import { buildMethodologySystem } from '../../transport/third-party/anthropic/methodology-prompt'
import type Anthropic from '@anthropic-ai/sdk'
import { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'

export type PromptContextInput = {
  sessionId: string
  userId: string
}

export type PromptContext = {
  systemBlocks: Anthropic.TextBlockParam[]
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
  contextBlob: string
  l1InterferenceNotes: string
}

// Loads the per-session prompt prefix used by per-card chat. Assumes the session
// has already been processed (context_blob populated and l1_interference_notes
// row present). Returns null if any required piece is missing.
export const buildPromptContext = async (
  input: PromptContextInput,
  studySessionsRepository: StudySessionsRepositoryInterface,
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
): Promise<PromptContext | null> => {
  const session = await studySessionsRepository.findByIdForUser(input.sessionId, input.userId)
  if (!session || !session.context_blob) return null
  const l1 = await l1InterferenceNotesRepository.findByPair(session.native_language, session.target_language)
  if (!l1) return null

  const systemBlocks = buildMethodologySystem({
    nativeLanguage: session.native_language,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    movieContextBlob: session.context_blob,
    l1InterferenceNotes: l1.notes,
  })

  return {
    systemBlocks,
    nativeLanguage: session.native_language,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    contextBlob: session.context_blob,
    l1InterferenceNotes: l1.notes,
  }
}
