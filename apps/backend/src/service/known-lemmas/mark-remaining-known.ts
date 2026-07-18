import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { TextTrackLemmaProfilesRepositoryInterface } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { ensureTrackLemmaProfileJob } from '../lemma-profiles/ensure-profile-job'

// The per-session "mark the rest as known" sweep (coverage proposal): every
// candidate lemma of the track's profile that is neither studied nor already
// marked gets a known_lemmas row. Ambiguous tokens mark ALL candidates —
// over-crediting a rare homograph is invisible noise. The sweep SKIPS saved
// terms (saving is the stronger, more specific signal), and read-time
// precedence keeps a later save winning over the mark.

export type MarkRemainingKnownDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

export type SweepComputation =
  | { ok: true; targetLanguage: string; markableLemmas: string[] }
  // Synthetic sessions (adhoc/lesson) and languages without ranks/wiktionary
  // support never sweep — same gate as the difficulty stat.
  | { ok: false; reason: 'not_found' | 'unsupported' | 'profile_pending' }

export const computeMarkableLemmas = async (
  params: { sessionId: string; userId: string },
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
  if (track.profile_built_at === null) {
    // Kick (or coalesce) the build so a retry succeeds; never build inline.
    await ensureTrackLemmaProfileJob({ textTrackId: track.id, userId: params.userId }, deps)
    return { ok: false, reason: 'profile_pending' }
  }

  const [profileRows, vocab] = await Promise.all([
    deps.textTrackLemmaProfilesRepository.listRowsByTrackId(track.id),
    deps.userLookupsRepository.listCheckpointVocab({ userId: params.userId, targetLanguage }),
  ])

  const candidateLemmas = new Set<string>()
  for (const row of profileRows) {
    for (const lemma of row.candidate_lemmas) candidateLemmas.add(lemma)
  }

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
  { ok: true; markedCount: number } | { ok: false; reason: 'not_found' | 'unsupported' | 'profile_pending' }

export const markRemainingKnown = async (
  params: { sessionId: string; userId: string },
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
