import { getAnthropicClient, MODEL_HAIKU, reasoningParams } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'

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
  // Language names, not ISO codes: told to gloss "in fr" next to a long
  // Cyrillic context, Haiku 5.5 wrote French in Cyrillic letters (мондаин,
  // лécha) in ~35% of replays; "in French" brought that under 1%.
  const target = getLanguageName(targetLanguage)
  const native = getLanguageName(nativeLanguage)
  const outputLanguageInstruction = hideTranslationFields
    ? `Return a one-line definition/gloss in ${target}.`
    : `Return a one-line gloss in ${native} (or a one-line definition in ${target} if the languages match).`
  const userMessage = `Target: ${target}
Native: ${native}
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
