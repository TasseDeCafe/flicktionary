import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'

export type SurroundingSegmentSlice = {
  id: string
  index: number
  text: string
}

export const SURROUNDING_RADIUS = 10

export const selectSurroundingSegments = async (
  textTrackId: string,
  centerSegmentId: string,
  textSegmentsRepository: TextSegmentsRepositoryInterface,
  radius: number = SURROUNDING_RADIUS
): Promise<SurroundingSegmentSlice[]> => {
  const center = await textSegmentsRepository.findById(centerSegmentId)
  if (!center) return []
  const slice = await textSegmentsRepository.listAroundIndex(textTrackId, center.index, radius)
  return slice.map((s) => ({ id: s.id, index: s.index, text: s.text }))
}

export const formatSurroundingSegments = (segments: SurroundingSegmentSlice[], focusSegmentId: string): string =>
  segments.map((s) => (s.id === focusSegmentId ? `> [${s.id}] ${s.text}` : `[${s.id}] ${s.text}`)).join('\n')
