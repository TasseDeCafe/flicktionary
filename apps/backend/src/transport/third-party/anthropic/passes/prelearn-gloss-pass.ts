import { getAnthropicClient, MODEL_HAIKU, reasoningParams } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'

// Batched short glosses for the book page's "Learn before you read" list: each
// word glossed in the book sentence it comes up in next, so a word the book
// uses in several senses gets the one the reader is about to meet. Same shape
// as the checkpoint sense pass: MODEL_HAIKU, no tool-use, numbered plain-text
// lines parsed by a unit-testable parser.

export type PrelearnGlossItem = {
  // Dictionary form of the word.
  headword: string
  // A window of the sentence it occurs in (the occurrence may be inflected).
  context: string
}

// Longest gloss kept: the row shows it inline next to the word.
const MAX_GLOSS_CHARS = 80

const SYSTEM_PROMPT = `You write very short glosses for words a learner is about to meet in a book.
For each numbered item you receive a word in dictionary form and the passage where it appears (the word may be inflected there).
Give the meaning the word has in that passage, in 1-4 words — lowercase unless it's a proper noun, no articles unless needed, no explanations, no quotes, no examples.
Output exactly one line per item, nothing else:
<item number>: <gloss>`

// One gloss per item, in item order; null where the line is missing or empty
// (the row then simply shows no gloss).
export const parsePrelearnGlossPassText = (text: string, itemCount: number): Array<string | null> => {
  const glossByNumber = new Map<number, string>()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[:.)]\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const gloss = match[2]!.replace(/^["'«“]+|["'»”]+$/g, '').trim()
    if (gloss.length === 0) continue
    glossByNumber.set(parseInt(match[1]!, 10), gloss.slice(0, MAX_GLOSS_CHARS))
  }
  return Array.from({ length: itemCount }, (_, index) => glossByNumber.get(index + 1) ?? null)
}

export const prelearnGlossPass = async (params: {
  targetLanguage: string
  nativeLanguage: string
  hideTranslationFields: boolean
  items: PrelearnGlossItem[]
}): Promise<Array<string | null>> => {
  if (params.items.length === 0) return []

  // Language names, not ISO codes — see fastGlossPass: with a bare code next to
  // Cyrillic passages Haiku 5.5 drifts into transliterating the gloss.
  const target = getLanguageName(params.targetLanguage)
  const native = getLanguageName(params.nativeLanguage)
  const outputLanguageInstruction = params.hideTranslationFields
    ? `Write each gloss as a short definition in ${target}.`
    : `Write each gloss in ${native} (or as a short definition in ${target} if the languages match).`
  const itemsBlock = params.items
    .map((item, index) => `${index + 1}. Word: ${item.headword}\n   Passage: ${item.context}`)
    .join('\n')
  const userMessage = `Target: ${target}
Native: ${native}

${itemsBlock}

${outputLanguageInstruction}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    ...reasoningParams(MODEL_HAIKU, 'low'),
    max_tokens: 40 * params.items.length + 65,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('prelearn-gloss', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parsePrelearnGlossPassText(textBlock.text, params.items.length)
}
