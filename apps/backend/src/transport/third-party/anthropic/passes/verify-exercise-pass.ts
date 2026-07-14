import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_EXERCISE_VERIFY, THINKING_DISABLED } from '../anthropic-client'
import { logAnthropicCacheUsage } from '../log-cache-usage'
import { buildPracticeMethodologySystem } from '../methodology-prompt'
import type { GeneratedExercise } from './generate-exercise-pass'

// Adversarial verifier — the second half of the accuracy-first pipeline. Runs
// in an INDEPENDENT context (never sees the generator's conversation), tries
// to break the exercise, and fails it on any plain-reading ambiguity — the bar
// is a defect a real learner would hit, not a contrived reading (an over-eager
// verifier terminally fails the whole term, so calibration matters both ways).
// The bank service regenerates on failure; cost is explicitly not a constraint
// here.

const TOOL_NAME = 'submit_verdict'

export type VerifyExerciseResult = {
  pass: boolean
  reasons: string[]
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: 'Submit the verification verdict for the exercise.',
  input_schema: {
    type: 'object',
    properties: {
      pass: {
        type: 'boolean',
        description:
          'true only if the exercise survives every check. Judge by plain, natural readings — fail on genuine defects, not contrived ones.',
      },
      reasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'One short reason per failed check (empty when pass=true).',
      },
    },
    required: ['pass', 'reasons'],
  },
})

const renderBlanked = (sentence: string, blankStart: number, blankEnd: number): string =>
  `${sentence.slice(0, blankStart)}_____${sentence.slice(blankEnd)}`

const buildUserMessage = (exercise: GeneratedExercise, targetLanguage: string): string => {
  if (exercise.type === 'mc_cloze') {
    const { sentence, blankStart, blankEnd, answer, options } = exercise.payload
    const distractors = options.filter((o) => o !== answer)
    return `You are verifying a multiple-choice cloze exercise in ${targetLanguage} written by another model. Your job is to BREAK it if you can — but only with defects a real learner would hit, judged on plain, natural readings.

Sentence with blank: ${renderBlanked(sentence, blankStart, blankEnd)}
Intended answer: "${answer}"
Distractors: ${distractors.map((d) => `"${d}"`).join(', ')}

Checks — fail the exercise if ANY fails:
1. For EACH distractor, mentally substitute it into the blank. If the result is grammatically valid AND semantically acceptable on its PLAIN reading (an ordinary sentence a native speaker would produce unprompted), the exercise is NOT uniquely correct → FAIL, naming the distractor. A defense that needs irony, sarcasm, an invented back-story, unusual context, or "with some imagination" does NOT count — if you catch yourself constructing a scenario to make the distractor work, it is eliminable and the check passes.
2. Each distractor must match the answer's part of speech and inflection/agreement; if grammar alone eliminates one, FAIL (the exercise tests grammar, not the term).
3. The full sentence (with the answer in place) must be natural, idiomatic ${targetLanguage} — no calques, no agreement errors.

Be adversarial: argue FOR each distractor before rejecting it, but verdict on the plain reading. Fail on genuine ambiguity, not on contrived readings.

Call ${TOOL_NAME}. Stop after the tool call.`
  }

  if (exercise.type === 'mc_comprehension') {
    const { sentence, prompt, options } = exercise.payload
    const answer = options[exercise.payload.answerIndex]
    const distractors = options.filter((_, i) => i !== exercise.payload.answerIndex)
    return `You are verifying a multiple-choice comprehension exercise in ${targetLanguage} written by another model. Your job is to BREAK it if you can — but only with defects a real learner would hit, judged on plain, natural readings.

Sentence: ${sentence}
Question: ${prompt}
Intended answer: "${answer}"
Distractors: ${distractors.map((d) => `"${d}"`).join(', ')}

Checks — fail the exercise if ANY fails:
1. For EACH distractor: is it correct as an answer to the question on a plain reading of the sentence? If yes → FAIL, naming the distractor. A defense that needs irony, an invented back-story, or unusual context does NOT count — if you must construct a scenario for the distractor to work, it is eliminable and the check passes.
2. The intended answer must be clearly and uniquely correct from the sentence alone (no outside knowledge required).
3. The sentence must be natural, idiomatic ${targetLanguage} — no calques, no agreement errors.
4. The question must be answerable only by understanding the sentence (not trivially answerable from option form/length alone).

Be adversarial: argue FOR each distractor before rejecting it, but verdict on the plain reading. Fail on genuine ambiguity, not on contrived readings.

Call ${TOOL_NAME}. Stop after the tool call.`
  }

  const { sentence, blankStart, blankEnd, answer, acceptedForms, hint } = exercise.payload
  return `You are verifying a production-cloze exercise in ${targetLanguage} written by another model. The learner sees the blanked sentence plus the hint and must TYPE the missing form. Your job is to BREAK the exercise if you can — but only with defects a real learner would hit, not theoretical ones.

Sentence with blank: ${renderBlanked(sentence, blankStart, blankEnd)}
Expected answer: "${answer}"
Accepted forms: ${acceptedForms.map((f) => `"${f}"`).join(', ')}
Hint shown to the learner: ${hint ? `"${hint}"` : '(none)'}

Checks — fail the exercise if ANY fails:
1. The full sentence (with the answer in place) must be natural, idiomatic ${targetLanguage} — correct agreement, no calques.
2. Given the blanked sentence and the hint, the expected answer (in exactly this inflection) must be recoverable by a learner who knows the term. If the sentence's cues leave the required inflection ambiguous (multiple inflections of the term would be grammatical), FAIL.
3. Every accepted form must be a legitimate spelling/variant of the SAME inflected form — none may be grammatically wrong in this sentence.

Fail on genuine defects a learner would actually face; do not fail over contrived alternative readings.

Call ${TOOL_NAME}. Stop after the tool call.`
}

