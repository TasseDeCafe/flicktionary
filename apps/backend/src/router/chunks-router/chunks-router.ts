import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import {
  chunksContract,
  ChunksCursorSchema,
  type ChunksCursor,
} from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import {
  ChunkRow,
  LastFacetFloorError,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { PracticeExercisesRepositoryInterface } from '../../transport/database/practice-exercises/practice-exercises-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { buildVocabularyCsv } from '../../service/export/build-vocabulary-csv'
import { generateFormFacetData } from '../../service/study-facets/generate-form-facet-data'
import { reconcilePronunciationFacet } from '../../service/study-facets/reconcile-pronunciation-facet'
import { toIsoString } from '../router-utils'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'

// Project a facet-joined ChunkRow down to the bare ChunkSchema shape (the
// setFacetEnabled response). ChunkRow already carries the DERIVED
// isProductionEnabled.
const toChunkRowAsChunkDto = (row: ChunkRow) => ({
  id: row.id,
  userId: row.userId,
  targetLanguage: row.targetLanguage,
  headword: row.headword,
  sense: row.sense,
  translation: row.translation,
  definition: row.definition,
  targetExample: row.targetExample,
  nativeExample: row.nativeExample,
  explorationExtras: row.explorationExtras,
  grammar: row.grammar,
  groundedAt: toIsoString(row.groundedAt),
  groundingPatch: row.groundingPatch,
  grammarUserEditedAt: toIsoString(row.grammarUserEditedAt),
  isProductionEnabled: row.isProductionEnabled,
})

const toChunkRowDto = (row: ChunkRow) => ({
  id: row.id,
  userId: row.userId,
  targetLanguage: row.targetLanguage,
  headword: row.headword,
  sense: row.sense,
  translation: row.translation,
  definition: row.definition,
  targetExample: row.targetExample,
  nativeExample: row.nativeExample,
  explorationExtras: row.explorationExtras,
  grammar: row.grammar,
  groundedAt: toIsoString(row.groundedAt),
  groundingPatch: row.groundingPatch,
  grammarUserEditedAt: toIsoString(row.grammarUserEditedAt),
  isProductionEnabled: row.isProductionEnabled,
  count: row.count,
  srsState: row.srsState,
  srsDue: toIsoString(row.srsDue),
  srsReps: row.srsReps,
  productionSrsState: row.productionSrsState,
  productionSrsDue: toIsoString(row.productionSrsDue),
  productionSrsReps: row.productionSrsReps,
  createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
  firstCardId: row.firstCardId,
  firstCardSegmentId: row.firstCardSegmentId,
  studySessionId: row.studySessionId,
  sourceAvailable: row.sourceAvailable,
})

// Opaque base64-of-JSON wire format for the listChunks cursor. Returning null
// from decode means "ignore the cursor and start from page 1" — the
// frontend should only ever feed us cursors we just emitted, so we treat a
// malformed cursor as "fall back to page 1" rather than 400ing.
// Exported for unit tests.
export const decodeCursor = (raw: string | null | undefined): ChunksCursor | null => {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8')
    const parsed = ChunksCursorSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const encodeCursor = (cursor: ChunksCursor | null): string | null => {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

// A grammarPatch with any key is a real user linguistic edit and stamps
// grammar_user_edited_at (pinning the bag against future LLM/grounding merges).
const hasGrammarPatch = (patch: Record<string, unknown> | null | undefined): boolean =>
  !!patch && Object.keys(patch).length > 0

export const ChunksRouter = (
  userLookupsRepository: UserLookupsRepositoryInterface,
  deps: {
    // Form-facet generate-and-confirm needs the user's language mode (native
    // language + translations-off) to fill a pending_data form facet's payload.
    usersRepository: UsersRepositoryInterface
    userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
    // Content edits clear the term's terminally-failed exercise slots so the
    // practice bank can regenerate against the corrected data.
    practiceExercisesRepository: PracticeExercisesRepositoryInterface
  }
): Router => {
  const implementer = implement(chunksContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  // Study-targets payload shared by getStudyTargets / generateFacetData /
  // setFacetPayload: every facet's identity + readiness, plus the encountered
  // forms the "+ Add a form" picker can still offer.
  const loadStudyTargets = async (chunkId: string) => {
    const [facets, candidateForms] = await Promise.all([
      userLookupsRepository.listFacetsForChunk(chunkId),
      userLookupsRepository.listCandidateFormsForChunk(chunkId),
    ])
    return { facets, candidateForms }
  }

  const router = implementer.router({
    get: implementer.get.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      // Representative-card pointer so "Edit term" surfaces can deep-link to
      // the focus view (`/sessions/$sessionId/review/$cardId`).
      const pointer = await userLookupsRepository.getFirstCardPointerForChunk({
        userLookupId: input.chunkId,
        userId,
      })
      // Re-read via the facet-joined getter so isProductionEnabled is the
      // DERIVED production-facet state (the plain term row no longer carries it).
      const row = await userLookupsRepository.getChunkRowForUser(input.chunkId, userId)
      if (!row) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      return {
        data: {
          chunk: toChunkRowAsChunkDto(row),
          firstCardId: pointer.cardId,
          firstCardSessionId: pointer.sessionId,
        },
      }
    }),

    updateContent: implementer.updateContent.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.updateContent({
        id: input.chunkId,
        translation: input.patch.translation,
        definition: input.patch.definition,
        targetExample: input.patch.targetExample,
        nativeExample: input.patch.nativeExample,
        explorationExtrasPatch: input.patch.explorationExtrasPatch ?? null,
        grammarPatch: input.patch.grammarPatch ?? null,
        markGrammarUserEdited: hasGrammarPatch(input.patch.grammarPatch),
      })
      // An edit to the fields exercise generation works from invalidates the
      // term's terminally-failed exercise slots — those verdicts were about
      // the old content. Clearing them lets the practice bank regenerate.
      if (
        input.patch.translation !== undefined ||
        input.patch.definition !== undefined ||
        input.patch.targetExample !== undefined
      ) {
        await deps.practiceExercisesRepository.deleteFailedForLookup(input.chunkId)
      }
      const refreshed = await userLookupsRepository.getChunkRowForUser(input.chunkId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after update' }] } })
      }
      // A grammar edit can remove the IPA a pronunciation facet depends on.
      await reconcilePronunciationFacet(
        userLookupsRepository,
        input.chunkId,
        refreshed.grammar,
        refreshed.targetLanguage
      )
      return { data: toChunkRowAsChunkDto(refreshed) }
    }),

    listChunks: implementer.listChunks.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const trimmedQ = input.q?.trim() ?? ''
      const { rows, nextCursor } = await userLookupsRepository.listChunksForLanguage({
        userId,
        targetLanguage: input.targetLanguage,
        sort: input.sort,
        cursor: decodeCursor(input.cursor),
        limit: input.limit,
        q: trimmedQ.length > 0 ? trimmedQ : null,
        skills: input.skills ?? null,
        status: input.status ?? null,
        hasMultipleForms: input.hasMultipleForms ?? null,
      })
      return { rows: rows.map(toChunkRowDto), nextCursor: encodeCursor(nextCursor) }
    }),

    setFacetEnabled: implementer.setFacetEnabled.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      // Normalize the facet key server-side (Trap 21) so the same form keyed
      // from any path collapses identically (''.normalized is still '').
      const targetForm = normalizeTargetForm(input.targetForm)
      let updated: Awaited<ReturnType<typeof userLookupsRepository.setFacetEnabled>>
      try {
        updated = await userLookupsRepository.setFacetEnabled({
          userLookupId: input.chunkId,
          userId,
          skill: input.skill,
          targetForm,
          enabled: input.enabled,
          payload: input.payload,
        })
      } catch (error) {
        // The floor guard rejects disabling a kept term's last enabled facet.
        if (error instanceof LastFacetFloorError) {
          throw errors.CONFLICT({ data: { errors: [{ message: error.message }] } })
        }
        throw error
      }
      if (!updated) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after update' }] } })
      }
      // Re-read via the facet-joined single-row getter so isProductionEnabled
      // reflects the post-update production-facet state (the plain term row no
      // longer carries it).
      const row = await userLookupsRepository.getChunkRowForUser(input.chunkId, userId)
      if (!row) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after update' }] } })
      }
      // Defend a pronunciation enable on a term with no displayable IPA: the
      // facet would render an empty back, so it is deleted right back out (the
      // frontend gates the chip on IPA presence, so this is the belt-and-braces).
      if (input.skill === 'pronunciation' && input.enabled) {
        await reconcilePronunciationFacet(userLookupsRepository, input.chunkId, row.grammar, row.targetLanguage)
      }
      return { data: toChunkRowAsChunkDto(row) }
    }),

    getStudyTargets: implementer.getStudyTargets.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // Ownership guard before the facet read (listFacetsForChunk keys on
      // user_lookup_id alone, mirroring the FK-cascade scope of study_facets).
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      return { data: await loadStudyTargets(input.chunkId) }
    }),

    generateFacetData: implementer.generateFacetData.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      const targetForm = normalizeTargetForm(input.targetForm)
      const outcome = await generateFormFacetData(
        { chunkId: input.chunkId, userId, skill: input.skill, targetForm },
        {
          userLookupsRepository,
          usersRepository: deps.usersRepository,
          userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
        }
      )
      // The facet stays pending_data on failure (the chip keeps offering retry /
      // manual entry); surface it as a 500 so the client toasts and doesn't
      // optimistically treat the form as ready.
      if (outcome === 'failed') {
        throw errors.INTERNAL_SERVER_ERROR({ data: { errors: [{ message: 'Form data generation failed' }] } })
      }
      return { data: await loadStudyTargets(input.chunkId) }
    }),

    setFacetPayload: implementer.setFacetPayload.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      const targetForm = normalizeTargetForm(input.targetForm)
      // Pass the full validated FormFacetPayload through — the repo merges it via
      // JSONB `||` (partial keys preserve untouched ones). The client is
      // responsible for sending `grammar` COMPLETE when present (the shallow
      // merge replaces the whole sub-object, it does not deep-merge it).
      await userLookupsRepository.setFacetPayload({
        userLookupId: input.chunkId,
        userId,
        skill: input.skill,
        targetForm,
        payload: input.payload as Record<string, unknown>,
      })
      return { data: await loadStudyTargets(input.chunkId) }
    }),

    deleteFacet: implementer.deleteFacet.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      // deleteFacet keys on user_lookup_id alone (FK-cascade scope); ownership is
      // enforced by the guard above. Normalize the key so it matches the stored
      // facet regardless of which surface the request came from (Trap 21).
      const targetForm = normalizeTargetForm(input.targetForm)
      await userLookupsRepository.deleteFacet({ userLookupId: input.chunkId, skill: input.skill, targetForm })
      return { data: await loadStudyTargets(input.chunkId) }
    }),

    listLanguages: implementer.listLanguages.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const languages = await userLookupsRepository.listLanguagesForUser(userId)
      return { languages }
    }),

    exportCsv: implementer.exportCsv.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const result = await buildVocabularyCsv(userId, input.targetLanguage, { userLookupsRepository })
      return { data: { csv: result.csv, chunkCount: result.chunkCount } }
    }),

    deleteChunk: implementer.deleteChunk.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.id, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.softDeleteChunk(input.id, userId)
      return { data: { id: input.id } }
    }),

    restoreChunk: implementer.restoreChunk.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // Restore targets soft-deleted rows by definition, so the deleted-filter
      // in findByIdForUser would 404 a valid restore. Use the including-
      // deleted variant for the ownership check.
      const owned = await userLookupsRepository.findByIdForUserIncludingDeleted(input.id, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      await userLookupsRepository.restoreChunk(input.id, userId)
      return { data: { id: input.id } }
    }),

    rename: implementer.rename.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const owned = await userLookupsRepository.findByIdForUser(input.chunkId, userId)
      if (!owned) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk not found' }] } })
      }
      const result = await userLookupsRepository.renameKey({
        id: input.chunkId,
        headword: input.headword,
        sense: input.sense,
        markGrammarUserEdited: true,
      })
      if (!result.ok) {
        throw errors.CONFLICT({
          data: { errors: [{ message: 'Another chunk already exists with that headword and sense' }] },
        })
      }
      // headword/sense are the core inputs of exercise generation — a rename
      // invalidates any terminally-failed slots so the bank can regenerate.
      await deps.practiceExercisesRepository.deleteFailedForLookup(input.chunkId)
      const refreshed = await userLookupsRepository.getChunkRowForUser(input.chunkId, userId)
      if (!refreshed) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chunk disappeared after rename' }] } })
      }
      return { data: toChunkRowAsChunkDto(refreshed) }
    }),
  })

  return createOrpcExpressRouter(router, { contract: chunksContract })
}
