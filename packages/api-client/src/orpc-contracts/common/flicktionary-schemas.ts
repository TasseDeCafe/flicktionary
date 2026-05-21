import { z } from 'zod'

export const ContentSourceTypeSchema = z.enum(['movie', 'book', 'article', 'text', 'adhoc'])
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

// Typed-but-sparse grammar/morphology bag stored alongside the canonical
// content fields on user_lookups. Every key is optional; the renderer shows
// only what's populated. Shape is language-agnostic: Russian uses aspect +
// aspect_pair_headword + government, Spanish uses gender, German uses
// gender + government, English mostly leaves it empty. Forward-compatible
// via passthrough — unknown future keys (e.g. tone for Mandarin) round-trip
// without a contract bump.
export const GrammarPosSchema = z.enum([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'pronoun',
  'particle',
  'conjunction',
  'numeral',
  'phrase',
  'idiom',
  'other',
])
export type GrammarPos = z.infer<typeof GrammarPosSchema>

export const GrammarGenderSchema = z.enum(['m', 'f', 'n', 'c'])
export type GrammarGender = z.infer<typeof GrammarGenderSchema>

export const GrammarAspectSchema = z.enum(['impf', 'perf', 'biaspectual'])
export type GrammarAspect = z.infer<typeof GrammarAspectSchema>

export const GrammarNumberOnlySchema = z.enum(['plurale_tantum', 'singulare_tantum'])
export type GrammarNumberOnly = z.infer<typeof GrammarNumberOnlySchema>

export const GrammarAnimacySchema = z.enum(['animate', 'inanimate'])
export type GrammarAnimacy = z.infer<typeof GrammarAnimacySchema>

export const GrammarNotableFormSchema = z.object({
  label: z.string(),
  form: z.string(),
})
export type GrammarNotableForm = z.infer<typeof GrammarNotableFormSchema>

// IPA strings bucketed by dialect. English populates `ga` (General American)
// and/or `rp` (Received Pronunciation); other languages populate `untagged`.
// Sourced from Wiktionary `sounds[]` at grounding time so the focus view can
// render pronunciation without waiting on the LLM full-exploration pass.
export const GrammarIpaBagSchema = z.object({
  ga: z.string().nullable().optional(),
  rp: z.string().nullable().optional(),
  untagged: z.string().nullable().optional(),
})
export type GrammarIpaBag = z.infer<typeof GrammarIpaBagSchema>

// Every key is `.nullable().optional()` because LLMs and JSONB-merge writes
// both occasionally leave explicit `null` values in the bag (the model emits
// `"notable_forms": null` despite the tool schema saying "array"; the
// editable panel's "clear" path stamps `null` via JSONB `||`). The renderer
// treats null and absent identically, so accepting null on read keeps the
// view from 500ing on otherwise-valid rows.
export const GrammarSchema = z
  .object({
    pos: GrammarPosSchema.nullable().optional(),
    // Display variant — canonical-but-decorated form. Russian: stress-marked
    // (`ви́деть`); the headword stays clean (`видеть`) for matching/lemmatization.
    display_form: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    // Nominal
    gender: GrammarGenderSchema.nullable().optional(),
    number_only: GrammarNumberOnlySchema.nullable().optional(),
    is_indeclinable: z.boolean().nullable().optional(),
    animacy: GrammarAnimacySchema.nullable().optional(),
    // Verbal
    aspect: GrammarAspectSchema.nullable().optional(),
    aspect_pair_headword: z.string().nullable().optional(),
    is_reflexive: z.boolean().nullable().optional(),
    // Government / case requirements (e.g. "+ acc", "от + gen", "с + instr")
    government: z.string().nullable().optional(),
    // Irregular / notable forms — open list of (label, form) pairs.
    notable_forms: z.array(GrammarNotableFormSchema).nullable().optional(),
    // Wiktionary-grounded IPA bag. English splits GA/RP; other languages
    // populate `untagged`. Renderer picks the right bucket from the user's
    // englishIpaDialect preference.
    ipa: GrammarIpaBagSchema.nullable().optional(),
  })
  .passthrough()
export type Grammar = z.infer<typeof GrammarSchema>

// Per-term knob: every kept term is at minimum 'passive' (recognition pool).
// Promoting to 'active' adds the term to the parallel active-drill pool.
export const LearningModeSchema = z.enum(['passive', 'active'])
export type LearningMode = z.infer<typeof LearningModeSchema>

