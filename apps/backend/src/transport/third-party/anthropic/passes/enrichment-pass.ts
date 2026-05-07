import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_enrichment'

// Output of the enrichment pass.
//
// Required fields are the basic columns (the model may refine them based on
// deeper analysis with the surrounding context). Optional fields are bundled
// into `extras` and persisted into `cards.exploration_extras`.
export type EnrichmentOutput = {
  headword: string
  sense: string
  surface_form: string
  translation: string
  definition: string
  target_example: string
  native_example: string
  extras: Record<string, unknown>
}

type EnrichmentPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  surfaceForm: string
  surroundingSegments: string
  userNote?: string | null
  presetTags?: string[]
}

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Submit a deep enrichment of a single chunk for the learner. Required fields are the basic columns (you may refine them based on the surrounding context). Optional fields all live inside `extras` and may be omitted individually when not relevant.',
  input_schema: {
    type: 'object',
    properties: {
      headword: {
        type: 'string',
        description:
          "Normalized citation form. May differ from surface_form (e.g. 'run out of' for surface 'ran out of').",
      },
      sense: {
        type: 'string',
        description:
          "Short sense tag (1-5 words). A disambiguator, NOT a definition — the definition lives in the `definition` field. Polysemous example for 'correr': 'race', 'flow (liquid)', 'spread (news)'. Monosemous example for 'desfibrilador': 'medical device'. Idiom example for 'estar a punto de': 'about to'. Never longer than 5 words.",
      },
      surface_form: { type: 'string' },
      translation: {
        type: 'string',
        description:
          "Translation of the chunk into the learner's native language. When native and target languages match, set this to an empty string.",
      },
      definition: {
        type: 'string',
        description: 'Contextual paraphrase in the target language.',
      },
      target_example: {
        type: 'string',
        description:
          'A self-contained example sentence in the target language inspired by — but not equal to — the source line. Complete and grammatical (not a fragment).',
      },
      native_example: {
        type: 'string',
        description:
          "A natural translation of `target_example` into the learner's native language. Empty string when native and target languages match.",
      },
      extras: {
        type: 'object',
        description:
          'Optional enrichment fields. Include any keys that are relevant; omit a key entirely when it is not. Recognized keys: `ipa` (string), `frequency` (one of high/medium/low), `more_frequent_synonym` (string|null), `regionalism` (string|null), `register` (string), `register_alternatives` ({more_formal, less_formal}), `collocations` (string[]), `etymology` (string), `l1_notes` (string|null), `notes` (string|null), `context_segment` (string with the chunk wrapped in **double asterisks**).',
        properties: {
          ipa: { type: 'string' },
          frequency: { type: 'string', enum: ['high', 'medium', 'low'] },
          more_frequent_synonym: { type: ['string', 'null'] },
          regionalism: { type: ['string', 'null'] },
          register: { type: 'string' },
          register_alternatives: {
            type: 'object',
            properties: {
              more_formal: { type: ['string', 'null'] },
              less_formal: { type: ['string', 'null'] },
            },
          },
          collocations: { type: 'array', items: { type: 'string' } },
          etymology: { type: 'string' },
          l1_notes: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
          context_segment: { type: 'string' },
        },
      },
    },
    required: [
      'headword',
      'sense',
      'surface_form',
      'translation',
      'definition',
      'target_example',
      'native_example',
      'extras',
    ],
  },
}

export const enrichmentPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  surfaceForm,
  surroundingSegments,
  userNote,
  presetTags,
}: EnrichmentPassArgs): Promise<EnrichmentOutput> => {
  const presetBlock = presetTags && presetTags.length ? `\nPreset emphasis: ${presetTags.join(', ')}` : ''
  const noteBlock = userNote ? `\nLearner note: ${userNote}` : ''

  const userMessage = `Enrich this chunk: "${surfaceForm}"

Surrounding segments:
${surroundingSegments}${noteBlock}${presetBlock}

Submit the enrichment via the tool. Required fields are the basic columns
(headword, sense, surface_form, translation, definition, target_example,
native_example) — refine them if your deeper analysis improves on the
shallow basic-data pass. Optional fields go inside \`extras\`; include
whichever are genuinely useful for this chunk.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 4000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
    }),
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Anthropic response did not contain a tool_use block')
  }
  const raw = toolUse.input as Record<string, unknown>
  const extras = raw.extras && typeof raw.extras === 'object' ? (raw.extras as Record<string, unknown>) : {}
  return {
    headword: String(raw.headword ?? ''),
    sense: typeof raw.sense === 'string' ? raw.sense : '',
    surface_form: String(raw.surface_form ?? ''),
    translation: typeof raw.translation === 'string' ? raw.translation : '',
    definition: typeof raw.definition === 'string' ? raw.definition : '',
    target_example: typeof raw.target_example === 'string' ? raw.target_example : '',
    native_example: typeof raw.native_example === 'string' ? raw.native_example : '',
    extras,
  }
}
