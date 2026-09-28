import type { VocabChatThread } from '../../transport/database/vocab-chat/vocab-chat-repository'
import { logCustomErrorMessageAndError } from '../../transport/error-monitoring/error-monitoring'
import {
  assertVocabChatMessageAllowed,
  runVocabChat,
  type RunVocabChatDependencies,
  type RunVocabChatResult,
} from './run-vocab-chat'

export type StartVocabChatError = 'native_language_not_set' | 'cefr_not_set'

export class StartVocabChatPrefsError extends Error {
  constructor(public readonly code: StartVocabChatError) {
    super(code)
    this.name = 'StartVocabChatPrefsError'
  }
}

const PROVISIONAL_TITLE_CHARS = 60

// A thread is created together with its first message (and removed again if
// that first turn fails), so the Sessions list
// never fills up with empty chats. The provisional title is the first message;
// runVocabChat renames the thread after the first exchange.
export const startVocabChat = async (
  params: { userId: string; targetLanguage: string; content: string },
  deps: RunVocabChatDependencies
): Promise<RunVocabChatResult & { thread: VocabChatThread }> => {
  const { userId, targetLanguage, content } = params
  const nativeLanguage = await deps.usersRepository.getNativeLanguage(userId)
  if (!nativeLanguage) throw new StartVocabChatPrefsError('native_language_not_set')
  const prefs = await deps.userTargetLanguagePrefsRepository.findForLanguage(userId, targetLanguage)
  if (!prefs) throw new StartVocabChatPrefsError('cefr_not_set')

  await assertVocabChatMessageAllowed(content, deps.anthropicPasses)

  const provisionalTitle = content.replace(/\s+/g, ' ').trim().slice(0, PROVISIONAL_TITLE_CHARS)
  const thread = await deps.vocabChatRepository.createThread({
    userId,
    targetLanguage,
    nativeLanguage,
    cefrLevel: prefs.cefr_level,
    title: provisionalTitle,
  })

  void deps.usersRepository.setLastTargetLanguage(userId, targetLanguage).catch((e) => {
    logCustomErrorMessageAndError(`startVocabChat: setLastTargetLanguage failed for userId=${userId}`, e)
  })

  let result: RunVocabChatResult
  try {
    result = await runVocabChat({ thread, userId, content }, deps)
  } catch (e) {
    await deps.vocabChatRepository.deleteEmptyThread(thread).catch((cleanupError) => {
      logCustomErrorMessageAndError(`startVocabChat: cleanup failed for session=${thread.session.id}`, cleanupError)
    })
    throw e
  }
  return { ...result, thread: { ...thread, title: result.title ?? thread.title } }
}
