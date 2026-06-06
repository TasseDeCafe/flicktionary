import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'

const TOOL_NAME = 'submit_enrichment'

// Output of the enrichment pass.
//
// Required fields are the basic columns (the model may refine them based on
// deeper analysis with the surrounding context). Optional fields are bundled
// into `extras` (persisted into user_lookups.exploration_extras) and `grammar`
// (persisted into user_lookups.grammar — typed morphology / grammar facts).
export type EnrichmentOutput = {
  headword: string
  sense: string
  surface_form: string
  translation: string
  // Translation of the inflected surface form as it reads in the source line
  // (empty when the surface form is already the citation form).
  surface_translation: string
  definition: string
  target_example: string
  native_example: string
  extras: Record<string, unknown>
  grammar: Record<string, unknown>
}

type EnrichmentPassArgs = {
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  movieContextBlob: string
  surfaceForm: string
  surroundingSegments: string
  hideTranslationFields?: boolean
  allowL1Notes?: boolean
}

const buildTool = (args: { hideTranslationFields: boolean; allowL1Notes: boolean }): Anthropic.Tool => ({
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
        description: args.hideTranslationFields
          ? 'Set to an empty string. Translation fields are disabled for this target language.'
          : "Translation of the HEADWORD (citation form) into the learner's native language — NOT a translation of the inflected surface form or of how the selection reads in the sentence. Mirror the headword's dictionary form: singular for a noun headword ('investment', not 'investments'), infinitive for a verb headword ('to pick at', not 'they pick at' or 'it made me sick'). Carry over no person, tense, number, or case from the source line.",
      },
      surface_translation: {
        type: 'string',
        description: args.hideTranslationFields
          ? 'Set to an empty string. Translation fields are disabled for this target language.'
          : "Counterpart to `translation` for the inflected form: translate surface_form exactly as it reads in the source line, into the learner's native language (e.g. headword 'посмотреть' with surface_form 'посмотрим' → 'let's see'). Unlike `translation`, this one DOES carry the person, tense, number, and case of the surface form. Empty string when surface_form is already the citation form (identical to the headword).",
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
        description: args.hideTranslationFields
          ? 'Set to an empty string. Native example fields are disabled for this target language.'
          : "A natural translation of `target_example` into the learner's native language.",
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
          l1_notes: {
            type: ['string', 'null'],
            description: args.allowL1Notes
              ? "Optional contrastive note tied to the learner's native language."
              : 'Set to null. L1 notes are disabled when there is no distinct native language.',
          },
          notes: { type: ['string', 'null'] },
          context_segment: { type: 'string' },
        },
      },
      grammar: {
        type: 'object',
        description:
          "Optional typed morphology / grammar facts for this chunk. Same shape as the basic-data pass's grammar object — refine or add keys based on deeper analysis with the surrounding context. Include keys only when useful for THIS chunk in THIS target language; omit the whole object when nothing applies. Recognized keys: `pos` (one of noun/verb/adjective/adverb/preposition/pronoun/particle/conjunction/numeral/phrase/idiom/other), `display_form` (canonical-but-decorated form for UI display, e.g. stress-marked Russian `ви́деть`), `gender` (m/f/n/c — only when ambiguous or surprising), `number_only` (plurale_tantum/singulare_tantum), `is_indeclinable` (boolean), `animacy` (animate/inanimate), `aspect` (impf/perf/biaspectual — Slavic verbs), `aspect_pair_headword` (string), `is_reflexive` (boolean), `government` (case/preposition pattern), `notable_forms` (array of {label, form}, max 3), `notes` (free-form). Per-language guidance is in the system prompt.",
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
    },
    required: [
      'headword',
      'sense',
      'surface_form',
      'translation',
      'surface_translation',
      'definition',
      'target_example',
      'native_example',
      'extras',
    ],
  },
})

export const enrichmentPass = async ({
  nativeLanguage,
  targetLanguage,
  cefrLevel,
  movieContextBlob,
  surfaceForm,
  surroundingSegments,
  hideTranslationFields = false,
  allowL1Notes = nativeLanguage.trim().toLowerCase() !== targetLanguage.trim().toLowerCase(),
}: EnrichmentPassArgs): Promise<EnrichmentOutput> => {
  const translationModeBlock = hideTranslationFields
    ? `\nTranslation fields are disabled for this target language. Set translation="", surface_translation="" and native_example="". Keep definition, target_example, and general explanations in ${targetLanguage}.`
    : ''
  const l1NotesBlock = allowL1Notes
    ? `\nYou may include extras.l1_notes for contrastive traps involving the learner's native language.`
    : `\nDo not include extras.l1_notes.`

  const userMessage = `Enrich this chunk: "${surfaceForm}"

Surrounding segments:
${surroundingSegments}${translationModeBlock}${l1NotesBlock}

Submit the enrichment via the tool. Required fields are the basic columns
(headword, sense, surface_form, translation, surface_translation, definition,
target_example, native_example) — refine them if your deeper analysis improves on the
shallow basic-data pass. Optional fields go inside \`extras\`; include
whichever are genuinely useful for this chunk. Use \`grammar\` for typed
morphology / grammar facts (pos, gender, aspect, government, etc.) — see
the per-target-language guidance in the system prompt for which keys to
fill. Skip the \`grammar\` object entirely when nothing applies.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 4000,
    system: buildMethodologySystem({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      movieContextBlob,
      hideTranslationFields,
      allowL1Notes,
    }),
    tools: [buildTool({ hideTranslationFields, allowL1Notes })],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Anthropic response did not contain a tool_use block')
  }
  const raw = toolUse.input as Record<string, unknown>
  const extras = raw.extras && typeof raw.extras === 'object' ? (raw.extras as Record<string, unknown>) : {}
  const grammar =
    raw.grammar && typeof raw.grammar === 'object' && !Array.isArray(raw.grammar)
      ? (raw.grammar as Record<string, unknown>)
      : {}
  return {
    headword: String(raw.headword ?? ''),
    sense: typeof raw.sense === 'string' ? raw.sense : '',
    surface_form: String(raw.surface_form ?? ''),
    translation: typeof raw.translation === 'string' ? raw.translation : '',
    surface_translation: typeof raw.surface_translation === 'string' ? raw.surface_translation : '',
    definition: typeof raw.definition === 'string' ? raw.definition : '',
    target_example: typeof raw.target_example === 'string' ? raw.target_example : '',
    native_example: typeof raw.native_example === 'string' ? raw.native_example : '',
    extras,
    grammar,
  }
}
