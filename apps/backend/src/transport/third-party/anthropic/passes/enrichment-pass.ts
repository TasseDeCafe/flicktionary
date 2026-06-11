import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildMethodologySystem } from '../methodology-prompt'
import type { EnglishIpaDialect } from '../language-instructions'

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
  englishIpaDialect?: EnglishIpaDialect
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
          'Enrichment fields, in two tiers. ALWAYS include for every chunk: `frequency`, `frequency_detail`, `more_frequent_synonym` (explicit null when none is needed), `more_examples`, `regionalism` (explicit verdict even when not regional), `register`, `register_alternatives` (explicit negatives when no alternative exists), `collocations`. Include when genuinely useful, omit otherwise: `etymology` (see its description), `l1_notes`, `notes`, `context_segment` (string with the chunk wrapped in **double asterisks**). Never skip an always-include key just because the answer is "nothing notable" — say so explicitly instead. Pronunciation does NOT live here — it goes in `grammar.ipa`.',
        properties: {
          frequency: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Coarse frequency band. Always include.',
          },
          frequency_detail: {
            type: 'string',
            description:
              "One short line of real frequency information, starting from the band: core-vocabulary status, speech vs writing skew, domain restrictions. E.g. 'Very high — core vocabulary, equally common in speech and writing.' or 'Low — mostly academic prose; sounds stiff in conversation.' Always include.",
          },
          more_frequent_synonym: {
            type: ['string', 'null'],
            description:
              'REQUIRED when frequency is medium or low: a more frequent near-synonym the learner could reach for instead. Explicit null when the chunk is already the high-frequency default.',
          },
          more_examples: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Exactly 2 additional self-contained example sentences in the same context and register as target_example (3 examples total). Complete and grammatical, not fragments. Always include.',
          },
          regionalism: {
            type: 'string',
            description:
              "Always include an explicit verdict. 'No — universal' when the chunk is used across all major varieties; otherwise name the region and give the neutral/other-variety equivalent (e.g. 'Chiefly British — Americans say X').",
          },
          register: {
            type: 'string',
            description:
              "Always include. How formal the chunk is and where it lives, e.g. 'neutral', 'informal — common in speech, rare in writing', 'formal — mostly written'.",
          },
          register_alternatives: {
            type: 'object',
            description:
              'Always include BOTH keys. Each value is either a synonym at that register (e.g. more_formal: "cord, twine") or an explicit negative (e.g. less_formal: "none — already the everyday word"). Never omit a key or use null.',
            properties: {
              more_formal: { type: 'string' },
              less_formal: { type: 'string' },
            },
            required: ['more_formal', 'less_formal'],
          },
          collocations: {
            type: 'array',
            items: { type: 'string' },
            description:
              'For single words AND for phrasal verbs / short multi-word units: 3-5 high-frequency collocations showing the chunk in its natural environments, most frequent first. Always include.',
          },
          etymology: {
            type: 'string',
            description:
              'Concise etymology for content words; for idioms and fixed expressions, the origin of the image. Include for every chunk where a real, documented origin exists. For grammar/function words, discourse markers, proper names, or unusual selections with no meaningful origin story, omit the key entirely — never invent or pad.',
          },
          l1_notes: {
            type: ['string', 'null'],
            description: args.allowL1Notes
              ? "Optional contrastive note tied to the learner's native language."
              : 'Set to null. L1 notes are disabled when there is no distinct native language.',
          },
          notes: { type: ['string', 'null'] },
          context_segment: { type: 'string' },
        },
        required: [
          'frequency',
          'frequency_detail',
          'more_frequent_synonym',
          'more_examples',
          'regionalism',
          'register',
          'register_alternatives',
          'collocations',
        ],
      },
      grammar: {
        type: 'object',
        description:
          "Typed morphology / grammar facts for this chunk. Same shape as the basic-data pass's grammar object — refine or add keys based on deeper analysis with the surrounding context. Include keys only when useful for THIS chunk in THIS target language — EXCEPT `ipa`, which you include for every chunk. Recognized keys: `pos` (one of noun/verb/adjective/adverb/preposition/pronoun/particle/conjunction/numeral/phrase/idiom/other), `display_form` (canonical-but-decorated form for UI display, e.g. stress-marked Russian `ви́деть`), `gender` (m/f/n/c — only when ambiguous or surprising), `number_only` (plurale_tantum/singulare_tantum), `is_indeclinable` (boolean), `animacy` (animate/inanimate), `aspect` (impf/perf/biaspectual — Slavic verbs), `aspect_pair_headword` (string), `is_reflexive` (boolean), `government` (case/preposition pattern), `notable_forms` (array of {label, form}, max 3), `ipa` (transcription bag, see its description), `notes` (free-form). Per-language guidance is in the system prompt.",
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
          ipa: {
            type: 'object',
            description:
              "IPA transcription of the HEADWORD (citation form). Include for every chunk. For English targets fill ONLY the dialect bucket the system prompt specifies (`ga` for General American, `rp` for Received Pronunciation); for every other language fill ONLY `untagged`. Write it the way a dictionary does, with the enclosing delimiters as part of the string: slashes for a phonemic transcription (preferred, e.g. '/səˈliːn/'), square brackets only when giving a narrow phonetic one (e.g. '[sɐzˈdanʲɪje]'). Mark stress. If you are not confident of the transcription, omit the whole `ipa` object rather than guessing.",
            properties: {
              ga: { type: 'string' },
              rp: { type: 'string' },
              untagged: { type: 'string' },
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
  englishIpaDialect,
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
shallow basic-data pass. \`extras\` holds the exploration: fill every
always-include key (with an explicit verdict or negative when the answer is
"nothing notable" — absence must never be ambiguous), and add the
when-relevant keys only when they genuinely earn their place. Use \`grammar\`
for typed morphology / grammar facts (pos, gender, aspect, government,
etc.) — see the per-target-language guidance in the system prompt for which
keys to fill. Always include \`grammar.ipa\` (the headword's transcription,
dialect rules in its schema description); the other grammar keys only when
they apply.`

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
      englishIpaDialect,
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
