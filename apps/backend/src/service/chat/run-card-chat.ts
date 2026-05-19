import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../../transport/third-party/anthropic/anthropic-client'
import { buildPromptContext } from '../processing/build-prompt-context'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'
import { CardsRepositoryInterface, DbCardWithChunk } from '../../transport/database/cards/cards-repository'
import {
  CardChatMessagesRepositoryInterface,
  DbCardChatMessage,
} from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { getEffectiveNativeLanguage } from '../user-prefs/effective-native-language'

export type RunCardChatDependencies = {
  cardsRepository: CardsRepositoryInterface
  cardChatMessagesRepository: CardChatMessagesRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
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

const UPDATE_TOOL_NAME = 'update_card_fields'

const updateCardFieldsTool: Anthropic.Tool = {
  name: UPDATE_TOOL_NAME,
  description:
    'Patch one or more fields on the card under discussion. Pass only the fields that should change — do not echo unchanged fields. To clear a basic text field, send an explicit empty string. `extras_patch` and `grammar_patch` are shallow-merged into their respective bags.',
  input_schema: {
    type: 'object',
    properties: {
      headword: { type: 'string' },
      sense: { type: 'string' },
      surface_form: { type: 'string' },
      translation: { type: 'string' },
      definition: { type: 'string' },
      target_example: { type: 'string' },
      native_example: { type: 'string' },
      extras_patch: {
        type: 'object',
        description:
          'Object of optional enrichment keys to merge into exploration_extras. Recognized keys: ipa, frequency, more_frequent_synonym, regionalism, register, register_alternatives, collocations, etymology, l1_notes, notes, context_segment.',
      },
      grammar_patch: {
        type: 'object',
        description:
          'Object of typed morphology / grammar keys to merge into the grammar bag. Recognized keys: pos, display_form, gender, number_only, is_indeclinable, animacy, aspect, aspect_pair_headword, is_reflexive, government, notable_forms, notes. See the per-target-language guidance in the system prompt for which keys to fill.',
      },
    },
  },
}

const renderCardForChat = (card: DbCardWithChunk, hideNativeFields: boolean): string => {
  const lines = [
    `- headword: ${card.chunk.headword}`,
    `- sense: ${card.chunk.sense || '(none)'}`,
    `- surface_form: ${card.surface_form}`,
    `- definition: ${card.chunk.definition ?? '(none)'}`,
    `- target_example: ${card.chunk.target_example ?? '(none)'}`,
  ]
  if (!hideNativeFields) {
    lines.push(`- translation: ${card.chunk.translation ?? '(none)'}`)
    lines.push(`- native_example: ${card.chunk.native_example ?? '(none)'}`)
  }
  const grammar = (card.chunk.grammar ?? {}) as Record<string, unknown>
  if (Object.keys(grammar).length > 0) {
    lines.push(`- grammar:\n${JSON.stringify(grammar, null, 2)}`)
  } else {
    lines.push('- grammar: (empty)')
  }
  const extras = { ...((card.chunk.exploration_extras ?? {}) as Record<string, unknown>) }
  if (hideNativeFields) {
    delete extras.l1_notes
  }
  if (Object.keys(extras).length > 0) {
    lines.push(`- exploration_extras:\n${JSON.stringify(extras, null, 2)}`)
  } else {
    lines.push('- exploration_extras: (empty — no full exploration generated yet)')
  }
  return lines.join('\n')
}

const buildSeedUserTurn = (
  card: DbCardWithChunk,
  surroundingSegmentsBlock: string,
  hideNativeFields: boolean
): string => {
  const editableFields = hideNativeFields
    ? 'definition, target-language example, grammar, etc.'
    : 'translation, example sentence, definition, etc.'

  return `Card under discussion:
${renderCardForChat(card, hideNativeFields)}

Surrounding segments:
${surroundingSegmentsBlock}

When the learner asks you to change something on the card (${editableFields}),
call the \`${UPDATE_TOOL_NAME}\` tool with only the fields that should change. Do not echo unchanged fields.
Confirm the change briefly in your reply.`
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

type CardFieldsToolInput = {
  headword?: unknown
  sense?: unknown
  surface_form?: unknown
  translation?: unknown
  definition?: unknown
  target_example?: unknown
  native_example?: unknown
  extras_patch?: unknown
  grammar_patch?: unknown
}

const FIELD_KEYS: Array<keyof CardFieldsToolInput> = [
  'headword',
  'sense',
  'surface_form',
  'translation',
  'definition',
  'target_example',
  'native_example',
]

type ParsedPatch = {
  patch: {
    headword: string | null
    sense: string | null
    surfaceForm: string | null
    translation: string | null
    definition: string | null
    targetExample: string | null
    nativeExample: string | null
    extrasPatch: Record<string, unknown> | null
    grammarPatch: Record<string, unknown> | null
  }
  changedFieldNames: string[]
}

const parseToolInput = (raw: unknown): ParsedPatch | null => {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as CardFieldsToolInput
  const changedFieldNames: string[] = []
  const stringField = (key: keyof CardFieldsToolInput): string | null => {
    const v = input[key]
    if (typeof v === 'string') {
      changedFieldNames.push(key)
      return v
    }
    return null
  }
  const headword = stringField('headword')
  const sense = stringField('sense')
  const surfaceForm = stringField('surface_form')
  const translation = stringField('translation')
  const definition = stringField('definition')
  const targetExample = stringField('target_example')
  const nativeExample = stringField('native_example')

  let extrasPatch: Record<string, unknown> | null = null
  if (input.extras_patch && typeof input.extras_patch === 'object' && !Array.isArray(input.extras_patch)) {
    extrasPatch = input.extras_patch as Record<string, unknown>
    if (Object.keys(extrasPatch).length > 0) changedFieldNames.push('extras')
    else extrasPatch = null
  }

  let grammarPatch: Record<string, unknown> | null = null
  if (input.grammar_patch && typeof input.grammar_patch === 'object' && !Array.isArray(input.grammar_patch)) {
    grammarPatch = input.grammar_patch as Record<string, unknown>
    if (Object.keys(grammarPatch).length > 0) changedFieldNames.push('grammar')
    else grammarPatch = null
  }

  if (changedFieldNames.length === 0) return null

  return {
    patch: {
      headword,
      sense,
      surfaceForm,
      translation,
      definition,
      targetExample,
      nativeExample,
      extrasPatch,
      grammarPatch,
    },
    changedFieldNames,
  }
}

export const runCardChat = async (
  input: RunCardChatInput,
  deps: RunCardChatDependencies
): Promise<RunCardChatResult> => {
  const card = await deps.cardsRepository.findByIdForUser(input.cardId, input.userId)
  if (!card) throw new Error('Card not found')

  const session = await deps.studySessionsRepository.findByIdForUser(card.study_session_id, input.userId)
  if (!session) throw new Error('Session not found')

  const languagePrefs = await getEffectiveNativeLanguage({
    userId: input.userId,
    targetLanguage: session.target_language,
    snapshotNativeLanguage: session.native_language,
    usersRepository: deps.usersRepository,
  })

  const promptContext = await buildPromptContext(
    {
      sessionId: card.study_session_id,
      userId: input.userId,
      nativeLanguageOverride: languagePrefs.nativeLanguage ?? undefined,
    },
    deps.studySessionsRepository
  )
  if (!promptContext) {
    throw new Error('Cannot chat: session has not been processed yet')
  }

  const surrounding = await selectSurroundingSegments(
    session.text_track_id,
    card.segment_id,
    deps.textSegmentsRepository
  )
  const surroundingFormatted = formatSurroundingSegments(surrounding, card.segment_id)

  const prior = await deps.cardChatMessagesRepository.listByCardId(input.cardId)
  const { older, recent } = splitTurns(prior)
  const summary = summarizeOlderTurns(older)

  const seedTurn = buildSeedUserTurn(card, surroundingFormatted, languagePrefs.hideNativeFields)
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
    model: MODEL_OPUS,
    max_tokens: 1500,
    system: promptContext.systemBlocks,
    tools: [updateCardFieldsTool],
    messages,
  })

  const assistantText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const toolUse = response.content.find((block) => block.type === 'tool_use')

  let updatedFieldNames: string[] = []
  if (toolUse && toolUse.type === 'tool_use' && toolUse.name === UPDATE_TOOL_NAME) {
    const parsed = parseToolInput(toolUse.input)
    if (parsed) {
      // surface_form lives on the card itself; everything else lives on the
      // canonical chunk (user_lookups). We split the patch across the two
      // repositories accordingly.
      if (parsed.patch.surfaceForm !== null) {
        await deps.cardsRepository.updateFields(input.cardId, { surfaceForm: parsed.patch.surfaceForm })
      }
      const contentTouched =
        parsed.patch.translation !== null ||
        parsed.patch.definition !== null ||
        parsed.patch.targetExample !== null ||
        parsed.patch.nativeExample !== null ||
        parsed.patch.extrasPatch !== null ||
        parsed.patch.grammarPatch !== null
      if (contentTouched) {
        await deps.userLookupsRepository.updateContent({
          id: card.user_lookup_id,
          translation: parsed.patch.translation,
          definition: parsed.patch.definition,
          targetExample: parsed.patch.targetExample,
          nativeExample: parsed.patch.nativeExample,
          explorationExtrasPatch: parsed.patch.extrasPatch,
          grammarPatch: parsed.patch.grammarPatch,
        })
      }
      if (parsed.patch.headword !== null || parsed.patch.sense !== null) {
        const result = await deps.userLookupsRepository.renameKey({
          id: card.user_lookup_id,
          headword: parsed.patch.headword ?? card.chunk.headword,
          sense: parsed.patch.sense ?? card.chunk.sense ?? '',
        })
        if (!result.ok) {
          // Drop the rename from the changed-field list silently — the chat
          // reply still lists what we did manage to apply. A future iteration
          // could surface a typed warning to the assistant.
          parsed.changedFieldNames = parsed.changedFieldNames.filter((n) => n !== 'headword' && n !== 'sense')
        }
      }
      updatedFieldNames = parsed.changedFieldNames
    }
  }

  const baseText = assistantText || (updatedFieldNames.length > 0 ? 'Done.' : '')
  if (!baseText) {
    throw new Error('Anthropic returned an empty response')
  }

  const finalAssistantBody =
    updatedFieldNames.length > 0 ? `${baseText}\n\n_Updated: ${updatedFieldNames.join(', ')}_` : baseText

  const userMessage = await deps.cardChatMessagesRepository.insertMessage({
    cardId: input.cardId,
    role: 'user',
    content: input.content,
  })

  const assistantMessage = await deps.cardChatMessagesRepository.insertMessage({
    cardId: input.cardId,
    role: 'assistant',
    content: finalAssistantBody,
  })

  return { userMessage, assistantMessage }
}

// Exported for tests.
export const __testing = { parseToolInput, FIELD_KEYS }
