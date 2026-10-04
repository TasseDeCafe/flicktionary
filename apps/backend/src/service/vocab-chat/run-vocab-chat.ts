import type Anthropic from '@anthropic-ai/sdk'
import { getLanguageName, isSupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { AUTO_CACHE, MODEL_OPUS, reasoningParams } from '../../transport/third-party/anthropic/anthropic-client'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logAnthropicCacheUsage } from '../../transport/third-party/anthropic/log-cache-usage'
import { buildPracticeMethodologySystem } from '../../transport/third-party/anthropic/methodology-prompt'
import type { HardBlockCategory } from '../../transport/third-party/anthropic/passes/moderation-pass'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type {
  DbVocabChatMessage,
  VocabChatNewThreadSuggestion,
  VocabChatProposalItem,
  VocabChatThread,
} from '../../transport/database/vocab-chat/vocab-chat-repository'
import { logCustomErrorMessageAndError } from '../../transport/error-monitoring/error-monitoring'
import { moderateIngestText } from '../moderation/moderate-ingest-text'
import { getIpaDialectForTargetLanguage } from '../user-prefs/ipa-dialect'
import { getLanguageMode } from '../user-prefs/language-mode'
import { addProposedItems, parseProposal, type AddProposedItemsDependencies } from './add-proposed-items'

export type RunVocabChatDependencies = AddProposedItemsDependencies & {
  anthropicPasses: AnthropicPassesInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
}

export type RunVocabChatResult = {
  userMessage: DbVocabChatMessage
  assistantMessage: DbVocabChatMessage
  // Set when this turn (re)named the thread.
  title: string | null
}

export class VocabChatBlockedError extends Error {
  constructor(public readonly category: HardBlockCategory) {
    super('Message blocked by moderation')
    this.name = 'VocabChatBlockedError'
  }
}

// Messages sent verbatim; older ones are folded into a compact summary. Turns
// are stored as user/assistant pairs, so an even count keeps the verbatim
// window starting on a user message.
const VERBATIM_MESSAGES = 12
// Tool rounds per turn before the model is forced to answer in prose.
const MAX_TOOL_ROUNDS = 4
const MAX_PROPOSAL_ITEMS = 15

const PROPOSE_TOOL = 'propose_cards'
const SEARCH_TOOL = 'search_vocabulary'
const ADD_TOOL = 'add_proposed_cards'
const NEW_THREAD_TOOL = 'suggest_new_thread'

const TOOLS: Anthropic.Tool[] = [
  {
    name: PROPOSE_TOOL,
    description:
      'Show the learner a checklist of terms they can add as flashcards with one tap. Writes nothing by itself. Returns the proposal_id and which items are already in their vocabulary.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              headword: {
                type: 'string',
                description: 'The term in dictionary citation form, following the language conventions.',
              },
              note: {
                type: 'string',
                description: 'One short line: the meaning plus anything that distinguishes it.',
              },
              example: { type: 'string', description: 'One short, natural example sentence using the term.' },
            },
            required: ['headword', 'note', 'example'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: SEARCH_TOOL,
    description: "Check which headwords are already in the learner's vocabulary (exact citation-form match).",
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { headwords: { type: 'array', items: { type: 'string' } } },
      required: ['headwords'],
    },
  },
  {
    name: ADD_TOOL,
    description:
      'Add items of an earlier propose_cards checklist as flashcards, when the learner explicitly asks for it. Only items that were proposed can be added.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        proposal_id: { type: 'string', description: 'The proposal_id returned by propose_cards.' },
        item_indexes: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Zero-based indexes of the items to add.',
        },
      },
      required: ['proposal_id', 'item_indexes'],
    },
  },
  {
    name: NEW_THREAD_TOOL,
    description:
      'Offer the learner a button to continue in a new chat for another target language, carrying over their message.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        language: { type: 'string', description: 'ISO 639-1 code of the other target language.' },
        message: { type: 'string', description: "The learner's request, to carry over to the new chat." },
      },
      required: ['language', 'message'],
    },
  },
]

