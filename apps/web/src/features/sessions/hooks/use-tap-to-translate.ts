import { useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import type { SelectionResult } from './use-text-selection'

type CachedHighlight = {
  id: string
  selectionText: string
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  fastGloss: string | null
}

// Looks for an existing highlight matching the current selection in the
// `highlights.listBySession` query cache. If found, the tap-to-translate sheet
// can re-use its highlight ID (and any cached fast_gloss) instead of creating
// a fresh row.
export const useTapToTranslate = (sessionId: string) => {
  const queryClient = useQueryClient()

  const findCachedHighlight = (selection: SelectionResult): CachedHighlight | null => {
    const cached = queryClient.getQueryData(orpcQuery.highlights.listBySession.key({ input: { sessionId } })) as
      | { data: CachedHighlight[] }
      | undefined
    if (!cached) return null
    const match = cached.data.find(
      (h) =>
        h.startSegmentId === selection.startSegmentId &&
        h.endSegmentId === selection.endSegmentId &&
        h.startOffset === selection.startOffset &&
        h.endOffset === selection.endOffset &&
        h.selectionText === selection.selectionText
    )
    return match ?? null
  }

  return { findCachedHighlight }
}
