import { getAnthropicClient, MODEL_HAIKU } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'

// Checkpoint-review backlog confirmation: a backlog candidate matched only
// through inflected forms may be a homograph false positive that survived the
// frequency-asymmetry guard (equal-frequency collisions like «стих»/«стихнуть»
// past tense). This pass judges whether the saved word actually occurs — in
// any inflected form, with roughly the saved meaning — in at least one of the
// candidate's sighting windows. The two-step format (state the in-context
// meaning, then verdict by meaning comparison alone) measurably beats a bare
// yes/no on homograph traps. Same shape as the MWE pass: MODEL_HAIKU, no
// tool-use, unit-testable parser. Chunked internally so callers and test
// mocks see a single invocation regardless of candidate count.

export type CheckpointBacklogItem = {
  headword: string
  sense: string
  // Match-centered windows of the segments the word was sighted in (never
  // full segments — pasted-text segments can be whole paragraphs).
  contexts: string[]
}

export type CheckpointBacklogVerdict = {
  headword: string
  occurs: boolean
}

const CHUNK_SIZE = 10

const SYSTEM_PROMPT = `You judge whether a saved vocabulary word occurs in text WITH its given meaning.
For each numbered item you receive the word (dictionary form and meaning) and one or more text excerpts.
Work in two steps for each item. First find the excerpt word that shares a spelling with the saved word or one of its inflected forms, and state what that word actually means IN CONTEXT (its lexeme and part of speech). Then compare: only if it is a grammatical form of the SAME lexeme, used with roughly the given meaning, in at least one excerpt, answer yes. A homograph — a different lexeme sharing the spelling (different part of speech, a piece of a hyphenated compound, part of a proper name), or the same spelling from a different dictionary word — is no.
The verdict is decided by the meaning comparison alone: yes ONLY when the in-context meaning you just stated matches the given meaning. If the in-context meaning is different — even when the spelling is identical to the dictionary form — the answer is no.
Example (English): Word: saw — cutting tool. Excerpt: I saw him yesterday. -> "saw" here is the past tense of "see", not the tool, so: saw = past of see -> no.
Output exactly one line per item, nothing else:
<item number>: <matched word> = <its in-context meaning, a few words> -> yes
or
<item number>: <matched word> = <its in-context meaning, a few words> -> no
or, when no excerpt word even shares the spelling:
<item number>: none -> no`

export const parseCheckpointBacklogPassText = (
  text: string,
  items: CheckpointBacklogItem[]
): CheckpointBacklogVerdict[] => {
  const verdictByIndex = new Map<number, boolean>()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[:.].*?->\s*(yes|no)\s*$/i.exec(line)
    if (!match) continue
    verdictByIndex.set(parseInt(match[1]!, 10), match[2]!.toLowerCase() === 'yes')
  }
  // A missing/unparseable answer counts as "does not occur" — never offer a
  // known-assertion on a guess.
  return items.map((item, index) => ({
    headword: item.headword,
    occurs: verdictByIndex.get(index + 1) ?? false,
  }))
}

const runChunk = async (
  targetLanguage: string,
  items: CheckpointBacklogItem[]
): Promise<CheckpointBacklogVerdict[]> => {
  const itemsBlock = items
    .map((item, index) => {
      const excerpts = item.contexts.map((context) => `   Excerpt: ${context}`).join('\n')
      return `${index + 1}. Word: ${item.headword} — ${item.sense}\n${excerpts}`
    })
    .join('\n')
  const userMessage = `Language: ${targetLanguage}\n\n${itemsBlock}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_HAIKU,
    max_tokens: 40 * items.length + 50,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('checkpoint-backlog', response)

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic response did not contain a text block')
  }
  return parseCheckpointBacklogPassText(textBlock.text, items)
}

export const checkpointBacklogPass = async (params: {
  targetLanguage: string
  items: CheckpointBacklogItem[]
}): Promise<CheckpointBacklogVerdict[]> => {
  if (params.items.length === 0) return []
  const chunks: CheckpointBacklogItem[][] = []
  for (let i = 0; i < params.items.length; i += CHUNK_SIZE) {
    chunks.push(params.items.slice(i, i + CHUNK_SIZE))
  }
  const results = await Promise.all(chunks.map((chunk) => runChunk(params.targetLanguage, chunk)))
  return results.flat()
}
