import { z } from 'zod'

export const ContentSourceTypeSchema = z.enum([
  'movie',
  'tv',
  'book',
  'article',
  'text',
  'adhoc',
  'youtube',
  'streaming',
  'lesson',
])
export type ContentSourceType = z.infer<typeof ContentSourceTypeSchema>

export const TextTrackSourceSchema = z.enum(['opensubtitles', 'upload', 'paste', 'url'])
export type TextTrackSource = z.infer<typeof TextTrackSourceSchema>

// Auto-keep session-vocabulary model:
//   needs_data — a card with no basic flashcard data yet (usually a note-only
//                stub awaiting Generate full exploration / chat).
//   kept       — has basic data; contributes to user_lookups.count and is in
//                Vocabulary/Practice. Cards auto-keep into this the moment they
//                gain basic data (saving the highlight was the explicit commit).
//   removed    — removed from its session vocabulary list (unkept). NOT a
//                soft-delete of the term — it survives in Vocabulary if kept
//                elsewhere. Term-level deletion is chunks.deleteChunk.
export const CardStatusSchema = z.enum(['needs_data', 'kept', 'removed'])
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

// What you practise on a target — one axis of a study_facets facet. `pool` (the
// session queue) is the DERIVED pool of a skill and stays on the wire; this is
// card identity. 'pronunciation' is recognition-pool and pairs with any
// target_form: citation cards read the lemma's grammar.ipa, form cards read the
// facet payload's grammar.ipa (generated per form, never the lemma's).
export const FacetSkillSchema = z.enum(['meaning_recognition', 'meaning_production', 'pronunciation'])
export type FacetSkill = z.infer<typeof FacetSkillSchema>

// Optional facet configuration chosen in a gloss-save popover, applied
// server-side once the term exists (the enrich_highlight job for highlight
// saves; inline for adhoc saves). FULL-SET semantics: when present, exactly the
// listed skills get facets — recognition must be listed explicitly (this skips
// the keep-time default via the facet row-existence check). Absent = today's
// default (citation recognition at Keep).
//
// `formScope` chooses WHICH target the skills attach to (exclusive, not
// additive): 'lemma' studies the dictionary form (citation facets); 'form'
// studies the encountered inflection (form facets keyed on
// normalizeTargetForm(surface)), leaving the lemma as a skill-less base anchor
// (it still exists as the user_lookup row + vocab entry + the focus view's
// citation chip). 'form' collapses to 'lemma' when the surface IS the headword
// (no distinct inflection; the client never knows the lemma, so the collapse
// decision lives server-side). Application is enable-only and additive on term
// dedupe — it never disables an existing facet.
export const StudyIntentSchema = z.object({
  skills: z.array(FacetSkillSchema).min(1),
  formScope: z.enum(['lemma', 'form']),
})
export type StudyIntent = z.infer<typeof StudyIntentSchema>

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
  // The gloss-save study intent stored on the highlight row, before the
  // enrich_highlight job applies it. Null once cleared, or never set. The saved
  // gloss sheet edits this directly (highlights.updateStudyIntent) while the
  // term is still pre-enrich (no facets exist yet).
  studyIntent: StudyIntentSchema.nullable(),
  // The user_lookups id once the enrich job has materialized this highlight's
  // card/term (cards.highlight_id → cards.user_lookup_id). Null pre-enrich. When
  // set, the saved gloss sheet switches from intent-editing to live-facet editing.
  chunkId: z.string().uuid().nullable(),
  createdAt: z.string(),
})
export type Highlight = z.infer<typeof HighlightSchema>

// A passive LLM-nominated span (Phase 2 ghost candidate). char_start/char_end are
// offsets into the segment's stored (SRT-stripped) text — the same coordinate space
// as Highlight.startOffset/endOffset, so the reader's selection compares directly.
export const GhostCandidateSchema = z.object({
  id: z.string().uuid(),
  studySessionId: z.string().uuid(),
  segmentId: z.string().uuid(),
  charStart: z.number().int(),
  charEnd: z.number().int(),
  surfaceForm: z.string(),
})
export type GhostCandidate = z.infer<typeof GhostCandidateSchema>

