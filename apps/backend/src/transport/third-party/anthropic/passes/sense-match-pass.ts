import { getAnthropicClient, MODEL_HAIKU, reasoningParams } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

// Save-time sense dedup: the basic-data pass writes a fresh sense label on every
// save, so a re-save of a word the user already has under another wording
// ("revolt, uprising" vs "uprising, revolt") would otherwise split into a second
// vocabulary row. When the headword already has saved senses, this pass decides
// whether the new one means the same as one of them. It is biased toward "new":
// a missed merge is today's behavior, a wrong merge hides a genuinely different
// meaning. Same shape as checkpoint-sense-pass: MODEL_HAIKU, plain text parsed
// by a unit-testable parser.

export type SenseMatchCandidate = {
  sense: string
  definition: string | null
  translation: string | null
  // The sentence the new save came from, when there is one.
  sentence: string | null
}

export type SenseMatchExisting = {
  userLookupId: string
  sense: string
  definition: string | null
  translation: string | null
}

const SYSTEM_PROMPT = `You decide whether a learner's newly saved word sense is the same meaning as a sense they already saved.
Same meaning: a learner would study both as one flashcard — the labels are paraphrases, reordered synonyms, or one only adds a register or part-of-speech note.
Different meaning: different senses of a polysemous word, opposite directions (borrow vs lend), a literal vs a figurative use, or a different part of speech.
When unsure, answer new.
Output exactly one line, nothing else: the number of the matching saved sense, or the word "new".`

const describeSense = (sense: { sense: string; definition: string | null; translation: string | null }): string => {
  const parts = [sense.sense]
  if (sense.translation) parts.push(`translation: ${sense.translation}`)
  if (sense.definition) parts.push(`definition: ${sense.definition}`)
  return parts.join(' — ')
}

// Returns the matched saved sense's id, or null for a new sense. Anything
// unparseable or out of range is null: never guess a merge.
export const parseSenseMatchPassText = (text: string, existing: SenseMatchExisting[]): string | null => {
  const match = /^\s*(\d+|new)\s*\.?\s*$/i.exec(text.trim().split(/\r?\n/)[0] ?? '')
  if (!match || match[1]!.toLowerCase() === 'new') return null
  return existing[parseInt(match[1]!, 10) - 1]?.userLookupId ?? null
}

export const senseMatchPass = async (params: {
  targetLanguage: string
  headword: string
  candidate: SenseMatchCandidate
  existing: SenseMatchExisting[]
}): Promise<string | null> => {
  if (params.existing.length === 0) return null

  const savedBlock = params.existing.map((s, i) => `${i + 1}. ${describeSense(s)}`).join('\n')
  const sentenceLine = params.candidate.sentence ? `\nSentence: ${params.candidate.sentence}` : ''
  const userMessage = `Language: ${params.targetLanguage}
Word: ${params.headword}

Saved senses:
${savedBlock}

New sense: ${describeSense(params.candidate)}${sentenceLine}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    ...reasoningParams(MODEL_HAIKU, 'low'),
    max_tokens: 13,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('sense-match', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseSenseMatchPassText(textBlock.text, params.existing)
}
