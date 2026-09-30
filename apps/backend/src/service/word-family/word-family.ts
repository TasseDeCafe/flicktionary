import { WORD_FAMILY_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  StoredWordFamilyInsight,
  WordFamilyCandidate,
  WordFamilyEntry,
  WordFamilyRepositoryInterface,
  WordFamilyTier,
  WordFamilyVocabularyRow,
} from '../../transport/database/word-family/word-family-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { foldSelectionTokens } from '../checkpoint/checkpoint-matching'
import { getLanguageMode } from '../user-prefs/language-mode'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { normalizeFastGlossPos } from '../wiktionary-grounding/fast-gloss-ipa'
import { isInformativeStructure, parseWordFamily, type ParsedWordFamily, type StructurePart } from './parse-word-family'

// The reader gloss sheet's word-family line (docs/proposals/word-family-hints.md):
// how the tapped word is built, plus up to MAX_ANCHORS relatives the user
// already has. The kaikki data and the user's vocabulary give a deterministic
// line; a per-lemma LLM insight (cached for every user, generated on demand
// by ensureWordFamilyInsight) then explains the parts, adds parents kaikki
// lacks and drops ancestors a learner can't see.

export const MAX_ANCHORS = 3

// Insights are only generated for content words: function words have no
// breakdown worth an LLM call.
const INSIGHT_POS = new Set(['noun', 'verb', 'adj', 'adv'])

export type WordFamilyAnchor = { lemma: string; source: 'known' | 'saved' }

export type WordFamilyPart = StructurePart & { meaning: string | null }

export type WordFamily = {
  formOf: ParsedWordFamily['formOf']
  parts: WordFamilyPart[] | null
  anchors: WordFamilyAnchor[]
  cognates: string[]
  // True when the lemma's insight isn't cached yet for the reader's
  // explanation language; the client then asks glosses.wordFamilyInsight.
  insightPending: boolean
}

export type WordFamilyDependencies = {
  wordFamilyRepository: WordFamilyRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  anthropicPasses: Pick<AnthropicPassesInterface, 'wordFamilyInsightPass'>
}

type ParsedEntry = WordFamilyEntry & { parsed: ParsedWordFamily }

export type PickedFamilyEntries = { folded: string; entries: ParsedEntry[] }

// Chooses which dictionary word the tap refers to. Stubs only count when they
// carry a followable form-of (participles etc.). The fast gloss's POS goes
// first when it matches anything (стекло as a verb is стечь, not the noun).
// Then a headword that IS the tapped token beats paradigm hits — ru verb
// paradigms list their aspect partner (угаснуть's forms include угасать) —
// and a participle stub beats its own verb (замёрзший over замёрзнуть — the
// structure line should say it's a participle). Anything still ambiguous gets
// no family line: a wrong anchor would hide the translation for nothing.
export const pickFamilyEntries = (
  entries: readonly WordFamilyEntry[],
  foldedToken: string,
  kaikkiPos: string | null,
  targetLanguage: string
): PickedFamilyEntries | null => {
  const parsed: ParsedEntry[] = entries
    .map((entry) => ({ ...entry, parsed: parseWordFamily(entry.data, targetLanguage) }))
    .filter((entry) => entry.isRealLemma || entry.parsed.formOf !== null)
  if (parsed.length === 0) return null

  const posMatches = kaikkiPos ? parsed.filter((entry) => entry.pos === kaikkiPos) : []
  const byPos = posMatches.length > 0 ? posMatches : parsed
  const direct = byPos.filter((entry) => entry.folded === foldedToken)
  const pool = direct.length > 0 ? direct : byPos

  const formOfTargets = new Set(
    pool.flatMap((entry) =>
      entry.parsed.formOf ? [foldCheckpointToken(entry.parsed.formOf.lemma, targetLanguage)] : []
    )
  )
  const specific = pool.filter((entry) => entry.parsed.formOf !== null || !formOfTargets.has(entry.folded))

  const lemmas = new Set(specific.map((entry) => entry.folded))
  if (lemmas.size !== 1) return null
  return { folded: specific[0].folded, entries: specific }
}

const TIER_ORDER: Record<WordFamilyTier, number> = { parent: 0, shared_root: 1, related: 2 }

export type RankedAnchor = { lemma: string; source: 'known' | 'saved'; tier: WordFamilyTier }

