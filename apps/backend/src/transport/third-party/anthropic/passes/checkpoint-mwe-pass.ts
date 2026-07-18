import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

// Checkpoint-review MWE confirmation: the recall filter (findMweCandidates)
// only checks that a multi-word expression's content words all appear in one
// segment — liberal by design, so shared words in unrelated roles pass it.
// This pass judges whether the expression actually OCCURS in the segment
// (inflected or reordered counts — separable verbs, free word order,
// interruptions; coincidental co-occurrence does not). MWE candidate volume
// is small, so this is where the LLM check earns its cost. Same shape as
// fast-gloss: MODEL_HAIKU, no tool-use, unit-testable parser.

export type CheckpointMweItem = {
  mweHeadword: string
  segmentText: string
}

export type CheckpointMweVerdict = {
  mweHeadword: string
  occurs: boolean
}

const SYSTEM_PROMPT = `You judge whether a multi-word expression occurs in a sentence.
For each numbered item you receive the expression and the sentence.
The expression counts as occurring when its words are used together in that meaning — inflected forms, reordering, and words in between all count (e.g. separable verbs). It does NOT count when the words merely co-occur in unrelated roles.
Output exactly one line per item, nothing else:
<item number>: yes
or
<item number>: no`

export const parseCheckpointMwePassText = (text: string, items: CheckpointMweItem[]): CheckpointMweVerdict[] => {
  const verdictByIndex = new Map<number, boolean>()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[:.]\s*(yes|no)\s*$/i.exec(line)
    if (!match) continue
    verdictByIndex.set(parseInt(match[1]!, 10), match[2]!.toLowerCase() === 'yes')
  }
  // A missing/unparseable answer counts as "does not occur" — never credit on
  // a guess.
  return items.map((item, index) => ({
    mweHeadword: item.mweHeadword,
    occurs: verdictByIndex.get(index + 1) ?? false,
  }))
}

export const checkpointMwePass = async (params: {
  targetLanguage: string
  items: CheckpointMweItem[]
}): Promise<CheckpointMweVerdict[]> => {
  if (params.items.length === 0) return []

  const itemsBlock = params.items
    .map((item, index) => `${index + 1}. Expression: ${item.mweHeadword}\n   Sentence: ${item.segmentText}`)
    .join('\n')
  const userMessage = `Language: ${params.targetLanguage}\n\n${itemsBlock}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 10 * params.items.length + 50,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('checkpoint-mwe', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseCheckpointMwePassText(textBlock.text, params.items)
}