// One entry in the nomination coverage set — a reading window already requested,
// so the client never re-requests it. `status` is 'pending' while its nominate job
// is in flight, 'done' once it has resolved (even if it produced no candidates),
// or 'failed' if the job exhausted retries.
export const NominatedWindowSchema = z.object({
  startIndex: z.number().int(),
  endIndex: z.number().int(),
  status: z.enum(['pending', 'done', 'failed']),
})
export type NominatedWindow = z.infer<typeof NominatedWindowSchema>

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

// German perfect auxiliary. `haben_or_sein` is real (fahren, aufstehen take
// either depending on transitivity / motion sense).
export const GrammarAuxiliarySchema = z.enum(['haben', 'sein', 'haben_or_sein'])
export type GrammarAuxiliary = z.infer<typeof GrammarAuxiliarySchema>

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
// Every enum-typed key is `.catch(undefined)`: LLM passes (basic-data /
// exploration models AND the per-card chat's `update_card_fields` tool) author
// this bag and occasionally emit a valid-but-out-of-enum value — e.g.
// `pos: "determiner"` for a Russian определитель, which our POS set doesn't
// list. A strict enum would 500 EVERY read of the card (and its whole session)
// on output validation. `.catch` coerces an unrecognized value to `undefined`
// (dropped on read; the raw value stays harmlessly in the JSONB), honoring this
// schema's "never 500 on a partial/garbled bag" contract.
export const GrammarSchema = z
  .object({
    pos: GrammarPosSchema.nullable().optional().catch(undefined),
    // Display variant — canonical-but-decorated form. Russian: stress-marked
    // (`ви́деть`); the headword stays clean (`видеть`) for matching/lemmatization.
    display_form: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    // Nominal
    gender: GrammarGenderSchema.nullable().optional().catch(undefined),
    number_only: GrammarNumberOnlySchema.nullable().optional().catch(undefined),
    is_indeclinable: z.boolean().nullable().optional(),
    animacy: GrammarAnimacySchema.nullable().optional().catch(undefined),
    // Verbal
    aspect: GrammarAspectSchema.nullable().optional().catch(undefined),
    aspect_pair_headword: z.string().nullable().optional(),
    is_reflexive: z.boolean().nullable().optional(),
    // German-specific morphology. Plural / genitive store the REAL form
    // always; the renderer derives the display (article, suffix-vs-full plural,
    // notable-genitive gating). `is_weak_noun` is its own learner-facing fact
    // (n-declension); `auxiliary` is the perfect-tense helper verb.
    plural: z.string().nullable().optional(),
    genitive: z.string().nullable().optional(),
    is_weak_noun: z.boolean().nullable().optional(),
    is_separable: z.boolean().nullable().optional(),
    auxiliary: GrammarAuxiliarySchema.nullable().optional().catch(undefined),
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

// The two practice queues, named for their dominant skill direction:
// 'recognition' serves the meaning_recognition + pronunciation facets,
// 'production' serves meaning_production. Matches the backend's PracticePool,
// the DB pool columns, and the UI labels ("Recognition practice" /
// "Production practice").
export const PracticePoolSchema = z.enum(['recognition', 'production'])
export type PracticePool = z.infer<typeof PracticePoolSchema>

// Full per-form card content stored in a form facet's `study_facets.payload`
// JSONB. A form is its own editable card: its `form` (display spelling)
// plus its own translation / definition / examples / grammar subset, all
// independent of the shared lemma `user_lookups` row. The `grammar` slot reuses
// GrammarSchema (lenient + passthrough) so it never 500s on a legacy or partial
// bag; the per-form editor only surfaces the editable subset (pos, ipa,
// display_form, gender, aspect, government, notable_forms). Validated at the
// `setFacetPayload` contract boundary; `StudyFacetSummarySchema.payload` itself
// stays a lenient record on the wire (legacy `{form,translation}` rows predate
// this and must round-trip without erroring).
export const FormFacetPayloadSchema = z
  .object({
    form: z.string(),
    translation: z.string().nullable().optional(),
    definition: z.string().nullable().optional(),
    targetExample: z.string().nullable().optional(),
    nativeExample: z.string().nullable().optional(),
    grammar: GrammarSchema.optional(),
  })
  .passthrough()
export type FormFacetPayload = z.infer<typeof FormFacetPayloadSchema>

// The encountered occurrence backing a study target — the most-recent kept
// `cards` row matching the target (normalized surface_form == target_form; ==
// headword for citation), joined to its session / text track and the center
// segment text. Drives the per-target Context block + source-seeded examples.
// `null` when there is no kept occurrence, the session is adhoc, or it has no
// text track — those targets render no Context and seed no example.
export const StudyFacetSourceSchema = z.object({
  sessionId: z.string().uuid(),
  segmentId: z.string().uuid(),
  textTrackId: z.string().uuid(),
  sentence: z.string(),
})
export type StudyFacetSource = z.infer<typeof StudyFacetSourceSchema>

// One study facet as seen by the Study-targets control (chunks.getStudyTargets).
// The chunk DTO only derives `learningMode` from the citation production facet;
// to render per-form / pronunciation chips the term view needs each facet's
// identity + membership + data readiness, which this summary carries. `enabled`
// = disabled_at IS NULL (disable != delete); `dataStatus='pending_data'` =
// enabled but not yet queued (Phase 4 form generation). `payload` carries full
// per-form card content for form facets (FormFacetPayloadSchema-shaped, but kept
// lenient on the wire for legacy rows), {} for citation/pronunciation. `source`
// is the encountered occurrence backing this target (Context block + example
// seeding); null when there's none.
export const StudyFacetSummarySchema = z.object({
  skill: FacetSkillSchema,
  targetForm: z.string(),
  enabled: z.boolean(),
  dataStatus: z.enum(['ready', 'pending_data']),
  srsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  payload: z.record(z.string(), z.unknown()),
  // Snapshot of the payload as the generate pass wrote it (server-write-only
  // column, never client-supplied). Per-field provenance compares `payload`
  // against it: equal = generated, diverged = user-edited. Null for
  // manually-entered or legacy form facets — those make no provenance claims.
  generatedPayload: z.record(z.string(), z.unknown()).nullable().default(null),
  source: StudyFacetSourceSchema.nullable(),
})
export type StudyFacetSummary = z.infer<typeof StudyFacetSummarySchema>

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
  // The exact kaikki patch merged into `grammar` at grounding time. Per-field
  // provenance compares grammar values against it: equal = Wiktionary-verified,
  // diverged = user-edited. Null when never grounded, or grounded before the
  // snapshot column existed (legacy rows claim nothing until re-grounded).
  groundingPatch: z.record(z.string(), z.unknown()).nullable().default(null),
  // Set when the user manually edits grammar-provenance-sensitive data.
  // Automatic processing/enrichment/chat patches do not stamp this.
  grammarUserEditedAt: z.string().nullable(),
  // True iff the citation meaning_production facet is enabled — i.e. the term
  // is in production study (the production pool, with its own SRS state).
  // Derived server-side from facet state (the user_lookups.learning_mode column
  // was dropped).
  isProductionEnabled: z.boolean().default(false),
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
  // Parallel production-pool SRS state. Null when the term hasn't been drilled
  // in the production pool yet (including all recognition-only terms).
  productionSrsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  productionSrsDue: z.string().nullable(),
  productionSrsReps: z.number().int(),
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
  // True when the newest assistant turn in this card's chat is newer than the
  // user's last_read_at (server-derived per card instance, not per chunk).
  hasUnreadChat: z.boolean(),
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
  processingWarnings: z.array(z.string()),
  // Deepest segment index the reader has reached (resume-reading position). NULL
  // until the reader scrolls in a normal session view. Track-relative index.
  furthestReadSegmentIndex: z.number().int().nullable(),
  createdAt: z.string(),
  contentSourceTitle: z.string().nullable(),
  contentSourceType: ContentSourceTypeSchema.nullable(),
  contentSourcePosterUrl: z.string().nullable(),
  contentSourceYear: z.number().int().nullable(),
  // TV-only show identity, read from content_source.metadata. Null for every
  // other source type. Powers grouping the Sessions list by show and the
  // "Add episode" shortcut that pre-seeds the new-session wizard.
  tmdbShowId: z.number().int().nullable(),
  seasonNumber: z.number().int().nullable(),
  episodeNumber: z.number().int().nullable(),
  showTitle: z.string().nullable(),
  originalTitle: z.string().nullable(),
  episodeTitle: z.string().nullable(),
})
export type StudySession = z.infer<typeof StudySessionSchema>

