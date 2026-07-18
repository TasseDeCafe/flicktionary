import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type {
  DbStudySession,
  StudySessionsRepositoryInterface,
} from '../../transport/database/study-sessions/study-sessions-repository'
import type { StudySessionCheckpointsRepositoryInterface } from '../../transport/database/study-sessions/study-session-checkpoints-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import {
  mergeFacet,
  type UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { CheckpointSenseItem } from '../../transport/third-party/anthropic/passes/checkpoint-sense-pass'
import { applyTermRating, type WithTransaction } from '../practice/rate-term'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import {
  foldSelectionTokens,
  matchVocabAgainstSpanLemmas,
  partitionMatches,
  tokenizeSegments,
  type MatchedVocabRow,
} from './checkpoint-matching'

export type CheckpointDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
  studySessionCheckpointsRepository: StudySessionCheckpointsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
  withTransaction: WithTransaction
}

export type PreviewedSpan = { segmentIndex: number; selectionText: string }

export type BacklogCandidate = { userLookupId: string; headword: string; sense: string }

export type CollectCheckpointResult =
  | { ok: false; reason: 'not_found' | 'unsupported_language' | 'conflict' }
  | {
      ok: true
      checkpointId: string | null
      fromSegmentIndex: number | null
      toSegmentIndex: number
      creditedCount: number
      suppressedCount: number
      backlogCandidates: BacklogCandidate[]
    }

export type CheckpointPreviewResult =
  { ok: false; reason: 'not_found' } | { ok: true; pendingCount: number; backlogCount: number; supported: boolean }

type SpanMatch = {
  fromSegmentIndex: number | null
  clampedTo: number
  empty: boolean
  matched: MatchedVocabRow[]
  suppressedLemmas: Set<string>
  backlogExcludedLemmas: Set<string>
}

// Steps 1–5 of the collect algorithm, shared with the preview path: clamp the
// span, tokenize it, resolve span + suppression tokens to lemmas through the
// wiktionary matcher, and intersect with the user's folded vocabulary.
const computeSpanMatch = async (
  session: DbStudySession,
  userId: string,
  toSegmentIndex: number,
  previewedSpans: readonly PreviewedSpan[],
  deps: CheckpointDependencies
): Promise<SpanMatch> => {
  const lang = session.target_language
  const from = session.reviewed_until_segment_index
  const fromExclusive = from ?? -1

  const maxIndex = await deps.textSegmentsRepository.getMaxIndexForTrack(session.text_track_id)
  const clampedTo = maxIndex === null ? -1 : Math.min(toSegmentIndex, maxIndex)
  if (clampedTo <= fromExclusive) {
    return {
      fromSegmentIndex: from,
      clampedTo,
      empty: true,
      matched: [],
      suppressedLemmas: new Set(),
      backlogExcludedLemmas: new Set(),
    }
  }

  const segments = await deps.textSegmentsRepository.listByIndexRange(
    session.text_track_id,
    fromExclusive + 1,
    clampedTo
  )
  const span = tokenizeSegments(segments, lang)

  // Suppression inputs. Highlights come from the DB (server-authoritative);
  // previewed gloss spans are client-tracked (the preview-gloss endpoint is
  // stateless) and already filtered to this collect call. Credit suppression
  // uses only the span's own lookups; backlog exclusion additionally uses the
  // WHOLE session's highlights — a term deliberately saved in this session
  // must not be offered for known-away.
  const highlightSpans = await deps.highlightsRepository.listSelectionSpansBySession(session.id)
  const inSpan = (segmentIndex: number): boolean => segmentIndex > fromExclusive && segmentIndex <= clampedTo
  const suppressionTokens = new Set<string>()
  const backlogExclusionTokens = new Set<string>()
  for (const h of highlightSpans) {
    for (const token of foldSelectionTokens(h.selection_text, lang)) {
      backlogExclusionTokens.add(token)
      if (inSpan(h.segment_index)) suppressionTokens.add(token)
    }
  }
  for (const p of previewedSpans) {
    if (!inSpan(p.segmentIndex)) continue
    for (const token of foldSelectionTokens(p.selectionText, lang)) {
      suppressionTokens.add(token)
      backlogExclusionTokens.add(token)
    }
  }

  // One resolver round trip covers span tokens AND suppression tokens.
  const allTokens = [...new Set([...span.foldedTokens, ...suppressionTokens, ...backlogExclusionTokens])]
  const lemmasByToken = await deps.wiktionaryMatchRepository.resolveFoldedLemmasForTokens({
    targetLanguage: lang,
    foldedTokens: allTokens,
  })

  const spanLemmas = new Set<string>()
  const contextByLemma = new Map<string, string>()
  for (const token of span.foldedTokens) {
    const lemmas = lemmasByToken.get(token)
    if (!lemmas) continue
    const context = span.contextByToken.get(token)
    for (const lemma of lemmas) {
      spanLemmas.add(lemma)
      if (context && !contextByLemma.has(lemma)) contextByLemma.set(lemma, context)
    }
  }
  const collectLemmas = (tokens: ReadonlySet<string>): Set<string> => {
    const out = new Set<string>()
    for (const token of tokens) {
      for (const lemma of lemmasByToken.get(token) ?? []) out.add(lemma)
    }
    return out
  }

  const vocab = await deps.userLookupsRepository.listCheckpointVocab({ userId, targetLanguage: lang })
  const matched = matchVocabAgainstSpanLemmas({ vocab, spanLemmas, contextByLemma, targetLanguage: lang })

  return {
    fromSegmentIndex: from,
    clampedTo,
    empty: false,
    matched,
    suppressedLemmas: collectLemmas(suppressionTokens),
    backlogExcludedLemmas: collectLemmas(backlogExclusionTokens),
  }
}

