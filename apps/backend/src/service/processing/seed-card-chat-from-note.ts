import { runCardChat } from '../chat/run-card-chat'
import type { ProcessingDependencies } from './processing-dependencies'

export type SeedCardChatOutcome = 'seeded' | 'skipped'

// seed_card_chat worker handler. Turns a saved highlight note/presets into a
// per-card chat turn: a rendered user question plus an assistant reply the
// learner sees when they open the card. The reply is informational and must not
// rewrite the just-enriched card (allowCardEdits: false).
//
// Idempotency comes from the deterministic per-highlight sourceKey
// (seed_card_chat:<highlightId>): runCardChat skips the Opus call and reuses the
// stored turn if this key already produced an assistant reply. Keying on the
// highlight (not the job) makes the seed once-per-highlight: a highlight's
// note/presets seed the chat exactly once, even if the user re-saves the saved
// sheet several times (each Save enqueues a fresh job once the prior one is no
// longer pending). The note editor is locked read-only after the first save, so
// the only way to re-seed is to delete the highlight and start over.
export const seedCardChatFromNote = async (
  params: { jobId: string; sessionId: string; highlightId: string; userId: string },
  deps: ProcessingDependencies
): Promise<SeedCardChatOutcome> => {
  const { sessionId, highlightId, userId } = params

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
      sourceKey: `seed_card_chat:${highlightId}`,
    },
    deps
  )

  return 'seeded'
}
