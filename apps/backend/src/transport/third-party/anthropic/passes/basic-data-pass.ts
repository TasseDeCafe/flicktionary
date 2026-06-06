import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_basic_data'

type SegmentInput = {
  id: string
  index: number
  text: string
}

export type HighlightInput = {
  highlightId: string
  segmentId: string
  selectionText: string
}

type BasicDataPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  segments: SegmentInput[]
  highlights: HighlightInput[]
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
  // Which model runs the pass. The per-highlight enrichment path passes
  // MODEL_ENRICHMENT (Sonnet).
  model?: string
}

export type BasicDataChunk = {
  source: 'llm' | 'highlight'
  highlightId?: string
  headword: string
  sense: string
  surfaceForm: string
  segmentId: string
  translation: string | null
  // Translation of the inflected surface form as it reads in the sentence
  // (e.g. 'voyons' for surface 'посмотрим' under headword 'посмотреть').
  // Null when the surface form is already the citation form.
  surfaceTranslation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  // Optional language-specific morphology / grammar facts. Sparse — keys
  // populated only when relevant to the chunk and target language. See
  // packages/api-client/.../flicktionary-schemas.ts (GrammarSchema) and the
  // language-instructions block for per-language guidance.
  grammar?: Record<string, unknown>
  belowCefr: boolean
  reasoning?: string
}

