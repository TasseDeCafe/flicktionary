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

export const FullExplorationSchema = z.object({
  headword: z.string(),
  surface_form: z.string(),
  context_segment: z.string(),
  definition: z.string(),
  examples: z.array(z.string()),
  ipa: z.string(),
  frequency: z.enum(['high', 'medium', 'low']),
  more_frequent_synonym: z.string().nullable(),
  regionalism: z.string().nullable(),
  register: z.string(),
  register_alternatives: z.object({
    more_formal: z.string().nullable(),
    less_formal: z.string().nullable(),
  }),
  collocations: z.array(z.string()),
  etymology: z.string(),
  l1_notes: z.string().nullable(),
  notes: z.string().nullable(),
  translation: z.string(),
})
export type FullExploration = z.infer<typeof FullExplorationSchema>

// Lenient on full_exploration shape: the renderer/CSV code is per-field defensive,
// and LLMs occasionally serialize one field oddly (e.g. examples as a JSON string).
// One bad row should not brick the whole list.
export const CardSchema = z.object({
  id: z.string().uuid(),
  studySessionId: z.string().uuid(),
  highlightId: z.string().uuid().nullable(),
  segmentId: z.string().uuid(),
  headword: z.string(),
  surfaceForm: z.string(),
  fullExploration: z.record(z.string(), z.unknown()),
  status: CardStatusSchema,
  frontOverride: z.string().nullable(),
  backOverride: z.string().nullable(),
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
