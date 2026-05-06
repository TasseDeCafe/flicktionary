import { CardStatus, CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type SetCardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// Wraps cardsRepository.updateStatus so that transitioning a card to 'kept'
// also bumps `count` on the canonical user_lookups row that backs the Practice
// tab. status=kept is idempotent — re-keeping the same card just bumps `count`.
// We don't undo the bump on un-keep: the user_lookups row is durable history,
// and the SRS state stays put.
export const setCardStatus = async (
  cardId: string,
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null

  const updated = await deps.cardsRepository.updateStatus(cardId, status)
  if (!updated) return null

  if (status === 'kept') {
    await deps.userLookupsRepository.upsertOnKeep({
      userLookupId: card.user_lookup_id,
      cardId: card.id,
    })
  }

  return updated
}

// Bulk variant for the triage list's "Keep all" / "Reject all" buttons.
export const setCardStatusBatch = async (
  studySessionId: string,
  cardIds: string[],
  userId: string,
  status: CardStatus,
  deps: SetCardStatusDependencies
): Promise<DbCard[]> => {
  if (cardIds.length === 0) return []

  const updated = await deps.cardsRepository.updateStatusBatch(studySessionId, cardIds, status)

  if (status === 'kept' && updated.length > 0) {
    const session = await deps.studySessionsRepository.findByIdForUser(studySessionId, userId)
    if (session) {
      await Promise.all(
        updated.map((card) =>
          deps.userLookupsRepository.upsertOnKeep({
            userLookupId: card.user_lookup_id,
            cardId: card.id,
          })
        )
      )
    }
  }

  return updated
}
