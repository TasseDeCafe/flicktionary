import { getWordRanges } from '@flicktionary/core/dom/word-segmenter'
import {
  foldCheckpointToken,
  foldUserHeadwordCandidates,
  stripReflexiveSuffix,
} from '@flicktionary/core/utils/checkpoint-fold'
import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { CheckpointVocabRow } from '../../transport/database/user-lookups/user-lookups-repository'

// Pure matching/partitioning logic for checkpoint reviews (docs/SRS.md
// "Checkpoint reviews"). The collector orchestrates DB/LLM calls in
// collect-checkpoint.ts; everything here is deterministic and unit-tested.

// One sighting of a token: the original cased slice plus a match-centered
// window of its segment — the claims-sheet evidence and the backlog confirm
// pass's context (segments can be whole pasted paragraphs, so never carry the
// full text here).
export type TokenOccurrence = {
  surface: string
  context: string
  segmentIndex: number
}

// Occurrences kept per folded token / per matched candidate. More than one
// matters because an early homograph must not hide a genuine later occurrence
// from the confirm pass; three is plenty for that purpose.
const MAX_OCCURRENCES = 3

// Characters kept on each side of the matched surface in an evidence window —
// sized for a ~2-line claims-sheet snippet (it doubles as the confirm pass's
// context, where clause-scale context is enough).
const OCCURRENCE_WINDOW_RADIUS = 80

const windowAroundRange = (text: string, start: number, end: number): string => {
  let from = Math.max(0, start - OCCURRENCE_WINDOW_RADIUS)
  let to = Math.min(text.length, end + OCCURRENCE_WINDOW_RADIUS)
  // Snap cut points to word boundaries so the window never opens or closes
  // mid-word (the ellipsis then reads as elided words, not a chopped one).
  if (from > 0) {
    const space = text.indexOf(' ', from)
    if (space !== -1 && space < start) from = space + 1
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space !== -1 && space > end) to = space
  }
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

// Digit-hyphen compounds («27-летний», de «27-jährige») split at the hyphen
// under Intl.Segmenter, and the letter part is a different lexeme from the
// standalone word — never a real occurrence of a saved term. Typographic
// hyphens/dashes (U+2010–U+2015, notably the non-breaking hyphen U+2011)
// split the same way as ASCII '-'; the class mirrors JOINER_PUNCTUATION in
// packages/core/src/utils/search-match.ts.
const HYPHEN_CHARS = /[-‐-―]/

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
  // Up to MAX_OCCURRENCES sightings per folded token, one per segment at most.
  occurrencesByToken: Map<string, TokenOccurrence[]>
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
  const occurrencesByToken = new Map<string, TokenOccurrence[]>()
  for (const segment of segments) {
    const segmentTokens = new Set<string>()
    for (const [start, end] of getWordRanges(segment.text, targetLanguage)) {
      if (HYPHEN_CHARS.test(segment.text[start - 1] ?? '') && /\d/.test(segment.text[start - 2] ?? '')) continue
      const folded = foldCheckpointToken(segment.text.slice(start, end), targetLanguage)
      if (!folded) continue
      foldedTokens.add(folded)
      if (!contextByToken.has(folded)) contextByToken.set(folded, segment.text)
      // One occurrence per segment per token: the first sighting stands in for
      // the segment, later segments add breadth for the confirm pass.
      if (!segmentTokens.has(folded)) {
        const occurrences = occurrencesByToken.get(folded) ?? []
        if (occurrences.length < MAX_OCCURRENCES) {
          occurrences.push({
            surface: segment.text.slice(start, end),
            context: windowAroundRange(segment.text, start, end),
            segmentIndex: segment.index,
          })
          occurrencesByToken.set(folded, occurrences)
        }
      }
      segmentTokens.add(folded)
    }
    if (segmentTokens.size > 0) {
      tokensBySegment.set(segment.index, segmentTokens)
      textBySegment.set(segment.index, segment.text)
    }
  }
  return { foldedTokens, tokensBySegment, contextByToken, textBySegment, occurrencesByToken }
}