// Which SRS column family a practice session reads and writes. 1:1 with
// user_lookups.learning_mode for the purpose of selecting sources, but lives
// on practice_sessions so the rating layer knows whether to advance srs_* or
// active_srs_*.
export const PracticePoolSchema = z.enum(['passive', 'active'])
export type PracticePool = z.infer<typeof PracticePoolSchema>

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
  grammar: GrammarSchema.default({}),
  // Set when the wiktionary-grounding step merged kaikki data into `grammar`.
  // Null means pure-LLM (either grounding didn't run, or no kaikki entry
  // matched). Persists across user edits.
  groundedAt: z.string().nullable(),
  // Set when the user manually edits grammar-provenance-sensitive data.
  // Automatic processing/enrichment/chat patches do not stamp this.
  grammarUserEditedAt: z.string().nullable(),
  // Passive (default) or active. Active terms additionally participate in the
  // active-drill pool with their own SRS state.
  learningMode: LearningModeSchema.default('passive'),
})
export type Chunk = z.infer<typeof ChunkSchema>

// Row shape returned by the Vocabulary tab list endpoint. Adds SRS state,
// recency, and the originating session/card so the action drawer can navigate
// without round trips.
export const ChunkRowSchema = ChunkSchema.extend({
  count: z.number().int(),
  srsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  srsDue: z.string().nullable(),
  srsReps: z.number().int(),
  // Parallel active-pool SRS state. Null when the term hasn't been drilled in
  // the active pool yet (including all 'passive' terms).
  activeSrsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  activeSrsDue: z.string().nullable(),
  activeSrsReps: z.number().int(),
  createdAt: z.string(),
  firstCardId: z.string().uuid().nullable(),
  firstCardSegmentId: z.string().uuid().nullable(),
  studySessionId: z.string().uuid().nullable(),
  sourceAvailable: z.boolean(),
})
export type ChunkRow = z.infer<typeof ChunkRowSchema>

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
  // Live content joined from user_lookups at fetch time so the rate sheet can
  // show the translation + definition without an extra round trip. Null when
  // the canonical row was deleted between generation and read.
  translation: z.string().nullable(),
  definition: z.string().nullable(),
  // Same join as translation/definition — surfaces the typed morphology bag
  // (pos, gender, aspect, government, ipa, display_form, …) so the rate sheet
  // can render the same chips + stress-marked headword + IPA the focus view
  // shows. Per-language allowlist gates which fields are rendered.
  grammar: GrammarSchema.nullable(),
  // Identifiers joined from user_lookups so the rate sheet can wire Edit
  // (navigate to the focus view of `cardId` within `cardSessionId`) and
  // Delete (soft-delete `userLookupId`). Null when the canonical row no
  // longer exists or the chunk has never been kept in any session.
  userLookupId: z.string().uuid().nullable(),
  cardId: z.string().uuid().nullable(),
  cardSessionId: z.string().uuid().nullable(),
  // Mirror of `user_lookups.deleted_at` so the practice text can render the
  // strikethrough/Restore state for chunks the user just deleted from the
  // sheet, even after a refetch.
  deletedAt: z.string().nullable(),
  // Current learning mode for the user_lookup row, so the rate sheet can show
  // the right "Switch to passive/active" action. Null when no canonical row.
  learningMode: LearningModeSchema.nullable(),
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
  // 'passive' for normal SRS reviews, 'active' for the active-drill pool. The
  // rating layer routes FSRS writes to srs_* or active_srs_* based on this.
  pool: PracticePoolSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
})
export type PracticeSession = z.infer<typeof PracticeSessionSchema>

export const PracticeDueSummaryEntrySchema = z.object({
  targetLanguage: z.string(),
  totalKept: z.number().int(),
  // Legacy alias used by older clients. In the current UX this means daily
  // review due, not intraday learning follow-ups.
  dueCount: z.number().int(),
  reviewDueCount: z.number().int(),
  learningDueCount: z.number().int(),
  nextLearningDueAt: z.string().nullable(),
  newCount: z.number().int(),
  newIntroducedTodayCount: z.number().int(),
  // Passive-pool active practice session id. Renamed from
  // activePracticeSessionId so clients are explicit about which pool to resume.
  passivePracticeSessionId: z.string().uuid().nullable(),
  // Active-drill pool counters. activeTotal is the number of user_lookups
  // promoted to learning_mode='active'; the rest mirror the passive counts
  // but read from active_srs_* state.
  activeTotal: z.number().int(),
  activeReviewDueCount: z.number().int(),
  activeLearningDueCount: z.number().int(),
  activeNewCount: z.number().int(),
  activePracticeSessionId: z.string().uuid().nullable(),
})
export type PracticeDueSummaryEntry = z.infer<typeof PracticeDueSummaryEntrySchema>

// Session progress (Problem 1). Numerator = chunks resolved (rated
// hard/good/easy at any point in the session, plus chunks the LLM abandoned
// after two skips). Denominator = the eligible-at-start subset of the
// frozen membership snapshot. Stable across the whole sitting.
export const PracticeSessionProgressSchema = z.object({
  completed: z.number().int(),
  target: z.number().int(),
})
export type PracticeSessionProgress = z.infer<typeof PracticeSessionProgressSchema>
