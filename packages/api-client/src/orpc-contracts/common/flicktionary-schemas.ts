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

// The canonical vocabulary entry: one row per (user, targetLanguage, headword,
// sense). Owns the gloss/example fields so edits propagate to every card that
// references it. Cards carry a `chunk` of this shape on read paths.
export const ChunkSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  targetLanguage: z.string(),
  headword: z.string(),
  sense: z.string(),
  translation: z.string().nullable(),
  definition: z.string().nullable(),
  targetExample: z.string().nullable(),
  nativeExample: z.string().nullable(),
  explorationExtras: ExplorationExtrasSchema,
})
export type Chunk = z.infer<typeof ChunkSchema>

export const CardSchema = z.object({
  id: z.string().uuid(),
  studySessionId: z.string().uuid(),
  highlightId: z.string().uuid().nullable(),
  segmentId: z.string().uuid(),
  userLookupId: z.string().uuid(),
  surfaceForm: z.string(),
  status: CardStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  chunk: ChunkSchema,
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
  contentSourceType: ContentSourceTypeSchema.nullable(),
  contentSourcePosterUrl: z.string().nullable(),
  contentSourceYear: z.number().int().nullable(),
})
export type StudySession = z.infer<typeof StudySessionSchema>

// =============================================================================
// Practice tab — SRS through generated texts
// =============================================================================

export const PracticeRatingSchema = z.enum(['again', 'hard', 'good', 'easy'])
export type PracticeRating = z.infer<typeof PracticeRatingSchema>

export const PracticeSessionStatusSchema = z.enum(['active', 'completed', 'abandoned'])
export type PracticeSessionStatus = z.infer<typeof PracticeSessionStatusSchema>

export const PracticeTextStatusSchema = z.enum(['pending', 'generating', 'ready', 'reading', 'done', 'failed'])
export type PracticeTextStatus = z.infer<typeof PracticeTextStatusSchema>

export const PracticeAnnotationSchema = z.object({
  headword: z.string(),
  sense: z.string(),
  surfaceForm: z.string(),
  charStart: z.number().int(),
  charEnd: z.number().int(),
})
export type PracticeAnnotation = z.infer<typeof PracticeAnnotationSchema>

export const PracticeTextSchema = z.object({
  id: z.string().uuid(),
  practiceSessionId: z.string().uuid(),
  ord: z.number().int(),
  status: PracticeTextStatusSchema,
  body: z.string().nullable(),
  annotations: z.array(PracticeAnnotationSchema),
  generationWarning: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  readAt: z.string().nullable(),
})
export type PracticeText = z.infer<typeof PracticeTextSchema>

export const PracticeSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  targetLanguage: z.string(),
  status: PracticeSessionStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
})
export type PracticeSession = z.infer<typeof PracticeSessionSchema>

export const PracticeDueSummaryEntrySchema = z.object({
  targetLanguage: z.string(),
  totalKept: z.number().int(),
  dueCount: z.number().int(),
  newCount: z.number().int(),
})
export type PracticeDueSummaryEntry = z.infer<typeof PracticeDueSummaryEntrySchema>
