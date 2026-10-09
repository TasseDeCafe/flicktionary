import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { CaptureCandidate } from '../../transport/third-party/anthropic/passes/translate-for-capture-pass'
import { normalizeHeadword } from './run-vocab-chat'

// The fast lane: target-language candidates for whatever the learner typed.
// Only the LLM answer, which the client caches for good; whether the learner
// already has a candidate is matchCaptureCandidates' job, asked fresh.
export const translateForCapture = async (
  params: {
    text: string
    context?: string | null
    targetLanguage: string
    nativeLanguage: string
    hideTranslationFields: boolean
  },
  deps: { anthropicPasses: AnthropicPassesInterface }
): Promise<{ inputLanguage: string | null; candidates: CaptureCandidate[] }> => {
  const result = await deps.anthropicPasses.translateForCapturePass({
    text: params.text,
    context: params.context,
    targetLanguage: params.targetLanguage,
    nativeLanguage: params.nativeLanguage,
    hideTranslationFields: params.hideTranslationFields,
  })
  return {
    inputLanguage: result.inputLanguage,
    candidates: result.candidates.map((c) => ({ ...c, headword: normalizeHeadword(c.headword) })),
  }
}
