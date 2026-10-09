import { Router } from 'express'
import { implement } from '@orpc/server'
import NodeCache from 'node-cache'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { vocabChatContract, type VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { getConfig } from '../../config/environment-config'
import type { DbVocabChatMessage } from '../../transport/database/vocab-chat/vocab-chat-repository'
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
import { matchCaptureCandidates } from '../../service/vocab-chat/match-capture-candidates'
import { toIsoString } from '../router-utils'
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

const toMessageDto = (row: DbVocabChatMessage): VocabChatMessage => {
  const proposal = parseProposal(row.proposal)
  const suggestion = row.new_thread_suggestion as { language: string; message: string } | null
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    proposal: proposal
      ? {
          items: proposal.items.map((item) => ({
            headword: item.headword,
            note: item.note,
            example: item.example,
            inVocabulary: item.inVocabulary,
            added: item.highlightId !== null,
          })),
        }
      : null,
    newThreadSuggestion: suggestion ? { language: suggestion.language, message: suggestion.message } : null,
    createdAt: toIsoString(row.created_at)!,
  }
}

export const VocabChatRouter = (deps: RunVocabChatDependencies): Router => {
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
        {
          userId,
          targetLanguage: input.targetLanguage,
          query: input.text,
          inputLanguage: input.inputLanguage,
          candidates: input.candidates,
        },
        deps
      )
      return { data: { matches } }
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
            messages: result.messages.map(toMessageDto),
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
          messages: messages.map(toMessageDto),
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
            userMessage: toMessageDto(result.userMessage),
            assistantMessage: toMessageDto(result.assistantMessage),
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
        return { data: { message: toMessageDto(result.message) } }
      } catch (e) {
        return rethrowChatError(e, errors)
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: vocabChatContract })
}
