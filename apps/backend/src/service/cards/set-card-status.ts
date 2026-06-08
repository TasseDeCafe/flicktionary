import { CardStatus, CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import {
  LearningMode,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { CITATION_FORM } from '../../transport/database/study-facets/study-facets-repository'

export type SetCardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// Apply a learning-mode choice via the citation meaning_production facet, which
// IS the membership flag now (active = enabled, passive = disabled). Replaces
// the dropped user_lookups.learning_mode column.
const applyLearningMode = (
  deps: SetCardStatusDependencies,
  userLookupId: string,
  userId: string,
  learningMode: LearningMode
): Promise<unknown> =>
  deps.userLookupsRepository.setFacetEnabled({
    userLookupId,
    userId,
    skill: 'meaning_production',
    targetForm: CITATION_FORM,
    enabled: learningMode === 'active',
  })

// Wraps cardsRepository.updateStatus with transition-aware bookkeeping on the
// canonical user_lookups row. count tracks "how many cards (across all sessions)
// currently have status='kept' for this lookup":
//   prev !== 'kept' && next === 'kept'   →  count += 1, clear deleted_at
//   prev === 'kept' && next !== 'kept'   →  count -= 1
//   no real transition                   →  no-op (idempotent re-clicks)
// SRS state stays put on un-keep — re-keeping later resumes the schedule.
//
// `learningMode` (optional) is applied to the canonical user_lookups row
// whenever the card lands in 'kept'. Critically, it also applies when the
// card is *already* 'kept' — highlights are kept by default, so "Keep as
// active" on an already-kept highlight must promote the underlying term to
// the active pool rather than no-op.
export const setCardStatus = async (
  cardId: string,
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies,
  learningMode?: LearningMode
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null

  const prevStatus = card.status

  // Same-status optimization: re-clicking the same status is idempotent, EXCEPT
  // when the caller is supplying a learningMode on an already-kept card — that
  // is the "promote already-kept term to active" path.
  if (prevStatus === status) {
    if (status === 'kept' && learningMode) {
      await applyLearningMode(deps, card.user_lookup_id, userId, learningMode)
    }
    return card
  }

  const updated = await deps.cardsRepository.updateStatus(cardId, status)
  if (!updated) return null

  if (prevStatus !== 'kept' && status === 'kept') {
    await deps.userLookupsRepository.applyKeepTransition({
      userLookupId: card.user_lookup_id,
      cardId: card.id,
    })
    if (learningMode) {
      await applyLearningMode(deps, card.user_lookup_id, userId, learningMode)
    }
  } else if (prevStatus === 'kept' && status !== 'kept') {
    await deps.userLookupsRepository.applyUnkeepTransition({ userLookupId: card.user_lookup_id })
  }

  return updated
}

// Bulk variant for the triage list's "Keep all" / "Reject all" buttons. Same
// transition semantics as setCardStatus, partitioned across the batch.
//
// `learningMode` (optional) is applied to every kept user_lookup in the batch
// — both rows transitioning into 'kept' and rows already 'kept'. Note: the
// product surface does not currently expose "Keep all as active", so this
// parameter is reserved for future bulk surfaces.
export const setCardStatusBatch = async (
  studySessionId: string,
  cardIds: string[],
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies,
  learningMode?: LearningMode
): Promise<DbCard[]> => {
  if (cardIds.length === 0) return []

  const session = await deps.studySessionsRepository.findByIdForUser(studySessionId, userId)
  if (!session) return []

  const existing = await deps.cardsRepository.listBySessionId(studySessionId)
  const existingById = new Map(existing.map((c) => [c.id, c]))
  const targets = cardIds
    .map((id) => existingById.get(id))
    .filter((c): c is (typeof existing)[number] => c !== undefined)

  const enteringKept = targets.filter((c) => c.status !== 'kept' && status === 'kept')
  const leavingKept = targets.filter((c) => c.status === 'kept' && status !== 'kept')
  const transitioning = targets.filter((c) => c.status !== status)
  const alreadyKept = targets.filter((c) => c.status === 'kept' && status === 'kept')

  if (transitioning.length === 0 && !(status === 'kept' && learningMode && alreadyKept.length > 0)) {
    return []
  }

  const updated =
    transitioning.length > 0
      ? await deps.cardsRepository.updateStatusBatch(
          studySessionId,
          transitioning.map((c) => c.id),
          status
        )
      : []

  if (enteringKept.length > 0) {
    await Promise.all(
      enteringKept.map((card) =>
        deps.userLookupsRepository.applyKeepTransition({
          userLookupId: card.user_lookup_id,
          cardId: card.id,
        })
      )
    )
  }
  if (leavingKept.length > 0) {
    await Promise.all(
      leavingKept.map((card) => deps.userLookupsRepository.applyUnkeepTransition({ userLookupId: card.user_lookup_id }))
    )
  }
  if (learningMode && status === 'kept') {
    // Stamp learning_mode on every kept user_lookup in the batch — both
    // newly-kept rows and rows that were already 'kept'.
    const stampTargets = [...enteringKept, ...alreadyKept]
    await Promise.all(stampTargets.map((card) => applyLearningMode(deps, card.user_lookup_id, userId, learningMode)))
  }

  return updated
}
