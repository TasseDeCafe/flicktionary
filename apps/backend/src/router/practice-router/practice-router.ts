import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { practiceContract } from '@flicktionary/api-client/orpc-contracts/practice-contract'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import {
  mergeFacet,
  type DbUserLookup,
  type DbUserLookupWithFacet,
  type UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  skillForPool,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
} from '../../transport/database/practice-texts/practice-texts-repository'
import type { PracticeExercisesRepositoryInterface } from '../../transport/database/practice-exercises/practice-exercises-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { beginTx } from '../../transport/database/postgres-client'
import { listReviewTerms } from '../../service/practice/list-review-terms'
import { rateTerm, type WithTransaction } from '../../service/practice/rate-term'
import { undoRating } from '../../service/practice/undo-rating'
import {
  ensureExerciseBank,
  getStrengthenExercises,
  warmExerciseBank,
  type ExerciseBankDependencies,
} from '../../service/practice/exercise-bank'
import { gradeMcAnswer, gradeProductionClozeAnswer } from '../../service/practice/grade-exercise'
import { applyGateAnswer } from '../../service/practice/rehab'
import { gradeUseInSentencePass } from '../../transport/third-party/anthropic/passes/grade-use-in-sentence-pass'
import { generateReadingText, prepareNextReadingText } from '../../service/practice/generate-reading-text'
import { advanceReadingText, type AdvanceReadingTextDependencies } from '../../service/practice/advance-reading-text'
import { fastGlossPass } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'

export type PracticeRouterDependencies = {
  practiceTextsRepository: PracticeTextsRepositoryInterface
  practiceExercisesRepository: PracticeExercisesRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}

type RawAnnotation = {
  headword?: unknown
  sense?: unknown
  surface_form?: unknown
  char_start?: unknown
  char_end?: unknown
}

type ChunkContent = {
  userLookupId: string
  cardId: string | null
  // Source session of the representative card. Needed so the practice text's
  // "Edit term" action can deep-link to `/sessions/$sessionId/review/$cardId`.
  cardSessionId: string | null
  translation: string | null
  definition: string | null
  grammar: Record<string, unknown> | null
  deletedAt: Date | null
  isProductionEnabled: boolean
}

const lookupKey = (headword: string, sense: string) => `${headword} ${sense}`

const toPracticeTextDto = (row: DbPracticeText, contentByKey: Map<string, ChunkContent>) => {
  const annRaw = Array.isArray(row.annotations) ? (row.annotations as RawAnnotation[]) : []
  const annotations = annRaw.map((a) => {
    const headword = typeof a.headword === 'string' ? a.headword : ''
    const sense = typeof a.sense === 'string' ? a.sense : ''
    const content = contentByKey.get(lookupKey(headword, sense))
    return {
      headword,
      sense,
      surfaceForm: typeof a.surface_form === 'string' ? a.surface_form : '',
      charStart: typeof a.char_start === 'number' ? a.char_start : 0,
      charEnd: typeof a.char_end === 'number' ? a.char_end : 0,
      translation: content?.translation ?? null,
      definition: content?.definition ?? null,
      grammar: content?.grammar ?? null,
      userLookupId: content?.userLookupId ?? null,
      cardId: content?.cardId ?? null,
      cardSessionId: content?.cardSessionId ?? null,
      deletedAt: content?.deletedAt ? new Date(content.deletedAt).toISOString() : null,
      isProductionEnabled: content?.isProductionEnabled ?? null,
    }
  })
  return {
    id: row.id,
    pool: (row.pool as 'passive' | 'active') ?? 'passive',
    ord: row.ord,
    status: row.status,
    body: row.body,
    annotations,
    generationWarning: row.generation_warning,
    createdAt: new Date(row.created_at).toISOString(),
    readyAt: row.ready_at ? new Date(row.ready_at).toISOString() : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  }
}

