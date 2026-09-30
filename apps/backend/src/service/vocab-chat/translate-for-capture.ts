import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { CaptureCandidate } from '../../transport/third-party/anthropic/passes/translate-for-capture-pass'
import { normalizeHeadword } from './run-vocab-chat'

export type CaptureCandidateWithCard = CaptureCandidate & {
  // The learner's existing card for this headword, so the result list can
  // offer "Edit" instead of a duplicate Add.
  existingCard: { cardId: string; sessionId: string } | null
}

// The fast lane plus a vocabulary lookup: candidates the learner already has
// come back pointing at their card. This is also what restores the "Added"
// state when the learner comes back to a search after editing a card.
export const translateForCapture = async (
  params: {
    userId: string
    text: string
    context?: string | null
    targetLanguage: string
    nativeLanguage: string
    hideTranslationFields: boolean
  },
  deps: { anthropicPasses: AnthropicPassesInterface; userLookupsRepository: UserLookupsRepositoryInterface }
): Promise<{ inputLanguage: string | null; candidates: CaptureCandidateWithCard[] }> => {
  const result = await deps.anthropicPasses.translateForCapturePass({
    text: params.text,
    context: params.context,
    targetLanguage: params.targetLanguage,
    nativeLanguage: params.nativeLanguage,
    hideTranslationFields: params.hideTranslationFields,
  })
  const candidates = result.candidates.map((c) => ({ ...c, headword: normalizeHeadword(c.headword) }))
  const matches = await deps.userLookupsRepository.listByHeadwords({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    headwords: candidates.map((c) => c.headword),
  })
  const withCards = await Promise.all(
    candidates.map(async (candidate): Promise<CaptureCandidateWithCard> => {
      // Several senses may exist; the sense-less row (sorted first) wins.
      const match = matches.get(candidate.headword.toLowerCase())?.[0]
      if (!match) return { ...candidate, existingCard: null }
      const pointer = await deps.userLookupsRepository.getFirstCardPointerForChunk({
        userLookupId: match.id,
        userId: params.userId,
      })
      const existingCard =
        pointer.cardId && pointer.sessionId ? { cardId: pointer.cardId, sessionId: pointer.sessionId } : null
      return { ...candidate, existingCard }
    })
  )
  return { inputLanguage: result.inputLanguage, candidates: withCards }
}
