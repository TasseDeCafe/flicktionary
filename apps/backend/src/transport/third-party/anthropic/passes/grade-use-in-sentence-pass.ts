import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '../anthropic-client'
import { buildPracticeMethodologySystem } from '../methodology-prompt'

// LLM grading for the use-in-a-sentence bonus exercise. Sonnet is plenty for
// single-sentence judging, and this path NEVER gates anything — callers
// degrade a thrown error to "feedback unavailable" rather than blocking.

const TOOL_NAME = 'submit_grade'

export type GradeUseInSentenceResult = {
  correct: boolean
  feedback: string
}

const buildTool = (): Anthropic.Tool => ({
  name: TOOL_NAME,
  description: "Submit the grade for the learner's sentence.",
  input_schema: {
    type: 'object',
    properties: {
      correct: {
        type: 'boolean',
        description:
          'true if the sentence uses the term grammatically and naturally in ANY legitimate standard sense of the term — not only the stored one. Minor typos/diacritic slips do not fail a sentence; broken grammar around the term, a non-existent sense, or not using the term at all do.',
      },
      feedback: {
        type: 'string',
        description:
          'One or two short sentences of feedback: what worked, and the single most useful correction if any. If the sentence uses a legitimate sense DIFFERENT from the stored one, say so explicitly and give one short example in the stored sense. Encouraging but concrete.',
      },
    },
    required: ['correct', 'feedback'],
  },
})

export const gradeUseInSentencePass = async (args: {
  headword: string
  sense: string
  userSentence: string
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  hideTranslationFields: boolean
  allowL1Notes: boolean
}): Promise<GradeUseInSentenceResult> => {
  const feedbackLanguage = args.hideTranslationFields ? args.targetLanguage : args.nativeLanguage
  const userMessage = `The learner was asked to write one ${args.targetLanguage} sentence using this term in its stored sense:

headword="${args.headword}" sense="${args.sense}"

Learner's sentence:

${args.userSentence}

Grade it. The bar: the term appears (inflection allowed), is used in a legitimate standard sense, and the sentence is grammatical and natural enough for CEFR ${args.cefrLevel}. Minor typos or missing diacritics are fine.

Sense handling: a correct sentence in a DIFFERENT legitimate sense than the stored one still passes (correct=true) — real production is the point — but the feedback must point out that the stored sense is the one this card tracks, and include one short example sentence in the stored sense. Only fail on senses that don't exist, broken grammar around the term, or the term not appearing.

Write the feedback in ${feedbackLanguage}.

Call ${TOOL_NAME}. Stop after the tool call.`

  const stream = getAnthropicClient().messages.stream({
    model: MODEL_SONNET,
    max_tokens: 1000,
    system: buildPracticeMethodologySystem({
      nativeLanguage: args.nativeLanguage,
      targetLanguage: args.targetLanguage,
      cefrLevel: args.cefrLevel,
      hideTranslationFields: args.hideTranslationFields,
      allowL1Notes: args.allowL1Notes,
    }),
    tools: [buildTool()],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMessage }],
  })
  const response = await stream.finalMessage()

  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    const reason = response.stop_reason ? ` (stop_reason=${response.stop_reason})` : ''
    throw new Error(`Use-in-sentence grading did not produce a tool_use block${reason}`)
  }
  const input = toolUse.input as Record<string, unknown>
  return {
    correct: input.correct === true,
    feedback: typeof input.feedback === 'string' ? input.feedback : '',
  }
}
