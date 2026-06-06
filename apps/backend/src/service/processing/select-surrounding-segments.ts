import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'

export type SurroundingSegmentSlice = {
  id: string
  index: number
  text: string
}

const SURROUNDING_RADIUS = 10

// `endSegmentId` widens the window for cross-segment highlights (a selection
// that starts in one subtitle segment and ends in another): the radius is
// applied around the whole [start, end] span so both anchor segments — and
// everything between them — are always inside the window.
export const selectSurroundingSegments = async (
  textTrackId: string,
  centerSegmentId: string,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  radius: number = SURROUNDING_RADIUS,
  endSegmentId?: string
): Promise<SurroundingSegmentSlice[]> => {
  const center = await textSegmentsRepository.findById(centerSegmentId)
  if (!center) return []
  const end =
    endSegmentId !== undefined && endSegmentId !== centerSegmentId
      ? await textSegmentsRepository.findById(endSegmentId)
      : null
  const slice = end
    ? await textSegmentsRepository.listByIndexRange(
        textTrackId,
        Math.min(center.index, end.index) - radius,
        Math.max(center.index, end.index) + radius
      )
    : await textSegmentsRepository.listAroundIndex(textTrackId, center.index, radius)
  return slice.map((s) => ({ id: s.id, index: s.index, text: s.text }))
}

export const formatSurroundingSegments = (segments: SurroundingSegmentSlice[], focusSegmentId: string): string =>
  segments.map((s) => (s.id === focusSegmentId ? `> [${s.id}] ${s.text}` : `[${s.id}] ${s.text}`)).join('\n')
