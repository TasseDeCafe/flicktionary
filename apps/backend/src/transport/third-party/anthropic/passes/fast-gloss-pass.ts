import { getAnthropicClient, MODEL_HAIKU, reasoningParams } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'

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

const SYSTEM_PROMPT = `You return a single-line gloss for a chunk in its sentence context.
No examples, no etymology, no formatting, no extra commentary.
Never wrap the gloss in quotation marks, even when the selection is quoted.
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
    ...reasoningParams(MODEL_HAIKU, 'low'),
    max_tokens: 260,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('fast-gloss', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseFastGloss(textBlock.text)
}
