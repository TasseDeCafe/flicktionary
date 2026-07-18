import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient } from './anthropic-client'
import { basicDataPass } from './passes/basic-data-pass'
import { checkpointSensePass } from './passes/checkpoint-sense-pass'
import { enrichmentPass } from './passes/enrichment-pass'
import { extractLessonPass } from './passes/extract-lesson-pass'
import { fastGlossPass } from './passes/fast-gloss-pass'
import { generateContextBlob } from './passes/generate-context-blob'
import { generateExercisePass } from './passes/generate-exercise-pass'
import { generateFormData } from './passes/generate-form-data'
import { generatePracticeText } from './passes/generate-practice-text'
import { gradeUseInSentencePass } from './passes/grade-use-in-sentence-pass'
import { languageDetectionPass } from './passes/language-detection-pass'
import { nominateCandidatesPass } from './passes/nominate-candidates-pass'
import { verifyExercisePass } from './passes/verify-exercise-pass'

// The injection seam for every LLM call the app makes. Services and routers
// receive this bundle through their deps objects instead of importing pass
// modules directly, so unit tests script canned pass outputs by plain injection
// (no module mocking) and integration tests can drive LLM-adjacent flows
// without network. The pass modules themselves (prompts + parsers) stay
// directly unit-testable; only the call surface is behind the interface.
export type AnthropicPassesInterface = {
  basicDataPass: typeof basicDataPass
  checkpointSensePass: typeof checkpointSensePass
  enrichmentPass: typeof enrichmentPass
  extractLessonPass: typeof extractLessonPass
  fastGlossPass: typeof fastGlossPass
  generateContextBlob: typeof generateContextBlob
  generateExercisePass: typeof generateExercisePass
  generateFormData: typeof generateFormData
  generatePracticeText: typeof generatePracticeText
  gradeUseInSentencePass: typeof gradeUseInSentencePass
  languageDetectionPass: typeof languageDetectionPass
  nominateCandidatesPass: typeof nominateCandidatesPass
  verifyExercisePass: typeof verifyExercisePass
  // Card chat builds a bespoke prompt (seeded turn, history split, edit tool)
  // in the service layer; only the raw completion call crosses the seam.
  createChatCompletion: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>
}

export const AnthropicPasses = (): AnthropicPassesInterface => ({
  basicDataPass,
  checkpointSensePass,
  enrichmentPass,
  extractLessonPass,
  fastGlossPass,
  generateContextBlob,
  generateExercisePass,
  generateFormData,
  generatePracticeText,
  gradeUseInSentencePass,
  languageDetectionPass,
  nominateCandidatesPass,
  verifyExercisePass,
  createChatCompletion: (params) => getAnthropicClient().messages.create(params),
})

const notScripted = (name: string) => (): never => {
  throw new Error(`MockAnthropicPasses.${name} was called but not scripted for this test`)
}

// Scripted fake: every method throws until the test scripts it via overrides,
// so an unexpected LLM call fails loudly instead of reaching the network.
export const MockAnthropicPasses = (overrides: Partial<AnthropicPassesInterface> = {}): AnthropicPassesInterface => ({
  basicDataPass: notScripted('basicDataPass'),
  checkpointSensePass: notScripted('checkpointSensePass'),
  enrichmentPass: notScripted('enrichmentPass'),
  extractLessonPass: notScripted('extractLessonPass'),
  fastGlossPass: notScripted('fastGlossPass'),
  generateContextBlob: notScripted('generateContextBlob'),
  generateExercisePass: notScripted('generateExercisePass'),
  generateFormData: notScripted('generateFormData'),
  generatePracticeText: notScripted('generatePracticeText'),
  gradeUseInSentencePass: notScripted('gradeUseInSentencePass'),
  languageDetectionPass: notScripted('languageDetectionPass'),
  nominateCandidatesPass: notScripted('nominateCandidatesPass'),
  verifyExercisePass: notScripted('verifyExercisePass'),
  createChatCompletion: notScripted('createChatCompletion'),
  ...overrides,
})
