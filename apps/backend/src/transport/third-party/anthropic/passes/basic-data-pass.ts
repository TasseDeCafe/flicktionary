import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_basic_data'

// Target chunk count for the LLM-discovered side of the pass scales with CEFR —
// higher levels benefit from a denser net across the full track since most
// lines are noise to them.
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

export type HighlightInput = {
  highlightId: string
  segmentId: string
  selectionText: string
  note: string | null
  presetTags: string[]
}

export type ExcludedHeadwordSense = {
  headword: string
  sense: string
}

type BasicDataPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  l1InterferenceNotes: string
  segments: SegmentInput[]
  highlights: HighlightInput[]
  excludedHeadwordSenses: ExcludedHeadwordSense[]
  // When false, the model is told to emit ONLY highlight rows and to skip
  // LLM-discovered chunks entirely. Used when the user has turned off the
  // "suggest chunks" pref.
  llmDiscoveryEnabled: boolean
}

export type BasicDataChunk = {
  source: 'llm' | 'highlight'
  highlightId?: string
  headword: string
  sense: string
  surfaceForm: string
  segmentId: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  belowCefr: boolean
  reasoning?: string
}

const buildTool = (sameLanguage: boolean): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    "Submit the list of items worth studying for this learner, with their basic data populated. Items can be either user-provided highlights (must always produce one row per highlight) or LLM-discovered chunks at or above the learner's CEFR level. Both single words and multi-word units are valuable.",
  input_schema: {
    type: 'object',
    properties: {
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['llm', 'highlight'],
              description:
                "'highlight' means the chunk is one provided in the highlights list — you MUST produce exactly one row per highlight. 'llm' means a chunk you discovered yourself in the segments.",
            },
            highlight_id: {
              type: 'string',
              description:
                "When source='highlight', the id of the originating highlight. Required for source='highlight'.",
            },
            headword: {
              type: 'string',
              description:
                "The normalized chunk in citation form (e.g. 'run out of', 'estar a punto de', 'fundirse con'). Always lemmatized — verbs as infinitives, nouns as singular, prepositional collocations include the canonical preposition. Never inflected.",
            },
            sense: {
              type: 'string',
              description:
                "Short sense tag (1-5 words). A disambiguator, NOT a definition — the definition belongs in `definition`, do not duplicate it here. Just enough to tell apart different meanings of the same headword. Polysemous example for 'correr': 'race', 'flow (liquid)', 'spread (news)'. Monosemous example for 'desfibrilador': 'medical device'. Idiom example for 'estar a punto de': 'about to'. Never a full sentence. Never longer than 5 words.",
            },
            surface_form: {
              type: 'string',
              description: 'How the chunk literally appears in the segment text.',
            },
            segment_id: {
              type: 'string',
              description: 'The id of the segment where this chunk appears (provided in the segment list).',
            },
            translation: {
              type: ['string', 'null'],
              description: sameLanguage
                ? 'Set to null when native_language equals target_language — there is nothing to translate.'
                : "Short translation of the chunk into the learner's native language. Null when below_cefr is true (we will skip this chunk).",
            },
            definition: {
              type: ['string', 'null'],
              description: sameLanguage
                ? 'Short contextual paraphrase in the target language. Used as the back of the card when the languages match. Null when below_cefr is true.'
                : 'Short contextual paraphrase in the target language (one short sentence). Optional but encouraged. Null when below_cefr is true.',
            },
            target_example: {
              type: ['string', 'null'],
              description:
                'A self-contained example sentence in the target language using the chunk in its natural setting. Inspired by but not equal to the source line. Null when below_cefr is true.',
            },
            native_example: {
              type: ['string', 'null'],
              description: sameLanguage
                ? 'Set to null when native_language equals target_language.'
                : 'A natural translation of target_example into the native language. Null when below_cefr is true.',
            },
            below_cefr: {
              type: 'boolean',
              description:
                "True if the chunk is below the learner's CEFR level. For LLM-discovered chunks you should not submit such chunks at all — but if one slips in, set this true and skip the translation/definition/example fields (set them to null) to save tokens. For source='highlight' you MUST emit a row regardless of level (always set below_cefr=false for highlights — the user explicitly asked).",
            },
            reasoning: {
              type: 'string',
              description: 'One-line note on why this chunk is worth studying. Optional.',
            },
          },
          required: [
            'source',
            'headword',
            'sense',
            'surface_form',
            'segment_id',
            'translation',
            'definition',
            'target_example',
            'native_example',
            'below_cefr',
          ],
        },
      },
    },
    required: ['chunks'],
  },
})

