import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_OPUS } from '../anthropic-client'
import { buildPracticeMethodologySystem } from '../methodology-prompt'

// Generation half of the accuracy-first exercise pipeline. Each call produces
// ONE exercise for one term; the adversarial verify pass (separate context,
// never sees this generator's output rationale) decides whether it ships.
// Blank offsets are computed server-side by substring search — the LLM echoes
// exact substrings (reliable) instead of character arithmetic (unreliable).

const TOOL_NAME = 'submit_exercise'

export type ExerciseTermInput = {
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
}

export type GeneratedMcCloze = {
  type: 'mc_cloze'
  payload: {
    sentence: string
    blankStart: number
    blankEnd: number
    answer: string
    options: string[]
    answerIndex: number
  }
}

export type GeneratedMcComprehension = {
  type: 'mc_comprehension'
  payload: {
    sentence: string
    prompt: string
    options: string[]
    answerIndex: number
  }
}

export type GeneratedProductionCloze = {
  type: 'production_cloze'
  payload: {
    sentence: string
    blankStart: number
    blankEnd: number
    answer: string
    acceptedForms: string[]
    hint: string | null
  }
}

export type GeneratedExercise = GeneratedMcCloze | GeneratedMcComprehension | GeneratedProductionCloze

export type GeneratableExerciseType = GeneratedExercise['type']

type GenerateExerciseArgs = {
  type: GeneratableExerciseType
  term: ExerciseTermInput
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  hideTranslationFields: boolean
  allowL1Notes: boolean
}

// In-place Fisher–Yates over a copy. Option order must not leak the answer
// position (the LLM tends to put the correct option first).
const shuffled = <T>(items: T[]): T[] => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

const buildClozeTool = (production: boolean): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: production
    ? 'Submit one production-cloze exercise: a sentence using the term, the exact surface form to blank out, and every acceptable answer form.'
    : 'Submit one multiple-choice cloze exercise: a sentence using the term, the exact surface form to blank out, and three distractors.',
  input_schema: {
    type: 'object',
    properties: {
      sentence: {
        type: 'string',
        description:
          'One natural sentence (10–25 words) in the target language containing the term, possibly inflected. Surrounding language stays at B1–B2 grammar. The context must make the term uniquely correct in its slot.',
      },
      surface_form: {
        type: 'string',
        description:
          'The exact substring of sentence that realizes the term (inflected as it appears, matching casing). The server locates the blank from this string — DO NOT output character offsets.',
      },
      ...(production
        ? {
            accepted_forms: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Every form that should be accepted as a correct typed answer for the blank: the surface form itself plus legitimate orthographic variants (e.g. optional diacritics, accepted alternative spellings). Do NOT include other inflections that would be grammatically wrong in this sentence.',
            },
          }
        : {
            distractors: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Exactly 3 distractors. Each must be the same part of speech AND carry the same inflection/agreement as the surface form (so grammar alone cannot eliminate it), but be semantically wrong in THIS sentence. No synonyms or near-synonyms of the term that would also be acceptable in the blank.',
            },
          }),
    },
    required: ['sentence', 'surface_form', production ? 'accepted_forms' : 'distractors'],
  },
})

const buildComprehensionTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description:
    'Submit one multiple-choice comprehension exercise: a sentence using the term, a question probing whether the reader understood the term in context, the correct option, and three distractors.',
  input_schema: {
    type: 'object',
    properties: {
      sentence: {
        type: 'string',
        description:
          'One natural sentence (10–25 words) in the target language containing the term, possibly inflected. Surrounding language stays at B1–B2 grammar.',
      },
      prompt: {
        type: 'string',
        description:
          'A short comprehension question about the sentence whose answer hinges on understanding the term (not on general knowledge or other words). Written in the language specified in the instructions.',
      },
      correct_option: {
        type: 'string',
        description: 'The single correct answer to the question. Short (a phrase, not a paragraph).',
      },
      distractors: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exactly 3 plausible but clearly wrong answers. None may be defensibly correct. Same length/register as the correct option so form does not give the answer away.',
      },
    },
    required: ['sentence', 'prompt', 'correct_option', 'distractors'],
  },
})

const describeTerm = (term: ExerciseTermInput, hideTranslationFields: boolean): string => {
  const lines = [`headword="${term.headword}" sense="${term.sense}"`]
  if (term.translation && !hideTranslationFields) lines.push(`translation="${term.translation}"`)
  if (term.definition) lines.push(`definition="${term.definition}"`)
  if (term.targetExample) lines.push(`target_example="${term.targetExample}"`)
  return lines.join('\n')
}