// A gloss/highlight selection can span several words — tokenize it with the
// SAME segmenter and fold each token, so a multi-word selection suppresses
// every lemma it touches. Deliberately NOT digit-hyphen-guarded: broader
// suppression is strictly conservative (it can only prevent a credit/claim,
// never create one), and someone who highlighted «27-летний» plausibly did
// care about «летний».
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
  // Windowed sightings backing this match (claims-sheet evidence + the
  // backlog confirm pass's contexts). Capped at MAX_OCCURRENCES.
  occurrences: TokenOccurrence[]
  // True when a matched lemma appeared verbatim as a span token (the saved
  // headword itself was in the text) — such matches skip the backlog confirm
  // pass. MWE candidates are also marked direct: checkpointMwePass already
  // confirmed their occurrence.
  directTokenMatch: boolean
}

// Intersect the user's vocabulary (folded via foldUserHeadwordCandidates)
// with the span's resolved lemma set. MWE headwords (containing spaces) don't
// single-token match; their particle-stripped variants ("to run" → "run",
// "sich freuen" → "freuen") do.
export const matchVocabAgainstSpanLemmas = (params: {
  vocab: readonly CheckpointVocabRow[]
  spanLemmas: ReadonlySet<string>
  contextByLemma: ReadonlyMap<string, string>
  occurrencesByLemma: ReadonlyMap<string, readonly TokenOccurrence[]>
  spanTokens: ReadonlySet<string>
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
    const occurrences: TokenOccurrence[] = []
    let directTokenMatch = false
    for (const lemma of matchedLemmas) {
      if (params.spanTokens.has(lemma)) directTokenMatch = true
      if (!context) context = params.contextByLemma.get(lemma) ?? null
      for (const occurrence of params.occurrencesByLemma.get(lemma) ?? []) {
        if (occurrences.length < MAX_OCCURRENCES) occurrences.push(occurrence)
      }
    }
    matched.push({ row, matchedLemmas, contextSegmentText: context, occurrences, directTokenMatch })
  }
  return matched
}

// Per-language function-word particles dropped when splitting an MWE headword
// into content lemmas — mirrors foldUserHeadwordCandidates' prefixes, but for
// any position ("to run" AND "run to ground" both drop "to").
const MWE_PARTICLES: Record<string, ReadonlySet<string>> = {
  en: new Set(['to']),
  de: new Set(['sich']),
  es: new Set(['de', 'a', 'en', 'con', 'la', 'el', 'los', 'las', 'se', 'que']),
  pt: new Set(['de', 'a', 'o', 'os', 'as', 'em', 'com', 'se', 'que']),
  fr: new Set(['de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'à', 'au', 'aux', 'en', 'se', 'que', 'ne']),
}

// French hyphenated compounds (peut-être, grand-mère) are MWEs too: the
// segmenter splits them into separate word tokens at the hyphen, so they can
// only ever match through the content-lemma path.
export const isMweHeadword = (headword: string, targetLanguage: string): boolean => {
  const trimmed = headword.trim()
  return trimmed.includes(' ') || (targetLanguage === 'fr' && trimmed.includes('-'))
}

export const splitMweContentLemmas = (headword: string, targetLanguage: string): string[] => {
  const particles = MWE_PARTICLES[targetLanguage]
  const parts = foldCheckpointToken(headword, targetLanguage)
    .split(targetLanguage === 'fr' ? /[\s-]+/ : /\s+/)
    // The fold strips elided clitics only at the string head, so interior
    // parts re-fold: `coup d'état` yields `état` — the same value the
    // segmenter's `d'état` token folds to.
    .map((p) => foldCheckpointToken(p, targetLanguage))
    .filter((p) => p.length > 0 && !particles?.has(p))
    // Pronominal parts inside an MWE (`darse cuenta de` → `darse`) reduce to
    // their base verb — text tokens resolve to `dar`, never `darse`, so the
    // reflexive spelling as a required content lemma could never match.
    .map((p) => stripReflexiveSuffix(p, targetLanguage) ?? p)
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
  const mweRows = params.vocab.filter((row) => isMweHeadword(row.lookup.headword, params.targetLanguage))
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
        occurrences: findMweAnchorOccurrence(params, segmentIndex, contentLemmas),
        // The MWE confirm pass judges the actual occurrence; the backlog
        // confirm pass must not second-guess it with a single-word prompt.
        directTokenMatch: true,
      })
      break
    }
  }
  return candidates
}

