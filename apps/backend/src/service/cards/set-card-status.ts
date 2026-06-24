import {
  CardStatus,
  CardsRepositoryInterface,
  DbCard,
  DbCardWithChunk,
} from '../../transport/database/cards/cards-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

export type SetCardStatusDependencies = {
  cardsRepository: CardsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
}

// A card can be kept into Vocabulary/Practice only once it has basic flashcard
// data. A note-only stub has none (translation/definition/target_example all
// empty) until the user runs Generate full exploration / chat. Mirror the same
// rule the frontend uses to disable Keep.
export const cardHasBasicData = (card: DbCardWithChunk): boolean =>
  Boolean(card.chunk.translation || card.chunk.definition || card.chunk.target_example)

// Thrown when Keep is attempted on a data-less card. The router maps it to 409.
export class CardKeepBlockedError extends Error {
  constructor() {
    super('Card has no basic data yet — generate it before keeping')
    this.name = 'CardKeepBlockedError'
  }
}

// Wraps cardsRepository.updateStatus with transition-aware bookkeeping on the
// canonical user_lookups row. count tracks "how many cards (across all sessions)
// currently have status='kept' for this lookup":
//   prev !== 'kept' && next === 'kept'   →  count += 1, clear deleted_at
//   prev === 'kept' && next !== 'kept'   →  count -= 1
//   no real transition                   →  no-op (idempotent re-clicks)
// SRS state stays put on un-keep — re-keeping later resumes the schedule.
//
// Production study (the production pool) is no longer set here: it's toggled
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

  // Block keeping a data-less card (note-only stub) — it would push a blank
  // flashcard into Vocabulary + Practice.
  if (prevStatus !== 'kept' && status === 'kept' && !cardHasBasicData(card)) {
    throw new CardKeepBlockedError()
  }

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

// Auto-keep a freshly data-bearing card. Saving a highlight is already an
// explicit commit, so a card keeps itself the moment it gains basic flashcard
// data — no separate triage Keep step. Gated two ways:
//   - status === 'pending'   →  never resurrect a Removed (rejected) or
//     auto_rejected card via a later retry/chat/exploration write.
//   - cardHasBasicData(card) →  skip note-only stubs (they keep until the user
//     generates data).
// Idempotent and reuses setCardStatus's keep-transition machinery. MUST run
// AFTER applyStudyIntent at every call site: the keep-time recognition default
// (ensureDefaultCitationFacetIfUnconfigured) only fires when the term has no
// facet rows, so the intent's facets must already exist for full-set semantics
// (production-only / pronunciation-only / exact-form) to survive the keep.
export const autoKeepPendingIfEligible = async (
  cardId: string,
  userId: string,
  deps: SetCardStatusDependencies
): Promise<DbCard | null> => {
  const card = await deps.cardsRepository.findByIdForUser(cardId, userId)
  if (!card) return null
  if (card.status !== 'pending' || !cardHasBasicData(card)) return null
  return setCardStatus(cardId, userId, 'kept', deps)
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

  // "Keep all" must not slip data-less cards through — silently leave them
  // pending (the per-row UI already won't offer Keep on them). When status isn't
  // 'kept', keepBlocked is empty so nothing is filtered.
  const keepBlocked =
    status === 'kept' ? new Set(targets.filter((c) => !cardHasBasicData(c)).map((c) => c.id)) : new Set<string>()

  const enteringKept = targets.filter((c) => c.status !== 'kept' && status === 'kept' && !keepBlocked.has(c.id))
  const leavingKept = targets.filter((c) => c.status === 'kept' && status !== 'kept')
  const transitioning = targets.filter((c) => c.status !== status && !keepBlocked.has(c.id))

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