// Orders the family members the user has: parent, then shared root, then
// related; within a tier known before saved, then most frequent first. A live
// saved term beats a known mark for the same lemma (saving a marked-known
// word says the user does NOT know it). `excluded` holds the tapped word's
// own lemma(s), which can't be its own anchor.
export const rankAnchors = (
  candidates: readonly WordFamilyCandidate[],
  vocabulary: readonly WordFamilyVocabularyRow[],
  excluded: ReadonlySet<string>
): RankedAnchor[] => {
  const best = new Map<string, WordFamilyCandidate>()
  for (const candidate of candidates) {
    if (excluded.has(candidate.lemma)) continue
    const current = best.get(candidate.lemma)
    if (
      !current ||
      TIER_ORDER[candidate.tier] < TIER_ORDER[current.tier] ||
      (candidate.tier === current.tier && candidate.depth < current.depth)
    ) {
      best.set(candidate.lemma, candidate)
    }
  }

  const ranked = vocabulary.flatMap((row) => {
    const candidate = best.get(row.lemma)
    if (!candidate || (!row.known && !row.saved)) return []
    return [{ ...candidate, source: row.saved ? ('saved' as const) : ('known' as const), rank: row.rank }]
  })
  ranked.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (a.source === b.source ? 0 : a.source === 'known' ? -1 : 1) ||
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.depth - b.depth ||
      a.lemma.localeCompare(b.lemma)
  )
  return ranked.slice(0, MAX_ANCHORS).map(({ lemma, source, tier }) => ({ lemma, source, tier }))
}

export type WordFamilyLookup = { foldedToken: string; entries: WordFamilyEntry[] }

// The kaikki entries a single-word selection can belong to — the DB half that
// doesn't need the gloss, so callers run it alongside the LLM call. Null when
// the language has no word-family data or the selection is a multi-word
// expression (skipped by design).
export const loadWordFamilyEntries = async (
  params: { targetLanguage: string; selectionText: string },
  deps: Pick<WordFamilyDependencies, 'wordFamilyRepository'>
): Promise<WordFamilyLookup | null> => {
  if (!WORD_FAMILY_LANGUAGES.has(params.targetLanguage)) return null
  const selection = params.selectionText.trim()
  if (!selection || /\s/.test(selection)) return null
  const tokens = foldSelectionTokens(selection, params.targetLanguage)
  if (tokens.length !== 1) return null
  const foldedToken = tokens[0]
  const entries = await deps.wordFamilyRepository.listEntriesForToken({
    targetLanguage: params.targetLanguage,
    foldedToken,
  })
  return { foldedToken, entries }
}

// True when the breakdown's only base is the form-of target itself.
const onlyRestates = (parts: readonly StructurePart[], formOfFolded: string, targetLanguage: string): boolean => {
  const bases = parts.filter((part) => !part.isAffix)
  return bases.length === 1 && foldCheckpointToken(bases[0].text, targetLanguage) === formOfFolded
}

const firstParts = (entries: readonly ParsedEntry[]): StructurePart[] | null =>
  entries.find((entry) => entry.parsed.parts !== null)?.parsed.parts ?? null

// Which structure the line shows. A generated insight's breakdown replaces
// kaikki's (an empty one means the word is opaque: no breakdown at all);
// without one the kaikki parts show, unexplained.
export const resolveDisplayedParts = (
  kaikkiParts: readonly StructurePart[] | null,
  insight: StoredWordFamilyInsight | null
): WordFamilyPart[] | null => {
  if (insight?.explanation) {
    const meanings = insight.explanation.partMeanings
    if (insight.parts.length === 0) return null
    return insight.parts.map((part, index) => ({ ...part, meaning: meanings[index] ?? null }))
  }
  return kaikkiParts ? kaikkiParts.map((part) => ({ ...part, meaning: null })) : null
}

type ResolvedWord = {
  lemma: string
  lemmaPos: string[]
  // The insight key's POS: the first picked entry's.
  insightPos: string
  headword: string
  formOf: ParsedWordFamily['formOf']
  kaikkiParts: StructurePart[] | null
}