// An MWE has no single matched surface, so its evidence anchors on ONE content
// word's occurrence in the matched segment. Content lemmas are tried longest
// first: languages without an MWE particle list (ru) keep function words like
// «в» as content lemmas, and anchoring on the first token resolving to one
// would center the window on an early stray «в»/«во» far from the expression —
// the longest lemma is the distinctive one («преддверии» for «в преддверии»).
const findMweAnchorOccurrence = (
  params: {
    span: TokenizedSpan
    lemmasByToken: ReadonlyMap<string, Set<string>>
  },
  segmentIndex: number,
  contentLemmas: readonly string[]
): TokenOccurrence[] => {
  const byDistinctiveness = [...contentLemmas].sort((a, b) => b.length - a.length)
  const segmentTokens = params.span.tokensBySegment.get(segmentIndex) ?? new Set<string>()
  for (const lemma of byDistinctiveness) {
    for (const token of segmentTokens) {
      const resolvesToLemma = token === lemma || (params.lemmasByToken.get(token)?.has(lemma) ?? false)
      if (!resolvesToLemma) continue
      const occurrence = params.span.occurrencesByToken.get(token)?.find((o) => o.segmentIndex === segmentIndex)
      if (occurrence) return [occurrence]
    }
  }
  return []
}

// A token→lemma edge is a homograph liability when the token's plausible
// readings differ wildly in frequency: «при» resolves to both the preposition
// «при» and «переть» (imperative «при́»), but a text containing «при» is
// essentially never an occurrence of «переть». Drop the dramatically rarer
// readings of an ambiguous token; a reading at least this many times rarer
// (by lemma_ranks rank) than the token's best reading goes.
export const HOMOGRAPH_RANK_FACTOR = 50
// ...unless the lemma is itself common: frequent lemmas (fr «suivre» behind
// «suis», es «comer» behind «como») are plausible readings even next to a
// top-rank sibling, so they always survive.
export const NEVER_DROP_RANK = 3000

// Filters the resolver's token→lemma map. Identity edges (the token IS that
// lemma's headword — fr «été») are never dropped, and a token whose readings
// are all unranked keeps everything, which makes the guard a natural no-op for
// languages without built lemma ranks.
export const applyFrequencyAsymmetryGuard = (
  lemmasByToken: ReadonlyMap<string, Set<string>>,
  ranks: ReadonlyMap<string, LemmaRankInfo>
): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>()
  for (const [token, lemmas] of lemmasByToken) {
    if (lemmas.size < 2) {
      result.set(token, lemmas)
      continue
    }
    let bestRank: number | null = null
    for (const lemma of lemmas) {
      const rank = ranks.get(lemma)?.rank
      if (rank !== undefined && (bestRank === null || rank < bestRank)) bestRank = rank
    }
    if (bestRank === null) {
      result.set(token, lemmas)
      continue
    }
    const kept = new Set<string>()
    for (const lemma of lemmas) {
      const rank = ranks.get(lemma)?.rank
      const isIdentity = lemma === token
      const isCommon = rank !== undefined && rank <= NEVER_DROP_RANK
      const isDramaticallyRarer = rank === undefined || rank >= HOMOGRAPH_RANK_FACTOR * bestRank
      if (isIdentity || isCommon || !isDramaticallyRarer) kept.add(lemma)
    }
    result.set(token, kept)
  }
  return result
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
