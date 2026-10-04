import type Anthropic from '@anthropic-ai/sdk'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import {
  cachedSystem,
  getAnthropicClient,
  MODEL_HAIKU,
  MODEL_WORD_FAMILY,
  reasoningParams,
  TOOL_CHOICE_AUTO,
} from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

// The LLM layer of the reader's word-family line
// (docs/proposals/word-family-hints.md, v2): for ONE dictionary word, what
// each part of it contributes, parents the kaikki data lacks, which kaikki
// ancestors a learner can't actually see in it, and native-language cognates.
// The result is cached per lemma and shown before the translation is
// revealed, so the prompt forbids giving away the whole word's meaning; part
// meanings also show on production fronts (#517), so they must never spell
// the word either.

const TOOL_NAME = 'submit_word_family'
const MAX_PARTS = 5
const MAX_MISSING_PARENTS = 3
const MAX_COGNATES = 2
const MAX_MEANING_CHARS = 60

export type WordFamilyInsightPart = { text: string; isAffix: boolean }

export type WordFamilyInsightPassInput = {
  targetLanguage: string
  // The language explanations are written in: the native language, or the
  // target language for translations-off learners (then no cognates).
  explanationLanguage: string
  headword: string
  pos: string
  // "participle of замёрзнуть" etc., when the word is one.
  formOf: string | null
  // The kaikki breakdown, when there is one.
  kaikkiParts: WordFamilyInsightPart[] | null
  // Dictionary spellings of the kaikki ancestors to judge.
  ancestors: string[]
  // Set when another explanation language already fixed the breakdown: the
  // pass then only explains these parts, in this order.
  fixedParts: WordFamilyInsightPart[] | null
}

export type WordFamilyInsightPassResult = {
  parts: WordFamilyInsightPart[]
  // Aligned with parts; null where the model gave none.
  partMeanings: Array<string | null>
  // Unvalidated dictionary spellings; the caller checks them against kaikki.
  missingParents: string[]
  // A subset of the input ancestors, as given.
  hiddenAncestors: string[]
  cognates: string[]
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Submit the learner-facing word-family analysis of the word.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parts: {
        type: 'array',
        description:
          'The breakdown in order, e.g. за- + мёрзнуть. Empty when no breakdown helps a learner (opaque or unanalyzable words).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: {
              type: 'string',
              description:
                'An affix written with its hyphen (за-, -ость, -ся) or a base word in dictionary form, no stress marks.',
            },
            is_affix: { type: 'boolean' },
            meaning: {
              type: 'string',
              description:
                'What this part contributes in THIS word, 1-5 words, lowercase. For an affix, its specific sense here (за-: "into a state"), not its general dictionary list. Never the meaning of the whole word, and never a spelling: no word of the target language, no transliteration, no donor-language word or etymology note.',
            },
          },
          required: ['text', 'is_affix', 'meaning'],
        },
      },
      missing_parents: {
        type: 'array',
        description:
          "Other same-language words this word visibly derives from that are neither in your breakdown nor among the listed ancestors (e.g. a participle's verb). Dictionary form, no stress marks. Usually empty.",
        items: { type: 'string' },
      },
      hidden_ancestors: {
        type: 'array',
        description:
          'Listed ancestors a learner cannot recognize in this word (sound change, meaning drift): copy them exactly as listed. Usually empty.',
        items: { type: 'string' },
      },
      cognates: {
        type: 'array',
        description:
          'Words in the explanation language that are recognizably related to this word in both form and meaning (дюжина ≈ dozen). Empty unless the link is obvious to an ordinary speaker.',
        items: { type: 'string' },
      },
    },
    required: ['parts', 'missing_parents', 'hidden_ancestors', 'cognates'],
  },
})

const formatParts = (parts: readonly WordFamilyInsightPart[]): string => parts.map((p) => p.text).join(' + ')

