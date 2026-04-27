import { getAnthropicClient, MODEL_SONNET } from '../anthropic-client'

type GenerateL1InterferenceNotesArgs = {
  nativeLanguage: string
  targetLanguage: string
}

const SYSTEM_PROMPT = `You produce concise notes (~500 tokens) on L1 interference patterns
between a learner's native language and target language. Output plain prose, no markdown,
covering: notable false friends, structural/grammatical transfers (word order, articles,
agreement, aspect), tense/aspect mismatches, missing or extra grammatical features,
register conventions that diverge between the two cultures. Be concrete with brief
examples. Skimmable. No pedagogical preamble.`

export const generateL1InterferenceNotes = async ({
  nativeLanguage,
  targetLanguage,
}: GenerateL1InterferenceNotesArgs): Promise<string> => {
  const userMessage = `Native language: ${nativeLanguage}
Target language: ${targetLanguage}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_SONNET,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return textBlock.text.trim()
}
