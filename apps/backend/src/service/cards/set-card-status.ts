import { CardStatus, CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type SetCardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// Wraps cardsRepository.updateStatus so that transitioning a card to 'kept'
// also upserts a row in user_lookups (the canonical "user vocabulary" record
// that backs the Practice tab). status=kept is idempotent — re-keeping the
// same card just bumps `count`. We don't undo the upsert on un-keep: the
// user_lookups row is durable history, and the SRS state stays put.
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
    const session = await deps.studySessionsRepository.findByIdForUser(card.study_session_id, userId)
    if (session) {
      await deps.userLookupsRepository.upsertOnKeep({
        userId,
        targetLanguage: session.target_language,
        headword: card.headword,
        sense: card.sense ?? '',
        cardId: card.id,
      })
    }
  }

  return updated
}

// Bulk variant for the triage list's "Keep all" / "Reject all" buttons.
// Resolves the session once (saves N round-trips), then upserts user_lookups
// for every card flipped to 'kept'.
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
            userId,
            targetLanguage: session.target_language,
            headword: card.headword,
            sense: card.sense ?? '',
            cardId: card.id,
          })
        )
      )
    }
  }

  return updated
}
