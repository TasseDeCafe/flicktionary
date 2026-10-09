import { Router } from 'express'
import { implement } from '@orpc/server'
import NodeCache from 'node-cache'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { vocabChatContract, type VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { getConfig } from '../../config/environment-config'
import type { DbVocabChatMessage, ProposalAdd } from '../../transport/database/vocab-chat/vocab-chat-repository'
import { blockedContentMessage } from '../../service/moderation/moderate-ingest-text'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import { addProposedItems, parseProposal, ProposalNotFoundError } from '../../service/vocab-chat/add-proposed-items'
import {
  assertVocabChatMessageAllowed,
  runVocabChat,
  VocabChatBlockedError,
  type RunVocabChatDependencies,
} from '../../service/vocab-chat/run-vocab-chat'
import { startVocabChat, StartVocabChatPrefsError } from '../../service/vocab-chat/start-vocab-chat'
import { translateForCapture } from '../../service/vocab-chat/translate-for-capture'
import { matchCaptureCandidates, type SenseMatchCache } from '../../service/vocab-chat/match-capture-candidates'
import { toIsoString } from '../router-utils'
import type { CaptureDemandRepositoryInterface } from '../../transport/database/capture-demand/capture-demand-repository'
import { incrementFixedWindowCount } from '../fixed-window-counter'

// Per-user fixed windows (see incrementFixedWindowCount). Generous for real
// use — a class session is a few dozen lookups — but they cap a runaway
// client or a scripted abuse of the Opus chat.
const chatTurnsByUser = new NodeCache({ stdTTL: 60 * 60 })
const MAX_CHAT_TURNS_PER_HOUR = 60
const translationsByUser = new NodeCache({ stdTTL: 60 * 60 })
const MAX_TRANSLATIONS_PER_HOUR = 300
// Asked again on every visit to a search and after each add, so it allows
// more than translate.
const captureMatchesByUser = new NodeCache({ stdTTL: 60 * 60 })
const MAX_CAPTURE_MATCHES_PER_HOUR = 600
// senseMatchPass answers for captureMatches (keyed by every input, so a
// vocabulary change misses): reopening a thread with many proposals or a
// search doesn't re-ask Haiku.
const senseMatchAnswers = new NodeCache({ stdTTL: 24 * 60 * 60, maxKeys: 50_000 })
const senseMatchCache: SenseMatchCache = {
  get: (key) => senseMatchAnswers.get<string | null>(key),
  set: (key, matchedId) => void senseMatchAnswers.set(key, matchedId),
}

const toMessageDto = (row: DbVocabChatMessage, adds: Map<string, ProposalAdd>): VocabChatMessage => {
  const proposal = parseProposal(row.proposal)
  const suggestion = row.new_thread_suggestion as { language: string; message: string } | null
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    proposal: proposal
      ? {
          items: proposal.items.map((item) => {
            const add = item.highlightId ? adds.get(item.highlightId) : undefined
            return {
              headword: item.headword,
              note: item.note,
              example: item.example,
              highlightId: item.highlightId,
              addState: add?.state ?? null,
              addedCard: add?.card ?? null,
            }
          }),
        }
      : null,
    newThreadSuggestion: suggestion ? { language: suggestion.language, message: suggestion.message } : null,
    createdAt: toIsoString(row.created_at)!,
  }
}

