import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'

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

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  const lines = textBlock.text.trim().split(/\r?\n/)
  return {
    gloss: lines[0] ?? '',
    pos: lines[1]?.trim() || null,
    register: lines[2]?.trim() || null,
  }
}
