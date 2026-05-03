import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbL1InterferenceNotes = Tables<'l1_interference_notes'>

const findByPair = async (l1Language: string, targetLanguage: string): Promise<DbL1InterferenceNotes | null> => {
  const result = (await sql`
    SELECT * FROM public.l1_interference_notes
    WHERE l1_language = ${l1Language} AND target_language = ${targetLanguage}
  `) as DbL1InterferenceNotes[]
  return result[0] ?? null
}

const upsertNotes = async (l1Language: string, targetLanguage: string, notes: string): Promise<void> => {
  await sql`
    INSERT INTO public.l1_interference_notes (l1_language, target_language, notes)
    VALUES (${l1Language}, ${targetLanguage}, ${notes})
    ON CONFLICT (l1_language, target_language) DO UPDATE SET
      notes = EXCLUDED.notes,
      updated_at = NOW()
  `
}

export interface L1InterferenceNotesRepositoryInterface {
  findByPair: (l1Language: string, targetLanguage: string) => Promise<DbL1InterferenceNotes | null>
  upsertNotes: (l1Language: string, targetLanguage: string, notes: string) => Promise<void>
}

export const L1InterferenceNotesRepository = (): L1InterferenceNotesRepositoryInterface => {
  return {
    findByPair,
    upsertNotes,
  }
}
