import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '../../transport/third-party/anthropic/anthropic-client'
import { buildPromptContext } from '../processing/build-prompt-context'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'
import { CardsRepositoryInterface, DbCard } from '../../transport/database/cards/cards-repository'
import {
  CardChatMessagesRepositoryInterface,
  DbCardChatMessage,
} from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'

export type RunCardChatDependencies = {
  cardsRepository: CardsRepositoryInterface
  cardChatMessagesRepository: CardChatMessagesRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
}

export type RunCardChatInput = {
  cardId: string
  userId: string
  content: string
}

export type RunCardChatResult = {
  userMessage: DbCardChatMessage
  assistantMessage: DbCardChatMessage
}

const VERBATIM_TURNS = 4

const renderFullExploration = (card: DbCard): string => {
  const exploration = (card.full_exploration ?? {}) as Record<string, unknown>
  if (Object.keys(exploration).length === 0)
    return '(no prior exploration — this card was suggested but not deeply explored)'
  return JSON.stringify(exploration, null, 2)
}

const buildSeedUserTurn = (card: DbCard, surroundingSegmentsBlock: string): string => {
  return `Card under discussion:
- headword: ${card.headword}
- surface_form: ${card.surface_form}

Surrounding segments:
${surroundingSegmentsBlock}

Already-shown structured exploration:
${renderFullExploration(card)}`
}

const summarizeOlderTurns = (older: DbCardChatMessage[]): string => {
  if (older.length === 0) return ''
  const lines = older.map(
    (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.replace(/\s+/g, ' ').slice(0, 240)}`
  )
  return `Earlier turns (summarized):\n${lines.join('\n')}`
}

const splitTurns = (prior: DbCardChatMessage[]): { older: DbCardChatMessage[]; recent: DbCardChatMessage[] } => {
  if (prior.length <= VERBATIM_TURNS) return { older: [], recent: prior }
  const split = prior.length - VERBATIM_TURNS
  return { older: prior.slice(0, split), recent: prior.slice(split) }
}

export const runCardChat = async (
  input: RunCardChatInput,
  deps: RunCardChatDependencies
): Promise<RunCardChatResult> => {
  const card = await deps.cardsRepository.findByIdForUser(input.cardId, input.userId)
  if (!card) throw new Error('Card not found')

  const promptContext = await buildPromptContext(
    { sessionId: card.study_session_id, userId: input.userId },
    deps.studySessionsRepository,
    deps.l1InterferenceNotesRepository
  )
  if (!promptContext) {
    throw new Error('Cannot chat: session has not been processed yet')
  }

  const session = await deps.studySessionsRepository.findByIdForUser(card.study_session_id, input.userId)
  if (!session) throw new Error('Session not found')

  const surrounding = await selectSurroundingSegments(
    session.text_track_id,
    card.segment_id,
    deps.textSegmentsRepository
  )
  const surroundingFormatted = formatSurroundingSegments(surrounding, card.segment_id)

  const prior = await deps.cardChatMessagesRepository.listByCardId(input.cardId)
  const { older, recent } = splitTurns(prior)
  const summary = summarizeOlderTurns(older)

  const seedTurn = buildSeedUserTurn(card, surroundingFormatted)
  const seedWithSummary = summary ? `${seedTurn}\n\n${summary}` : seedTurn

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: seedWithSummary },
    ...recent.map(
      (m): Anthropic.MessageParam => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })
    ),
    { role: 'user', content: input.content },
  ]

  const response = await getAnthropicClient().messages.create({
    model: MODEL_SONNET,
    max_tokens: 1500,
    system: promptContext.systemBlocks,
    messages,
  })

  const assistantText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  if (!assistantText) {
    throw new Error('Anthropic returned an empty response')
  }

  const userMessage = await deps.cardChatMessagesRepository.insertMessage({
    cardId: input.cardId,
    role: 'user',
    content: input.content,
  })
  if (!userMessage) throw new Error('Failed to persist user message')

  const assistantMessage = await deps.cardChatMessagesRepository.insertMessage({
    cardId: input.cardId,
    role: 'assistant',
    content: assistantText,
  })
  if (!assistantMessage) throw new Error('Failed to persist assistant message')

  return { userMessage, assistantMessage }
}