const buildChatInstructions = (target: string, replyLanguage: string): string =>
  `Vocabulary chat.

You are chatting with the learner inside their vocabulary app. The learner studies ${target} with flashcards; your job is to answer their questions about ${target} and help them pick the terms worth turning into cards.

- Reply in ${replyLanguage}, except for the ${target} itself. Keep answers short and skimmable.
- When the learner asks how to say something, give the natural ${target} way to say it, with the nuance that matters (register, aspect, collocation, L1 traps).
- Whenever your answer contains ${target} terms worth studying, call ${PROPOSE_TOOL} with them instead of listing them in prose. Prefer 3-8 high-value items over long lists. Headwords follow the citation-form conventions above.
- The ${PROPOSE_TOOL} result says which items the learner already has. You may call ${SEARCH_TOOL} first to avoid proposing those.
- When the learner asks to add proposed terms ("add them", "add the first three"), call ${ADD_TOOL} with the proposal_id and the item indexes. You can only add proposed items: to add a new term, propose it first, then add it.
- This chat is only for ${target}. If the learner asks for vocabulary in another target language, call ${NEW_THREAD_TOOL} and do not propose cards in that language. Questions about ${target} written in another language, and comparisons with other languages, belong here.
- You cannot edit or delete existing cards. If asked, tell the learner to open the card and use its own chat.
- The checklist is shown to the learner right below your message: after a tool call, reply briefly and do not repeat the items.`

const renderProposalForModel = (message: DbVocabChatMessage): string => {
  const proposal = parseProposal(message.proposal)
  if (!proposal || proposal.items.length === 0) return ''
  const lines = proposal.items.map((item, index) => {
    const state = item.highlightId ? ' (added)' : item.inVocabulary ? ' (already in vocabulary)' : ''
    return `${index}. ${item.headword} — ${item.note}${state}`
  })
  return `\n\n[Proposed cards, proposal_id=${message.id}]\n${lines.join('\n')}`
}

const renderMessageForModel = (message: DbVocabChatMessage): string => {
  if (message.role === 'user') return message.content
  const suggestion = message.new_thread_suggestion as VocabChatNewThreadSuggestion | null
  const suggestionNote = suggestion ? `\n\n[Offered to continue in a new ${suggestion.language} chat]` : ''
  return `${message.content}${renderProposalForModel(message)}${suggestionNote}`
}

const summarizeOlderMessages = (older: DbVocabChatMessage[]): string => {
  if (older.length === 0) return ''
  const lines = older.map((m) => {
    const who = m.role === 'user' ? 'Learner' : 'Assistant'
    const proposal = parseProposal(m.proposal)
    const proposalNote = proposal
      ? ` [proposal_id=${m.id}: ${proposal.items.map((item, i) => `${i}. ${item.headword}${item.highlightId ? ' (added)' : ''}`).join(', ')}]`
      : ''
    return `${who}: ${m.content.replace(/\s+/g, ' ').slice(0, 240)}${proposalNote}`
  })
  return `Earlier in this chat (summarized):\n${lines.join('\n')}`
}

export const buildHistoryMessages = (prior: DbVocabChatMessage[], content: string): Anthropic.MessageParam[] => {
  const split = Math.max(0, prior.length - VERBATIM_MESSAGES)
  const summary = summarizeOlderMessages(prior.slice(0, split))
  const history: Anthropic.MessageParam[] = prior.slice(split).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: renderMessageForModel(m),
  }))
  history.push({ role: 'user', content })
  if (summary) {
    const first = history[0]!
    history[0] = { role: 'user', content: `${summary}\n\n---\n\n${first.content as string}` }
  }
  return history
}

// Stress marks are display-only: stored headwords never carry them.
export const normalizeHeadword = (headword: string): string =>
  headword.normalize('NFD').replace(/[̀́]/g, '').normalize('NFC').trim()

const extractText = (content: Anthropic.ContentBlock[]): string =>
  content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

type TurnState = {
  assistantMessageId: string
  proposalItems: VocabChatProposalItem[]
  selfAddIndexes: Set<number>
  newThreadSuggestion: VocabChatNewThreadSuggestion | null
}

export const findExistingHeadwords = async (
  headwords: string[],
  thread: VocabChatThread,
  userId: string,
  deps: RunVocabChatDependencies
): Promise<Map<string, string[]>> => {
  const normalized = headwords.map(normalizeHeadword).filter(Boolean)
  const matches = await deps.userLookupsRepository.listByHeadwords({
    userId,
    targetLanguage: thread.session.target_language,
    headwords: normalized,
  })
  const senses = new Map<string, string[]>()
  for (const [key, rows] of matches) senses.set(key, rows.map((r) => r.sense).filter(Boolean))
  return senses
}

type ToolOutcome = { content: string; isError?: boolean }