// =============================================================================
// Practice tab — SRS through generated texts
// =============================================================================

export const PracticeRatingSchema = z.enum(['again', 'hard', 'good', 'easy'])
export type PracticeRating = z.infer<typeof PracticeRatingSchema>

// Which slice of the live SRS pool a review pulls. review_due = cards due now;
// learn_new = never-reviewed cards up to the daily cap; mixed = both, due-first.
// Generalizes the old session "mode" without the learn_extra/production-drill
// variants (production is now expressed via `pool`, extra-learning is gone).
export const ReviewScopeSchema = z.enum(['review_due', 'learn_new', 'mixed'])
export type ReviewScope = z.infer<typeof ReviewScopeSchema>

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
  // Whether the term is in production study (citation meaning_production facet
  // enabled), so the rate sheet can show the right "Switch to
  // production/recognition-only" action. Null when no canonical row.
  isProductionEnabled: z.boolean().nullable(),
})
export type PracticeAnnotation = z.infer<typeof PracticeAnnotationSchema>

export const PracticeTextSchema = z.object({
  id: z.string().uuid(),
  // Which practice queue the text was generated for. The rating layer routes
  // FSRS writes to the pool's facet skill based on this. Replaces the old
  // practiceSessionId now that reading is sessionless: texts are kept per
  // (user, target_language, pool) and double as history.
  pool: PracticePoolSchema,
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
  // Unseen opt-in facets (pronunciation / specific forms), enabled+ready, per
  // pool. Served only in learn-new sessions — newCount/productionNewCount
  // stay citation-only because the mixed Practice queue never serves opt-ins.
  optInNewCount: z.number().int(),
  productionOptInNewCount: z.number().int(),
  // Review-state cards rated today (the spent daily review budget, counted
  // off the rating-event log). Lets the landing distinguish "limit reached"
  // from "all caught up" when due work exists beyond the budget.
  reviewedTodayCount: z.number().int(),
  // Parked recognition terms, split by origin (both excluded from every
  // practice queue until they leave the ladder; the due counts above already
  // exclude them). parkedCount = genuine leeches ("strengthen them");
  // warmupCount = exercise-first onboarding terms still warming up ("continue").
  // Recognition-only — warm-up never parks production facets.
  parkedCount: z.number().int(),
  warmupCount: z.number().int(),
  // Production-pool counters. productionTotal is the number of terms in
  // production study (enabled citation meaning_production facet); the rest
  // mirror the recognition counts but read the production facets' SRS state.
  productionTotal: z.number().int(),
  productionReviewDueCount: z.number().int(),
  productionLearningDueCount: z.number().int(),
  productionNewCount: z.number().int(),
  // Parked production terms, split by origin like parkedCount / warmupCount:
  // productionParkedCount = leeches ("strengthen them"); productionWarmupCount =
  // exercise-first onboarding still warming up ("continue").
  productionParkedCount: z.number().int(),
  productionWarmupCount: z.number().int(),
  // In-progress reading-mode texts (status='reading'), at most one per pool.
  // Feeds the landing's "continue reading" affordance. The scope is needed to
  // resume: re-entering reading under a different scope discards the open
  // text (failMismatchedScopeSlots). NULL scope = legacy row, any scope works.
  currentReadings: z.array(
    z.object({
      pool: PracticePoolSchema,
      scope: ReviewScopeSchema.nullable(),
      termCount: z.number().int(),
    })
  ),
})
export type PracticeDueSummaryEntry = z.infer<typeof PracticeDueSummaryEntrySchema>

