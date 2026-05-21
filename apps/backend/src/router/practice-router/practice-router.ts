import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { practiceContract } from '@flicktionary/api-client/orpc-contracts/practice-contract'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type {
  PracticeSessionsRepositoryInterface,
  DbPracticeSession,
} from '../../transport/database/practice-sessions/practice-sessions-repository'
import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
} from '../../transport/database/practice-texts/practice-texts-repository'
import {
  startPracticeSession,
  type StartPracticeSessionDependencies,
} from '../../service/practice/start-practice-session'
import {
  generateNextPracticeText,
  prepareNextPracticeText,
  type GenerateNextPracticeTextDependencies,
} from '../../service/practice/generate-next-practice-text'
import { rateChunk, type RateChunkDependencies } from '../../service/practice/rate-chunk'
import {
  finalizePracticeText,
  type FinalizePracticeTextDependencies,
} from '../../service/practice/finalize-practice-text'
import { fastGlossPass } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'

export type PracticeRouterDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  practiceTextsRepository: PracticeTextsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
  startPracticeSessionDependencies: StartPracticeSessionDependencies
  generateNextPracticeTextDependencies: GenerateNextPracticeTextDependencies
  rateChunkDependencies: RateChunkDependencies
  finalizePracticeTextDependencies: FinalizePracticeTextDependencies
}

