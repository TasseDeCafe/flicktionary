import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { getLanguageInstructions, type TargetIpaDialect } from '../language-instructions'

// Generate-and-confirm: when a learner adds a
// specific inflected form as its own study target, the form facet is born
// `pending_data` carrying only the surface string (a `cards` row stores nothing
// else). This focused pass fills the form's FULL card content — its correct
// written shape, a translation of THAT inflected form, a target-language
// definition, an example, the part of speech, and the form's own IPA. It
// deliberately runs the *better* model (Opus, never the Haiku fast-gloss): a
// wrong per-form gloss drilled as truth is worse than none.
//
// The IPA is of THIS inflected form (a lemma's transcription is wrong for an
// inflection) and may come back null — the model is told to skip it rather
// than guess, and the pronunciation facet's readiness gate handles absence
// (stays pending_data).
//
// Source-seeding: when the learner met the form in a real sentence we feed
// that sentence in and ask Opus to use it verbatim as `targetExample` and
// translate it for `nativeExample`, rather than inventing an example.

const TOOL_NAME = 'submit_form_data'

// Part-of-speech values the form payload's grammar bag accepts (GrammarPosSchema
// in api-client). Kept in sync by hand — a wrong value is dropped to null below.
const POS_VALUES = [
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
] as const
type Pos = (typeof POS_VALUES)[number]

export type FormDataOutput = {
  // The form in its correct written shape (case + Russian combining-acute stress
  // preserved for the stressed-display path; the facet key is normalized
  // separately, payload keeps the full display form).
  form: string
  // Stress-marked / decorated display form of THIS inflected form, matching the
  // lemma's grammar.display_form convention (Russian: U+0301 on the stressed
  // vowel). Null for languages that don't use one (e.g. English) or per the
  // per-language rules. Mirrors `form` for stress languages.
  displayForm: string | null
  // Translation of the inflected form as it grammatically functions.
  translation: string
  // Short target-language paraphrase of this form's meaning (optional).
  definition: string | null
  // An example sentence using THIS form — the encountered sentence verbatim when
  // one was provided, else a natural invented one.
  targetExample: string | null
  // Native-language translation of targetExample.
  nativeExample: string | null
  // Part of speech of the headword/form (null when unknown / not emitted).
  pos: Pos | null
  // IPA of THIS inflected form (dialect-aware for English), with the dictionary
  // delimiters in the string. Null when the model wasn't confident.
  ipa: string | null
}

type GenerateFormDataArgs = {
  nativeLanguage: string
  targetLanguage: string
  headword: string
  headwordTranslation: string | null
  surfaceForm: string
  // The real sentence the learner met this form in, when known. When present,
  // Opus reuses it as targetExample and translates it instead of inventing one.
  encounteredSentence: string | null
  // English IPA dialect preference — steers which variety the `ipa` field
  // transcribes for English targets. Undefined for other languages.
  ipaDialect?: TargetIpaDialect
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Submit the full study data for one inflected form of a known headword.',
  input_schema: {
    type: 'object',
    properties: {
      form: {
        type: 'string',
        description:
          'The inflected form itself in its correct conventional spelling and case. For languages that mark stress with a combining acute (Russian), put the stress mark on the stressed vowel (e.g. "стола́"). Otherwise reproduce the form as it is normally written.',
      },
      display_form: {
        type: 'string',
        description:
          'Stress-marked / decorated display form of THIS inflected form for UI display, following the per-language grammar conventions in the system prompt (Russian: combining acute U+0301 on the stressed vowel, e.g. "кре́сла"; usually equals `form`). OMIT for languages that do not use a separate display form (e.g. English) or per the per-language rules (monosyllables, words containing ё).',
      },
      translation: {
        type: 'string',
        description:
          'A concise translation of THIS inflected form as it grammatically functions — carry over its person, tense, number, gender, and case. Do NOT translate the citation/headword form. Examples: headword "посмотреть" + form "посмотрим" → "let\'s have a look"; headword "стол" + form "стола" → "of the table"; headword "house" + form "houses" → "houses".',
      },
      definition: {
        type: 'string',
        description:
          'A short paraphrase of the meaning in the TARGET language (the language being learned), 1 sentence. Omit if you have nothing accurate to add beyond the translation.',
      },
      target_example: {
        type: 'string',
        description:
          'One short, natural, self-contained example sentence in the target language that uses THIS exact inflected form and makes its meaning clear on its own. Write a fresh sentence — do NOT copy the "Encountered sentence" if one was provided; use it only to understand the form\'s sense and register.',
      },
      native_example: {
        type: 'string',
        description: 'A natural translation of target_example into the native language.',
      },
      pos: {
        type: 'string',
        enum: [...POS_VALUES],
        description: 'The part of speech of the headword/form.',
      },
      ipa: {
        type: 'string',
        description:
          "IPA transcription of THIS exact inflected form — never the citation form's (a lemma transcription is wrong for an inflection: stress can move, endings change). For English, transcribe the dialect named in the system prompt. Write it the way a dictionary does, with the enclosing delimiters as part of the string: slashes for a phonemic transcription (preferred, e.g. '/ˈhaʊzɪz/'), square brackets only for a narrow phonetic one (e.g. '[stɐˈla]'). Mark stress. OMIT this field entirely if you are not fully confident of the transcription — a wrong transcription drilled as truth is worse than none.",
      },
    },
    required: ['form', 'translation'],
  },
})

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null)