// =========================================================================
// Strengthen exercises (leech rehab + post-session bonus)
// =========================================================================

export const ExerciseTypeSchema = z.enum(['mc_cloze', 'mc_comprehension', 'production_cloze', 'use_in_sentence'])
export type ExerciseType = z.infer<typeof ExerciseTypeSchema>

// Served payloads are STRIPPED: answer / answerIndex / acceptedForms never
// leave the server — grading is server-side only (submitExerciseAnswer).
export const McClozePayloadSchema = z.object({
  type: z.literal('mc_cloze'),
  sentence: z.string(),
  blankStart: z.number().int(),
  blankEnd: z.number().int(),
  options: z.array(z.string()).length(4),
})
export const McComprehensionPayloadSchema = z.object({
  type: z.literal('mc_comprehension'),
  sentence: z.string(),
  prompt: z.string(),
  options: z.array(z.string()).length(4),
})
export const ProductionClozePayloadSchema = z.object({
  type: z.literal('production_cloze'),
  sentence: z.string(),
  blankStart: z.number().int(),
  blankEnd: z.number().int(),
  hint: z.string().nullable(),
})
export const UseInSentencePayloadSchema = z.object({
  type: z.literal('use_in_sentence'),
  prompt: z.string(),
  term: z.string(),
})
export const StrengthenExercisePayloadSchema = z.discriminatedUnion('type', [
  McClozePayloadSchema,
  McComprehensionPayloadSchema,
  ProductionClozePayloadSchema,
  UseInSentencePayloadSchema,
])
export type StrengthenExercisePayload = z.infer<typeof StrengthenExercisePayloadSchema>

