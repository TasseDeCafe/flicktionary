import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_difficult_chunks'
const DIFFICULT_WORDS_TARGET = 25

type SegmentInput = {
  id: string
  index: number
  text: string
}

type DifficultWordsPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  l1InterferenceNotes: string
  segments: SegmentInput[]
  excludedHeadwords: string[]
}

export type DifficultChunk = {
  headword: string
  surfaceForm: string
  segmentId: string
  belowCefr: boolean
  reasoning?: string
}

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Submit the list of chunks worth studying for this learner. Each chunk is a phrase, collocation, or fixed expression — not a single word in isolation unless the word itself is unusual. Aim for ~25 chunks.',
  input_schema: {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            headword: {
              type: 'string',
              description:
                "The normalized chunk in citation form (e.g. 'run out of', 'estar a punto de'). May differ from how it appears in the segment.",
            },
            surface_form: {
              type: 'string',
              description: 'How the chunk literally appears in the segment text.',
            },
            segment_id: {
              type: 'string',
              description: 'The id of the segment where this chunk appears (provided in the segment list).',
            },
            below_cefr: {
              type: 'boolean',
              description:
                "True if the chunk is more than one CEFR level below the learner's level — these will be auto-rejected.",
            },
            reasoning: {
              type: 'string',
              description: 'One-line note on why this chunk is worth studying. Optional.',
            },
          },
          required: ['headword', 'surface_form', 'segment_id', 'below_cefr'],
        },
      },
    },
    required: ['chunks'],
  },
}

export const difficultWordsPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  l1InterferenceNotes,
  segments,
  excludedHeadwords,
}: DifficultWordsPassArgs): Promise<DifficultChunk[]> => {
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')
  const excludedBlock = excludedHeadwords.length
    ? `\nThe learner has already studied (exclude these):\n${excludedHeadwords.join(', ')}`
    : ''

  const userMessage = `Identify approximately ${DIFFICULT_WORDS_TARGET} chunks from these subtitles
that this learner would benefit from studying. Prefer multi-word collocations,
fixed expressions, idioms, phrasal verbs, and discourse markers over single words.
For each chunk, indicate whether it is below the learner's CEFR level (${cefrLevel}).${excludedBlock}

Segments (id followed by text):
${segmentLines}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_SONNET,
    max_tokens: 8000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      l1InterferenceNotes,
    }),
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Anthropic response did not contain a tool_use block')
  }
  const input = toolUse.input as { chunks?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.chunks)) {
    throw new Error('tool_use.input.chunks was not an array')
  }
  return input.chunks.map((c) => ({
    headword: String(c.headword),
    surfaceForm: String(c.surface_form),
    segmentId: String(c.segment_id),
    belowCefr: Boolean(c.below_cefr),
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
  }))
}
