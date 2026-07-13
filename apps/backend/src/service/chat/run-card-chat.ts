import type Anthropic from '@anthropic-ai/sdk'
import { MODEL_OPUS } from '../../transport/third-party/anthropic/anthropic-client'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logAnthropicCacheUsage } from '../../transport/third-party/anthropic/log-cache-usage'
import { buildPromptContext } from '../processing/build-prompt-context'
import { ensureSessionContextBlob } from '../processing/ensure-session-context-blob'
import { selectSurroundingSegments, formatSurroundingSegments } from '../processing/select-surrounding-segments'
import { CardsRepositoryInterface, DbCardWithChunk } from '../../transport/database/cards/cards-repository'
import { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import {
  CardChatMessagesRepositoryInterface,
  DbCardChatMessage,
} from '../../transport/database/card-chat-messages/card-chat-messages-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { getLanguageMode, type LanguageMode } from '../user-prefs/language-mode'
import { autoKeepNeedsDataIfEligible } from '../cards/set-card-status'
import { sanitizeExplorationExtrasForLanguageMode } from '../user-prefs/language-output-guards'
import { isEnglishTargetLanguage } from '../../transport/third-party/anthropic/language-instructions'

export type RunCardChatDependencies = {
  anthropicPasses: AnthropicPassesInterface
  cardsRepository: CardsRepositoryInterface
  cardChatMessagesRepository: CardChatMessagesRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  // Lets chat lazily mint the session context blob on first use. A note-only
  // session never ran an enrich job, so its blob is absent — without this the
  // seeded turn and any manual chat would throw "session not processed yet".
  contentSourcesRepository: ContentSourcesRepositoryInterface
}

export type RunCardChatInput = {
  cardId: string
  userId: string
  content: string
  // When false, the Opus call is made without the update_card_fields tool, so a
  // turn cannot rewrite card fields. Interactive chat leaves this true; the
  // auto-seeded highlight-note turn sets it false (the reply is informational
  // and must not silently overwrite the just-enriched card). Default: true.
  allowCardEdits?: boolean
  // Idempotency metadata for worker-seeded turns. When sourceKey is set, both
  // rows are persisted with it and the run is skipped if an assistant reply for
  // the key already exists — so a retried job never calls Opus or duplicates the
  // turn. Manual chat leaves these undefined (rows store NULL).
  source?: string
  sourceKey?: string
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
          'Object of optional enrichment keys to merge into exploration_extras. Recognized keys: ipa, frequency, frequency_detail, more_frequent_synonym, more_examples, regionalism, register, register_alternatives, collocations, etymology, l1_notes, notes, context_segment.',
      },
      grammar_patch: {
        type: 'object',
        description:
          'Object of typed morphology / grammar keys to merge into the grammar bag. Recognized keys: pos, display_form, gender, number_only, is_indeclinable, animacy, aspect, aspect_pair_headword, is_reflexive, government, plural, genitive, is_weak_noun, is_separable, auxiliary, notable_forms, notes. See the per-target-language guidance in the system prompt for which keys to fill.',
      },
    },
  },
}

