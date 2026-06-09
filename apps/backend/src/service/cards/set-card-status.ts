import { CardStatus, CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type SetCardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// Wraps cardsRepository.updateStatus with transition-aware bookkeeping on the
// canonical user_lookups row. count tracks "how many cards (across all sessions)
// currently have status='kept' for this lookup":
//   prev !== 'kept' && next === 'kept'   →  count += 1, clear deleted_at
//   prev === 'kept' && next !== 'kept'   →  count -= 1
//   no real transition                   →  no-op (idempotent re-clicks)
// SRS state stays put on un-keep — re-keeping later resumes the schedule.
//
// Production study (the active pool) is no longer set here: it's toggled
// independently via the citation meaning_production facet (setFacetEnabled).
// Keep creates the DEFAULT recognition facet only when the term has no facet
// rows yet — a pre-keep study-target configuration (e.g. pronunciation-only
// picked in the triage focus view) is respected, not overwritten.
export const setCardStatus = async (
  cardId: string,
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null

  const prevStatus = card.status

  // Re-clicking the same status is idempotent.
  if (prevStatus === status) return card

  const updated = await deps.cardsRepository.updateStatus(cardId, status)
  if (!updated) return null

  if (prevStatus !== 'kept' && status === 'kept') {
    await deps.userLookupsRepository.applyKeepTransition({
      userLookupId: card.user_lookup_id,
      cardId: card.id,
    })
  } else if (prevStatus === 'kept' && status !== 'kept') {
    await deps.userLookupsRepository.applyUnkeepTransition({ userLookupId: card.user_lookup_id })
  }

  return updated
}

// Bulk variant for the triage list's "Keep all" / "Reject all" buttons. Same
// transition semantics as setCardStatus, partitioned across the batch.
export const setCardStatusBatch = async (
  studySessionId: string,
  cardIds: string[],
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies
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

  if (transitioning.length === 0) return []

  const updated = await deps.cardsRepository.updateStatusBatch(
    studySessionId,
    transitioning.map((c) => c.id),
    status
  )

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

  return updated
}
