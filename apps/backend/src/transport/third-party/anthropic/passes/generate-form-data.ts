import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'

// Generate-and-confirm (Phase 4b): when a learner adds a specific inflected form
// as its own study target, the form facet is born `pending_data` carrying only
// the surface string (a `cards` row stores nothing else). This focused pass
// fills the render data — the form's correct written shape + a translation of
// THAT inflected form. It deliberately runs the *better* model (Opus, never the
// Haiku fast-gloss): a wrong per-form gloss drilled as truth is worse than none.
//
// Scope is meaning only. Pronunciation/stress for an arbitrary form is where
// LLMs hallucinate (wrong Russian stress is worse than no card), so per-form
// pronunciation stays confirm-gated/roadmap — this pass never produces IPA.

const TOOL_NAME = 'submit_form_data'

export type FormDataOutput = {
  // The form in its correct written shape (case + Russian combining-acute stress
  // preserved for the stressed-display path; the facet key is normalized
  // separately, payload keeps the full display form).
  form: string
  // Translation of the inflected form as it grammatically functions.
  translation: string
}

type GenerateFormDataArgs = {
  nativeLanguage: string
  targetLanguage: string
  headword: string
  headwordTranslation: string | null
  surfaceForm: string
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Submit the study data for one inflected form of a known headword.',
  input_schema: {
    type: 'object',
    properties: {
      form: {
        type: 'string',
        description:
          'The inflected form itself in its correct conventional spelling and case. For languages that mark stress with a combining acute (Russian), put the stress mark on the stressed vowel (e.g. "стола́"). Otherwise reproduce the form as it is normally written.',
      },
      translation: {
        type: 'string',
        description:
          'A concise translation of THIS inflected form as it grammatically functions — carry over its person, tense, number, gender, and case. Do NOT translate the citation/headword form. Examples: headword "посмотреть" + form "посмотрим" → "let\'s have a look"; headword "стол" + form "стола" → "of the table"; headword "house" + form "houses" → "houses".',
      },
    },
    required: ['form', 'translation'],
  },
})

export const generateFormData = async (args: GenerateFormDataArgs): Promise<FormDataOutput> => {
  const system = `You are a meticulous ${args.targetLanguage} lexicographer preparing a single flashcard for a learner whose native language is ${args.nativeLanguage}. You are given a headword (citation form) and one inflected surface form of it the learner met while reading. Return the form's correct written shape and a short, accurate translation of that exact inflected form — never of the citation form. Translate the form as it grammatically functions (its person, tense, number, gender, case). Output only the tool call, no commentary.`

  const userMessage = `Headword (citation form): ${args.headword}${
    args.headwordTranslation ? ` — ${args.headwordTranslation}` : ''
  }
Encountered inflected form: ${args.surfaceForm}
Target language: ${args.targetLanguage}
Native language: ${args.nativeLanguage}

Submit the form's data via the tool.`

  const response = await getAnthropicClient().messages.create({
    model: MODEL_OPUS,
    max_tokens: 400,
    system,
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Anthropic response did not contain a tool_use block')
  }
  const raw = toolUse.input as Record<string, unknown>
  // Fall back to the encountered surface form if the model returned nothing
  // usable for `form` — better the raw form than an empty front.
  const form = typeof raw.form === 'string' && raw.form.trim().length > 0 ? raw.form : args.surfaceForm
  const translation = typeof raw.translation === 'string' ? raw.translation : ''
  return { form, translation }
}
