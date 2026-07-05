import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

type FastGlossPassArgs = {
  targetLanguage: string
  nativeLanguage: string
  hideTranslationFields?: boolean
  contextLine: string
  selectionText: string
}

export type FastGloss = {
  gloss: string
  pos: string | null
  register: string | null
}

const FAST_GLOSS_POS_ALIASES = new Set([
  'n',
  'noun',
  'v',
  'verb',
  'transitive verb',
  'intransitive verb',
  'phrasal verb',
  'modal verb',
  'adj',
  'adjective',
  'adv',
  'adverb',
  'prep',
  'preposition',
  'pron',
  'pronoun',
  'particle',
  'conj',
  'conjunction',
  'num',
  'numeral',
  'intj',
  'interjection',
])

const normalizeMetadataToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/\s+/g, ' ')

const isFastGlossPos = (value: string): boolean => FAST_GLOSS_POS_ALIASES.has(normalizeMetadataToken(value))

export const parseFastGlossText = (text: string): FastGloss => {
  const lines = text.trim().split(/\r?\n/)
  const gloss = lines[0] ?? ''
  const metadata = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const first = metadata[0] ?? null
  const second = metadata[1] ?? null

  if (first && isFastGlossPos(first)) return { gloss, pos: first, register: second }
  if (second && isFastGlossPos(second)) return { gloss, pos: second, register: first }
  return { gloss, pos: null, register: first }
}

const SYSTEM_PROMPT = `You return a single-line gloss for a chunk in its sentence context.
No examples, no etymology, no formatting, no extra commentary.
Format: <gloss>\\n[POS]\\n[register]
Where POS and register are single words and may be omitted (one or two trailing newlines).`

export const fastGlossPass = async ({
  targetLanguage,
  nativeLanguage,
  hideTranslationFields = false,
  contextLine,
  selectionText,
}: FastGlossPassArgs): Promise<FastGloss> => {
  const outputLanguageInstruction = hideTranslationFields
    ? `Return a one-line definition/gloss in ${targetLanguage}.`
    : `Return a one-line gloss in ${nativeLanguage} (or a one-line definition in ${targetLanguage} if the languages match).`
  const userMessage = `Target: ${targetLanguage}
Native: ${nativeLanguage}
Context line: ${contextLine}
Selection: ${selectionText}

${outputLanguageInstruction} Optionally a single POS tag and a single register tag.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('fast-gloss', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseFastGlossText(textBlock.text)
}