// Multi-sense resolution BEFORE partitioning, across ALL matched lookups —
// otherwise one sense could be credited while another is offered as backlog.
// Only headwords with 2+ saved senses in the match set reach the LLM; a pass
// failure drops those headwords entirely (conservative).
const resolveMultiSenseMatches = async (
  matched: MatchedVocabRow[],
  targetLanguage: string,
  deps: CheckpointDependencies
): Promise<MatchedVocabRow[]> => {
  const byHeadword = new Map<string, MatchedVocabRow[]>()
  for (const match of matched) {
    const group = byHeadword.get(match.row.lookup.headword)
    if (group) group.push(match)
    else byHeadword.set(match.row.lookup.headword, [match])
  }
  const items: CheckpointSenseItem[] = []
  for (const [headword, group] of byHeadword) {
    if (group.length < 2) continue
    items.push({
      headword,
      segmentText: group[0]!.contextSegmentText ?? '',
      senses: group.map((g) => ({ userLookupId: g.row.lookup.id, sense: g.row.lookup.sense })),
    })
  }
  if (items.length === 0) return matched

  let pickedIds: Set<string>
  const multiSenseHeadwords = new Set(items.map((i) => i.headword))
  try {
    const picks = await deps.anthropicPasses.checkpointSensePass({ targetLanguage, items })
    pickedIds = new Set(picks.flatMap((p) => (p.pickedUserLookupId ? [p.pickedUserLookupId] : [])))
  } catch (error) {
    logWithSentry({ message: 'checkpointSensePass failed; dropping multi-sense headwords', params: {}, error })
    pickedIds = new Set()
  }
  return matched.filter((m) => !multiSenseHeadwords.has(m.row.lookup.headword) || pickedIds.has(m.row.lookup.id))
}

const applySuppression = (
  partition: ReturnType<typeof partitionMatches>,
  suppressedLemmas: ReadonlySet<string>,
  backlogExcludedLemmas: ReadonlySet<string>
): { creditable: MatchedVocabRow[]; suppressedCount: number; backlog: MatchedVocabRow[] } => {
  const intersects = (lemmas: ReadonlySet<string>, exclusion: ReadonlySet<string>): boolean => {
    for (const lemma of lemmas) if (exclusion.has(lemma)) return true
    return false
  }
  const creditable = partition.creditable.filter((m) => !intersects(m.matchedLemmas, suppressedLemmas))
  const backlog = partition.backlog.filter((m) => !intersects(m.matchedLemmas, backlogExcludedLemmas))
  return { creditable, suppressedCount: partition.creditable.length - creditable.length, backlog }
}