const toPracticeSessionDto = (row: DbPracticeSession) => ({
  id: row.id,
  userId: row.user_id,
  targetLanguage: row.target_language,
  status: row.status,
  pool: (row.pool as 'passive' | 'active') ?? 'passive',
  startedAt: new Date(row.started_at).toISOString(),
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
})

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
    practiceSessionId: row.practice_session_id,
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

  const router = implementer.router({
    dueSummary: implementer.dueSummary.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const summary = await deps.userLookupsRepository.listDueSummary(userId)
      return { data: { perLanguage: summary } }
    }),

    startSession: implementer.startSession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await startPracticeSession(
        userId,
        input.targetLanguage,
        input.mode,
        deps.startPracticeSessionDependencies
      )
      if (!result.ok) {
        throw errors.BAD_REQUEST({
          data: {
            errors: [
              {
                message:
                  result.reason === 'no_kept_cards'
                    ? 'No kept cards in this language yet.'
                    : result.reason === 'no_practice_terms'
                      ? 'No terms match your current practice limits.'
                      : 'Set your native language in settings before starting practice.',
              },
            ],
          },
        })
      }
      return { data: { sessionId: result.sessionId, resumed: result.resumed } }
    }),

    abandonSession: implementer.abandonSession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await deps.practiceSessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Practice session not found' }] },
        })
      }
      const abandoned = await deps.practiceSessionsRepository.markAbandoned(input.sessionId, userId)
      return { data: { abandoned } }
    }),

    getSession: implementer.getSession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const session = await deps.practiceSessionsRepository.findByIdForUser(input.sessionId, userId)
      if (!session) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Practice session not found' }] },
        })
      }
      const currentText = await deps.practiceTextsRepository.selectAndMarkReading(session.id)
      const contentByKey = currentText
        ? await fetchAnnotationContent(currentText, userId, session.target_language, deps.userLookupsRepository)
        : new Map<string, ChunkContent>()
      const progress = await deps.practiceSessionsRepository.getSessionProgress(session.id)
      return {
        data: {
          session: toPracticeSessionDto(session),
          currentText: currentText ? toPracticeTextDto(currentText, contentByKey) : null,
          progress,
        },
      }
    }),

    generateNextText: implementer.generateNextText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await generateNextPracticeText(input.sessionId, userId, deps.generateNextPracticeTextDependencies)
      if (!result.ok) {
        if (result.reason === 'session_not_found') {
          throw errors.NOT_FOUND({
            data: { errors: [{ message: 'Practice session not found' }] },
          })
        }
        if (result.reason === 'session_completed' || result.reason === 'no_native_language') {
          throw errors.BAD_REQUEST({
            data: {
              errors: [
                {
                  message:
                    result.reason === 'session_completed'
                      ? 'Practice session is no longer active.'
                      : 'Native language pref missing.',
                },
              ],
            },
          })
        }
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: result.warning ?? 'Practice text generation failed' }] },
        })
      }
      const progress = await deps.practiceSessionsRepository.getSessionProgress(input.sessionId)
      if ('done' in result && result.done) {
        return { data: { done: true as const, progress } }
      }
      if ('practiceText' in result && 'targetLanguage' in result) {
        const contentByKey = await fetchAnnotationContent(
          result.practiceText,
          userId,
          result.targetLanguage,
          deps.userLookupsRepository
        )
        return {
          data: {
            done: false as const,
            practiceText: toPracticeTextDto(result.practiceText, contentByKey),
            progress,
          },
        }
      }
      // Should be unreachable given the foreground path always resolves to
      // done or practiceText, but TypeScript needs the exit.
      throw errors.INTERNAL_SERVER_ERROR({
        data: { errors: [{ message: 'unexpected generateNextText result shape' }] },
      })
    }),

    prepareNextText: implementer.prepareNextText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await prepareNextPracticeText(input.sessionId, userId, deps.generateNextPracticeTextDependencies)
      if (!result.ok) {
        if (result.reason === 'session_not_found') {
          throw errors.NOT_FOUND({ data: { errors: [{ message: 'Practice session not found' }] } })
        }
        throw errors.BAD_REQUEST({
          data: {
            errors: [
              {
                message:
                  result.reason === 'session_completed'
                    ? 'Practice session is no longer active.'
                    : 'Native language pref missing.',
              },
            ],
          },
        })
      }
      if ('noWork' in result) {
        return { data: { status: 'no_work' as const } }
      }
      if ('alreadyReady' in result) {
        return { data: { status: 'already_ready' as const, practiceTextId: result.practiceText.id } }
      }
      if ('alreadyGenerating' in result) {
        return { data: { status: 'already_generating' as const, practiceTextId: result.practiceText.id } }
      }
      return { data: { status: 'queued' as const, practiceTextId: result.practiceText.id } }
    }),

    rateChunk: implementer.rateChunk.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await rateChunk(
        input.textId,
        userId,
        input.headword,
        input.sense,
        input.rating,
        true,
        deps.rateChunkDependencies
      )
      if (!result.ok) {
        if (result.reason === 'text_not_found' || result.reason === 'lookup_not_found') {
          throw errors.NOT_FOUND({
            data: { errors: [{ message: result.reason }] },
          })
        }
        if (result.reason === 'text_already_finalized') {
          throw errors.BAD_REQUEST({
            data: { errors: [{ message: 'Practice text is already finalized; rating refused.' }] },
          })
        }
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Chunk is not part of this practice text.' }] },
        })
      }
      // Find the session for the just-rated text so we can compute progress.
      const found = await deps.practiceTextsRepository.findByIdForUser(input.textId, userId)
      const sessionId = found?.practiceSessionId
      const progress = sessionId
        ? await deps.practiceSessionsRepository.getSessionProgress(sessionId)
        : { completed: 0, target: 0 }
      return { data: { accepted: true as const, progress } }
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

    finalizeText: implementer.finalizeText.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const result = await finalizePracticeText(input.textId, userId, deps.finalizePracticeTextDependencies)
      if (!result.ok) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'Practice text not found' }] },
        })
      }
      const found = await deps.practiceTextsRepository.findByIdForUser(input.textId, userId)
      const sessionId = found?.practiceSessionId
      const progress = sessionId
        ? await deps.practiceSessionsRepository.getSessionProgress(sessionId)
        : { completed: 0, target: 0 }
      return { data: { implicitGoodCount: result.implicitGoodCount, progress } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: practiceContract })
}
