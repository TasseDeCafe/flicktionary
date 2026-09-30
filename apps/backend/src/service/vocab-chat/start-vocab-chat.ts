import type { DbVocabChatMessage, VocabChatThread } from '../../transport/database/vocab-chat/vocab-chat-repository'
import { logCustomErrorMessageAndError } from '../../transport/error-monitoring/error-monitoring'
import {
  assertVocabChatMessageAllowed,
  findExistingHeadwords,
  normalizeHeadword,
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

export type VocabChatSeed = {
  userMessage: string
  items: Array<{ headword: string; note: string; example: string }>
}

// A thread is created together with its first message (and removed again if
// that first turn fails), so the Sessions list never fills up with empty
// chats. The provisional title is the opening request; runVocabChat renames
// the thread after the first exchange.
//
// A seed (a "Translate & add" search the learner escalated) is saved first as
// the thread's opening exchange, so the model answers with the search and its
// candidates in its history and can add them like any other proposal.
export const startVocabChat = async (
  params: { userId: string; targetLanguage: string; content: string; seed?: VocabChatSeed },
  deps: RunVocabChatDependencies
): Promise<{ thread: VocabChatThread; messages: DbVocabChatMessage[] }> => {
  const { userId, targetLanguage, content, seed } = params
  const nativeLanguage = await deps.usersRepository.getNativeLanguage(userId)
  if (!nativeLanguage) throw new StartVocabChatPrefsError('native_language_not_set')
  const prefs = await deps.userTargetLanguagePrefsRepository.findForLanguage(userId, targetLanguage)
  if (!prefs) throw new StartVocabChatPrefsError('cefr_not_set')

  // The seed is client-supplied text that ends up in the thread (and in
  // cards), so it goes through moderation with the message.
  const seedText = seed
    ? [seed.userMessage, ...seed.items.map((item) => `${item.headword} — ${item.note} — ${item.example}`)].join('\n')
    : null
  await assertVocabChatMessageAllowed(seedText ? `${seedText}\n\n${content}` : content, deps.anthropicPasses)

  const openingRequest = seed ? `${seed.userMessage}\n\n${content}` : content
  const provisionalTitle = (seed?.userMessage ?? content).replace(/\s+/g, ' ').trim().slice(0, PROVISIONAL_TITLE_CHARS)
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
    if (seed) await insertSeed(seed, thread, userId, deps)
    result = await runVocabChat({ thread, userId, content, titleFrom: openingRequest }, deps)
  } catch (e) {
    await deps.vocabChatRepository.deleteEmptyThread(thread).catch((cleanupError) => {
      logCustomErrorMessageAndError(`startVocabChat: cleanup failed for session=${thread.session.id}`, cleanupError)
    })
    throw e
  }
  const messages = await deps.vocabChatRepository.listMessages(thread.session.id)
  return { messages, thread: { ...thread, title: result.title ?? thread.title } }
}

const insertSeed = async (
  seed: VocabChatSeed,
  thread: VocabChatThread,
  userId: string,
  deps: RunVocabChatDependencies
): Promise<void> => {
  const items = seed.items
    .map((item) => ({
      headword: normalizeHeadword(item.headword),
      note: item.note.trim(),
      example: item.example.trim(),
    }))
    .filter((item) => item.headword.length > 0)
  if (items.length === 0) return
  // Candidates added from the search before escalating live in the ad-hoc
  // session, so they show here as already in the vocabulary.
  const existing = await findExistingHeadwords(
    items.map((item) => item.headword),
    thread,
    userId,
    deps
  )
  await deps.vocabChatRepository.insertMessage({
    sessionId: thread.session.id,
    role: 'user',
    content: seed.userMessage,
  })
  await deps.vocabChatRepository.insertMessage({
    sessionId: thread.session.id,
    role: 'assistant',
    content: '',
    proposal: {
      items: items.map((item) => ({
        ...item,
        inVocabulary: existing.has(item.headword.toLowerCase()),
        highlightId: null,
      })),
    },
  })
}