export const VocabChatRouter = (
  deps: RunVocabChatDependencies & { captureDemandRepository: CaptureDemandRepositoryInterface }
): Router => {
  const implementer = implement(vocabChatContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  type Errors = Parameters<Parameters<typeof implementer.translate.handler>[0]>[0]['errors']

  // Both lanes are LLM proxies an anonymous visitor could farm, so they
  // require an account.
  const assertSignedIn = (context: OrpcContext, errors: Errors) => {
    if (context.res.locals.isAnonymous) {
      throw errors.FORBIDDEN({
        data: { errors: [{ code: 'GUEST_NOT_ALLOWED', message: 'Create an account to use translation and chat' }] },
      })
    }
  }

  const assertWithinLimit = (cache: NodeCache, max: number, userId: string, errors: Errors) => {
    if (!getConfig().shouldRateLimit) return
    if ((cache.get<number>(userId) ?? 0) >= max) {
      throw errors.TOO_MANY_REQUESTS({ data: { errors: [{ message: 'Too many requests — try again later' }] } })
    }
    incrementFixedWindowCount(cache, userId)
  }

  // Message DTOs with each added proposal item resolved to where it stands.
  const toMessageDtos = async (rows: DbVocabChatMessage[], userId: string): Promise<VocabChatMessage[]> => {
    const highlightIds = rows.flatMap(
      (row) => parseProposal(row.proposal)?.items.flatMap((item) => (item.highlightId ? [item.highlightId] : [])) ?? []
    )
    const adds = await deps.vocabChatRepository.resolveProposalAdds({ userId, highlightIds })
    return rows.map((row) => toMessageDto(row, adds))
  }

  // Maps the chat services' domain errors to contract errors.
  const rethrowChatError = (e: unknown, errors: Errors): never => {
    if (e instanceof VocabChatBlockedError) {
      throw errors.UNPROCESSABLE_ENTITY({
        data: { errors: [{ code: 'CONTENT_BLOCKED', message: blockedContentMessage(e.category) }] },
      })
    }
    if (e instanceof StartVocabChatPrefsError) {
      throw errors.BAD_REQUEST({ data: { errors: [{ code: e.code, message: e.message }] } })
    }
    if (e instanceof ProposalNotFoundError) {
      throw errors.NOT_FOUND({ data: { errors: [{ message: e.message }] } })
    }
    throw e
  }

  const router = implementer.router({
    translate: implementer.translate.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const userId = context.res.locals.userId
      assertWithinLimit(translationsByUser, MAX_TRANSLATIONS_PER_HOUR, userId, errors)

      const languageMode = await getLanguageMode({
        userId,
        targetLanguage: input.targetLanguage,
        usersRepository: deps.usersRepository,
        targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
      })
      if (!languageMode.nativeLanguage) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ code: 'native_language_not_set', message: 'Native language not set' }] },
        })
      }
      const result = await translateForCapture(
        {
          text: input.text,
          context: input.context,
          targetLanguage: input.targetLanguage,
          nativeLanguage: languageMode.nativeLanguage,
          hideTranslationFields: languageMode.hideTranslationFields,
        },
        deps
      )
      return { data: { inputLanguage: result.inputLanguage, candidates: result.candidates } }
    }),

    captureMatches: implementer.captureMatches.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const userId = context.res.locals.userId
      assertWithinLimit(captureMatchesByUser, MAX_CAPTURE_MATCHES_PER_HOUR, userId, errors)
      const matches = await matchCaptureCandidates(
        { userId, targetLanguage: input.targetLanguage, context: input.context, candidates: input.candidates },
        { ...deps, senseMatchCache }
      )
      return { data: { matches } }
    }),

    recordCaptureDemand: implementer.recordCaptureDemand.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const outcome = await deps.captureDemandRepository.recordCaptureDemand({
        userId: context.res.locals.userId,
        userLookupId: input.userLookupId,
        source: input.source,
      })
      return { data: { outcome } }
    }),

    undoCaptureDemand: implementer.undoCaptureDemand.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const reverted = await deps.captureDemandRepository.undoCaptureDemand({
        userId: context.res.locals.userId,
        userLookupId: input.userLookupId,
      })
      return { data: { reverted } }
    }),

    start: implementer.start.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const userId = context.res.locals.userId
      assertWithinLimit(chatTurnsByUser, MAX_CHAT_TURNS_PER_HOUR, userId, errors)
      try {
        const result = await startVocabChat(
          { userId, targetLanguage: input.targetLanguage, content: input.content, seed: input.seed },
          deps
        )
        return {
          data: {
            sessionId: result.thread.session.id,
            title: result.thread.title,
            messages: await toMessageDtos(result.messages, userId),
          },
        }
      } catch (e) {
        return rethrowChatError(e, errors)
      }
    }),

    getThread: implementer.getThread.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const thread = await deps.vocabChatRepository.findThreadForUser(input.sessionId, context.res.locals.userId)
      if (!thread) throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chat not found' }] } })
      const messages = await deps.vocabChatRepository.listMessages(thread.session.id)
      return {
        data: {
          sessionId: thread.session.id,
          title: thread.title,
          targetLanguage: thread.session.target_language,
          messages: await toMessageDtos(messages, context.res.locals.userId),
        },
      }
    }),

    sendMessage: implementer.sendMessage.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const userId = context.res.locals.userId
      const thread = await deps.vocabChatRepository.findThreadForUser(input.sessionId, userId)
      if (!thread) throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chat not found' }] } })
      assertWithinLimit(chatTurnsByUser, MAX_CHAT_TURNS_PER_HOUR, userId, errors)
      try {
        await assertVocabChatMessageAllowed(input.content, deps.anthropicPasses)
        const result = await runVocabChat({ thread, userId, content: input.content }, deps)
        return {
          data: {
            ...(await toMessageDtos([result.userMessage, result.assistantMessage], userId).then(
              ([userMessage, assistantMessage]) => ({ userMessage: userMessage!, assistantMessage: assistantMessage! })
            )),
            title: result.title,
          },
        }
      } catch (e) {
        return rethrowChatError(e, errors)
      }
    }),

    addProposedItems: implementer.addProposedItems.handler(async ({ input, context, errors }) => {
      assertSignedIn(context, errors)
      const userId = context.res.locals.userId
      const thread = await deps.vocabChatRepository.findThreadForUser(input.sessionId, userId)
      if (!thread) throw errors.NOT_FOUND({ data: { errors: [{ message: 'Chat not found' }] } })
      try {
        const result = await addProposedItems(
          { thread, userId, messageId: input.messageId, itemIndexes: input.itemIndexes },
          deps
        )
        const [message] = await toMessageDtos([result.message], userId)
        return { data: { message: message! } }
      } catch (e) {
        return rethrowChatError(e, errors)
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: vocabChatContract })
}
