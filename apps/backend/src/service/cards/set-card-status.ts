import {
  CardStatus,
  CardsRepositoryInterface,
  DbCard,
  DbCardWithChunk,
} from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type CardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// A card can be kept into Vocabulary/Practice only once it has basic flashcard
// data. A note-only stub has none (translation/definition/target_example all
// empty) until the user runs Generate full exploration / chat.
export const cardHasBasicData = (card: DbCardWithChunk): boolean =>
  Boolean(card.chunk.translation || card.chunk.definition || card.chunk.target_example)

// Internal transition helper with transition-aware bookkeeping on the canonical
// user_lookups row. count tracks "how many cards (across all sessions) currently
// have status='kept' for this lookup":
//   prev !== 'kept' && next === 'kept'   →  count += 1, clear deleted_at
//   prev === 'kept' && next !== 'kept'   →  count -= 1
//   no real transition                   →  no-op (idempotent re-clicks)
// SRS state stays put on un-keep — re-keeping later resumes the schedule.
//
// Production study (the production pool) is no longer set here: it's toggled
// independently via the citation meaning_production facet (setFacetEnabled).
// Keep creates the DEFAULT recognition facet only when the term has no facet
// rows yet — a pre-keep study-target configuration (e.g. pronunciation-only
// picked in the focus view) is respected, not overwritten.
//
// Not exposed to UI/router code: cards keep themselves automatically and the
// only user-driven transition is removal. Callers pass a status they've already
// validated (autoKeep checks for basic data first).
const transitionCardStatus = async (
  card: DbCardWithChunk,
  status: CardStatus,
  deps: CardStatusDependencies
): Promise<DbCard | null> => {
  const prevStatus = card.status

  // Re-applying the same status is idempotent.
  if (prevStatus === status) return card

  const updated = await deps.cardsRepository.updateStatus(card.id, status)
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

// Auto-keep a freshly data-bearing card. Saving a highlight is already an
// explicit commit, so a card keeps itself the moment it gains basic flashcard
// data — there is no separate Keep step. Gated two ways:
//   - status === 'needs_data'  →  never resurrect a Removed card via a later
//     retry/chat/exploration write.
//   - cardHasBasicData(card)   →  skip note-only stubs (they stay needs_data
//     until the user generates data).
// MUST run AFTER applyStudyIntent at every call site: the keep-time recognition
// default (ensureDefaultCitationFacetIfUnconfigured) only fires when the term
// has no facet rows, so the intent's facets must already exist for full-set
// semantics (production-only / pronunciation-only / exact-form) to survive.
export const autoKeepNeedsDataIfEligible = async (
  cardId: string,
  userId: string,
  deps: CardStatusDependencies
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null
  if (card.status !== 'needs_data' || !cardHasBasicData(card)) return null
  return transitionCardStatus(card, 'kept', deps)
}

// Remove (unkeep) a card from its session vocabulary list. Non-destructive: the
// card moves to `removed`, user_lookups.count decrements only if it was kept,
// and no deleted_at is set — the term survives in Vocabulary if kept elsewhere.
// Term-level soft-delete is chunks.deleteChunk, a separate concept.
export const removeCardFromSession = async (
  cardId: string,
  userId: string,
  deps: CardStatusDependencies
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null
  return transitionCardStatus(card, 'removed', deps)
}