const resolveWord = async (
  params: { targetLanguage: string; lookup: WordFamilyLookup | null; pos: string | null },
  deps: Pick<WordFamilyDependencies, 'wordFamilyRepository'>
): Promise<ResolvedWord | null> => {
  const { targetLanguage, lookup } = params
  if (!lookup || lookup.entries.length === 0) return null
  const picked = pickFamilyEntries(
    lookup.entries,
    lookup.foldedToken,
    normalizeFastGlossPos(params.pos),
    targetLanguage
  )
  if (!picked) return null

  const formOf = picked.entries.find((entry) => entry.parsed.formOf)?.parsed.formOf ?? null
  // A participle's own entry has no etymology, and a passive's (врезаться =
  // врезать + -ся) only repeats the form-of line; the verb's breakdown is the
  // useful one (замёрзший → participle of замёрзнуть · за- + мёрзнуть).
  let parts = firstParts(picked.entries)
  const formOfFolded = formOf ? foldCheckpointToken(formOf.lemma, targetLanguage) : null
  if (formOf && formOfFolded && (!parts || onlyRestates(parts, formOfFolded, targetLanguage))) {
    const lemmaEntries = await deps.wordFamilyRepository.listLemmaEntries({ targetLanguage, folded: formOfFolded })
    const lemmaParts = firstParts(
      lemmaEntries.map((entry) => ({ ...entry, parsed: parseWordFamily(entry.data, targetLanguage) }))
    )
    if (lemmaParts) parts = lemmaParts
  }
  return {
    lemma: picked.folded,
    lemmaPos: [...new Set(picked.entries.map((entry) => entry.pos))],
    insightPos: picked.entries[0].pos,
    headword: picked.entries[0].headword,
    formOf,
    kaikkiParts: parts,
  }
}

const FORM_OF_DESCRIPTIONS: Record<NonNullable<ParsedWordFamily['formOf']>['kind'], string> = {
  participle: 'participle',
  adverbial_participle: 'adverbial participle',
  gerund: 'gerund',
  passive: 'passive',
  verbal_noun: 'verbal noun',
}

// Generates and stores the word's insight for `explanationLanguage` when it
// isn't cached yet. A breakdown generated for another explanation language
// is kept; the pass then only explains its parts. Parents kaikki lacks (the
// suggested ones and the breakdown's base words) are kept only when they are
// real kaikki lemmas, which guards against invented words.
const generateInsight = async (
  params: { targetLanguage: string; explanationLanguage: string; word: ResolvedWord },
  existing: StoredWordFamilyInsight | null,
  deps: WordFamilyDependencies
): Promise<void> => {
  const { targetLanguage, explanationLanguage, word } = params
  const ancestors = existing
    ? []
    : await deps.wordFamilyRepository.listAncestors({ targetLanguage, lemma: word.lemma, lemmaPos: word.lemmaPos })
  const ancestorDisplay = await deps.wiktionaryMatchRepository.resolveDisplayHeadwords({
    targetLanguage,
    foldedLemmas: ancestors,
  })
  const result = await deps.anthropicPasses.wordFamilyInsightPass({
    targetLanguage,
    explanationLanguage,
    headword: word.headword,
    pos: word.insightPos,
    formOf: word.formOf ? `${FORM_OF_DESCRIPTIONS[word.formOf.kind]} of ${word.formOf.lemma}` : null,
    kaikkiParts: word.kaikkiParts,
    ancestors: ancestors.map((a) => ancestorDisplay.get(a) ?? a),
    fixedParts: existing?.parts ?? null,
  })

  const fold = (text: string) => foldCheckpointToken(text, targetLanguage)
  const known = new Set(ancestors)
  // The breakdown's base words are parents too (ожог = о- + жечь when kaikki
  // has no etymology for ожог).
  const bases = result.parts.filter((part) => !part.isAffix).map((part) => part.text)
  const suggested = [...new Set([...result.missingParents, ...bases].map(fold))].filter(
    (p) => p !== word.lemma && !known.has(p)
  )
  const real = await deps.wiktionaryMatchRepository.resolveDisplayHeadwords({
    targetLanguage,
    foldedLemmas: suggested,
  })
  const stored = await deps.wordFamilyRepository.saveInsight({
    targetLanguage,
    lemma: word.lemma,
    lemmaPos: word.insightPos,
    explanationLanguage,
    parts: result.parts,
    missingParents: suggested.filter((p) => real.has(p)),
    // A base word the breakdown shows is visible by definition.
    hiddenAncestors: [...new Set(result.hiddenAncestors.map(fold))].filter(
      (a) => known.has(a) && !bases.some((base) => fold(base) === a)
    ),
    partMeanings: result.partMeanings,
    cognates: result.cognates,
    model: result.model,
  })
  // A concurrent request for another explanation language stored a different
  // breakdown first: explain that one instead.
  if (!stored && !existing) {
    const winner = await deps.wordFamilyRepository.getInsight({
      targetLanguage,
      lemma: word.lemma,
      lemmaPos: word.insightPos,
      explanationLanguage,
    })
    if (winner && !winner.explanation) await generateInsight(params, winner, deps)
  }
}