export const buildWordFamilyInsightPrompt = (
  input: WordFamilyInsightPassInput
): { system: string; userMessage: string } => {
  const target = getLanguageName(input.targetLanguage)
  const explanation = getLanguageName(input.explanationLanguage)
  const cognatesAllowed = input.explanationLanguage !== input.targetLanguage

  const system = `You help a ${target} learner guess the meaning of a word from how it is built, before they see its translation.

For the given ${target} word you:
1. Give a learner-facing breakdown into parts (prefixes, root word, suffixes). Keep it shallow and useful: stop at a word a learner could know (замёрзнуть = за- + мёрзнуть, not за- + мёрз- + -ну- + -ть). Skip pure inflection endings. A dictionary breakdown may be given; keep it when it is sound, fix it when it is wrong or unhelpful, and leave the parts empty for opaque words.
2. Say what each part contributes in THIS word, in ${explanation}. An affix has many senses; give the one at work here. Never state the meaning of the whole word — the learner is about to guess it. Describe what a part means, not where it comes from: a meaning never contains a ${target} word, a transliteration or a donor-language word (no "from French sérieux") — production practice shows these meanings while the learner recalls the word's spelling.
3. List same-language parents the dictionary data missed, only when the link is transparent to a learner.
4. Mark listed ancestors a learner cannot recognize in the word (e.g. понимать from иметь: the root is no longer visible). Keep ancestors whose link is visible even if distant. A word you use in your breakdown is visible by definition — never mark it.
5. ${cognatesAllowed ? `List ${explanation} cognates only when both form and meaning make the link obvious; otherwise none.` : 'Leave cognates empty.'}

Call ${TOOL_NAME} once.`

  const lines = [`Word: ${input.headword}`, `Part of speech: ${input.pos}`]
  if (input.formOf) lines.push(`It is a ${input.formOf}.`)
  if (input.fixedParts) {
    lines.push(
      `Use exactly these parts, in this order, and only explain them: ${formatParts(input.fixedParts)}. Return empty missing_parents and hidden_ancestors.`
    )
  } else {
    lines.push(`Dictionary breakdown: ${input.kaikkiParts ? formatParts(input.kaikkiParts) : 'none'}`)
    lines.push(`Ancestors in the dictionary data: ${input.ancestors.length > 0 ? input.ancestors.join(', ') : 'none'}`)
  }
  return { system, userMessage: lines.join('\n') }
}

const cleanWord = (s: string): string => s.normalize('NFC').replace(/́/g, '').trim()

export const parseWordFamilyInsightInput = (
  raw: unknown,
  input: Pick<WordFamilyInsightPassInput, 'ancestors' | 'fixedParts' | 'explanationLanguage' | 'targetLanguage'>
): WordFamilyInsightPassResult => {
  const data = (raw ?? {}) as Record<string, unknown>
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
      .filter((v): v is string => typeof v === 'string')
      .map(cleanWord)
      .filter((v) => v.length > 0 && !/\s/.test(v))

  const rawParts = (Array.isArray(data.parts) ? data.parts : []).flatMap((p) => {
    const item = (p ?? {}) as Record<string, unknown>
    const text = typeof item.text === 'string' ? cleanWord(item.text) : ''
    if (!text) return []
    const meaning = typeof item.meaning === 'string' ? item.meaning.trim().slice(0, MAX_MEANING_CHARS) : ''
    return [{ text, isAffix: item.is_affix === true || text.startsWith('-') || text.endsWith('-'), meaning }]
  })

  let parts: WordFamilyInsightPart[]
  let partMeanings: Array<string | null>
  if (input.fixedParts) {
    // The stored breakdown wins; meanings pair up by position, then by text.
    parts = input.fixedParts
    partMeanings = input.fixedParts.map((fixed, index) => {
      const byIndex = rawParts[index]
      const match = byIndex?.text === fixed.text ? byIndex : rawParts.find((p) => p.text === fixed.text)
      return match?.meaning || null
    })
  } else {
    // A single part restates the word itself — no breakdown.
    const kept = rawParts.length >= 2 || rawParts.some((p) => !p.isAffix) ? rawParts.slice(0, MAX_PARTS) : []
    parts = kept.map(({ text, isAffix }) => ({ text, isAffix }))
    partMeanings = kept.map((p) => p.meaning || null)
  }

  const listed = new Set(input.ancestors.map(cleanWord))
  return {
    parts,
    partMeanings,
    missingParents: input.fixedParts ? [] : strings(data.missing_parents).slice(0, MAX_MISSING_PARENTS),
    hiddenAncestors: input.fixedParts ? [] : strings(data.hidden_ancestors).filter((a) => listed.has(a)),
    cognates: input.explanationLanguage === input.targetLanguage ? [] : strings(data.cognates).slice(0, MAX_COGNATES),
  }
}

export const wordFamilyInsightPass = async (
  input: WordFamilyInsightPassInput
): Promise<WordFamilyInsightPassResult & { model: string }> => {
  const { system, userMessage } = buildWordFamilyInsightPrompt(input)
  const response = await getAnthropicClient().messages.create({
    model: MODEL_WORD_FAMILY,
    ...(MODEL_WORD_FAMILY === MODEL_HAIKU ? {} : reasoningParams(MODEL_WORD_FAMILY, 'low')),
    max_tokens: 2000,
    system: cachedSystem(system),
    tools: [buildTool()],
    // Opus 5.5 rejects a forced tool_choice; the prompt names the tool.
    tool_choice: MODEL_WORD_FAMILY === MODEL_HAIKU ? { type: 'tool', name: TOOL_NAME } : TOOL_CHOICE_AUTO,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('word-family-insight', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Word-family insight did not produce a tool_use block')
  }
  return { ...parseWordFamilyInsightInput(toolUse.input, input), model: MODEL_WORD_FAMILY }
}
