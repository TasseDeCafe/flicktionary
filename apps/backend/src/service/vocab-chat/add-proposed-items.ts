import { beginTx } from '../../transport/database/postgres-client'
import type { HighlightsRepositoryInterface } from '../../transport/database/highlights/highlights-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type {
  DbVocabChatMessage,
  VocabChatProposal,
  VocabChatRepositoryInterface,
  VocabChatThread,
} from '../../transport/database/vocab-chat/vocab-chat-repository'

export type AddProposedItemsDependencies = {
  vocabChatRepository: VocabChatRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  highlightsRepository: HighlightsRepositoryInterface
  processingJobsRepository: ProcessingJobsRepositoryInterface
}

export type AddProposedItemsResult = {
  message: DbVocabChatMessage
  addedHeadwords: string[]
  // Items that were already added earlier (idempotent re-adds).
  alreadyAddedHeadwords: string[]
}

export class ProposalNotFoundError extends Error {
  constructor() {
    super('Proposal not found')
    this.name = 'ProposalNotFoundError'
  }
}

export const parseProposal = (raw: unknown): VocabChatProposal | null => {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return null
  return raw as VocabChatProposal
}

// Adds the selected items of a chat proposal to the thread's session, the
// same way a confirmed lesson import does: one segment (the item's example
// sentence, prefixed with the headword so the highlight offsets always land on
// a real substring), one highlight on the headword, and one enrich_highlight
// job per item, all in one transaction. Card creation and every LLM call run
// afterwards in the background enrichment pipeline, which also keeps the card.
// Re-adding an already-added item is a no-op, so a double click or a model
// re-issuing add_proposed_cards can't duplicate cards.
export const addProposedItems = async (
  params: { thread: VocabChatThread; userId: string; messageId: string; itemIndexes: number[] },
  deps: AddProposedItemsDependencies
): Promise<AddProposedItemsResult> => {
  const { thread, userId } = params
  return beginTx(async (tx) => {
    const message = await deps.vocabChatRepository.lockMessageForUpdate(params.messageId, thread.session.id, tx)
    const proposal = parseProposal(message?.proposal)
    if (!message || !proposal) throw new ProposalNotFoundError()

    const addedHeadwords: string[] = []
    const alreadyAddedHeadwords: string[] = []
    const items = proposal.items.map((item) => ({ ...item }))
    for (const index of new Set(params.itemIndexes)) {
      const item = items[index]
      if (!item) continue
      if (item.highlightId) {
        alreadyAddedHeadwords.push(item.headword)
        continue
      }
      const example = item.example.trim()
      const segmentText = example ? `${item.headword} — ${example}` : item.headword
      const segment = await deps.textSegmentsRepository.appendSegmentAtomic(
        { textTrackId: thread.session.text_track_id, text: segmentText, startMs: null, endMs: null },
        tx
      )
      const highlight = await deps.highlightsRepository.insertHighlight(
        {
          studySessionId: thread.session.id,
          startSegmentId: segment.id,
          endSegmentId: segment.id,
          startOffset: 0,
          endOffset: item.headword.length,
          selectionText: item.headword,
          note: null,
          presetTags: [],
          studyIntent: null,
          fastGloss: null,
        },
        tx
      )
      await deps.processingJobsRepository.enqueue(
        { kind: 'enrich_highlight', sessionId: thread.session.id, userId, highlightId: highlight.id },
        tx
      )
      item.highlightId = highlight.id
      addedHeadwords.push(item.headword)
    }

    const updatedProposal: VocabChatProposal = { items }
    if (addedHeadwords.length > 0) {
      await deps.vocabChatRepository.setProposal(message.id, updatedProposal, tx)
    }
    return {
      message: { ...message, proposal: updatedProposal as unknown as DbVocabChatMessage['proposal'] },
      addedHeadwords,
      alreadyAddedHeadwords,
    }
  })
}
