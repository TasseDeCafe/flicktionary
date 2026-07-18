import { getWordRanges } from '@flicktionary/core/dom/word-segmenter'
import { foldCheckpointToken, foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { CheckpointVocabRow } from '../../transport/database/user-lookups/user-lookups-repository'

// Pure matching/partitioning logic for checkpoint reviews (docs/SRS.md
// "Checkpoint reviews"). The collector orchestrates DB/LLM calls in
// collect-checkpoint.ts; everything here is deterministic and unit-tested.

export type TokenizedSpan = {
  // Every distinct folded word token in the span.
  foldedTokens: Set<string>
  // Folded tokens per segment index — the MWE recall filter's input (an MWE
  // candidate needs all its content lemmas within ONE segment).
  tokensBySegment: Map<number, Set<string>>
  // First span segment containing each token — sentence context for the
  // sense-disambiguation pass.
  contextByToken: Map<string, string>
  // Segment text by index — the MWE confirm pass's context (the whole
  // candidate segment, not one token's line).
  textBySegment: Map<number, string>
}

// Server-side tokenization uses the same Intl.Segmenter wrapper as the web
// reader's tap-to-select, so word boundaries match what the user read.
export const tokenizeSegments = (
  segments: ReadonlyArray<{ index: number; text: string }>,
  targetLanguage: string
): TokenizedSpan => {
  const foldedTokens = new Set<string>()
  const tokensBySegment = new Map<number, Set<string>>()
  const contextByToken = new Map<string, string>()
  const textBySegment = new Map<number, string>()
  for (const segment of segments) {
    const segmentTokens = new Set<string>()
    for (const [start, end] of getWordRanges(segment.text, targetLanguage)) {
      const folded = foldCheckpointToken(segment.text.slice(start, end), targetLanguage)
      if (!folded) continue
      foldedTokens.add(folded)
      segmentTokens.add(folded)
      if (!contextByToken.has(folded)) contextByToken.set(folded, segment.text)
    }
    if (segmentTokens.size > 0) {
      tokensBySegment.set(segment.index, segmentTokens)
      textBySegment.set(segment.index, segment.text)
    }
  }
  return { foldedTokens, tokensBySegment, contextByToken, textBySegment }
}

// A gloss/highlight selection can span several words — tokenize it with the
// SAME segmenter and fold each token, so a multi-word selection suppresses
// every lemma it touches.
export const foldSelectionTokens = (selectionText: string, targetLanguage: string): string[] => {
  const tokens: string[] = []
  for (const [start, end] of getWordRanges(selectionText, targetLanguage)) {
    const folded = foldCheckpointToken(selectionText.slice(start, end), targetLanguage)
    if (folded) tokens.push(folded)
  }
  return tokens
}

export type MatchedVocabRow = {
  row: CheckpointVocabRow
  // The folded span lemmas this row matched through (suppression and backlog
  // exclusion are lemma-keyed).
  matchedLemmas: Set<string>
  // Sentence context for the sense pass; null only if bookkeeping failed to
  // find one (defensive — a match always came from some token).
  contextSegmentText: string | null
}

// Intersect the user's vocabulary (folded via foldUserHeadwordCandidates)
// with the span's resolved lemma set. MWE headwords (containing spaces) don't
// single-token match; their particle-stripped variants ("to run" → "run",
// "sich freuen" → "freuen") do.
export const matchVocabAgainstSpanLemmas = (params: {
  vocab: readonly CheckpointVocabRow[]
  spanLemmas: ReadonlySet<string>
  contextByLemma: ReadonlyMap<string, string>
  targetLanguage: string
}): MatchedVocabRow[] => {
  const matched: MatchedVocabRow[] = []
  for (const row of params.vocab) {
    const candidates = foldUserHeadwordCandidates(row.lookup.headword, params.targetLanguage)
    const matchedLemmas = new Set<string>()
    for (const candidate of candidates) {
      if (params.spanLemmas.has(candidate)) matchedLemmas.add(candidate)
    }
    if (matchedLemmas.size === 0) continue
    let context: string | null = null
    for (const lemma of matchedLemmas) {
      const c = params.contextByLemma.get(lemma)
      if (c) {
        context = c
        break
      }
    }
    matched.push({ row, matchedLemmas, contextSegmentText: context })
  }
  return matched
}

// Per-language function-word particles dropped when splitting an MWE headword
// into content lemmas — mirrors foldUserHeadwordCandidates' prefixes, but for
// any position ("to run" AND "run to ground" both drop "to").
const MWE_PARTICLES: Record<string, ReadonlySet<string>> = {
  en: new Set(['to']),
  de: new Set(['sich']),
}

export const splitMweContentLemmas = (headword: string, targetLanguage: string): string[] => {
  const particles = MWE_PARTICLES[targetLanguage]
  const parts = foldCheckpointToken(headword, targetLanguage)
    .split(/\s+/)
    .filter((p) => p.length > 0 && !particles?.has(p))
  return [...new Set(parts)]
}

// MWE recall filter (docs/SRS.md §6b): a saved multi-word headword is a
// candidate iff EVERY content lemma is present within ONE segment — either as
// a resolved lemma of that segment's tokens (inflected occurrences count) or
// as a raw folded token (words wiktionary doesn't know still match exactly).
// Deliberately liberal: contiguity and order are NOT required (separable
// verbs, free word order, interruptions) — the Haiku confirm pass is the
// precision stage. Returns matches shaped like single-word ones; matchedLemmas
// carries the content lemmas so suppression/backlog exclusion stay lemma-keyed.
export const findMweCandidates = (params: {
  vocab: readonly CheckpointVocabRow[]
  span: TokenizedSpan
  lemmasByToken: ReadonlyMap<string, Set<string>>
  targetLanguage: string
}): MatchedVocabRow[] => {
  const mweRows = params.vocab.filter((row) => row.lookup.headword.trim().includes(' '))
  if (mweRows.length === 0) return []

  // Lemma view of each segment: the segment's own folded tokens plus every
  // lemma those tokens resolve to.
  const lemmasBySegment = new Map<number, Set<string>>()
  for (const [segmentIndex, tokens] of params.span.tokensBySegment) {
    const lemmas = new Set<string>(tokens)
    for (const token of tokens) {
      for (const lemma of params.lemmasByToken.get(token) ?? []) lemmas.add(lemma)
    }
    lemmasBySegment.set(segmentIndex, lemmas)
  }

  const candidates: MatchedVocabRow[] = []
  for (const row of mweRows) {
    const contentLemmas = splitMweContentLemmas(row.lookup.headword, params.targetLanguage)
    if (contentLemmas.length === 0) continue
    for (const [segmentIndex, segmentLemmas] of lemmasBySegment) {
      if (!contentLemmas.every((lemma) => segmentLemmas.has(lemma))) continue
      candidates.push({
        row,
        matchedLemmas: new Set(contentLemmas),
        contextSegmentText: params.span.textBySegment.get(segmentIndex) ?? null,
      })
      break
    }
  }
  return candidates
}

export type PartitionedMatches = {
  // The review-budget predicate: enabled, ready, unparked recognition facet in
  // srs_state new/review and due. Gets the implicit good.
  creditable: MatchedVocabRow[]
  // Never-introduced (srs_state NULL) enabled+ready facets — the backlog
  // known-assertion candidates. Includes onboarding-parked facets (the
  // assertion exits onboarding); the seed guards discriminate at write time.
  backlog: MatchedVocabRow[]
  // Matched but not gradable/claimable: missing facet, disabled, pending
  // data, not due, or mid learning-ladder. Only encounter aggregates persist.
  encounterOnly: MatchedVocabRow[]
  // Leech-parked with SRS history: excluded from BOTH lanes — weak contextual
  // evidence must never override the rehab loop. (Still recorded as a content
  // encounter by the caller.)
  excludedLeechParked: MatchedVocabRow[]
}

export const partitionMatches = (matched: readonly MatchedVocabRow[], now: Date): PartitionedMatches => {
  const result: PartitionedMatches = { creditable: [], backlog: [], encounterOnly: [], excludedLeechParked: [] }
  for (const match of matched) {
    const facet = match.row.facet
    if (!facet || facet.disabled_at !== null || facet.data_status !== 'ready') {
      result.encounterOnly.push(match)
      continue
    }
    if (facet.srs_state === null) {
      // Unparked never-introduced AND onboarding-parked both land in backlog.
      result.backlog.push(match)
      continue
    }
    if (facet.leech_parked_at !== null) {
      result.excludedLeechParked.push(match)
      continue
    }
    const due = facet.srs_due !== null && new Date(facet.srs_due).getTime() <= now.getTime()
    if ((facet.srs_state === 'new' || facet.srs_state === 'review') && due) {
      result.creditable.push(match)
    } else {
      result.encounterOnly.push(match)
    }
  }
  return result
}
