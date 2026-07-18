import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

// Checkpoint-review sense disambiguation: when the user's vocabulary holds 2+
// saved senses of one headword and that headword matched a collected span,
// this pass picks which saved sense the text actually uses — only the picked
// sense's row survives into credit/backlog partitioning. Single-sense
// headwords never reach this pass; a failed pass drops its headwords entirely
// (conservative). Same shape as fast-gloss: MODEL_HAIKU, no tool-use, plain
// text parsed by a unit-testable parser.

export type CheckpointSenseItem = {
  headword: string
  // One segment from the span containing the matched occurrence.
  segmentText: string
  senses: Array<{ userLookupId: string; sense: string }>
}

export type CheckpointSensePick = {
  headword: string
  // null = the model judged that none of the saved senses is the one used.
  pickedUserLookupId: string | null
}

const SYSTEM_PROMPT = `You disambiguate which saved sense of a word is used in a sentence.
For each numbered item you receive a word, the sentence it appeared in, and a numbered list of candidate senses.
Output exactly one line per item, nothing else:
<item number>: <sense number>
Use the sense number of the sense actually used in the sentence, or the word "none" if none of the listed senses fits.`

export const parseCheckpointSensePassText = (text: string, items: CheckpointSenseItem[]): CheckpointSensePick[] => {
  const pickBySenseIndex = new Map<number, number | null>()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[:.]\s*(\d+|none)\s*$/i.exec(line)
    if (!match) continue
    const itemNumber = parseInt(match[1]!, 10)
    const choice = match[2]!.toLowerCase()
    pickBySenseIndex.set(itemNumber, choice === 'none' ? null : parseInt(choice, 10))
  }
  return items.map((item, index) => {
    const senseNumber = pickBySenseIndex.get(index + 1)
    // An unparseable / missing answer is treated like "none": the headword is
    // dropped rather than guessed at.
    if (senseNumber == null) return { headword: item.headword, pickedUserLookupId: null }
    const sense = item.senses[senseNumber - 1]
    return { headword: item.headword, pickedUserLookupId: sense?.userLookupId ?? null }
  })
}

export const checkpointSensePass = async (params: {
  targetLanguage: string
  items: CheckpointSenseItem[]
}): Promise<CheckpointSensePick[]> => {
  if (params.items.length === 0) return []

  const itemsBlock = params.items
    .map((item, index) => {
      const senses = item.senses.map((s, i) => `   ${i + 1}. ${s.sense}`).join('\n')
      return `${index + 1}. Word: ${item.headword}\n   Sentence: ${item.segmentText}\n   Senses:\n${senses}`
    })
    .join('\n')
  const userMessage = `Language: ${params.targetLanguage}\n\n${itemsBlock}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 20 * params.items.length + 50,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('checkpoint-sense', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseCheckpointSensePassText(textBlock.text, params.items)
}
