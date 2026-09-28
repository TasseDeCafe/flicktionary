import { WORD_FAMILY_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import type {
  WordFamilyCandidate,
  WordFamilyEntry,
  WordFamilyRepositoryInterface,
  WordFamilyTier,
  WordFamilyVocabularyRow,
} from '../../transport/database/word-family/word-family-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { foldSelectionTokens } from '../checkpoint/checkpoint-matching'
import { normalizeFastGlossPos } from '../wiktionary-grounding/fast-gloss-ipa'
import { isInformativeStructure, parseWordFamily, type ParsedWordFamily, type StructurePart } from './parse-word-family'

// The reader gloss sheet's word-family line (docs/proposals/word-family-hints.md):
// how the tapped word is built, plus up to MAX_ANCHORS relatives the user
// already has. Deterministic — kaikki data and the user's vocabulary only.

export const MAX_ANCHORS = 3

export type WordFamilyAnchor = { lemma: string; source: 'known' | 'saved' }

export type WordFamily = {
  formOf: ParsedWordFamily['formOf']
  parts: StructurePart[] | null
  anchors: WordFamilyAnchor[]
}

export type WordFamilyDependencies = {
  wordFamilyRepository: WordFamilyRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
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

// Finishes the family line once the gloss's POS is known. Null when there is
// nothing worth showing: no informative structure and no anchor.
export const buildWordFamily = async (
  params: { userId: string; targetLanguage: string; lookup: WordFamilyLookup | null; pos: string | null },
  deps: WordFamilyDependencies
): Promise<WordFamily | null> => {
  const { userId, targetLanguage, lookup } = params
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

  const candidates = await deps.wordFamilyRepository.listFamilyCandidates({
    targetLanguage,
    lemma: picked.folded,
    lemmaPos: [...new Set(picked.entries.map((entry) => entry.pos))],
  })
  const vocabulary = await deps.wordFamilyRepository.listUserVocabulary({
    userId,
    targetLanguage,
    lemmas: candidates.map((c) => c.lemma),
  })
  const ranked = rankAnchors(candidates, vocabulary, new Set([picked.folded]))

  // A bare "X + -ся" breakdown only shows next to an anchor.
  if (ranked.length === 0 && !isInformativeStructure({ formOf, parts }, targetLanguage)) return null

  // Folded keys lose what a reader needs (ё, capitals) — show dictionary spellings.
  const display = await deps.wiktionaryMatchRepository.resolveDisplayHeadwords({
    targetLanguage,
    foldedLemmas: ranked.map((a) => a.lemma),
  })
  return {
    formOf,
    parts,
    anchors: ranked.map((a) => ({ lemma: display.get(a.lemma) ?? a.lemma, source: a.source })),
  }
}
