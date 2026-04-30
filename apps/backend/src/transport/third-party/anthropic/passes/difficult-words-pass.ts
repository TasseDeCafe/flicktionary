import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_difficult_chunks'

// Target chunk count scales with CEFR — higher levels benefit from a denser net
// across the full track since most lines are noise to them.
const targetForLevel = (cefrLevel: string): number => {
  const upper = cefrLevel.trim().toUpperCase()
  if (upper === 'A1' || upper === 'A2') return 20
  if (upper === 'B1' || upper === 'B2') return 25
  if (upper === 'C1') return 35
  if (upper === 'C2') return 40
  return 25
}

type SegmentInput = {
  id: string
  index: number
  text: string
}

export type ExcludedHeadwordSense = {
  headword: string
  sense: string
}

type DifficultWordsPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  l1InterferenceNotes: string
  segments: SegmentInput[]
  excludedHeadwordSenses: ExcludedHeadwordSense[]
}

export type DifficultChunk = {
  headword: string
  sense: string
  surfaceForm: string
  segmentId: string
  belowCefr: boolean
  reasoning?: string
}

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Submit the list of chunks worth studying for this learner. Each chunk is a phrase, collocation, or fixed expression — not a single word in isolation unless the word itself is at or above the learner's level. Only include chunks at or above the learner's CEFR level.",
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
                "The normalized chunk in citation form (e.g. 'run out of', 'estar a punto de', 'fundirse con'). Always lemmatized — verbs as infinitives, nouns as singular, prepositional collocations include the canonical preposition. Never inflected.",
            },
            sense: {
              type: 'string',
              description:
                "Short sense tag (1-5 words). A disambiguator, NOT a definition — the definition belongs in a separate field, do not duplicate it here. Just enough to tell apart different meanings of the same headword. Polysemous example for 'correr': 'race', 'flow (liquid)', 'spread (news)'. Monosemous example for 'desfibrilador': 'medical device'. Idiom example for 'estar a punto de': 'about to'. Never a full sentence. Never longer than 5 words.",
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
                "True if the chunk is below the learner's CEFR level. You should not submit such chunks at all — but if one slips in, set this true and it will be auto-rejected.",
            },
            reasoning: {
              type: 'string',
              description: 'One-line note on why this chunk is worth studying. Optional.',
            },
          },
          required: ['headword', 'sense', 'surface_form', 'segment_id', 'below_cefr'],
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
  excludedHeadwordSenses,
}: DifficultWordsPassArgs): Promise<DifficultChunk[]> => {
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')
  const excludedLines = excludedHeadwordSenses.map((e) => `- ${e.headword}${e.sense ? ` | ${e.sense}` : ''}`).join('\n')
  const excludedBlock = excludedHeadwordSenses.length
    ? `\nThe learner has already studied these (headword | sense). Exclude any
candidate whose headword AND sense are sufficiently similar to one of these.
A candidate with the same headword but a clearly distinct sense (e.g.
'correr | to run a race' vs 'correr | to spread, of news') should still be
included as a new entry:
${excludedLines}`
    : ''
  const target = targetForLevel(cefrLevel)

  const userMessage = `Identify approximately ${target} chunks from these subtitles
that this learner would benefit from studying. The learner is at ${cefrLevel}.

Selection criteria — apply strictly:
- Only include chunks AT OR ABOVE ${cefrLevel}. Do not include chunks below
  ${cefrLevel} even if they appear frequently in the source. Common collocations
  like "durante el resto de su vida", "nunca más", "según su costumbre" are not
  ${cefrLevel} material — skip them.
- Prefer multi-word collocations, fixed expressions, idioms, phrasal verbs,
  pronominal verbs (with their canonical preposition), and discourse markers
  over single words. Include single words only when the word itself is at or
  above ${cefrLevel}.
- Read the source-context block in the system prompt for register and
  regional cues. If the source is dense with regional, dialectal, or colloquial
  usage that a ${cefrLevel} learner would not know (e.g. rioplatense voseo,
  lunfardo, peninsular slang, mexicanismos), prioritize chunks that exemplify
  that usage over neutral pan-language equivalents — that is the highest-value
  material for this learner.
- Headwords must be in dictionary citation form (lemmatized). Verbs as
  infinitives, nouns as singular masculine, pronominal verbs include 'se'
  ('fundirse con', not 'se fundía con'). Surface_form is the literal form
  in the segment.${excludedBlock}

Segments (id followed by text):
${segmentLines}`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
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
    sense: typeof c.sense === 'string' ? c.sense : '',
    surfaceForm: String(c.surface_form),
    segmentId: String(c.segment_id),
    belowCefr: Boolean(c.below_cefr),
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
  }))
}
