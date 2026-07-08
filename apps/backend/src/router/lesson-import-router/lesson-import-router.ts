import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { lessonImportContract } from '@flicktionary/api-client/orpc-contracts/lesson-import-contract'
import type {
  ImportBatch,
  ImportBatchRow,
  ImportBatchStatus,
} from '@flicktionary/api-client/orpc-contracts/lesson-import-contract'
import type { DbImportBatch, DbImportBatchRow } from '../../transport/database/import-batches/import-batches-repository'
import type { FacetSkill } from '../../transport/database/study-facets/study-facets-repository'
import type { ExtractedLessonRow } from '../../transport/third-party/anthropic/passes/extract-lesson-pass'
import { createBatch } from '../../service/lesson-import/create-batch'
import {
  confirmBatch,
  ConfirmBatchConflictError,
  ConfirmBatchNeedsOnboardingError,
  mapProposedFacetsToSkills,
  type ConfirmBatchDeps,
} from '../../service/lesson-import/confirm-batch'
import { toIsoString } from '../router-utils'

const toBatchDto = (batch: DbImportBatch): ImportBatch => ({
  id: batch.id,
  status: batch.status as ImportBatchStatus,
  targetLanguage: batch.target_language,
  sourceTitle: batch.source_title,
  formatProfile: batch.format_profile,
  studySessionId: batch.study_session_id,
  error: batch.error,
  createdAt: toIsoString(batch.created_at)!,
})

const toRowDto = (row: DbImportBatchRow): ImportBatchRow => {
  const payload = row.payload as unknown as ExtractedLessonRow
  const duplicateFacets = row.duplicate_facets as {
    headword?: string
    enabledSkills?: FacetSkill[]
  } | null
  return {
    id: row.id,
    rowIndex: row.row_index,
    lessonDate: row.lesson_date ? toIsoString(row.lesson_date) : null,
    sourceText: payload.sourceText,
    type: payload.type,
    headword: payload.headword,
    targetForm: payload.targetForm,
    context: payload.context,
    wrongForm: payload.wrongForm,
    stressMark: payload.stressMark,
    proposedSkills: mapProposedFacetsToSkills(payload.proposedFacets),
    confidence: payload.confidence,
    plannedAction: row.planned_action as ImportBatchRow['plannedAction'],
    duplicateHeadword: duplicateFacets?.headword ?? null,
    duplicateEnabledSkills: duplicateFacets?.enabledSkills ?? null,
  }
}

export const LessonImportRouter = (deps: ConfirmBatchDeps): Router => {
  const implementer = implement(lessonImportContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    createBatch: implementer.createBatch.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await createBatch(
        {
          userId,
          targetLanguage: input.targetLanguage,
          sourceTitle: input.sourceTitle,
          rawText: input.rawText,
          teacherProfileId: input.teacherProfileId ?? null,
        },
        deps
      )
      if (!result.ok) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'The pasted text is empty' }] } })
      }
      return { data: { batch: toBatchDto(result.batch), resumed: result.resumed } }
    }),

    getBatch: implementer.getBatch.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const batch = await deps.importBatchesRepository.findByIdForUser(input.batchId, userId)
      if (!batch) throw errors.NOT_FOUND({ data: { errors: [{ message: 'Import batch not found' }] } })
      const rows =
        batch.status === 'ready' || batch.status === 'confirmed'
          ? await deps.importBatchesRepository.listRows(batch.id)
          : []
      return { data: { batch: toBatchDto(batch), rows: rows.map(toRowDto) } }
    }),

    confirmBatch: implementer.confirmBatch.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const batch = await deps.importBatchesRepository.findByIdForUser(input.batchId, userId)
      if (!batch) throw errors.NOT_FOUND({ data: { errors: [{ message: 'Import batch not found' }] } })
      try {
        const result = await confirmBatch(
          {
            userId,
            batchId: input.batchId,
            decisions: input.decisions,
            saveProfileName: input.saveProfileName,
          },
          deps
        )
        return { data: { sessionId: result.sessionId } }
      } catch (error) {
        if (error instanceof ConfirmBatchConflictError) {
          throw errors.CONFLICT({ data: { errors: [{ message: 'Batch is not ready to confirm' }] } })
        }
        if (error instanceof ConfirmBatchNeedsOnboardingError) {
          throw errors.PRECONDITION_FAILED({
            data: { errors: [{ message: 'Finish onboarding (native language) first' }] },
          })
        }
        throw error
      }
    }),

    listProfiles: implementer.listProfiles.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const profiles = await deps.teacherProfilesRepository.listForUser(userId)
      return {
        data: {
          profiles: profiles.map((p) => ({
            id: p.id,
            name: p.name,
            language: p.language,
            profileText: p.profile_text,
          })),
        },
      }
    }),

    upsertProfile: implementer.upsertProfile.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const profile = await deps.teacherProfilesRepository.upsert({
        userId,
        name: input.name,
        language: input.language,
        profileText: input.profileText,
      })
      return {
        data: {
          profile: {
            id: profile.id,
            name: profile.name,
            language: profile.language,
            profileText: profile.profile_text,
          },
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: lessonImportContract })
}