const buildTool = (hideTranslationFields: boolean): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    'Submit basic card data for the user-provided highlights. You must produce exactly one row per highlight.',
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
              enum: ['highlight'],
              description: "Always 'highlight'. Do not discover new chunks from the context segments.",
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
              description: hideTranslationFields
                ? 'Set to null. Translation fields are disabled for this target language.'
                : "Short translation of the HEADWORD (citation form) into the learner's native language — NOT a translation of the inflected surface form or of the selection as it reads in the sentence. Mirror the headword's dictionary form: singular for a noun headword ('investment', not 'investments'), infinitive for a verb headword ('to pick at', not 'they pick at' or 'it made me sick'). Carry over no person, tense, number, or case from the example. Null when below_cefr is true (we will skip this chunk).",
            },
            surface_translation: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Set to null. Translation fields are disabled for this target language.'
                : "Counterpart to `translation` for the inflected form: translate surface_form exactly as it reads in the sentence, into the learner's native language (e.g. headword 'посмотреть' with surface_form 'посмотрим' → 'let's see'). Unlike `translation`, this one DOES carry the person, tense, number, and case of the surface form. Null when surface_form is already the citation form (identical to the headword). Null when below_cefr is true.",
            },
            definition: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Short contextual paraphrase in the target language. Used as the back of the card when translation fields are hidden. Null when below_cefr is true.'
                : 'Short contextual paraphrase in the target language (one short sentence). Optional but encouraged. Null when below_cefr is true.',
            },
            target_example: {
              type: ['string', 'null'],
              description:
                'A self-contained example sentence in the target language using the chunk in its natural setting. Inspired by but not equal to the source line. Null when below_cefr is true.',
            },
            native_example: {
              type: ['string', 'null'],
              description: hideTranslationFields
                ? 'Set to null. Native example fields are disabled for this target language.'
                : 'A natural translation of target_example into the native language. Null when below_cefr is true.',
            },
            below_cefr: {
              type: 'boolean',
              description:
                "Always false for user highlights. The user explicitly selected this text, so enrich it even if it is below the learner's CEFR level.",
            },
            grammar: {
              type: 'object',
              description:
                "Optional sparse bag of typed morphology / grammar facts for this chunk. Include keys only when they are useful for THIS chunk in THIS target language; omit the whole object when nothing applies. Recognized keys: `pos` (one of noun/verb/adjective/adverb/preposition/pronoun/particle/conjunction/numeral/phrase/idiom/other), `display_form` (canonical-but-decorated form for UI display, e.g. stress-marked Russian `ви́деть` — keep the headword itself clean), `gender` (m/f/n/c — only when ambiguous or surprising), `number_only` (plurale_tantum/singulare_tantum), `is_indeclinable` (boolean), `animacy` (animate/inanimate), `aspect` (impf/perf/biaspectual — Slavic verbs), `aspect_pair_headword` (string — the counterpart's clean lemma), `is_reflexive` (boolean), `government` (case/preposition pattern, e.g. '+ acc', 'от + gen', 'с + instr'), `notable_forms` (array of {label, form} for irregular paradigm cells, max 3), `notes` (free-form, last resort). The per-target-language instructions in the system prompt say WHEN to fill which keys.",
              properties: {
                pos: {
                  type: 'string',
                  enum: [
                    'noun',
                    'verb',
                    'adjective',
                    'adverb',
                    'preposition',
                    'pronoun',
                    'particle',
                    'conjunction',
                    'numeral',
                    'phrase',
                    'idiom',
                    'other',
                  ],
                },
                display_form: { type: 'string' },
                gender: { type: 'string', enum: ['m', 'f', 'n', 'c'] },
                number_only: { type: 'string', enum: ['plurale_tantum', 'singulare_tantum'] },
                is_indeclinable: { type: 'boolean' },
                animacy: { type: 'string', enum: ['animate', 'inanimate'] },
                aspect: { type: 'string', enum: ['impf', 'perf', 'biaspectual'] },
                aspect_pair_headword: { type: 'string' },
                is_reflexive: { type: 'boolean' },
                government: { type: 'string' },
                notable_forms: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      form: { type: 'string' },
                    },
                    required: ['label', 'form'],
                  },
                },
                notes: { type: 'string' },
              },
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
            'surface_translation',
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
  segments,
  highlights,
  hideTranslationFields = false,
  allowL1Notes,
  model = MODEL_OPUS,
}: BasicDataPassArgs): Promise<BasicDataChunk[]> => {
  const sameLanguage = nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const shouldHideTranslationFields = hideTranslationFields || sameLanguage
  const segmentLines = segments.map((s) => `[${s.id}] ${s.text}`).join('\n')

  // The learner's note / preset tags are intentionally NOT injected here: they
  // are answered directly in the per-card chat (seed_card_chat) rather than
  // shaping the card's base fields.
  const highlightLines = highlights
    .map((h) => `- ${h.highlightId} :: segment_id=${h.segmentId} :: "${h.selectionText}"`)
    .join('\n')

  const highlightsBlock = highlights.length
    ? `\nUser highlights (you MUST emit exactly one row per highlight, with source='highlight' and the matching highlight_id; below_cefr=false; basic data fully populated even when the chunk is below ${cefrLevel}):
${highlightLines}\n`
    : ''

  const translationModeNote = shouldHideTranslationFields
    ? `\n- Translation fields are disabled for this target language. Set translation=null, surface_translation=null and native_example=null on every row. Keep definition and target_example in ${targetLanguage}.`
    : ''

  const userMessage = `Emit one row per user highlight only. DO NOT discover any new chunks
on your own — ghost nomination handles suggestions separately. Every row must
have source='highlight' and a matching highlight_id from the list below. Do not
emit any source='llm' rows.

For every emitted row, populate the basic data: headword, sense, surface_form,
segment_id, translation, surface_translation, definition, target_example,
native_example. Populate
the optional \`grammar\` object per chunk when relevant for the target
language (see the system prompt for per-language guidance).
The learner is at ${cefrLevel}, native language ${nativeLanguage}, target
${targetLanguage}. Headwords must be in dictionary citation form (lemmatized),
and translation must render that citation form (infinitive for verbs, singular
for nouns) — never the inflected selection as it appears in the segment.${translationModeNote}${highlightsBlock}

Segments (id followed by text — only for context, do NOT mine them for new chunks):
${segmentLines}`

  // Keep streaming even for highlight-only enrichment so long responses do not hit
  // the SDK's non-streaming duration limit.
  const stream = getAnthropicClient().messages.stream({
    model,
    max_tokens: 32000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      hideTranslationFields: shouldHideTranslationFields,
      allowL1Notes,
    }),
    tools: [buildTool(shouldHideTranslationFields)],
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
    surfaceTranslation: typeof c.surface_translation === 'string' ? c.surface_translation : null,
    definition: typeof c.definition === 'string' ? c.definition : null,
    targetExample: typeof c.target_example === 'string' ? c.target_example : null,
    nativeExample: typeof c.native_example === 'string' ? c.native_example : null,
    grammar:
      c.grammar && typeof c.grammar === 'object' && !Array.isArray(c.grammar)
        ? (c.grammar as Record<string, unknown>)
        : undefined,
    belowCefr: Boolean(c.below_cefr),
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
  }))
