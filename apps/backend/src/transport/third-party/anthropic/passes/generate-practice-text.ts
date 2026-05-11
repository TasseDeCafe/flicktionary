import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildPracticeMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_practice_text'

// Concrete format directives the model picks from per call. Without this the
// model defaults to a fairy-tale / short-story shape regardless of the chunk
// mix. We pick one at random per generation to force genre variety across a
// practice session.
const TEXT_FORMATS = [
  'A short passage from a news article — pick a paragraph from the middle of the story, not the lede. Neutral journalistic register.',
  "A dialogue between two friends in a casual setting (café, bar, walking). Use the language's natural convention for speech (em-dashes, quote marks).",
  'A text-message exchange between two friends. Each message on its own line; speaker label optional but consistent.',
  'A mid-scene passage from a contemporary novel. No setup, no resolution — drop the reader into the middle of something.',
  'An online comment in the style of a Reddit thread reply: opinionated, conversational, can be slightly ranty.',
  'An online review of a restaurant, product, or movie. Glowing, scathing, or mixed — the writer has a clear take.',
  'A diary entry — candid, first-person, reflecting on something mundane or absurd from the writer’s day.',
  'An email — work message, friendly catch-up, or polite complaint. Use a salutation and sign-off if natural.',
  'A social-media post (Instagram caption / X post). Punchy, self-contained, can be funny.',
  'An opinion piece / editorial fragment. The writer takes a clear position on something current or evergreen.',
  'A snippet from a podcast or interview transcript, with speaker labels (Q: / A: or names).',
  'A forum post asking for advice or sharing a story (think r/relationships or a hobby forum).',
  'A customer-support exchange — customer message plus agent reply, or just one side of one.',
  'A travel-blog excerpt: a writer describing a place they visited, with personal observations.',
  'A personal-essay fragment — a small observation about life, no plot, more vibe than story.',
  'A voice-memo-style transcript: rambly, parentheticals, false starts, "anyway" and "so" allowed.',
  'A group-chat scrollback with three or more participants reacting to the same thing. Short messages, fragments, jokes.',
  'A humorous monologue or stand-up-bit fragment. Allowed to be silly.',
  'A complaint letter — to a landlord, neighbor, airline, or company. Polite but pointed.',
  'A how-to / explainer paragraph: someone walking the reader through a process or idea.',
  'A confession or vent to a friend, in text or in person. Emotional, casual register.',
  'An overheard-conversation snippet — what the writer caught a stranger saying on a bus, in a queue, at the next table.',
  'A breakdown of something niche the writer is enthusiastic about (a hobby, a band, an obscure recipe).',
  'A short pitch / blurb of the kind you’d find on a menu, packaging, or About page.',
]

const pickFormat = (): string => TEXT_FORMATS[Math.floor(Math.random() * TEXT_FORMATS.length)]!

export type PracticeChunkInput = {
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
}

export type GeneratedAnnotation = {
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
}

export type GeneratedSkippedChunk = {
  headword: string
  sense: string
  reason: string
}

export type GeneratePracticeTextResult = {
  body: string
  usedChunks: GeneratedAnnotation[]
  skippedChunks: GeneratedSkippedChunk[]
  generationWarning: string | null
}

type GeneratePracticeTextArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  chunks: PracticeChunkInput[]
  // Rescue mode: a stubborn chunk the LLM previously skipped in a multi-chunk
  // text. Switches the prompt to "single short sentence containing this one
  // chunk" — much easier to fit naturally than a 7-chunk paragraph.
  rescueMode?: boolean
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    'Submit one short, self-contained text in the target language that naturally weaves in the requested chunks, plus the array of chunk annotations (where each chunk appears in the body). The format/genre is specified in the user message — match it. If a chunk does not fit naturally, omit it and add it to skipped_chunks rather than forcing it in.',
  input_schema: {
    type: 'object',
    properties: {
      body: {
        type: 'string',
        description:
          'The generated text in the target language. Aim for ~80–120 words in the format specified by the user message. Surrounding language stays at B1–B2 grammar regardless of how advanced the requested chunks are; do not invent rare advanced vocabulary outside the requested chunks.',
      },
      used_chunks: {
        type: 'array',
        description:
          'One entry per requested chunk that appears in body. Skip chunks that did not fit naturally — list them in skipped_chunks instead.',
        items: {
          type: 'object',
          properties: {
            headword: {
              type: 'string',
              description: 'Must match a headword from the input chunks list (citation form).',
            },
            sense: {
              type: 'string',
              description: "Must match the corresponding sense from the input chunks list. Use '' for empty senses.",
            },
            surface_form: {
              type: 'string',
              description:
                'The exact substring as it appears in body (possibly inflected — conjugated verb, declined noun, etc.). Must be a verbatim substring of body, including casing and punctuation. The server locates the position from this string — DO NOT include character offsets.',
            },
          },
          required: ['headword', 'sense', 'surface_form'],
        },
      },
      skipped_chunks: {
        type: 'array',
        description: 'Chunks from the input that you did not embed (e.g. could not fit naturally).',
        items: {
          type: 'object',
          properties: {
            headword: { type: 'string' },
            sense: { type: 'string' },
            reason: {
              type: 'string',
              description: 'One short phrase: e.g. "context-incompatible", "too many for length", "register clash".',
            },
          },
          required: ['headword', 'sense', 'reason'],
        },
      },
    },
    required: ['body', 'used_chunks', 'skipped_chunks'],
  },
})

const buildChunkBlock = (chunks: PracticeChunkInput[], sameLanguage: boolean): string => {
  return chunks
    .map((c, i) => {
      const lines = [`${i + 1}. headword="${c.headword}" sense="${c.sense}"`]
      if (c.translation) lines.push(`   translation="${c.translation}"`)
      if (c.definition) lines.push(`   definition="${c.definition}"`)
      if (c.targetExample) lines.push(`   target_example="${c.targetExample}"`)
      if (c.nativeExample && !sameLanguage) lines.push(`   native_example="${c.nativeExample}"`)
      return lines.join('\n')
    })
    .join('\n\n')
}

const buildRescueUserMessage = (args: {
  targetLanguage: string
  cefrLevel: string
  chunks: PracticeChunkInput[]
  sameLanguage: boolean
}): string => {
  const numbered = buildChunkBlock(args.chunks, args.sameLanguage)
  return `Write ONE short, natural ${args.targetLanguage} sentence (10–25 words) that uses the chunk below in its given sense. This is a "rescue" call: the chunk was skipped in a previous multi-chunk text because it didn't fit the surrounding context, so now you have full freedom to pick whatever context lets it land naturally.

Hard rules:
- Exactly one sentence. No multi-sentence body. No setup, no explanation.
- Surrounding language stays at B1–B2 grammar regardless of how advanced the chunk is. Do not invent rare advanced vocabulary outside the chunk.
- Use the chunk's stored MEANING. Inflect to fit (conjugate verbs, decline nouns, agree adjectives).
- Do NOT gloss, define, or explain the chunk inline.
- surface_form is the EXACT substring as it appears in body (matching casing and punctuation). The server finds the position — do not output character offsets.
- If you genuinely cannot form a natural sentence with this chunk, put it in skipped_chunks. This should be very rare — you have full context freedom now.

Learner profile: CEFR ${args.cefrLevel}, target language ${args.targetLanguage}.

Chunk:

${numbered}

Call submit_practice_text with body, used_chunks, and skipped_chunks. Stop after the tool call.`
}

