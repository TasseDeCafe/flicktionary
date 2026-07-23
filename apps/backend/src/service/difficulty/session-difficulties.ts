import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { LemmaRanksRepositoryInterface } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type {
  DbStudySessionWithSource,
  StudySessionsRepositoryInterface,
} from '../../transport/database/study-sessions/study-sessions-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { TextTrackLemmaProfilesRepositoryInterface } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type {
  DifficultyVocabRow,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { recognitionRetrievabilityAt } from '../practice/fsrs'
import { resolveTrackProfileReadiness } from '../lemma-profiles/profile-readiness'
import {
  computeDifficulty,
  flooredCoveragePercent,
  labelForCoverage,
  type DifficultyLabel,
  type LemmaKnowledge,
} from './compute-difficulty'

// The batched difficulty read behind studySessions.getDifficulties: sessions
// are grouped by (track, language) so a TV season costs one profile read, and
// the per-user side (vocab + known lemmas) loads ONCE per language. The stat
// itself is never pre-aggregated (live query, no stored snapshots) — if this
// ever feels slow, caching goes on the profile side, never the blended
// number.

export type SessionDifficultyStatus = 'available' | 'pending' | 'failed' | 'unsupported'

export type SessionDifficultyDto = {
  status: SessionDifficultyStatus
  expectedCoveragePercent: number | null
  label: DifficultyLabel | null
  unknownLemmaCount: number | null
  frequentUnknownCount: number | null
  savedNotStartedCount: number | null
  knownLemmaCount: number | null
}

export type SessionDifficultiesDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
  textTracksRepository: TextTracksRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
  lemmaRanksRepository: LemmaRanksRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

const EMPTY_OF = (status: SessionDifficultyStatus): SessionDifficultyDto => ({
  status,
  expectedCoveragePercent: null,
  label: null,
  unknownLemmaCount: null,
  frequentUnknownCount: null,
  savedNotStartedCount: null,
  knownLemmaCount: null,
})

// Build the per-lemma P(known) source map for one (user, language), with
// read-time precedence: ANY live saved lookup beats a known mark. Among
// saved rows for the same lemma, a scheduled facet's retrievability wins
// (max across senses); enabled+ready+scheduled is the bar — disabled,
// pending_data, and never-introduced facets stay saved_not_started (P=0).
const buildKnowledgeMap = (params: {
  vocab: readonly DifficultyVocabRow[]
  knownLemmas: readonly string[]
  targetLanguage: string
  now: Date
}): Map<string, LemmaKnowledge> => {
  const map = new Map<string, LemmaKnowledge>()
  for (const row of params.vocab) {
    const facet = row.facet
    const scheduled =
      facet !== null && facet.srs_state !== null && facet.disabled_at === null && facet.data_status === 'ready'
    const retrievability = scheduled ? recognitionRetrievabilityAt(facet, params.now) : null
    for (const lemma of foldUserHeadwordCandidates(row.headword, params.targetLanguage)) {
      const existing = map.get(lemma)
      if (retrievability !== null) {
        const best = existing?.kind === 'scheduled' ? Math.max(existing.retrievability, retrievability) : retrievability
        map.set(lemma, { kind: 'scheduled', retrievability: best })
      } else if (!existing) {
        map.set(lemma, { kind: 'saved_not_started' })
      }
    }
  }
  // Known marks only fill lemmas with NO live saved lookup.
  for (const lemma of params.knownLemmas) {
    if (!map.has(lemma)) map.set(lemma, { kind: 'known' })
  }
  return map
}

type TrackGroup = {
  textTrackId: string
  targetLanguage: string
  sessionIds: string[]
}

const resolveTrackStatus = async (
  group: TrackGroup,
  userId: string,
  deps: SessionDifficultiesDependencies
): Promise<{ kind: 'compute' } | { kind: 'terminal'; dto: SessionDifficultyDto }> => {
  const track = await deps.textTracksRepository.findByIdWithSourceType(group.textTrackId)
  if (!track) return { kind: 'terminal', dto: EMPTY_OF('unsupported') }
  if (track.content_source_type === 'adhoc' || track.content_source_type === 'lesson') {
    return { kind: 'terminal', dto: EMPTY_OF('unsupported') }
  }

  // Missing/stale/failed handling lives in the shared readiness resolver —
  // the same lifecycle the mark-known sweep sees, so a terminally failed
  // build reads 'failed' on every path and clients stop polling.
  const readiness = await resolveTrackProfileReadiness(track, userId, deps)
  if (readiness !== 'available') return { kind: 'terminal', dto: EMPTY_OF(readiness) }

  return { kind: 'compute' }
}

