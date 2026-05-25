import { runCardChat } from '../chat/run-card-chat'
import type { ProcessingDependencies } from './processing-dependencies'

export type SeedCardChatOutcome = 'seeded' | 'skipped'

// seed_card_chat worker handler. Turns a saved highlight note/presets into a
// per-card chat turn: a rendered user question plus an assistant reply the
// learner sees when they open the card. The reply is informational and must not
// rewrite the just-enriched card (allowCardEdits: false).
//
// Idempotency comes from the deterministic sourceKey (seed_card_chat:<jobId>):
// runCardChat skips the Opus call and reuses the stored turn if this key already
// produced an assistant reply, so a worker retry after a partial write does not
// duplicate the turn or call the model twice.
export const seedCardChatFromNote = async (
  params: { jobId: string; sessionId: string; highlightId: string; userId: string },
  deps: ProcessingDependencies
): Promise<SeedCardChatOutcome> => {
  const { jobId, sessionId, highlightId, userId } = params

  const highlight = await deps.highlightsRepository.findById(highlightId)
  if (!highlight || highlight.study_session_id !== sessionId) {
    // Highlight deleted (or moved) before we ran — nothing to seed.
    return 'skipped'
  }

  // The localized question was composed on the frontend (preset phrasing in the
  // UI locale + the verbatim note) and stored on the highlight. Read it verbatim.
  const content = highlight.chat_seed_prompt?.trim()
  if (!content) {
    // The note/presets were cleared between enqueue and run, or never set.
    return 'skipped'
  }

  // The card is materialized by the highlight's enrich_highlight job. If it isn't
  // there yet, throw so the worker takes a bounded backoff retry — enrichment
  // almost always finishes within that window. After MAX_ATTEMPTS the job parks
  // as failed (surfaced as a failed seed in the processing status).
  const card = await deps.cardsRepository.findByHighlightId(highlightId)
  if (!card) {
    throw new Error(`seed_card_chat: card for highlight ${highlightId} not materialized yet`)
  }

  await runCardChat(
    {
      cardId: card.id,
      userId,
      content,
      allowCardEdits: false,
      source: 'highlight_note_seed',
      sourceKey: `seed_card_chat:${jobId}`,
    },
    deps
  )

  return 'seeded'
}