const buildUserMessage = (args: {
  targetLanguage: string
  cefrLevel: string
  chunks: PracticeChunkInput[]
  sameLanguage: boolean
  format: string
}): string => {
  const numbered = buildChunkBlock(args.chunks, args.sameLanguage)

  return `Generate a short ${args.targetLanguage} text in the following format, naturally incorporating ALL of the chunks below.

FORMAT: ${args.format}

Write in that format and only that format. Do NOT default to a fairy-tale or short-story shape unless the format above is itself a story passage. The text does not need a clear beginning, middle, and end — a fragment, a moment, a snippet is fine. Drop the reader in.

Hard rules:
- Length: ~80–120 words. Be concise. Pack the chunks in densely; this is a vocabulary review, not a narrative.
- Aim to include every requested chunk. Only put a chunk in skipped_chunks as a last resort (genuine register clash or context impossibility). Most chunks should fit.
- Surrounding language stays at B1–B2 grammar and vocabulary, regardless of how advanced the requested chunks are. Do not introduce rare or advanced vocabulary outside the requested chunks. Keep sentence structures simple.
- Use each chunk's stored MEANING, not its example sentence verbatim. Inflect to fit (conjugate verbs, decline nouns, agree adjectives).
- Discontinuous patterns (e.g. "ni … ni", "either … or", "más … que") must appear with both halves in correct grammatical relation. Use one annotation per half if needed.
- Do NOT gloss, define, or explain chunks inline. They appear as natural language.
- Tone is yours to pick — dry, warm, mocking, melancholic, enthusiastic, ranty, funny — match the chosen format. Humor is welcome.
- For each used chunk, surface_form is the EXACT substring as it appears in body (matching casing and punctuation). The server finds the position — do not compute or output character offsets.
- If a chunk does not fit naturally, omit it and add it to skipped_chunks rather than forcing it in.

Learner profile: CEFR ${args.cefrLevel}, target language ${args.targetLanguage}.

Chunks to include:

${numbered}

Call submit_practice_text with body, used_chunks, and skipped_chunks. Stop after the tool call.`
}

type RawUsedChunk = {
  headword: string
  sense: string
  surfaceForm: string
}

// Find the next occurrence of `needle` in `body` starting at or after
// `searchFrom` that doesn't overlap any previously claimed range. Falls back
// to the earliest non-overlapping occurrence if nothing is found at/after the
// cursor. Returns -1 if no valid position exists.
const findFreePosition = (
  body: string,
  needle: string,
  searchFrom: number,
  claimed: Array<[number, number]>
): number => {
  const overlaps = (start: number) => {
    const end = start + needle.length
    return claimed.some(([s, e]) => start < e && end > s)
  }
  let pos = body.indexOf(needle, searchFrom)
  while (pos >= 0) {
    if (!overlaps(pos)) return pos
    pos = body.indexOf(needle, pos + 1)
  }
  // Fall back to scanning from the start of the body in case the LLM emitted
  // chunks out of narrative order.
  pos = body.indexOf(needle, 0)
  while (pos >= 0 && pos < searchFrom) {
    if (!overlaps(pos)) return pos
    pos = body.indexOf(needle, pos + 1)
  }
  return -1
}

// Locate each requested chunk in body by searching for surface_form. The LLM
// is bad at character arithmetic but reliable at echoing exact substrings, so
// we let it produce the surface_form and compute the offsets ourselves. Drops
// chunks whose surface_form isn't a substring of body (or whose only matches
// overlap with already-claimed ranges).
const locateAnnotations = (
  body: string,
  rawUsed: RawUsedChunk[],
  requested: PracticeChunkInput[]
): { kept: GeneratedAnnotation[]; warning: string | null } => {
  const requestedKeys = new Set(requested.map((c) => `${c.headword}::${c.sense ?? ''}`))
  const kept: GeneratedAnnotation[] = []
  const dropped: string[] = []
  const claimed: Array<[number, number]> = []
  let cursor = 0

  for (const ann of rawUsed) {
    const key = `${ann.headword}::${ann.sense ?? ''}`
    if (!requestedKeys.has(key)) {
      dropped.push(`unrequested ${ann.headword}|${ann.sense}`)
      continue
    }
    if (!ann.surfaceForm) {
      dropped.push(`empty surface_form ${ann.headword}|${ann.sense}`)
      continue
    }
    const pos = findFreePosition(body, ann.surfaceForm, cursor, claimed)
    if (pos < 0) {
      dropped.push(`not in body ${ann.headword}|${ann.sense}`)
      continue
    }
    const end = pos + ann.surfaceForm.length
    kept.push({
      headword: ann.headword,
      sense: ann.sense,
      surfaceForm: ann.surfaceForm,
      charStart: pos,
      charEnd: end,
    })
    claimed.push([pos, end])
    cursor = end
  }

  const warning = dropped.length > 0 ? `Dropped ${dropped.length} bad annotation(s): ${dropped.join('; ')}` : null
  return { kept, warning }
}

