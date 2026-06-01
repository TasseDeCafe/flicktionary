import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { practiceContract } from '@flicktionary/api-client/orpc-contracts/practice-contract'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import type {
  DbUserLookup,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
} from '../../transport/database/practice-texts/practice-texts-repository'
import { listReviewTerms } from '../../service/practice/list-review-terms'
import { rateTerm } from '../../service/practice/rate-term'
import { clampPracticeSessionLimits } from '../../service/practice/review-caps'
import {
  generateReadingText,
  prepareNextReadingText,
  type GenerateReadingTextDependencies,
} from '../../service/practice/generate-reading-text'
import { advanceReadingText } from '../../service/practice/advance-reading-text'
import { fastGlossPass } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'

export type PracticeRouterDependencies = {
  practiceTextsRepository: PracticeTextsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
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
  learningMode: 'passive' | 'active'
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
      learningMode: content?.learningMode ?? null,
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
const toReviewTermDto = (row: DbUserLookup, pool: 'passive' | 'active') => ({
  userLookupId: row.id,
  headword: row.headword,
  sense: row.sense ?? '',
  translation: row.translation,
  definition: row.definition,
  targetExample: row.target_example,
  nativeExample: row.native_example,
  grammar: (row.grammar as Record<string, unknown> | null) ?? null,
  srsState: pool === 'active' ? row.active_srs_state : row.srs_state,
  targetLanguage: row.target_language,
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
      learningMode: r.learningMode,
    })
  }
  return map
}

export const PracticeRouter = (deps: PracticeRouterDependencies): Router => {
  const implementer = implement(practiceContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const readingDeps: GenerateReadingTextDependencies = {
    practiceTextsRepository: deps.practiceTextsRepository,
    userLookupsRepository: deps.userLookupsRepository,
    usersRepository: deps.usersRepository,
    userTargetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  }
  const capsDeps = {
    usersRepository: deps.usersRepository,
    userLookupsRepository: deps.userLookupsRepository,
    practiceTextsRepository: deps.practiceTextsRepository,
  }

  // Shape a practice_text into its DTO, joining live annotation content.
  const shapeText = async (text: DbPracticeText, userId: string, targetLanguage: string) => {
    const contentByKey = await fetchAnnotationContent(text, userId, targetLanguage, deps.userLookupsRepository)
    return toPracticeTextDto(text, contentByKey)
  }

  const router = implementer.router({
    dueSummary: implementer.dueSummary.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const summary = await deps.userLookupsRepository.listDueSummary(userId)
      return { data: { perLanguage: summary } }
    }),

    listReviewTerms: implementer.listReviewTerms.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const rows = await listReviewTerms(userId, input.targetLanguage, input.pool, input.scope, capsDeps)
      return { data: { terms: rows.map((row) => toReviewTermDto(row, input.pool)) } }
    }),

    rateTerm: implementer.rateTerm.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // Pass the FULL clamped daily cap: the atomic guard does its own
      // today-count comparison against it (subtracting here would double-count).
      const limits = clampPracticeSessionLimits(await deps.usersRepository.getPracticeSessionLimits(userId))
      const result = await rateTerm(input.userLookupId, userId, input.rating, input.pool, limits.maxNewTerms, {
        userLookupsRepository: deps.userLookupsRepository,
      })
      if (!result.ok) {
        if (result.reason === 'not_in_active_pool') {
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Term is not in the active pool.' }] } })
        }
        throw errors.NOT_FOUND({ data: { errors: [{ message: 'lookup_not_found' }] } })
      }
      return {
        data: { accepted: true as const, introducedNew: result.introducedNew, dailyCapReached: result.dailyCapReached },
      }
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