// Maps a user_lookups row to the review-term DTO. grammar JSONB is passed
// through like toPracticeTextDto does; the contract's GrammarSchema validates it.
const toReviewTermDto = (row: DbUserLookupWithFacet) => ({
  userLookupId: row.id,
  headword: row.headword,
  sense: row.sense ?? '',
  translation: row.translation,
  definition: row.definition,
  targetExample: row.target_example,
  nativeExample: row.native_example,
  grammar: (row.grammar as Record<string, unknown> | null) ?? null,
  srsState: row.srs_state,
  targetLanguage: row.target_language,
  // Facet identity carried back to rate/undo (the queue item knows its card).
  skill: row.skill,
  targetForm: row.target_form,
  facetPayload: (row.payload as Record<string, unknown> | null) ?? null,
})

// Builds the (headword, sense) -> content map for the row's annotations by
// hitting user_lookups once per practice text. Returns an empty map when the
// row has no annotations (or the body hasn't been generated yet).
const fetchAnnotationContent = async (
  row: DbPracticeText,
  userId: string,
  targetLanguage: string,
  userLookupsRepository: UserLookupsRepositoryInterface
): Promise<Map<string, ChunkContent>> => {
  const annRaw = Array.isArray(row.annotations) ? (row.annotations as RawAnnotation[]) : []
  const keys = annRaw
    .map((a) => ({
      headword: typeof a.headword === 'string' ? a.headword : '',
      sense: typeof a.sense === 'string' ? a.sense : '',
    }))
    .filter((k) => k.headword.length > 0)
  if (keys.length === 0) return new Map()
  const rows = await userLookupsRepository.listChunkContentForKeys({ userId, targetLanguage, keys })
  const map = new Map<string, ChunkContent>()
  for (const r of rows) {
    map.set(lookupKey(r.headword, r.sense), {
      userLookupId: r.id,
      cardId: r.firstCardId,
      cardSessionId: r.firstCardSessionId,
      translation: r.translation,
      definition: r.definition,
      grammar: r.grammar,
      deletedAt: r.deletedAt,
      isProductionEnabled: r.isProductionEnabled,
    })
  }
  return map
}

