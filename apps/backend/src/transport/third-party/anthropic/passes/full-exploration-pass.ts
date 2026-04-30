import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_full_exploration'

export type FullExploration = {
  headword: string
  surface_form: string
  sense: string
  context_segment: string
  definition: string
  examples: string[]
  context_example: {
    target: string
    native: string
  }
  ipa: string
  frequency: 'high' | 'medium' | 'low'
  more_frequent_synonym: string | null
  regionalism: string | null
  register: string
  register_alternatives: {
    more_formal: string | null
    less_formal: string | null
  }
  collocations: string[]
  etymology: string
  l1_notes: string | null
  notes: string | null
  translation: string
}

type FullExplorationPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  l1InterferenceNotes: string
  surfaceForm: string
  surroundingSegments: string
  userNote?: string | null
  presetTags?: string[]
}

const tool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Submit a full exploration of a single chunk for the learner.',
  input_schema: {
    type: 'object',
    properties: {
      headword: {
        type: 'string',
        description:
          "Normalized citation form. May differ from surface_form (e.g. 'run out of' for surface 'ran out of').",
      },
      surface_form: { type: 'string' },
      sense: {
        type: 'string',
        description:
          "Short sense tag (1-5 words). A disambiguator, NOT a definition — the definition lives in the `definition` field, do not duplicate it here. Just enough to tell apart different meanings of the same headword. Polysemous example for 'correr': 'race', 'flow (liquid)', 'spread (news)'. Monosemous example for 'desfibrilador': 'medical device'. Idiom example for 'estar a punto de': 'about to'. Never a full sentence. Never longer than 5 words.",
      },
      context_segment: {
        type: 'string',
        description: 'The full segment text with the chunk wrapped in **double asterisks**.',
      },
      definition: { type: 'string', description: 'Contextual, not dictionary-generic.' },
      examples: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
      context_example: {
        type: 'object',
        description:
          "A self-contained example sentence inspired by — but not equal to — the source line, demonstrating the chunk in its natural setting. Use the movie's register and topic if helpful, but make it a complete, grammatical, easy-to-read sentence on its own (not a fragment).",
        properties: {
          target: {
            type: 'string',
            description: 'The example sentence in the target language.',
          },
          native: {
            type: 'string',
            description: 'A natural translation of the example sentence into the learner native language.',
          },
        },
        required: ['target', 'native'],
      },
      ipa: { type: 'string' },
      frequency: { type: 'string', enum: ['high', 'medium', 'low'] },
      more_frequent_synonym: { type: ['string', 'null'] },
      regionalism: { type: ['string', 'null'] },
      register: {
        type: 'string',
        description: 'informal | neutral | formal | literary | slang | etc.',
      },
      register_alternatives: {
        type: 'object',
        properties: {
          more_formal: { type: ['string', 'null'] },
          less_formal: { type: ['string', 'null'] },
        },
        required: ['more_formal', 'less_formal'],
      },
      collocations: { type: 'array', items: { type: 'string' } },
      etymology: { type: 'string', description: 'Brief origin or idiom story.' },
      l1_notes: {
        type: ['string', 'null'],
        description: "False-friend / interference flags for this user's L1, or null if none apply.",
      },
      notes: {
        type: ['string', 'null'],
        description: 'Anything else needed to master usage, or null.',
      },
      translation: { type: 'string', description: 'Translation into the learner native language.' },
    },
    required: [
      'headword',
      'surface_form',
      'sense',
      'context_segment',
      'definition',
      'examples',
      'context_example',
      'ipa',
      'frequency',
      'more_frequent_synonym',
      'regionalism',
      'register',
      'register_alternatives',
      'collocations',
      'etymology',
      'l1_notes',
      'notes',
      'translation',
    ],
  },
}

export const fullExplorationPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  l1InterferenceNotes,
  surfaceForm,
  surroundingSegments,
  userNote,
  presetTags,
}: FullExplorationPassArgs): Promise<FullExploration> => {
  const presetBlock = presetTags && presetTags.length ? `\nPreset emphasis: ${presetTags.join(', ')}` : ''
  const noteBlock = userNote ? `\nLearner note: ${userNote}` : ''

  const userMessage = `Explore this chunk: "${surfaceForm}"

Surrounding segments:
${surroundingSegments}${noteBlock}${presetBlock}

Submit the full exploration via the tool.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 4000,
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
  return toolUse.input as FullExploration
}