const renderCardForChat = (card: DbCardWithChunk, mode: LanguageMode): string => {
  const lines = [
    `- headword: ${card.chunk.headword}`,
    `- sense: ${card.chunk.sense || '(none)'}`,
    `- surface_form: ${card.surface_form}`,
    `- definition: ${card.chunk.definition ?? '(none)'}`,
    `- target_example: ${card.chunk.target_example ?? '(none)'}`,
  ]
  // sameLanguage: translation fields are meaningless — never surface them.
  // Translations-off: surface only values that exist (manually entered), so
  // the model can discuss/edit them without being tempted to backfill the
  // empty ones unprompted.
  if (!mode.sameLanguage) {
    if (!mode.hideTranslationFields) {
      lines.push(`- translation: ${card.chunk.translation ?? '(none)'}`)
      lines.push(`- native_example: ${card.chunk.native_example ?? '(none)'}`)
    } else {
      if (card.chunk.translation !== null) lines.push(`- translation: ${card.chunk.translation}`)
      if (card.chunk.native_example !== null) lines.push(`- native_example: ${card.chunk.native_example}`)
    }
  }
  const grammar = (card.chunk.grammar ?? {}) as Record<string, unknown>
  if (Object.keys(grammar).length > 0) {
    lines.push(`- grammar:\n${JSON.stringify(grammar, null, 2)}`)
  } else {
    lines.push('- grammar: (empty)')
  }
  const extras = { ...((card.chunk.exploration_extras ?? {}) as Record<string, unknown>) }
  if (!mode.allowL1Notes) {
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
  mode: LanguageMode,
  allowCardEdits: boolean,
  replyLanguage: string
): string => {
  const header = `Card under discussion:
${renderCardForChat(card, mode)}

Surrounding segments:
${surroundingSegmentsBlock}`

  // No editing tool is offered for this turn — omit the tool instructions so the
  // model answers conversationally instead of trying to call a tool it can't.
  // The question itself may be phrased in the user's UI language (e.g. preset
  // chips), so pin the reply language explicitly: target language when
  // translations are hidden (preserve immersion), otherwise the native language.
  if (!allowCardEdits) return `${header}\n\nRespond in ${replyLanguage}.`

  const editableFields = mode.hideTranslationFields
    ? mode.sameLanguage
      ? 'definition, target-language example, grammar, etc.'
      : 'definition, target-language example, grammar, translation (on request), etc.'
    : 'translation, example sentence, definition, etc.'
  // sameLanguage: translation fields never apply. Translations-off is only a
  // generation pref — the model must not backfill unprompted, but an explicit
  // learner request to add/change a translation is honoured.
  const translationModeNote = mode.sameLanguage
    ? `\nTranslation fields do not apply for this card (the learner's native language is the target language): do not call \`${UPDATE_TOOL_NAME}\` with translation or native_example.`
    : mode.hideTranslationFields
      ? `\nTranslations are not auto-generated for this target language (learner preference). Do not populate translation or native_example unprompted — but if the learner explicitly asks you to add or change a translation or a native-language example, call \`${UPDATE_TOOL_NAME}\` with those fields.`
      : ''

  return `${header}

When the learner asks you to change something on the card (${editableFields}),
call the \`${UPDATE_TOOL_NAME}\` tool with only the fields that should change. Do not echo unchanged fields.
Confirm the change briefly in your reply.${translationModeNote}

When the learner asks you to fill in, create, or generate the card's data without specifying how deep to go, populate only the basic fields (translation, definition, target_example, native_example) plus the core \`grammar_patch\` keys — leave \`extras_patch\` (the full-exploration bag: frequency, register, register_alternatives, more_frequent_synonym, more_examples, regionalism, collocations, etymology, l1_notes, context_segment) empty. Only populate \`extras_patch\` when the learner explicitly asks for a full / deep / complete exploration, or asks for one of those specific extras by name.`
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
  const allowCardEdits = input.allowCardEdits ?? true

  const card = await deps.cardsRepository.findByIdForUser(input.cardId, input.userId)
  if (!card) throw new Error('Card not found')

  const session = await deps.studySessionsRepository.findByIdForUser(card.study_session_id, input.userId)
  if (!session) throw new Error('Session not found')

  // A note-only session never ran an enrich job, so its context_blob may be
  // absent. Mint-and-persist it lazily here (before buildPromptContext, which
  // returns null without it) so seeded + manual chat self-bootstrap.
  await ensureSessionContextBlob(session, input.userId, {
    anthropicPasses: deps.anthropicPasses,
    contentSourcesRepository: deps.contentSourcesRepository,
    textSegmentsRepository: deps.textSegmentsRepository,
    studySessionsRepository: deps.studySessionsRepository,
  })

  // Idempotency gate for worker-seeded turns: if this seed key already produced
  // an assistant reply, return the stored turn without calling Opus again. The
  // card/session ownership check above must happen first because card_chat rows
  // carry ownership only through card -> session.
  if (input.sourceKey) {
    const existingAssistant = await deps.cardChatMessagesRepository.findSeededAssistant(input.cardId, input.sourceKey)
    if (existingAssistant) {
      const userMessage = await deps.cardChatMessagesRepository.insertSeededMessage({
        cardId: input.cardId,
        role: 'user',
        content: input.content,
        source: input.source ?? 'seed',
        sourceTurnKey: input.sourceKey,
      })
      return { userMessage, assistantMessage: existingAssistant }
    }
  }

  const languagePrefs = await getLanguageMode({
    userId: input.userId,
    targetLanguage: session.target_language,
    snapshotNativeLanguage: session.native_language,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  })

  // Chat shares the enrichment pass's dialect handling so its answers (and any
  // extras_patch edits) stay consistent with the generated exploration.
  const englishIpaDialect = isEnglishTargetLanguage(session.target_language)
    ? await deps.usersRepository.getEnglishIpaDialect(input.userId)
    : undefined

  const promptContext = await buildPromptContext(
    {
      sessionId: card.study_session_id,
      userId: input.userId,
      nativeLanguage: languagePrefs.nativeLanguage ?? undefined,
      hideTranslationFields: languagePrefs.hideTranslationFields,
      allowL1Notes: languagePrefs.allowL1Notes,
      englishIpaDialect,
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

  // Reply language for the auto-seeded (non-editable) turn: target language when
  // translations are hidden (immersion), otherwise the learner's native language.
  const replyLanguage = languagePrefs.hideTranslationFields
    ? session.target_language
    : (languagePrefs.nativeLanguage ?? session.target_language)
  const seedTurn = buildSeedUserTurn(card, surroundingFormatted, languagePrefs, allowCardEdits, replyLanguage)
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

  const response = await deps.anthropicPasses.createChatCompletion({
    model: MODEL_OPUS,
    max_tokens: 1500,
    system: promptContext.systemBlocks,
    // Withhold the editing tool for non-editable (auto-seeded) turns.
    ...(allowCardEdits ? { tools: [updateCardFieldsTool] } : {}),
    messages,
  })
  logAnthropicCacheUsage('card-chat', response)

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
      // Translation fields are blocked only for sameLanguage (where they are
      // meaningless). With translations-off they pass through — the seed turn
      // instructs the model to set them only on explicit learner request.
      if (languagePrefs.sameLanguage) {
        parsed.patch.translation = null
        parsed.patch.nativeExample = null
        parsed.changedFieldNames = parsed.changedFieldNames.filter(
          (name) => name !== 'translation' && name !== 'native_example'
        )
      }
      parsed.patch.extrasPatch = sanitizeExplorationExtrasForLanguageMode(parsed.patch.extrasPatch, languagePrefs)
      if (parsed.patch.extrasPatch === null) {
        parsed.changedFieldNames = parsed.changedFieldNames.filter((name) => name !== 'extras')
      }
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
        // A note-only stub whose chat just generated basic data auto-keeps. A
        // normal highlight is already kept by enrichment, so this only ever
        // fires for a data-less stub gaining data — no study-intent ordering
        // race (note-only saves carry no intent).
        await autoKeepNeedsDataIfEligible(input.cardId, input.userId, {
          cardsRepository: deps.cardsRepository,
          studySessionsRepository: deps.studySessionsRepository,
          userLookupsRepository: deps.userLookupsRepository,
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

  // Seeded turns persist with the source key (conflict-safe, so a retry after a
  // partial insert re-reads the stored rows instead of duplicating the turn).
  // Manual turns insert plainly with NULL source columns.
  if (input.sourceKey) {
    const source = input.source ?? 'seed'
    const userMessage = await deps.cardChatMessagesRepository.insertSeededMessage({
      cardId: input.cardId,
      role: 'user',
      content: input.content,
      source,
      sourceTurnKey: input.sourceKey,
    })
    const assistantMessage = await deps.cardChatMessagesRepository.insertSeededMessage({
      cardId: input.cardId,
      role: 'assistant',
      content: finalAssistantBody,
      source,
      sourceTurnKey: input.sourceKey,
    })
    return { userMessage, assistantMessage }
  }

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