// Finishes the family line once the gloss's POS is known. With
// `generateInsight`, a missing insight is generated first (the slow path the
// client triggers after the first render). Null when there is nothing worth
// showing and nothing left to generate.
export const buildWordFamily = async (
  params: {
    userId: string
    targetLanguage: string
    explanationLanguage: string
    lookup: WordFamilyLookup | null
    pos: string | null
    generateInsight?: boolean
  },
  deps: WordFamilyDependencies
): Promise<WordFamily | null> => {
  const { userId, targetLanguage, explanationLanguage } = params
  const word = await resolveWord(params, deps)
  if (!word) return null

  const insightKey = { targetLanguage, lemma: word.lemma, lemmaPos: word.insightPos, explanationLanguage }
  const wantsInsight = INSIGHT_POS.has(word.insightPos)
  let insight = wantsInsight ? await deps.wordFamilyRepository.getInsight(insightKey) : null
  if (wantsInsight && params.generateInsight && !insight?.explanation) {
    await generateInsight({ targetLanguage, explanationLanguage, word }, insight, deps)
    insight = await deps.wordFamilyRepository.getInsight(insightKey)
  }
  const insightPending = wantsInsight && !insight?.explanation

  const candidates = await deps.wordFamilyRepository.listFamilyCandidates({
    targetLanguage,
    lemma: word.lemma,
    lemmaPos: word.lemmaPos,
    hiddenAncestors: insight?.hiddenAncestors ?? [],
    extraParents: insight?.missingParents ?? [],
  })
  const vocabulary = await deps.wordFamilyRepository.listUserVocabulary({
    userId,
    targetLanguage,
    lemmas: candidates.map((c) => c.lemma),
  })
  const ranked = rankAnchors(candidates, vocabulary, new Set([word.lemma]))

  const parts = resolveDisplayedParts(word.kaikkiParts, insight)
  const explained = parts?.some((part) => part.meaning) ?? false
  const cognates = insight?.explanation?.cognates ?? []
  // A bare "X + -ся" breakdown only shows next to an anchor or explained.
  const structureShown =
    ranked.length > 0 || explained || isInformativeStructure({ formOf: word.formOf, parts }, targetLanguage)
  if (!structureShown && cognates.length === 0 && !insightPending) return null

  // Folded keys lose what a reader needs (ё, capitals) — show dictionary spellings.
  const display = await deps.wiktionaryMatchRepository.resolveDisplayHeadwords({
    targetLanguage,
    foldedLemmas: ranked.map((a) => a.lemma),
  })
  return {
    formOf: structureShown ? word.formOf : null,
    parts: structureShown ? parts : null,
    anchors: ranked.map((a) => ({ lemma: display.get(a.lemma) ?? a.lemma, source: a.source })),
    cognates,
    insightPending,
  }
}

// Word-family explanations follow the gloss: in the native language, or in
// the target language for translations-off learners.
export const explanationLanguageFor = (
  targetLanguage: string,
  prefs: { nativeLanguage: string | null; hideTranslationFields: boolean }
): string => (prefs.hideTranslationFields || !prefs.nativeLanguage ? targetLanguage : prefs.nativeLanguage)

// The word-family line for a word whose gloss (and so POS) is already known —
// a saved highlight's gloss sheet, so the line it showed in preview survives
// Save and reopen. Reads the language mode the same way the preview gloss
// does, so it resolves the same cached insight. Null when the reader has the
// hints off for this language.
export const loadGlossedWordFamily = async (
  params: { userId: string; targetLanguage: string; selectionText: string; pos: string | null },
  deps: WordFamilyDependencies & {
    usersRepository: UsersRepositoryInterface
    userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  }
): Promise<WordFamily | null> => {
  const { userId, targetLanguage, selectionText, pos } = params
  if (!(await deps.userTargetLanguagePrefsRepository.getWordFamilyHintsEnabled(userId, targetLanguage))) return null
  const [languagePrefs, lookup] = await Promise.all([
    getLanguageMode({
      userId,
      targetLanguage,
      usersRepository: deps.usersRepository,
      targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    }),
    loadWordFamilyEntries({ targetLanguage, selectionText }, deps),
  ])
  return buildWordFamily(
    {
      userId,
      targetLanguage,
      explanationLanguage: explanationLanguageFor(targetLanguage, languagePrefs),
      lookup,
      pos,
    },
    deps
  )
}
