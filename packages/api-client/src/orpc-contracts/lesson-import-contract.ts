import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { FacetSkillSchema } from './common/flicktionary-schemas'

export const ImportBatchStatusSchema = z.enum(['extracting', 'ready', 'failed', 'confirmed'])
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>

export const LessonRowTypeSchema = z.enum(['vocab', 'grammar', 'pronunciation', 'win', 'noise'])
export type LessonRowType = z.infer<typeof LessonRowTypeSchema>

export const ImportPlannedActionSchema = z.enum(['create', 'add_facet', 'lapse_and_add_facet', 'skip'])
export type ImportPlannedAction = z.infer<typeof ImportPlannedActionSchema>

// One extracted row as the confirm screen renders it: the extractor payload
// flattened, plus the duplicate resolution the extract job computed.
export const ImportBatchRowSchema = z.object({
  id: z.string().uuid(),
  rowIndex: z.number().int(),
  lessonDate: z.string().nullable(),
  sourceText: z.string(),
  type: LessonRowTypeSchema,
  headword: z.string(),
  targetForm: z.string().nullable(),
  context: z.string(),
  wrongForm: z.string().nullable(),
  stressMark: z.string().nullable(),
  proposedSkills: z.array(FacetSkillSchema),
  confidence: z.number(),
  plannedAction: ImportPlannedActionSchema,
  duplicateHeadword: z.string().nullable(),
  duplicateEnabledSkills: z.array(FacetSkillSchema).nullable(),
})
export type ImportBatchRow = z.infer<typeof ImportBatchRowSchema>

export const ImportBatchSchema = z.object({
  id: z.string().uuid(),
  status: ImportBatchStatusSchema,
  targetLanguage: z.string(),
  sourceTitle: z.string(),
  formatProfile: z.string().nullable(),
  studySessionId: z.string().uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
})
export type ImportBatch = z.infer<typeof ImportBatchSchema>

export const TeacherProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  language: z.string(),
  profileText: z.string(),
})
export type TeacherProfile = z.infer<typeof TeacherProfileSchema>

export const lessonImportContract = {
  // Create (or resume) an extraction draft from client-normalized markdown.
  // Idempotent by input hash per (user, target language): re-uploading the
  // same text returns the existing batch — if that batch is already
  // 'confirmed', its studySessionId routes the client to the session instead
  // of a stale confirm screen.
  createBatch: oc
    .route({ method: 'POST', path: '/lesson-import/batches', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(2),
        sourceTitle: z.string().min(1).max(200),
        rawText: z.string().min(1).max(500_000),
        teacherProfileId: z.string().uuid().nullable().optional(),
      })
    )
    .output(z.object({ data: z.object({ batch: ImportBatchSchema, resumed: z.boolean() }) })),

  // Poll target while status is 'extracting'; rows are populated once 'ready'.
  getBatch: oc
    .route({ method: 'GET', path: '/lesson-import/batches/{batchId}', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
    })
    .input(z.object({ batchId: z.string().uuid() }))
    .output(z.object({ data: z.object({ batch: ImportBatchSchema, rows: z.array(ImportBatchRowSchema) }) })),

  // Apply the user's accept/reject decisions. LLM-free and transactional:
  // creates the lesson session, appends one segment + highlight per accepted
  // new row (standard enrich_highlight jobs produce the cards progressively),
  // adds facets / applies implicit lapses on duplicates. `saveProfileName`
  // stores the batch's inferred formatProfile as a reusable teacher profile.
  confirmBatch: oc
    .route({ method: 'POST', path: '/lesson-import/batches/{batchId}/confirm', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      // Not in 'ready' state: double-submit, still extracting, or failed.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      // Native language missing — finish onboarding first.
      PRECONDITION_FAILED: { status: 412, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        batchId: z.string().uuid(),
        decisions: z
          .array(
            z.object({
              rowId: z.string().uuid(),
              accepted: z.boolean(),
              skills: z.array(FacetSkillSchema).optional(),
            })
          )
          .max(500),
        saveProfileName: z.string().min(1).max(100).optional(),
      })
    )
    .output(z.object({ data: z.object({ sessionId: z.string().uuid() }) })),

  listProfiles: oc
    .route({ method: 'GET', path: '/lesson-import/profiles', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}).optional())
    .output(z.object({ data: z.object({ profiles: z.array(TeacherProfileSchema) }) })),

  upsertProfile: oc
    .route({ method: 'POST', path: '/lesson-import/profiles', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        language: z.string().min(2),
        profileText: z.string().min(1).max(10_000),
      })
    )
    .output(z.object({ data: z.object({ profile: TeacherProfileSchema }) })),
} as const
