import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { TextTrackLemmaProfilesRepositoryInterface } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { countFoldedTokens } from '../lemma-profiles/count-tokens'
import { resolveTrackProfileReadiness } from '../lemma-profiles/profile-readiness'

// The per-session "mark the rest as known" sweep (coverage proposal): every
// candidate lemma that is neither studied nor already marked gets a
// known_lemmas row. Ambiguous tokens mark ALL candidates — over-crediting a
// rare homograph is invisible noise. The sweep SKIPS saved terms (saving is
// the stronger, more specific signal), and read-time precedence keeps a later
// save winning over the mark.
//
// Two scopes: the WHOLE text (candidates from the stored track profile) or a
// SPAN [0, toSegmentIndex] for the progressive multi-sitting flow — the span
// is tokenized live in bounded batches through the checkpoint matcher because
// profile rows carry no segment positions. Repeated span sweeps accumulate:
// ON CONFLICT DO NOTHING plus the already-known exclusion make overlap free.

export type MarkRemainingKnownDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

const SEGMENT_BATCH_SIZE = 500
const RESOLVE_CHUNK_SIZE = 5_000

// Candidate lemmas of the segments [0, toSegmentIndex] (clamped by the rows
// that actually exist), resolved through the same matcher the profile build
// uses. Keyset pages over real rows — indices are client-supplied and not
// guaranteed dense, so stepping through the index space would let a sparse or
// crafted max index burn the request on empty range queries.
const resolveSpanCandidates = async (
  params: { textTrackId: string; targetLanguage: string; toSegmentIndex: number },
  deps: MarkRemainingKnownDependencies
): Promise<Set<string>> => {
  const candidates = new Set<string>()
  const counts = new Map<string, number>()
  let cursor: number | null = null
  for (;;) {
    const segments = await deps.textSegmentsRepository.listPageAfterIndex({
      textTrackId: params.textTrackId,
      afterIndex: cursor,
      limit: SEGMENT_BATCH_SIZE,
      toIndexInclusive: params.toSegmentIndex,
    })
    if (segments.length === 0) break
    countFoldedTokens(segments, params.targetLanguage, counts)
    cursor = segments[segments.length - 1].index
    if (segments.length < SEGMENT_BATCH_SIZE) break
  }
  const tokens = [...counts.keys()]
  for (let i = 0; i < tokens.length; i += RESOLVE_CHUNK_SIZE) {
    const resolved = await deps.wiktionaryMatchRepository.resolveFoldedLemmasForTokens({
      targetLanguage: params.targetLanguage,
      foldedTokens: tokens.slice(i, i + RESOLVE_CHUNK_SIZE),
    })
    for (const lemmas of resolved.values()) {
      for (const lemma of lemmas) candidates.add(lemma)
    }
  }
  return candidates
}

export type SweepComputation =
  | { ok: true; targetLanguage: string; markableLemmas: string[] }
  // Synthetic sessions (adhoc/lesson) and languages without ranks/wiktionary
  // support never sweep — same gate as the difficulty stat. 'profile_failed'
  // is the terminal build failure: the client must stop polling, not retry.
  | { ok: false; reason: 'not_found' | 'unsupported' | 'profile_pending' | 'profile_failed' }

export const computeMarkableLemmas = async (
  params: { sessionId: string; userId: string; toSegmentIndex?: number | null },
  deps: MarkRemainingKnownDependencies
): Promise<SweepComputation> => {
  const session = await deps.studySessionsRepository.findByIdForUserWithSource(params.sessionId, params.userId)
  if (!session) return { ok: false, reason: 'not_found' }
  if (session.content_source_type === 'adhoc' || session.content_source_type === 'lesson') {
    return { ok: false, reason: 'unsupported' }
  }
  const targetLanguage = session.target_language
  if (!KAIKKI_LANGUAGES.has(targetLanguage)) return { ok: false, reason: 'unsupported' }

  const track = await deps.textTracksRepository.findByIdWithSourceType(session.text_track_id)
  if (!track) return { ok: false, reason: 'not_found' }

  let candidateLemmas: Set<string>
  if (params.toSegmentIndex != null) {
    // Span scope tokenizes live and never depends on the profile, so it works
    // (and never reports pending) even while the build job runs.
    candidateLemmas = await resolveSpanCandidates(
      { textTrackId: track.id, targetLanguage, toSegmentIndex: params.toSegmentIndex },
      deps
    )
  } else {
    // Same lifecycle as the difficulty read (shared resolver): enqueue/coalesce
    // while missing or stale, but surface a terminal build failure instead of
    // re-enqueueing it on every preview poll.
    const readiness = await resolveTrackProfileReadiness(track, params.userId, deps)
    if (readiness === 'failed') return { ok: false, reason: 'profile_failed' }
    if (readiness === 'pending') return { ok: false, reason: 'profile_pending' }
    const profileRows = await deps.textTrackLemmaProfilesRepository.listRowsByTrackId(track.id)
    candidateLemmas = new Set<string>()
    for (const row of profileRows) {
      for (const lemma of row.candidate_lemmas) candidateLemmas.add(lemma)
    }
  }

  const vocab = await deps.userLookupsRepository.listCheckpointVocab({ userId: params.userId, targetLanguage })

  // Saved-term exclusion is lemma-keyed through the same headword fold the
  // checkpoint matcher uses ("to run" excludes "run").
  const studiedLemmas = new Set<string>()
  for (const row of vocab) {
    for (const candidate of foldUserHeadwordCandidates(row.lookup.headword, targetLanguage)) {
      studiedLemmas.add(candidate)
    }
  }

  const unstudied = [...candidateLemmas].filter((lemma) => !studiedLemmas.has(lemma))
  const alreadyKnown = new Set(
    await deps.knownLemmasRepository.filterKnown({ userId: params.userId, targetLanguage, lemmas: unstudied })
  )
  const markableLemmas = unstudied.filter((lemma) => !alreadyKnown.has(lemma)).sort()
  return { ok: true, targetLanguage, markableLemmas }
}

export type MarkRemainingKnownResult =
  | { ok: true; markedCount: number }
  | { ok: false; reason: 'not_found' | 'unsupported' | 'profile_pending' | 'profile_failed' }

export const markRemainingKnown = async (
  params: { sessionId: string; userId: string; toSegmentIndex?: number | null },
  deps: MarkRemainingKnownDependencies
): Promise<MarkRemainingKnownResult> => {
  const computation = await computeMarkableLemmas(params, deps)
  if (!computation.ok) return computation
  const markedCount = await deps.knownLemmasRepository.bulkMarkKnown({
    userId: params.userId,
    targetLanguage: computation.targetLanguage,
    lemmas: computation.markableLemmas,
    source: 'bulk_text',
    sourceId: params.sessionId,
  })
  return { ok: true, markedCount }
}