export const parseToolResult = (
  body: string,
  toolInput: Record<string, unknown>,
  requested: PracticeChunkInput[]
): GeneratePracticeTextResult => {
  const rawUsed = Array.isArray(toolInput.used_chunks) ? (toolInput.used_chunks as Array<Record<string, unknown>>) : []
  const rawSkipped = Array.isArray(toolInput.skipped_chunks)
    ? (toolInput.skipped_chunks as Array<Record<string, unknown>>)
    : []

  const usedRaw: RawUsedChunk[] = rawUsed.map((c) => ({
    headword: String(c.headword ?? ''),
    sense: typeof c.sense === 'string' ? c.sense : '',
    surfaceForm: String(c.surface_form ?? ''),
  }))
  const { kept, warning: locatorWarning } = locateAnnotations(body, usedRaw, requested)

  const skippedChunks: GeneratedSkippedChunk[] = rawSkipped.map((s) => ({
    headword: String(s.headword ?? ''),
    sense: typeof s.sense === 'string' ? s.sense : '',
    reason: String(s.reason ?? 'unspecified'),
  }))

  const skippedSummary =
    skippedChunks.length > 0
      ? `LLM skipped ${skippedChunks.length} chunk(s): ${skippedChunks
          .map((s) => `${s.headword}|${s.sense} (${s.reason})`)
          .join('; ')}`
      : null
  const generationWarning = [locatorWarning, skippedSummary].filter((w): w is string => w !== null).join(' / ') || null

  return {
    body,
    usedChunks: kept,
    skippedChunks,
    generationWarning,
  }
}

export const generatePracticeText = async (args: GeneratePracticeTextArgs): Promise<GeneratePracticeTextResult> => {
  const sameLanguage = args.nativeLanguage.trim().toLowerCase() === args.targetLanguage.trim().toLowerCase()
  const userMessage = args.rescueMode
    ? buildRescueUserMessage({
        targetLanguage: args.targetLanguage,
        cefrLevel: args.cefrLevel,
        chunks: args.chunks,
        sameLanguage,
      })
    : buildUserMessage({
        targetLanguage: args.targetLanguage,
        cefrLevel: args.cefrLevel,
        chunks: args.chunks,
        sameLanguage,
        format: pickFormat(),
      })

  // Streaming is optional for this output size (~300 words, ~600 tokens) but
  // we use it for consistency with basic-data-pass and to leave the door open
  // for v2 pre-generation that may want incremental UI updates.
  const stream = getAnthropicClient().messages.stream({
    model: MODEL_OPUS,
    max_tokens: 4000,
    system: buildPracticeMethodologySystem({
      nativeLanguage: args.nativeLanguage,
      targetLanguage: args.targetLanguage,
      cefrLevel: args.cefrLevel,
    }),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  })
  const response = await stream.finalMessage()

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Practice text generation did not produce a tool_use block${reason}`)
  }

  const input = toolUse.input as Record<string, unknown>
  const body = typeof input.body === 'string' ? input.body : ''
  if (!body) {
    throw new Error('Practice text generation returned an empty body')
  }

  return parseToolResult(body, input, args.chunks)
}