const runTool = async (
  toolUse: Anthropic.ToolUseBlock,
  state: TurnState,
  thread: VocabChatThread,
  userId: string,
  deps: RunVocabChatDependencies
): Promise<ToolOutcome> => {
  const input = (toolUse.input ?? {}) as Record<string, unknown>

  if (toolUse.name === PROPOSE_TOOL) {
    const rawItems = Array.isArray(input.items) ? input.items : []
    const items = rawItems
      .map((raw) => {
        const item = (raw ?? {}) as Record<string, unknown>
        const headword = typeof item.headword === 'string' ? normalizeHeadword(item.headword) : ''
        return {
          headword,
          note: typeof item.note === 'string' ? item.note.trim() : '',
          example: typeof item.example === 'string' ? item.example.trim() : '',
        }
      })
      .filter((item) => item.headword.length > 0)
    const room = MAX_PROPOSAL_ITEMS - state.proposalItems.length
    if (items.length === 0 || room <= 0) {
      return { content: 'Nothing was shown: no valid items, or the checklist is full.', isError: true }
    }
    const existing = await findExistingHeadwords(
      items.map((i) => i.headword),
      thread,
      userId,
      deps
    )
    const start = state.proposalItems.length
    for (const item of items.slice(0, room)) {
      state.proposalItems.push({
        ...item,
        inVocabulary: existing.has(item.headword.toLowerCase()),
        highlightId: null,
      })
    }
    const lines = state.proposalItems
      .slice(start)
      .map((item, i) => `${start + i}. ${item.headword}${item.inVocabulary ? ' (already in vocabulary)' : ''}`)
    return {
      content: `Shown to the learner as a checklist. proposal_id=${state.assistantMessageId}\n${lines.join('\n')}`,
    }
  }

  if (toolUse.name === SEARCH_TOOL) {
    const headwords = (Array.isArray(input.headwords) ? input.headwords : []).filter(
      (h): h is string => typeof h === 'string'
    )
    if (headwords.length === 0) return { content: 'No headwords given.', isError: true }
    const existing = await findExistingHeadwords(headwords, thread, userId, deps)
    const lines = headwords.map((h) => {
      const senses = existing.get(normalizeHeadword(h).toLowerCase())
      if (!senses) return `${h}: not in vocabulary`
      return senses.length > 0 ? `${h}: in vocabulary (senses: ${senses.join('; ')})` : `${h}: in vocabulary`
    })
    return { content: lines.join('\n') }
  }

  if (toolUse.name === ADD_TOOL) {
    const proposalId = typeof input.proposal_id === 'string' ? input.proposal_id.trim() : ''
    const indexes = (Array.isArray(input.item_indexes) ? input.item_indexes : []).filter(
      (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0
    )
    if (indexes.length === 0) return { content: 'No item indexes given.', isError: true }

    // Items proposed earlier in this same turn are added once the message is
    // saved (the proposal has no row yet).
    if (proposalId === state.assistantMessageId) {
      const valid = indexes.filter((i) => i < state.proposalItems.length)
      if (valid.length === 0) return { content: 'Those indexes are not in the proposal.', isError: true }
      for (const i of valid) state.selfAddIndexes.add(i)
      return { content: `Added: ${valid.map((i) => state.proposalItems[i]!.headword).join(', ')}.` }
    }

    try {
      const result = await addProposedItems({ thread, userId, messageId: proposalId, itemIndexes: indexes }, deps)
      const parts: string[] = []
      if (result.addedHeadwords.length > 0) parts.push(`Added: ${result.addedHeadwords.join(', ')}.`)
      if (result.alreadyAddedHeadwords.length > 0) {
        parts.push(`Already added before: ${result.alreadyAddedHeadwords.join(', ')}.`)
      }
      return { content: parts.join(' ') || 'Those indexes are not in the proposal.' }
    } catch {
      return { content: 'Unknown proposal_id.', isError: true }
    }
  }

  if (toolUse.name === NEW_THREAD_TOOL) {
    const language = typeof input.language === 'string' ? input.language.trim().toLowerCase() : ''
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (!isSupportedLanguageCode(language) || language === thread.session.target_language || !message) {
      return { content: 'Not offered: unsupported language, or the same language as this chat.', isError: true }
    }
    state.newThreadSuggestion = { language, message }
    return {
      content: `The learner now sees a button to continue in a new ${getLanguageName(language)} chat. Do not propose cards in that language here.`,
    }
  }

  return { content: `Unknown tool ${toolUse.name}.`, isError: true }
}

// Moderation runs before any thread is created or any Opus call is made. The
// callers run it (not runVocabChat) so a blocked first message never creates a
// thread.
export const assertVocabChatMessageAllowed = async (
  content: string,
  anthropicPasses: AnthropicPassesInterface
): Promise<void> => {
  const moderation = await moderateIngestText(content, anthropicPasses, { surface: 'vocab-chat' })
  if (!moderation.allowed) throw new VocabChatBlockedError(moderation.category)
}

export const runVocabChat = async (
  input: {
    thread: VocabChatThread
    userId: string
    content: string
    // The thread's opening request, set on its first turn so the exchange
    // names the thread.
    titleFrom?: string
  },
  deps: RunVocabChatDependencies
): Promise<RunVocabChatResult> => {
  const { thread, userId, content, titleFrom } = input
  const session = thread.session

  const languageMode = await getLanguageMode({
    userId,
    targetLanguage: session.target_language,
    snapshotNativeLanguage: session.native_language,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  })
  const nativeLanguage = languageMode.nativeLanguage ?? session.native_language
  const ipaDialect = await getIpaDialectForTargetLanguage(deps.usersRepository, userId, session.target_language)
  const target = getLanguageName(session.target_language)
  const replyLanguage = getLanguageName(languageMode.hideTranslationFields ? session.target_language : nativeLanguage)

  const system = buildPracticeMethodologySystem({
    nativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    hideTranslationFields: languageMode.hideTranslationFields,
    allowL1Notes: languageMode.allowL1Notes,
    ipaDialect,
    extraStableBlocks: [buildChatInstructions(target, replyLanguage)],
  })

  const prior = await deps.vocabChatRepository.listMessages(session.id)
  const messages = buildHistoryMessages(prior, content)

  const state: TurnState = {
    assistantMessageId: crypto.randomUUID(),
    proposalItems: [],
    selfAddIndexes: new Set(),
    newThreadSuggestion: null,
  }

  const request = {
    model: MODEL_OPUS,
    ...reasoningParams(MODEL_OPUS, 'low'),
    max_tokens: 8000,
    system,
    tools: TOOLS,
  }

  // Tool loop: Opus 5.5 folds pre-tool prose into thinking, so the visible
  // reply usually comes from the round after the tool results. The last round
  // forbids tools so the turn always ends in prose. Every other round caches
  // the conversation so the next round (and the next turn, while the verbatim
  // window isn't sliding) reads it back; the last round's tool_choice change
  // invalidates the messages cache, so a write there would never be read.
  const texts: string[] = []
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS
    const response = await deps.anthropicPasses.createChatCompletion({
      ...request,
      ...(lastRound ? { tool_choice: { type: 'none' as const } } : { cache_control: AUTO_CACHE }),
      messages,
    })
    logAnthropicCacheUsage('vocab-chat', response)
    const text = extractText(response.content)
    if (text) texts.push(text)

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) break

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const outcome = await runTool(toolUse, state, thread, userId, deps)
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results })
  }

  const reply = texts.join('\n\n')
  if (!reply && state.proposalItems.length === 0 && !state.newThreadSuggestion) {
    throw new Error('Anthropic returned an empty response')
  }

  const userMessage = await deps.vocabChatRepository.insertMessage({
    sessionId: session.id,
    role: 'user',
    content,
  })
  let assistantMessage = await deps.vocabChatRepository.insertMessage({
    id: state.assistantMessageId,
    sessionId: session.id,
    role: 'assistant',
    content: reply,
    proposal: state.proposalItems.length > 0 ? { items: state.proposalItems } : null,
    newThreadSuggestion: state.newThreadSuggestion,
  })
  if (state.selfAddIndexes.size > 0) {
    const added = await addProposedItems(
      { thread, userId, messageId: assistantMessage.id, itemIndexes: [...state.selfAddIndexes] },
      deps
    )
    assistantMessage = added.message
  }

  // The first exchange names the thread; a failure keeps the provisional
  // title (the first message).
  let title: string | null = null
  if (titleFrom) {
    try {
      title = await deps.anthropicPasses.vocabChatTitlePass({
        firstUserMessage: titleFrom,
        firstAssistantReply: reply,
        titleLanguage: replyLanguage,
      })
      if (title) await deps.vocabChatRepository.setTitle(thread.contentSourceId, title)
    } catch (e) {
      logCustomErrorMessageAndError(`runVocabChat: title generation failed for session=${session.id}`, e)
    }
  }

  return { userMessage, assistantMessage, title }
}