const buildUserMessage = (args: GenerateExerciseArgs): string => {
  const termBlock = describeTerm(args.term, args.hideTranslationFields)
  const promptLanguage = args.hideTranslationFields ? args.targetLanguage : args.nativeLanguage

  if (args.type === 'mc_cloze') {
    return `Create ONE multiple-choice cloze exercise in ${args.targetLanguage} for the term below.

Hard rules:
- Write one natural sentence (10–25 words) using the term in its stored sense. Inflect to fit. Surrounding language stays at B1–B2 grammar; no rare vocabulary outside the term.
- THE CORE CONSTRAINT: the sentence context must make the term uniquely correct in its slot. A learner who knows the term should be able to rule out every distractor on MEANING.
- Each of the 3 distractors must share the part of speech and the exact inflection/agreement of the surface form (gender, number, person, tense, case — whatever applies), so grammar alone cannot eliminate it. Each must be semantically wrong in THIS sentence.
- Never use a synonym or near-synonym of the term as a distractor — if a distractor would also be acceptable in the blank, the exercise is broken.
- surface_form is the EXACT substring of sentence realizing the term (matching casing/punctuation). The server computes the blank position from it.

Learner profile: CEFR ${args.cefrLevel}, target language ${args.targetLanguage}.

Term:

${termBlock}

Call ${TOOL_NAME}. Stop after the tool call.`
  }

  if (args.type === 'mc_comprehension') {
    return `Create ONE multiple-choice comprehension exercise in ${args.targetLanguage} for the term below.

Hard rules:
- Write one natural sentence (10–25 words) using the term in its stored sense. Inflect to fit. Surrounding language stays at B1–B2 grammar.
- The question must hinge on understanding the TERM in this sentence — a reader who knows every other word but not the term should not be able to answer.
- Write the question and all options in ${promptLanguage}.
- The 3 distractors must be plausible but clearly wrong; none may be defensibly correct. Match the correct option's length and register so form gives nothing away.

Learner profile: CEFR ${args.cefrLevel}, target language ${args.targetLanguage}.

Term:

${termBlock}

Call ${TOOL_NAME}. Stop after the tool call.`
  }

  return `Create ONE production-cloze exercise in ${args.targetLanguage} for the term below. The learner sees the sentence with the term blanked out (plus the term's meaning as a hint) and must TYPE the missing form.

Hard rules:
- Write one natural sentence (10–25 words) using the term in its stored sense. Inflect to fit. Surrounding language stays at B1–B2 grammar.
- The context must make the term the natural, uniquely correct filler — given the hint, a learner who knows the term can produce exactly the blanked form.
- Prefer a sentence where the required inflection is unambiguous (clear subject/tense/agreement cues).
- surface_form is the EXACT substring of sentence realizing the term (matching casing/punctuation). The server computes the blank position from it.
- accepted_forms lists every string acceptable as a typed answer: the surface form plus legitimate orthographic variants only. Do NOT include inflections that would be wrong in this sentence.

Learner profile: CEFR ${args.cefrLevel}, target language ${args.targetLanguage}.

Term:

${termBlock}

Call ${TOOL_NAME}. Stop after the tool call.`
}

const locateBlank = (sentence: string, surfaceForm: string): { blankStart: number; blankEnd: number } => {
  if (!surfaceForm) throw new Error('Exercise generation returned an empty surface_form')
  const blankStart = sentence.indexOf(surfaceForm)
  if (blankStart < 0) {
    throw new Error(`Exercise generation surface_form is not a substring of sentence: "${surfaceForm}"`)
  }
  return { blankStart, blankEnd: blankStart + surfaceForm.length }
}

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)).filter((v) => v.length > 0) : []

export const generateExercisePass = async (args: GenerateExerciseArgs): Promise<GeneratedExercise> => {
  const tool =
    args.type === 'mc_comprehension' ? buildComprehensionTool() : buildClozeTool(args.type === 'production_cloze')

  const stream = getAnthropicClient().messages.stream({
    model: MODEL_OPUS,
    max_tokens: 2000,
    system: buildPracticeMethodologySystem({
      nativeLanguage: args.nativeLanguage,
      targetLanguage: args.targetLanguage,
      cefrLevel: args.cefrLevel,
      hideTranslationFields: args.hideTranslationFields,
      allowL1Notes: args.allowL1Notes,
    }),
    tools: [tool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserMessage(args) }],
  })
  const response = await stream.finalMessage()

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Exercise generation did not produce a tool_use block${reason}`)
  }
  const input = toolUse.input as Record<string, unknown>
  const sentence = typeof input.sentence === 'string' ? input.sentence : ''
  if (!sentence) throw new Error('Exercise generation returned an empty sentence')

  if (args.type === 'mc_cloze') {
    const surfaceForm = String(input.surface_form ?? '')
    const distractors = readStringArray(input.distractors)
    if (distractors.length !== 3) {
      throw new Error(`Exercise generation returned ${distractors.length} distractors (expected 3)`)
    }
    const { blankStart, blankEnd } = locateBlank(sentence, surfaceForm)
    const options = shuffled([surfaceForm, ...distractors])
    return {
      type: 'mc_cloze',
      payload: {
        sentence,
        blankStart,
        blankEnd,
        answer: surfaceForm,
        options,
        answerIndex: options.indexOf(surfaceForm),
      },
    }
  }

  if (args.type === 'mc_comprehension') {
    const prompt = String(input.prompt ?? '')
    const correctOption = String(input.correct_option ?? '')
    const distractors = readStringArray(input.distractors)
    if (!prompt || !correctOption) throw new Error('Exercise generation returned an empty prompt/correct_option')
    if (distractors.length !== 3) {
      throw new Error(`Exercise generation returned ${distractors.length} distractors (expected 3)`)
    }
    const options = shuffled([correctOption, ...distractors])
    return {
      type: 'mc_comprehension',
      payload: {
        sentence,
        prompt,
        options,
        answerIndex: options.indexOf(correctOption),
      },
    }
  }

  const surfaceForm = String(input.surface_form ?? '')
  const acceptedForms = readStringArray(input.accepted_forms)
  const { blankStart, blankEnd } = locateBlank(sentence, surfaceForm)
  const hint = args.hideTranslationFields
    ? (args.term.definition ?? args.term.sense ?? null)
    : (args.term.translation ?? args.term.definition ?? args.term.sense ?? null)
  return {
    type: 'production_cloze',
    payload: {
      sentence,
      blankStart,
      blankEnd,
      answer: surfaceForm,
      acceptedForms: Array.from(new Set([surfaceForm, ...acceptedForms])),
      hint,
    },
  }
}
