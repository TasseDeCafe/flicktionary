import { generateL1InterferenceNotes } from '../../transport/third-party/anthropic/passes/generate-l1-interference-notes'
import type { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'

// Mirrors the logic from process-session.ts: load the L1 interference notes
// for (native, target), generating + upserting if missing, then return the
// notes string. Cached forever once written.
export const ensureL1InterferenceNotes = async (
  nativeLanguage: string,
  targetLanguage: string,
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
): Promise<string> => {
  const existing = await l1InterferenceNotesRepository.findByPair(nativeLanguage, targetLanguage)
  if (existing) return existing.notes
  const notes = await generateL1InterferenceNotes({ nativeLanguage, targetLanguage })
  await l1InterferenceNotesRepository.upsertNotes(nativeLanguage, targetLanguage, notes)
  return notes
}
