import {
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from '@flicktionary/core/constants/supported-languages'
import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'

const MAX_INPUT_CHARS = 1_000

const SYSTEM_PROMPT = `You identify the dominant natural language of a text snippet.
Respond with exactly the ISO 639-1 two-letter code, lowercase, with no punctuation, whitespace, or commentary.
Allowed codes: ${SUPPORTED_LANGUAGE_CODES.join(', ')}.
If the language is not in this list, or the text is too short, ambiguous, or not natural language, respond with: und`

export const languageDetectionPass = async (text: string): Promise<SupportedLanguageCode | null> => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 16,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: trimmed.slice(0, MAX_INPUT_CHARS) }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null

  const candidate = textBlock.text.trim().toLowerCase()
  return isSupportedLanguageCode(candidate) ? candidate : null
}