export const generateFormData = async (args: GenerateFormDataArgs): Promise<FormDataOutput> => {
  // The per-language instructions block carries the display_form rules (Russian:
  // stress-marked; English: leave unset) + IPA dialect, so the form's grammar
  // matches the lemma's basic-data pass instead of the model guessing.
  const languageInstructions = getLanguageInstructions(args.targetLanguage, {
    ipaDialect: args.ipaDialect,
  })
  const system = `You are a meticulous ${args.targetLanguage} lexicographer preparing a single flashcard for a learner whose native language is ${args.nativeLanguage}. You are given a headword (citation form) and one inflected surface form of it the learner met while reading. Return the form's correct written shape, its stress-marked display form where the language uses one, a short accurate translation of that exact inflected form (never of the citation form, carry over its person/tense/number/gender/case), an optional short target-language definition, one example sentence using this exact form, its native-language translation, the part of speech, and the inflected form's own IPA (skip the IPA when not fully confident — never guess a transcription).${
    languageInstructions ? `\n\n${languageInstructions}` : ''
  }\n\nOutput only the tool call, no commentary.`

  const userMessage = `Headword (citation form): ${args.headword}${
    args.headwordTranslation ? ` — ${args.headwordTranslation}` : ''
  }
Encountered inflected form: ${args.surfaceForm}
${args.encounteredSentence ? `Encountered sentence (context for the form's sense and register — do NOT copy it; write a fresh, short standalone target_example): ${args.encounteredSentence}\n` : ''}Target language: ${args.targetLanguage}
Native language: ${args.nativeLanguage}

Submit the form's data via the tool.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 800,
    system,
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })
  logAnthropicCacheUsage('generate-form-data', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Anthropic response did not contain a tool_use block')
  }
  const raw = toolUse.input as Record<string, unknown>
  // Fall back to the encountered surface form if the model returned nothing
  // usable for `form` — better the raw form than an empty front.
  const form = typeof raw.form === 'string' && raw.form.trim().length > 0 ? raw.form : args.surfaceForm
  const translation = typeof raw.translation === 'string' ? raw.translation : ''
  // Opus writes a fresh, short standalone sentence using the exact form; the
  // encountered sentence is passed only as context (raw segments can be whole
  // paragraphs, so copying them verbatim makes a poor example). Fall back to the
  // encountered sentence only if the model returned nothing usable.
  const targetExample = asString(raw.target_example) ?? args.encounteredSentence ?? null
  const rawPos = typeof raw.pos === 'string' ? raw.pos : null
  const pos = rawPos && (POS_VALUES as readonly string[]).includes(rawPos) ? (rawPos as Pos) : null
  return {
    form,
    displayForm: asString(raw.display_form),
    translation,
    definition: asString(raw.definition),
    targetExample,
    nativeExample: asString(raw.native_example),
    pos,
    ipa: asString(raw.ipa),
  }
}