export const getSessionDifficulties = async (
  params: { userId: string; sessionIds: readonly string[]; now?: Date },
  deps: SessionDifficultiesDependencies
): Promise<Record<string, SessionDifficultyDto>> => {
  const now = params.now ?? new Date()
  const uniqueIds = [...new Set(params.sessionIds)]
  const sessions = await deps.studySessionsRepository.listByIdsForUserWithSource(uniqueIds, params.userId)
  const result: Record<string, SessionDifficultyDto> = {}
  if (sessions.length === 0) return result

  const rankedLanguages = await deps.lemmaRanksRepository.listBuiltLanguages()
  const isSupportedLanguage = (language: string): boolean =>
    KAIKKI_LANGUAGES.has(language) && rankedLanguages.has(language)

  // Group by (track, language) so a TV season = one profile read.
  const groups = new Map<string, TrackGroup>()
  const groupOf = (session: DbStudySessionWithSource): TrackGroup => {
    const key = `${session.text_track_id}:${session.target_language}`
    let group = groups.get(key)
    if (!group) {
      group = { textTrackId: session.text_track_id, targetLanguage: session.target_language, sessionIds: [] }
      groups.set(key, group)
    }
    return group
  }

  for (const session of sessions) {
    if (
      session.content_source_type === 'adhoc' ||
      session.content_source_type === 'lesson' ||
      !isSupportedLanguage(session.target_language)
    ) {
      result[session.id] = EMPTY_OF('unsupported')
      continue
    }
    groupOf(session).sessionIds.push(session.id)
  }

  // The per-user side loads once per language, shared across all that
  // language's track groups.
  const knowledgeByLanguage = new Map<string, Map<string, LemmaKnowledge>>()
  const languages = [...new Set([...groups.values()].map((g) => g.targetLanguage))]
  await Promise.all(
    languages.map(async (language) => {
      const [vocab, knownLemmas] = await Promise.all([
        deps.userLookupsRepository.listDifficultyVocab({ userId: params.userId, targetLanguage: language }),
        deps.knownLemmasRepository.listLemmas(params.userId, language),
      ])
      knowledgeByLanguage.set(language, buildKnowledgeMap({ vocab, knownLemmas, targetLanguage: language, now }))
    })
  )

  // Groups compute concurrently — each writes disjoint session ids, and the
  // DB pool caps how many profile reads are actually in flight, so a batch
  // of ~100 distinct tracks doesn't pay ~100 sequential round-trip chains.
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const status = await resolveTrackStatus(group, params.userId, deps)
      let dto: SessionDifficultyDto
      if (status.kind === 'terminal') {
        dto = status.dto
      } else {
        const profileRows = await deps.textTrackLemmaProfilesRepository.listRowsByTrackId(group.textTrackId)
        const candidateLemmas = new Set<string>()
        for (const row of profileRows) {
          for (const lemma of row.candidate_lemmas) candidateLemmas.add(lemma)
        }
        const ranksByLemma = await deps.lemmaRanksRepository.listRanksForLemmas({
          targetLanguage: group.targetLanguage,
          lemmas: [...candidateLemmas],
        })
        const computation = computeDifficulty({
          groups: profileRows.map((row) => ({ tokenCount: row.token_count, candidateLemmas: row.candidate_lemmas })),
          knowledgeByLemma: knowledgeByLanguage.get(group.targetLanguage) ?? new Map(),
          ranksByLemma,
        })
        dto = {
          status: 'available',
          expectedCoveragePercent:
            computation.expectedCoverage === null ? null : flooredCoveragePercent(computation.expectedCoverage),
          label: computation.expectedCoverage === null ? null : labelForCoverage(computation.expectedCoverage),
          unknownLemmaCount: computation.unknownLemmas.length,
          frequentUnknownCount: computation.frequentUnknownLemmas.length,
          savedNotStartedCount: computation.savedNotStartedLemmas.length,
          knownLemmaCount: computation.knownLemmas.length,
        }
      }
      for (const sessionId of group.sessionIds) result[sessionId] = dto
    })
  )

  return result
}