// Read-only preview for the footer badge. Skips the sense pass (multi-sense
// headwords count optimistically) and cannot see previewed-gloss spans (GET,
// no body) — documented overcount; the collect toast shows the real number.
export const previewCheckpoint = async (
  params: { sessionId: string; userId: string; toSegmentIndex: number },
  deps: CheckpointDependencies
): Promise<CheckpointPreviewResult> => {
  const session = await deps.studySessionsRepository.findByIdForUser(params.sessionId, params.userId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (!KAIKKI_LANGUAGES.has(session.target_language)) {
    return { ok: true, pendingCount: 0, backlogCount: 0, supported: false }
  }
  const span = await computeSpanMatch(session, params.userId, params.toSegmentIndex, [], deps)
  if (span.empty) return { ok: true, pendingCount: 0, backlogCount: 0, supported: true }
  const partition = partitionMatches(span.matched, new Date())
  const { creditable, backlog } = applySuppression(partition, span.suppressedLemmas, span.backlogExcludedLemmas)
  return { ok: true, pendingCount: creditable.length, backlogCount: backlog.length, supported: true }
}

// The checkpoint press. Matching and the sense pass run OUTSIDE the write
// transaction; the transaction re-locks the session pointer (CONFLICT if a
// concurrent press advanced it), reloads the creditable facets and re-validates
// the full creditable predicate on the fresh rows (a rating that landed during
// the LLM call skips that facet), then credits, inserts the checkpoint row,
// advances the pointer, and records content encounters atomically.
export const collectCheckpoint = async (
  params: {
    sessionId: string
    userId: string
    toSegmentIndex: number
    previewedSpans: readonly PreviewedSpan[]
  },
  deps: CheckpointDependencies
): Promise<CollectCheckpointResult> => {
  const session = await deps.studySessionsRepository.findByIdForUser(params.sessionId, params.userId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (!KAIKKI_LANGUAGES.has(session.target_language)) return { ok: false, reason: 'unsupported_language' }

  const span = await computeSpanMatch(session, params.userId, params.toSegmentIndex, params.previewedSpans, deps)
  if (span.empty) {
    return {
      ok: true,
      checkpointId: null,
      fromSegmentIndex: span.fromSegmentIndex,
      toSegmentIndex: span.clampedTo,
      creditedCount: 0,
      suppressedCount: 0,
      backlogCandidates: [],
    }
  }

  const resolved = await resolveMultiSenseMatches(span.matched, session.target_language, deps)
  const partition = partitionMatches(resolved, new Date())
  const { creditable, suppressedCount, backlog } = applySuppression(
    partition,
    span.suppressedLemmas,
    span.backlogExcludedLemmas
  )

  const allMatchedIds = [...new Set(resolved.map((m) => m.row.lookup.id))]
  const creditableById = new Map(creditable.map((m) => [m.row.lookup.id, m]))

  const txResult = await deps.withTransaction(async (tx) => {
    const locked = await deps.studySessionsRepository.lockReviewedUntilForUpdate(params.sessionId, params.userId, tx)
    if (!locked) return { conflict: true as const }
    if (locked.reviewed_until_segment_index !== span.fromSegmentIndex) return { conflict: true as const }

    // Fresh reload + full predicate re-validation: applyTermRating computes
    // from the row it is handed, so it MUST be handed these fresh rows.
    const freshFacets = await deps.studyFacetsRepository.listFacetsByLookupIds(
      { userLookupIds: [...creditableById.keys()], skill: 'meaning_recognition', targetForm: CITATION_FORM },
      tx
    )
    const now = Date.now()
    const survivors = freshFacets.filter(
      (f) =>
        f.disabled_at === null &&
        f.data_status === 'ready' &&
        f.leech_parked_at === null &&
        (f.srs_state === 'new' || f.srs_state === 'review') &&
        f.srs_due !== null &&
        new Date(f.srs_due).getTime() <= now
    )

    const checkpoint = await deps.studySessionCheckpointsRepository.insert(
      {
        userId: params.userId,
        studySessionId: params.sessionId,
        fromSegmentIndex: span.fromSegmentIndex,
        toSegmentIndex: span.clampedTo,
        creditedCount: survivors.length,
        backlogCandidateIds: backlog.map((m) => m.row.lookup.id),
      },
      tx
    )

    for (const facet of survivors) {
      const match = creditableById.get(facet.user_lookup_id)
      if (!match) continue
      await applyTermRating({
        lookup: mergeFacet(match.row.lookup, facet),
        userId: params.userId,
        rating: 'good',
        pool: 'recognition',
        // The creditable predicate guarantees an already-scheduled facet, so
        // the introduction guard is never reached; 0 documents that a
        // checkpoint can never introduce.
        maxNewTerms: 0,
        wasExplicit: false,
        studySessionId: params.sessionId,
        checkpointId: checkpoint.id,
        deps: {
          userLookupsRepository: deps.userLookupsRepository,
          studyFacetsRepository: deps.studyFacetsRepository,
          practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
          userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
          withTransaction: (fn) => fn(tx),
        },
      })
    }

    await deps.studySessionsRepository.advanceReviewedUntil(params.sessionId, params.userId, span.clampedTo, tx)
    await deps.userLookupsRepository.recordContentEncounter(allMatchedIds, tx)

    return { conflict: false as const, checkpointId: checkpoint.id, creditedCount: survivors.length }
  })

  if (txResult.conflict) return { ok: false, reason: 'conflict' }
  return {
    ok: true,
    checkpointId: txResult.checkpointId,
    fromSegmentIndex: span.fromSegmentIndex,
    toSegmentIndex: span.clampedTo,
    creditedCount: txResult.creditedCount,
    suppressedCount,
    backlogCandidates: backlog.map((m) => ({
      userLookupId: m.row.lookup.id,
      headword: m.row.lookup.headword,
      sense: m.row.lookup.sense,
    })),
  }
}