// One Strengthen-session item. `track` separates the gated rehab path (parked
// leeches) from the ungated bonus path (this-session again/hard terms).
// status='generating' means the bank is still cooking an exercise (the entry
// has no exercise yet — exerciseId/exerciseType/payload null — and the client
// shows a placeholder it can poll to swap in place). status='failed' means
// generation is terminally exhausted for this term (every candidate gate slot
// failed): the client shows a "couldn't prepare — skip" state instead of an
// endless hourglass.
export const StrengthenExerciseEntrySchema = z.object({
  exerciseId: z.string().uuid().nullable(),
  userLookupId: z.string().uuid(),
  // The facet pool this exercise drills. A warm-up serves a MIXED queue
  // (recognition + production); a both-skills term contributes one entry per
  // pool with the SAME userLookupId, so the client must key its placeholder
  // merge on (pool, userLookupId), not userLookupId alone.
  pool: PracticePoolSchema,
  headword: z.string(),
  sense: z.string(),
  // The term's meaning — powers the opt-in Hint on cloze exercises and the
  // post-answer reminder line. The client picks translation vs definition by
  // the same rules as flashcard faces (definition-only when L1 = L2 or the
  // Show-translations pref is off).
  translation: z.string().nullable(),
  definition: z.string().nullable(),
  track: z.enum(['gate', 'bonus']),
  status: z.enum(['ready', 'generating', 'failed']),
  // How the term got parked — picks the client copy ("warming up" vs "rehab")
  // in the composed queue, which serves both origins in one session. Null on
  // the bonus track.
  origin: z.enum(['onboarding', 'leech']).nullable(),
  exerciseType: ExerciseTypeSchema.nullable(),
  payload: StrengthenExercisePayloadSchema.nullable(),
})
export type StrengthenExerciseEntry = z.infer<typeof StrengthenExerciseEntrySchema>

export const ExerciseAnswerSchema = z.union([
  z.object({ selectedIndex: z.number().int().min(0).max(3) }),
  z.object({ text: z.string().trim().min(1).max(500) }),
])
export type ExerciseAnswer = z.infer<typeof ExerciseAnswerSchema>

