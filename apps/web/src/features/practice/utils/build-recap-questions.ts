import { shuffled } from '@flicktionary/core/utils/shuffle'
import { normalizeTypedAnswer } from '@flicktionary/core/utils/typed-answer-grading'

// Pure question builder for the zero-LLM session recap: every question is
// derived from card data already on the client, graded locally, and never
// touches the SRS. Copy lives in the components — nothing here is user-facing.

export type RecapTerm = {
  cardId: string
  chunkId: string
  headword: string
  surfaceForm: string
  // Pre-resolved by the caller under the language-mode rules (translation vs
  // definition), guaranteed non-empty.
  gloss: string
  pos: string | null
  targetExample: string | null
}

// Character span into `sentence` marking the term's occurrence.
export type Span = { sentence: string; start: number; end: number }

export type RecapQuestion =
  | { kind: 'mc'; term: RecapTerm; stem: Span | null; options: string[]; answerIndex: number }
  | { kind: 'typed'; term: RecapTerm; blanked: Span | null; acceptedForms: string[] }

export type RecapQueueItem = RecapQuestion & { key: string; isRedrill: boolean }

// Case-insensitive substring match of the surface form (then the headword) in
// the example. Indices point into the original string so casing renders
// faithfully. Null when neither occurs — callers must then drop the sentence
// entirely (for typed questions it would reveal the answer).
const findSpan = (example: string, surfaceForm: string, headword: string): Span | null => {
  const haystack = example.toLowerCase()
  for (const needle of [surfaceForm, headword]) {
    const trimmed = needle.trim()
    if (trimmed.length === 0) continue
    const idx = haystack.indexOf(trimmed.toLowerCase())
    if (idx >= 0) return { sentence: example, start: idx, end: idx + trimmed.length }
  }
  return null
}

const dedupeByNormalized = (values: string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = normalizeTypedAnswer(value)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

const buildTyped = (term: RecapTerm): RecapQuestion => ({
  kind: 'typed',
  term,
  blanked: term.targetExample ? findSpan(term.targetExample, term.surfaceForm, term.headword) : null,
  acceptedForms: dedupeByNormalized([term.headword, term.surfaceForm]),
})

const MAX_MC_DISTRACTORS = 3
const MIN_MC_DISTRACTORS = 2

// Distractor glosses come from the session's other terms: never one that
// normalizes to the correct gloss (a second right answer), deduped, and drawn
// from the same-POS subset only when it can fill all three slots (a partial
// POS match would make the odd-one-out guessable by category).
const tryBuildMc = (term: RecapTerm, allTerms: RecapTerm[], rng: () => number): RecapQuestion | null => {
  const correctKey = normalizeTypedAnswer(term.gloss)
  const usable = dedupeByNormalized(allTerms.filter((t) => t.chunkId !== term.chunkId).map((t) => t.gloss)).filter(
    (gloss) => normalizeTypedAnswer(gloss) !== correctKey
  )
  const glossToPos = new Map(allTerms.map((t) => [normalizeTypedAnswer(t.gloss), t.pos]))
  const samePos =
    term.pos == null ? [] : usable.filter((gloss) => glossToPos.get(normalizeTypedAnswer(gloss)) === term.pos)
  const pool = samePos.length >= MAX_MC_DISTRACTORS ? samePos : usable
  const distractors = shuffled(pool, rng).slice(0, MAX_MC_DISTRACTORS)
  if (distractors.length < MIN_MC_DISTRACTORS) return null
  const options = shuffled([term.gloss, ...distractors], rng)
  return {
    kind: 'mc',
    term,
    stem: term.targetExample ? findSpan(term.targetExample, term.surfaceForm, term.headword) : null,
    options,
    answerIndex: options.indexOf(term.gloss),
  }
}

// Alternate kinds by parity over an already-shuffled order: random assignment
// on a 3-term session can come out all-MC or all-typed, parity guarantees a
// mix at every session size. MC that can't be built (too few usable
// distractors) falls back to typed, which is always buildable.
export const buildRecapQuestions = (terms: RecapTerm[], rng: () => number = Math.random): RecapQueueItem[] =>
  shuffled(terms, rng).map((term, i) => {
    const question = i % 2 === 0 ? (tryBuildMc(term, terms, rng) ?? buildTyped(term)) : buildTyped(term)
    return { ...question, key: term.chunkId, isRedrill: false }
  })

// A miss gets one retry at the end of the queue in the OTHER form (fresh
// retrieval attempt, not a memorized answer). A missed typed question whose
// MC can't be built repeats as typed — acceptable duplication.
export const buildRedrillQuestion = (
  term: RecapTerm,
  allTerms: RecapTerm[],
  previousKind: RecapQuestion['kind'],
  rng: () => number = Math.random
): RecapQueueItem => {
  const question = previousKind === 'mc' ? buildTyped(term) : (tryBuildMc(term, allTerms, rng) ?? buildTyped(term))
  return { ...question, key: `${term.chunkId}:redrill`, isRedrill: true }
}