export const basicDataPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  l1InterferenceNotes,
  segments,
  highlights,
  excludedHeadwordSenses,
  llmDiscoveryEnabled,
}: BasicDataPassArgs): Promise<BasicDataChunk[]> => {
  const sameLanguage = nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')
  const excludedLines = excludedHeadwordSenses.map((e) => `- ${e.headword}${e.sense ? ` | ${e.sense}` : ''}`).join('\n')
  const excludedBlock = excludedHeadwordSenses.length
    ? `\nThe learner has already studied these (headword | sense). Exclude any
LLM-discovered candidate whose headword AND sense are sufficiently similar to
one of these. A candidate with the same headword but a clearly distinct sense
(e.g. 'correr | to run a race' vs 'correr | to spread, of news') should still
be included as a new entry. This exclusion list does NOT apply to user
highlights — always emit a row for every highlight.
${excludedLines}`
    : ''

  const target = llmDiscoveryEnabled ? targetForLevel(cefrLevel) : 0

  const highlightLines = highlights
    .map((h) => {
      const noteSuffix = h.note ? ` | note: ${h.note}` : ''
      const tagSuffix = h.presetTags.length ? ` | tags: ${h.presetTags.join(', ')}` : ''
      return `- ${h.highlightId} :: segment_id=${h.segmentId} :: "${h.selectionText}"${noteSuffix}${tagSuffix}`
    })
    .join('\n')

  const highlightsBlock = highlights.length
    ? `\nUser highlights (you MUST emit exactly one row per highlight, with source='highlight' and the matching highlight_id; below_cefr=false; basic data fully populated even when the chunk is below ${cefrLevel}):
${highlightLines}\n`
    : ''

  const sameLangNote = sameLanguage
    ? `\n- The learner's native language equals the target language. Set translation=null and native_example=null on every row. Use definition for the back of the card.`
    : ''

  const userMessage = llmDiscoveryEnabled
    ? `Identify approximately ${target} chunks from these subtitles
that this learner would benefit from studying, AND emit one row per user
highlight. The learner is at ${cefrLevel}.

For every emitted row, populate the basic data: headword, sense, surface_form,
segment_id, translation, definition, target_example, native_example. For
below_cefr=true rows the translation/definition/example fields can be null
(saves tokens — the user can override and request enrichment later).

Selection criteria for LLM-discovered chunks — apply strictly:
- Pick the most important chunks. There can be more than ${target} useful chunks
  to learn, so go for the ones that are the most useful/frequent.
- Only include items AT OR ABOVE ${cefrLevel}. Do not include items below
  ${cefrLevel} even if they appear frequently in the source. Common collocations
  like "durante el resto de su vida", "nunca más", "según su costumbre" are not
  ${cefrLevel} material — skip them.
- Include BOTH single words and multi-word units. Do not skew exclusively toward
  multi-word chunks: an advanced single word the learner does not know
  (literary, technical, archaic, slang, jargon — e.g. 'sap' as a weapon,
  'desfibrilador', 'untado', 'fulano') is just as worth studying as a
  collocation. Multi-word units to consider: collocations, fixed expressions,
  idioms, phrasal verbs, pronominal verbs (with their canonical preposition),
  discourse markers. Aim for a natural mix that reflects what is actually
  difficult in this source — if the source is dialogue-heavy and idiomatic,
  multi-word units will dominate; if it is narrative or technical, single
  words will dominate. Trust the source.
- Read the source-context block in the system prompt for register and
  regional cues. If the source is dense with regional, dialectal, or colloquial
  usage that a ${cefrLevel} learner would not know (e.g. rioplatense voseo,
  lunfardo, peninsular slang, mexicanismos), prioritize chunks that exemplify
  that usage over neutral pan-language equivalents — that is the highest-value
  material for this learner.
- Headwords must be in dictionary citation form (lemmatized). Verbs as
  infinitives, nouns as singular masculine, pronominal verbs include 'se'
  ('fundirse con', not 'se fundía con'). Surface_form is the literal form
  in the segment.${excludedBlock}${sameLangNote}${highlightsBlock}

Segments (id followed by text):
${segmentLines}`
    : `Emit one row per user highlight only. DO NOT discover any new chunks
on your own — the learner has turned off LLM-suggested chunks. Every row must
have source='highlight' and a matching highlight_id from the list below. Do
not emit any source='llm' rows.

For every emitted row, populate the basic data: headword, sense, surface_form,
segment_id, translation, definition, target_example, native_example.
The learner is at ${cefrLevel}, native language ${nativeLanguage}, target
${targetLanguage}. Headwords must be in dictionary citation form (lemmatized).${sameLangNote}${highlightsBlock}

Segments (id followed by text — only for context, do NOT mine them for new chunks):
${segmentLines}`

  // Opus 4.x natively supports up to 32k output tokens. With per-chunk basic
  // data (translation + definition + 2 examples) and CEFR target counts up to
  // 40, a long English track can easily blow past 16k. The SDK requires
  // streaming for any request whose worst-case duration exceeds 10 minutes —
  // at 32k tokens that's mandatory, so we use messages.stream(...).finalMessage().
  const stream = getAnthropicClient().messages.stream({
    model: MODEL_OPUS,
    max_tokens: 32000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      l1InterferenceNotes,
    }),
    tools: [buildTool(sameLanguage)],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })
  const response = await stream.finalMessage()

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Anthropic response did not contain a tool_use block${reason}`)
  }
  const input = toolUse.input as { chunks?: Array<Record<string, unknown>> }
  if (!Array.isArray(input.chunks)) {
    const truncated = response.stop_reason === 'max_tokens'
    const detail = truncated
      ? 'output truncated at max_tokens — increase max_tokens or lower CEFR target count'
      : `unexpected tool_use input shape (stop_reason=${response.stop_reason ?? 'unknown'})`
    throw new Error(`Basic-data pass produced no usable chunks: ${detail}`)
  }
  return parseBasicDataChunks(input.chunks)
}

// Exported for unit tests. Maps the raw tool_use chunk objects to typed
// BasicDataChunk values, defending against the model's occasional sloppiness.
export const parseBasicDataChunks = (raw: Array<Record<string, unknown>>): BasicDataChunk[] =>
  raw.map((c) => ({
    source: c.source === 'highlight' ? 'highlight' : 'llm',
    highlightId: typeof c.highlight_id === 'string' ? c.highlight_id : undefined,
    headword: String(c.headword ?? ''),
    sense: typeof c.sense === 'string' ? c.sense : '',
    surfaceForm: String(c.surface_form ?? ''),
    segmentId: String(c.segment_id ?? ''),
    translation: typeof c.translation === 'string' ? c.translation : null,
    definition: typeof c.definition === 'string' ? c.definition : null,
    targetExample: typeof c.target_example === 'string' ? c.target_example : null,
    nativeExample: typeof c.native_example === 'string' ? c.native_example : null,
    belowCefr: Boolean(c.below_cefr),
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
  }))
