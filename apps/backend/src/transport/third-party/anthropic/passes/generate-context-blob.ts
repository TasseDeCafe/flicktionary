import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'

type GenerateContextBlobArgs = {
  contentTitle: string
  contentLanguage: string
  contentType: string
  // A representative slice of segment text. Whole-track text is too large to send
  // verbatim; a sampled slice (e.g. first ~150 segments) gives the model enough
  // signal for topic/tone/named-entity estimation.
  segmentSample: string
}

const SYSTEM_PROMPT = `You produce a short context blob (~300 tokens) about a piece of source material
the learner is studying. The material may be subtitles for a film, a news article,
a forum comment, a book excerpt, or any other text. Output plain prose, no markdown,
in this order: topic (for narrative material: genre + plot sketch in 2-3 sentences;
for non-narrative: subject matter), register (formal / conversational / literary /
journalistic / etc), tone, recurring vocabulary themes the learner will encounter,
any named entities or recurring referents (characters, places, products) worth
knowing. Be terse and concrete.`

const labelForContentType = (contentType: string): string => {
  if (contentType === 'movie') return 'Subtitle excerpts'
  if (contentType === 'book') return 'Book excerpts'
  if (contentType === 'article') return 'Article excerpts'
  return 'Text excerpts'
}

export const generateContextBlob = async ({
  contentTitle,
  contentLanguage,
  contentType,
  segmentSample,
}: GenerateContextBlobArgs): Promise<string> => {
  const userMessage = `Title: ${contentTitle}
Language: ${contentLanguage}
Source type: ${contentType}

${labelForContentType(contentType)}:
${segmentSample}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
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