type VerifyExerciseArgs = {
  exercise: GeneratedExercise
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  hideTranslationFields: boolean
  allowL1Notes: boolean
}

const runVerdictCall = async (args: VerifyExerciseArgs): Promise<VerifyExerciseResult> => {
  const stream = getAnthropicClient().messages.stream({
    model: MODEL_EXERCISE_VERIFY,
    thinking: THINKING_DISABLED,
    max_tokens: 1500,
    system: buildPracticeMethodologySystem({
      nativeLanguage: args.nativeLanguage,
      targetLanguage: args.targetLanguage,
      cefrLevel: args.cefrLevel,
      hideTranslationFields: args.hideTranslationFields,
      allowL1Notes: args.allowL1Notes,
    }),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserMessage(args.exercise, args.targetLanguage) }],
  })
  const response = await stream.finalMessage()
  logAnthropicCacheUsage('verify-exercise', response)

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Exercise verification did not produce a tool_use block${reason}`)
  }
  const input = toolUse.input as Record<string, unknown>
  const reasons = Array.isArray(input.reasons) ? input.reasons.map((r) => String(r)) : []
  // Tool schemas don't guarantee a real boolean — the model occasionally emits
  // "true"/"false" strings, and a strict `=== true` would silently turn a pass
  // into a reasonless rejection.
  const pass = input.pass === true || input.pass === 'true'
  return { pass, reasons }
}

// A fail with zero reasons is a verdict the prompt forbids (reasons must name
// each failed check; they're empty only on pass), so it usually means a
// malformed tool call rather than a real rejection. Retry the verdict once
// before accepting it as a failure.
export const verifyExercisePass = async (args: VerifyExerciseArgs): Promise<VerifyExerciseResult> => {
  const first = await runVerdictCall(args)
  if (first.pass || first.reasons.length > 0) return first
  const second = await runVerdictCall(args)
  if (second.pass || second.reasons.length > 0) return second
  return { pass: false, reasons: ['verifier failed the exercise twice without naming a reason'] }
}
