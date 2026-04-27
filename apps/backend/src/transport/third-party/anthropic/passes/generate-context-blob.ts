import { getAnthropicClient, MODEL_SONNET } from '../anthropic-client'

type GenerateContextBlobArgs = {
  contentTitle: string
  contentLanguage: string
  // A representative slice of segment text. Whole-track text is too large to send
  // verbatim; a sampled slice (e.g. first ~150 segments) gives the model enough
  // signal for genre/tone/character estimation.
  segmentSample: string
}

const SYSTEM_PROMPT = `You produce a short context blob (~300 tokens) about a piece of media,
based on its subtitle excerpts. Output plain prose, no markdown, in this order:
genre and tone, register (formal/conversational/literary/etc), main characters
identifiable from dialogue, plot sketch in 2-3 sentences, recurring vocabulary
themes the learner will encounter. Be terse and concrete.`

export const generateContextBlob = async ({
  contentTitle,
  contentLanguage,
  segmentSample,
}: GenerateContextBlobArgs): Promise<string> => {
  const userMessage = `Title: ${contentTitle}
Language: ${contentLanguage}

Subtitle excerpts:
${segmentSample}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_SONNET,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return textBlock.text.trim()
}
