import { buildMethodologySystem } from '../../transport/third-party/anthropic/methodology-prompt'
import type Anthropic from '@anthropic-ai/sdk'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'

export type PromptContextInput = {
  sessionId: string
  userId: string
  // Override the session's snapshotted native_language. Used to spoof
  // native=target when the user has the show-translations pref off.
  nativeLanguageOverride?: string
}

export type PromptContext = {
  systemBlocks: Anthropic.TextBlockParam[]
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  contextBlob: string
}

// Loads the per-session prompt prefix used by per-card chat. Assumes the session
// has already been processed (context_blob populated). Returns null if any
// required piece is missing.
export const buildPromptContext = async (
  input: PromptContextInput,
  studySessionsRepository: StudySessionsRepositoryInterface
): Promise<PromptContext | null> => {
  const session = await studySessionsRepository.findByIdForUser(input.sessionId, input.userId)
  if (!session || !session.context_blob) return null

  const nativeLanguage = input.nativeLanguageOverride ?? session.native_language

  const systemBlocks = buildMethodologySystem({
    nativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    movieContextBlob: session.context_blob,
  })

  return {
    systemBlocks,
    nativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    contextBlob: session.context_blob,
  }
}