// One term in the sessionless review queue (formerly Flashcard). All fields are
// read straight off user_lookups — no generated text involved. The same row
// feeds both render modes: the flashcard front/back and the reading generator's
// candidate set. `display_form` (when present) lives inside `grammar` and is
// read client-side. `srsState` is null for never-reviewed (new) terms.
export const ReviewTermSchema = z.object({
  userLookupId: z.string().uuid(),
  headword: z.string(),
  sense: z.string(),
  translation: z.string().nullable(),
  definition: z.string().nullable(),
  targetExample: z.string().nullable(),
  nativeExample: z.string().nullable(),
  grammar: GrammarSchema.nullable(),
  srsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  targetLanguage: z.string(),
  // Facet identity: the client holds the queue item, so it carries each card's
  // identity back to rate/undo. `targetForm` is '' for citation cards. In
  // Phase 2 every queued card is the citation facet; the fields are carried so
  // the rate/undo wiring is ready for pronunciation/form facets (Phase 4).
  skill: FacetSkillSchema,
  targetForm: z.string(),
  // Form facets ({form, translation}); '{}' / null for citation cards. Designed
  // now, populated in Phase 4.
  facetPayload: z.record(z.string(), z.unknown()).nullable(),
  // 'wiktionary' when the citation card's displayed IPA is dictionary-grounded
  // (grammar.ipa still matches the grounding snapshot) — drives the blue
  // verified badge on flashcards. Computed server-side; always null for form
  // cards (form IPA is generated, never grounded).
  ipaSource: z.enum(['wiktionary']).nullable(),
})
export type ReviewTerm = z.infer<typeof ReviewTermSchema>

// =========================================================================
// Composed practice queue (flashcards + gate exercises in one session)
// =========================================================================

// Selects which term populations the composed queue serves. Render type is
// derived from term state (parked → gate exercise; due/graduated → flashcard;
// new opt-in facet → flashcard), never chosen per item — the filter only
// scopes populations. All fields default to the primary "Practice" behavior,
// so `{}` is the everyday queue.
export const PracticeQueueFilterSchema = z.object({
  pools: z.array(PracticePoolSchema).min(1).default(['production', 'recognition']),
  // 'due_only' = no new introductions of any kind; 'new_only' = warm-up gates
  // (+ opt-in-new flashcards when enabled) only.
  scope: z.enum(['due_only', 'new_only', 'both']).default('both'),
  render: z.enum(['flashcards_only', 'exercises_only', 'both']).default('both'),
  // Auto-park eligible new terms into warm-up before serving. Forced off
  // server-side on the refresh endpoint (polling must never introduce).
  autoWarmup: z.boolean().default(true),
  // Serve never-reviewed opt-in (pronunciation/form) facets as flashcards —
  // their only introduction path, reserved for the Learn-new preset.
  includeOptInNew: z.boolean().default(false),
  // Explicit learn-extra batch: park up to this many recognition terms past
  // the daily-new cap. Compose-only; ignored by refresh.
  learnExtraCount: z.number().int().min(1).max(20).optional(),
})
export type PracticeQueueFilter = z.infer<typeof PracticeQueueFilterSchema>

// The primary "Practice" behavior — both pools, everything in scope, warm-up
// on. Used as the contract-level default when no filter is sent, and by
// clients building preset specs relative to the default.
export const DEFAULT_PRACTICE_QUEUE_FILTER: PracticeQueueFilter = {
  pools: ['production', 'recognition'],
  scope: 'both',
  render: 'both',
  autoWarmup: true,
  includeOptInNew: false,
}

// One composed-queue item. Reuses the flashcard and exercise wire shapes
// verbatim; the client dispatches its renderer on `type`.
export const PracticeQueueItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flashcard'), card: ReviewTermSchema }),
  z.object({ type: z.literal('exercise'), entry: StrengthenExerciseEntrySchema }),
])
export type PracticeQueueItem = z.infer<typeof PracticeQueueItemSchema>

// One explicit rating the client collected while reading a text, keyed by the
// term's user_lookup id. Annotations absent from the list are advanced as
// implicit 'good'. Sent in a single batch by advanceReadingText.
export const ReadingRatingSchema = z.object({
  userLookupId: z.string().uuid(),
  rating: PracticeRatingSchema,
})
export type ReadingRating = z.infer<typeof ReadingRatingSchema>
