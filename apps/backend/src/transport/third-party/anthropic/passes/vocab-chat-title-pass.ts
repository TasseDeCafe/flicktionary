import { getAnthropicClient, MODEL_HAIKU, reasoningParams } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

const MAX_TITLE_CHARS = 60

// Names a vocabulary chat thread after its first exchange, so the Sessions
// list shows "Gym vocabulary" instead of the learner's first message.
export const vocabChatTitlePass = async (args: {
  firstUserMessage: string
  firstAssistantReply: string
  // Language the title is written in (the learner's UI-facing language).
  titleLanguage: string
}): Promise<string | null> => {
  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    ...reasoningParams(MODEL_HAIKU, 'low'),
    max_tokens: 52,
    system: `You name a language learner's vocabulary chat. Reply with a short title (2-5 words) in ${args.titleLanguage} naming the topic, e.g. "Gym vocabulary" or "Falling asleep". No quotes, no trailing punctuation, nothing else.`,
    messages: [
      {
        role: 'user',
        content: `Learner: ${args.firstUserMessage.slice(0, 1000)}\n\nAssistant: ${args.firstAssistantReply.slice(0, 1500)}`,
      },
    ],
  })
  logAnthropicCacheUsage('vocab-chat-title', response)
  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null
  const title = textBlock.text
    .trim()
    .replace(/^["'«“]+|["'»”.]+$/g, '')
    .trim()
  return title.length > 0 ? title.slice(0, MAX_TITLE_CHARS) : null
}
