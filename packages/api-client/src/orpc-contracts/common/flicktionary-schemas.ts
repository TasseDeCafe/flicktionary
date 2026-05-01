import { z } from 'zod'

export const ContentSourceTypeSchema = z.enum(['movie', 'book', 'article', 'text'])
export type ContentSourceType = z.infer<typeof ContentSourceTypeSchema>

export const TextTrackSourceSchema = z.enum(['opensubtitles', 'upload', 'paste', 'url'])
export type TextTrackSource = z.infer<typeof TextTrackSourceSchema>

export const StudySessionStatusSchema = z.enum(['active', 'processing', 'processed', 'exported', 'failed'])
export type StudySessionStatus = z.infer<typeof StudySessionStatusSchema>

export const CardStatusSchema = z.enum(['pending', 'kept', 'rejected', 'auto_rejected'])
export type CardStatus = z.infer<typeof CardStatusSchema>

export const CardChatRoleSchema = z.enum(['user', 'assistant'])
export type CardChatRole = z.infer<typeof CardChatRoleSchema>

export const CefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
export type CefrLevel = z.infer<typeof CefrLevelSchema>

export const TextSegmentSchema = z.object({
  id: z.string().uuid(),
  index: z.number().int(),
  text: z.string(),
  startMs: z.number().int().nullable(),
  endMs: z.number().int().nullable(),
})
export type TextSegment = z.infer<typeof TextSegmentSchema>

export const HighlightSchema = z.object({
  id: z.string().uuid(),
  studySessionId: z.string().uuid(),
  startSegmentId: z.string().uuid(),
  endSegmentId: z.string().uuid(),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  selectionText: z.string(),
  note: z.string().nullable(),
  presetTags: z.array(z.string()),
  fastGloss: z.string().nullable(),
  createdAt: z.string(),
})
export type Highlight = z.infer<typeof HighlightSchema>

// Lenient on extras shape: the renderer/CSV code is per-field defensive, and LLMs
// occasionally serialize one field oddly. One bad row should not brick the whole list.
export const ExplorationExtrasSchema = z.record(z.string(), z.unknown())
export type ExplorationExtras = z.infer<typeof ExplorationExtrasSchema>

export const CardSchema = z.object({
  id: z.string().uuid(),
  studySessionId: z.string().uuid(),
  highlightId: z.string().uuid().nullable(),
  segmentId: z.string().uuid(),
  headword: z.string(),
  sense: z.string(),
  surfaceForm: z.string(),
  translation: z.string().nullable(),
  definition: z.string().nullable(),
  targetExample: z.string().nullable(),
  nativeExample: z.string().nullable(),
  explorationExtras: ExplorationExtrasSchema,
  status: CardStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Card = z.infer<typeof CardSchema>

export const CardChatMessageSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  role: CardChatRoleSchema,
  content: z.string(),
  createdAt: z.string(),
})
export type CardChatMessage = z.infer<typeof CardChatMessageSchema>

export const ContentSourceSchema = z.object({
  id: z.string().uuid(),
  type: ContentSourceTypeSchema,
  title: z.string(),
  language: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string(),
})
export type ContentSource = z.infer<typeof ContentSourceSchema>

export const TextTrackSchema = z.object({
  id: z.string().uuid(),
  contentSourceId: z.string().uuid(),
  source: TextTrackSourceSchema,
  language: z.string(),
  externalId: z.string().nullable(),
  hash: z.string(),
  createdAt: z.string(),
})
export type TextTrack = z.infer<typeof TextTrackSchema>

export const StudySessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  contentSourceId: z.string().uuid(),
  textTrackId: z.string().uuid(),
  nativeLanguage: z.string(),
  targetLanguage: z.string(),
  cefrLevel: z.string(),
  contextBlob: z.string().nullable(),
  status: StudySessionStatusSchema,
  processingWarnings: z.array(z.string()),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
  contentSourceTitle: z.string().nullable(),
  contentSourcePosterUrl: z.string().nullable(),
  contentSourceYear: z.number().int().nullable(),
})
export type StudySession = z.infer<typeof StudySessionSchema>