export const PracticeRouter = (deps: PracticeRouterDependencies): Router => {
  const implementer = implement(practiceContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const exerciseBankDeps: ExerciseBankDependencies = {
    practiceExercisesRepository: deps.practiceExercisesRepository,
    userLookupsRepository: deps.userLookupsRepository,
    usersRepository: deps.usersRepository,
    userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    studyFacetsRepository: deps.studyFacetsRepository,
  }
  // Fire-and-forget warmer threaded into the shared rating path: again/hard
  // ratings (flashcards AND reading mode) pre-generate Strengthen exercises.
  const warmBank = (params: { lookup: DbUserLookup; pool: 'passive' | 'active' }) =>
    warmExerciseBank({ ...params, deps: exerciseBankDeps })

  // FSRS write + rating-event insert commit atomically (see applyTermRating).
  // The cast strips postgres.js's UnwrapPromiseArray from beginTx's return —
  // our callbacks always resolve a single value, never a query array.
  const withTransaction: WithTransaction = (fn) => beginTx(fn) as ReturnType<typeof fn>

  const readingDeps: AdvanceReadingTextDependencies = {
    practiceTextsRepository: deps.practiceTextsRepository,
    userLookupsRepository: deps.userLookupsRepository,
    studyFacetsRepository: deps.studyFacetsRepository,
    usersRepository: deps.usersRepository,
    userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
    withTransaction,
    warmExerciseBank: warmBank,
  }
  const capsDeps = {
    userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    userLookupsRepository: deps.userLookupsRepository,
    practiceTextsRepository: deps.practiceTextsRepository,
    practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
  }

  // Shape a practice_text into its DTO, joining live annotation content.
  const shapeText = async (text: DbPracticeText, userId: string, targetLanguage: string) => {
    const contentByKey = await fetchAnnotationContent(text, userId, targetLanguage, deps.userLookupsRepository)
    return toPracticeTextDto(text, contentByKey)
  }

  const router = implementer.router({
    dueSummary: implementer.dueSummary.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      // reviewedTodayCount comes off the rating-event log (passive review
      // budget only — the active pool has no review budget) in one grouped
      // query, merged per language.
      const [summary, reviewedTodayByLanguage] = await Promise.all([
        deps.userLookupsRepository.listDueSummary(userId),
        deps.practiceRatingEventsRepository.countReviewBudgetConsumedTodayByLanguage({ userId, mode: 'recognition' }),
      ])
      const perLanguage = summary.map((entry) => ({
        ...entry,
        reviewedTodayCount: reviewedTodayByLanguage.get(entry.targetLanguage) ?? 0,
      }))
      return { data: { perLanguage } }
    }),

    listReviewTerms: implementer.listReviewTerms.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const rows = await listReviewTerms(userId, input.targetLanguage, input.pool, input.scope, capsDeps, {
        requestedNewCount: input.newBatchSize,
      })
      return { data: { terms: rows.map((row) => toReviewTermDto(row)) } }
    }),

    rateTerm: implementer.rateTerm.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await rateTerm(
        input.userLookupId,
        userId,
        input.rating,
        input.pool,
        input.skill,
        input.targetForm,
        {
          userLookupsRepository: deps.userLookupsRepository,
          studyFacetsRepository: deps.studyFacetsRepository,
          practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
          userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
          withTransaction,
          warmExerciseBank: warmBank,
        },
        { bypassDailyCap: input.learnNewSession === true }
      )
      if (!result.ok) {
        if (result.reason === 'not_in_active_pool') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Term is not in the active pool.' }] } })
        }
        if (result.reason === 'illegal_pool_skill') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Illegal (pool, skill) pairing.' }] } })
        }
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'lookup_not_found' }] } })
      }
      return {
        data: {
          accepted: true as const,
          introducedNew: result.introducedNew,
          dailyCapReached: result.dailyCapReached,
          parked: result.parked,
          eventId: result.eventId,
        },
      }
    }),

    undoRating: implementer.undoRating.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await undoRating(
        input.userLookupId,
        userId,
        input.pool,
        input.skill,
        input.targetForm,
        input.eventId,
        {
          userLookupsRepository: deps.userLookupsRepository,
          studyFacetsRepository: deps.studyFacetsRepository,
          practiceRatingEventsRepository: deps.practiceRatingEventsRepository,
          withTransaction,
        }
      )
      if (!result.ok) {
        if (result.reason === 'illegal_pool_skill') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Illegal (pool, skill) pairing.' }] } })
        }
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'lookup_not_found' }] } })
      }
      return { data: { undone: result.undone } }
    }),

    generateNextReadingText: implementer.generateNextReadingText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await generateReadingText(userId, input.targetLanguage, input.pool, input.scope, readingDeps)
      if (!result.ok) {
        if (result.reason === 'no_native_language') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language pref missing.' }] } })
        }
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: result.warning ?? 'Practice text generation failed' }] },
        })
      }
      if (result.done) return { data: { done: true as const } }
      return {
        data: {
          done: false as const,
          practiceText: await shapeText(result.practiceText, userId, input.targetLanguage),
        },
      }
    }),

    prepareNextReadingText: implementer.prepareNextReadingText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await prepareNextReadingText(
        userId,
        input.targetLanguage,
        input.pool,
        input.scope,
        input.excludeUserLookupIds,
        readingDeps
      )
      if (!result.ok) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language pref missing.' }] } })
      }
      if (result.status === 'no_work') return { data: { status: 'no_work' as const } }
      return { data: { status: result.status, practiceTextId: result.practiceTextId } }
    }),

    advanceReadingText: implementer.advanceReadingText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await advanceReadingText(userId, input.textId, input.pool, input.scope, input.ratings, readingDeps)
      if (!result.ok) {
        if (result.reason === 'text_not_found') {
          throw errors.NOT_FOUND({ data: { errors: [{ message: 'Practice text not found' }] } })
        }
        if (result.reason === 'no_native_language') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language pref missing.' }] } })
        }
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: result.warning ?? 'Practice text generation failed' }] },
        })
      }
      if (result.done) return { data: { done: true as const, introduced: result.introduced } }
      const found = await deps.practiceTextsRepository.findByIdForUser(result.practiceText.id, userId)
      const targetLanguage = found?.targetLanguage ?? result.practiceText.target_language
      return {
        data: {
          done: false as const,
          nextText: await shapeText(result.practiceText, userId, targetLanguage),
          introduced: result.introduced,
        },
      }
    }),

    readingHistory: implementer.readingHistory.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const rows = await deps.practiceTextsRepository.listHistory({
        userId,
        targetLanguage: input.targetLanguage,
        pool: input.pool,
      })
      const texts = await Promise.all(rows.map((row) => shapeText(row, userId, input.targetLanguage)))
      return { data: { texts } }
    }),

    readingTextById: implementer.readingTextById.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const found = await deps.practiceTextsRepository.findByIdForUser(input.textId, userId)
      if (!found) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Practice text not found' }] } })
      }
      return { data: { practiceText: await shapeText(found.practiceText, userId, found.targetLanguage) } }
    }),

    startStrengthenSession: implementer.startStrengthenSession.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const exercises = await getStrengthenExercises({
        userId,
        targetLanguage: input.targetLanguage,
        pool: input.pool,
        sessionHardUserLookupIds: input.sessionHardUserLookupIds,
        deps: exerciseBankDeps,
      })
      return {
        data: {
          exercises: exercises.map((entry) => ({
            ...entry,
            // The service strips payloads to the wire shape; the contract's
            // discriminated union validates the result.
            payload: entry.payload as never,
          })),
        },
      }
    }),

    submitExerciseAnswer: implementer.submitExerciseAnswer.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const exercise = await deps.practiceExercisesRepository.findByIdForUser(input.exerciseId, userId)
      if (!exercise) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Exercise not found' }] } })
      }
      if (exercise.status !== 'ready' || exercise.payload == null) {
        // Already used/failed — stale answer (e.g. a second submit racing the
        // first, or an answer for a consumed exercise after refresh).
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Exercise is no longer answerable' }] } })
      }
      const isMc = exercise.exercise_type === 'mc_cloze' || exercise.exercise_type === 'mc_comprehension'
      const hasSelectedIndex = 'selectedIndex' in input.response
      if (isMc !== hasSelectedIndex) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: `Response shape does not match exercise type ${exercise.exercise_type}` }] },
        })
      }

      // Consume-on-answer. Losing this update means another submit won.
      const consumed = await deps.practiceExercisesRepository.consumeExercise(exercise.id)
      if (!consumed) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Exercise is no longer answerable' }] } })
      }

      const payload = exercise.payload as Record<string, unknown>
      let correct = false
      let feedback: string | null = null
      let correctIndex: number | null = null
      let correctAnswer: string | null = null

      if (isMc && hasSelectedIndex && 'selectedIndex' in input.response) {
        correctIndex = payload.answerIndex as number
        correct = gradeMcAnswer({ answerIndex: correctIndex }, input.response.selectedIndex)
      } else if (exercise.exercise_type === 'production_cloze' && 'text' in input.response) {
        correctAnswer = payload.answer as string
        correct = gradeProductionClozeAnswer(
          { answer: correctAnswer, acceptedForms: (payload.acceptedForms as string[] | undefined) ?? [] },
          input.response.text
        )
      } else if ('text' in input.response) {
        // use_in_sentence — LLM-graded, NEVER gates. Grading failure degrades
        // to attempt-only (counts as correct, no feedback) rather than blocking.
        const lookup = await deps.userLookupsRepository.findByIdForUser(exercise.user_lookup_id, userId)
        try {
          const languagePrefs = await getLanguageMode({
            userId,
            targetLanguage: exercise.target_language,
            usersRepository: deps.usersRepository,
            targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
          })
          if (!lookup || !languagePrefs.nativeLanguage) throw new Error('grading context unavailable')
          const grade = await gradeUseInSentencePass({
            headword: lookup.headword,
            sense: lookup.sense ?? '',
            userSentence: input.response.text,
            targetLanguage: exercise.target_language,
            nativeLanguage: languagePrefs.nativeLanguage,
            cefrLevel: 'B1',
            hideTranslationFields: languagePrefs.hideTranslationFields,
            allowL1Notes: languagePrefs.allowL1Notes,
          })
          correct = grade.correct
          feedback = grade.feedback || null
        } catch (e) {
          console.warn('use-in-sentence grading failed, degrading to attempt-only', { exerciseId: exercise.id, e })
          correct = true
          feedback = null
        }
      }

      const exercisePool = exercise.pool as 'passive' | 'active'
      const termLookup = await deps.userLookupsRepository.findByIdForUser(exercise.user_lookup_id, userId)

      // Rehab: a gate exercise answered for a term parked in this pool drives
      // the graduation ladder (one distinct-day credit per correct answer;
      // soft re-entry at the threshold). Non-parked terms (bonus track) and
      // ungated exercises are untouched.
      let rehabCorrectDays: number | null = null
      let graduated = false
      if (consumed.gate_eligible && termLookup) {
        // Load the facet for this pool's citation skill; rehab only runs when
        // it exists and is parked (applyGateAnswer guards on parked).
        const facet = await deps.studyFacetsRepository.getFacet({
          userLookupId: termLookup.id,
          skill: skillForPool(exercisePool),
          targetForm: CITATION_FORM,
        })
        if (facet) {
          const facetRow: DbUserLookupWithFacet = mergeFacet(termLookup, facet)
          const outcome = await applyGateAnswer({
            lookup: facetRow,
            pool: exercisePool,
            correct,
            deps: { studyFacetsRepository: deps.studyFacetsRepository },
          })
          rehabCorrectDays = outcome.rehabCorrectDays
          graduated = outcome.graduated
        }
      }

      // Replenish the consumed slot in the background so the next attempt for
      // this term has a fresh exercise waiting. Skip on graduation — the term
      // is back in normal rotation and the remaining bank stays for a
      // potential future re-park.
      if (termLookup && !graduated) {
        void ensureExerciseBank({
          lookup: termLookup,
          pool: exercisePool,
          deps: exerciseBankDeps,
        }).catch((err) => console.error('exercise bank refill threw', { userLookupId: exercise.user_lookup_id, err }))
      }

      return {
        data: {
          correct,
          feedback,
          gated: consumed.gate_eligible,
          correctIndex,
          correctAnswer,
          rehabCorrectDays,
          graduated,
        },
      }
    }),

    fastGloss: implementer.fastGloss.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const found = await deps.practiceTextsRepository.findByIdForUser(input.practiceTextId, userId)
      if (!found) {
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'Practice text not found' }] } })
      }
      const body = found.practiceText.body
      if (!body || body.length === 0) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Practice text has no body yet' }] } })
      }
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage: found.targetLanguage,
        usersRepository: deps.usersRepository,
        targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
      })
      if (!languagePrefs.nativeLanguage) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language not set' }] } })
      }
      const gloss = await fastGlossPass({
        targetLanguage: found.targetLanguage,
        nativeLanguage: languagePrefs.nativeLanguage,
        hideTranslationFields: languagePrefs.hideTranslationFields,
        contextLine: body,
        selectionText: input.selectionText,
      })
      const ipa = await lookupFastGlossIpa({
        targetLanguage: found.targetLanguage,
        selectionText: input.selectionText,
        pos: gloss.pos,
        wiktionaryEntriesRepository: deps.wiktionaryEntriesRepository,
      })
      return { data: { ...gloss, ipa } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: practiceContract })
}
