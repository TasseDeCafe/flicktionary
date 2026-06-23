import type postgres from 'postgres'
import {
  DbHighlight,
  HighlightInsertParams,
  HighlightsRepositoryInterface,
} from '../../transport/database/highlights/highlights-repository'
import { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { GhostCandidatesRepositoryInterface } from '../../transport/database/ghost-candidates/ghost-candidates-repository'
import { insertStubCardForHighlight } from '../processing/materialize-basic-data-chunks'

// Wraps `fn` in one DB transaction and hands it the executor to thread into
// repo methods that accept one (wired from postgres-client's beginTx; unit tests
// fake it as `(fn) => fn(undefined as never)`). Same convention as rate-term.
export type WithTransaction = <T>(fn: (tx: postgres.Sql) => Promise<T>) => Promise<T>

export type CreateNoteOnlyHighlightDependencies = {
  highlightsRepository: HighlightsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  ghostCandidatesRepository: GhostCandidatesRepositoryInterface
  withTransaction: WithTransaction
}

// Note-only save lane: insert the highlight and a synchronously-created empty
// stub card in ONE transaction, so a saved note-only highlight is never left
// without an openable card/chat. NO basic-data pass / grounding / study facets —
// the card body stays empty until the user generates its data. studyIntent is
// intentionally not persisted here (the note-only lane ignores skill selection).
//
// The seed_card_chat enqueue is the caller's post-commit, best-effort step (it
// retries; worst case the user chats manually once the blob self-bootstraps).
export const createNoteOnlyHighlight = async (
  params: HighlightInsertParams & {
    userId: string
    targetLanguage: string
    // A ghost was adopted pre-save: dismiss it in the same transaction so it
    // stops rendering. Optional — a plain selection has no ghost.
    adoptedGhostId?: string
  },
  deps: CreateNoteOnlyHighlightDependencies
): Promise<DbHighlight> => {
  return deps.withTransaction(async (tx) => {
    const highlight = await deps.highlightsRepository.insertHighlight(
      {
        studySessionId: params.studySessionId,
        startSegmentId: params.startSegmentId,
        endSegmentId: params.endSegmentId,
        startOffset: params.startOffset,
        endOffset: params.endOffset,
        selectionText: params.selectionText,
        note: params.note,
        presetTags: params.presetTags,
        studyIntent: null,
        fastGloss: params.fastGloss,
        chatSeedPrompt: params.chatSeedPrompt ?? null,
      },
      tx
    )

    await insertStubCardForHighlight(
      {
        sessionId: params.studySessionId,
        userId: params.userId,
        targetLanguage: params.targetLanguage,
        highlightId: highlight.id,
        segmentId: highlight.start_segment_id,
        selectionText: highlight.selection_text,
      },
      { cardsRepository: deps.cardsRepository, userLookupsRepository: deps.userLookupsRepository },
      tx
    )

    if (params.adoptedGhostId) {
      await deps.ghostCandidatesRepository.dismissGhost(params.adoptedGhostId, params.studySessionId, tx)
    }

    return highlight
  })
}
