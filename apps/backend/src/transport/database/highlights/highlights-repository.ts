import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbHighlight = Tables<'highlights'>

const insertHighlight = async (params: {
  studySessionId: string
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
  note: string | null
  presetTags: string[]
}): Promise<DbHighlight> => {
  const result = (await sql`
    INSERT INTO public.highlights (
      study_session_id, start_segment_id, end_segment_id,
      start_offset, end_offset, selection_text, note, preset_tags
    )
    VALUES (
      ${params.studySessionId},
      ${params.startSegmentId},
      ${params.endSegmentId},
      ${params.startOffset},
      ${params.endOffset},
      ${params.selectionText},
      ${params.note},
      ${params.presetTags}
    )
    RETURNING *
  `) as DbHighlight[]
  return result[0]!
}

const listBySessionId = async (studySessionId: string): Promise<DbHighlight[]> => {
  return (await sql`
    SELECT * FROM public.highlights
    WHERE study_session_id = ${studySessionId}
    ORDER BY created_at ASC
  `) as DbHighlight[]
}

const findById = async (id: string): Promise<DbHighlight | null> => {
  const result = (await sql`SELECT * FROM public.highlights WHERE id = ${id}`) as DbHighlight[]
  return result[0] ?? null
}

const updateFastGloss = async (id: string, fastGloss: string): Promise<void> => {
  await sql`
    UPDATE public.highlights SET fast_gloss = ${fastGloss} WHERE id = ${id}
  `
}

const updateNoteAndTags = async (
  id: string,
  note: string | null,
  presetTags: string[]
): Promise<DbHighlight | null> => {
  const result = (await sql`
    UPDATE public.highlights
    SET note = ${note}, preset_tags = ${presetTags}
    WHERE id = ${id}
    RETURNING *
  `) as DbHighlight[]
  return result[0] ?? null
}

const deleteById = async (id: string): Promise<boolean> => {
  const result = await sql`DELETE FROM public.highlights WHERE id = ${id}`
  return result.count === 1
}

export interface HighlightsRepositoryInterface {
  insertHighlight: (params: {
    studySessionId: string
    startSegmentId: string
    endSegmentId: string
    startOffset: number
    endOffset: number
    selectionText: string
    note: string | null
    presetTags: string[]
  }) => Promise<DbHighlight>
  listBySessionId: (studySessionId: string) => Promise<DbHighlight[]>
  findById: (id: string) => Promise<DbHighlight | null>
  updateFastGloss: (id: string, fastGloss: string) => Promise<void>
  updateNoteAndTags: (id: string, note: string | null, presetTags: string[]) => Promise<DbHighlight | null>
  deleteById: (id: string) => Promise<boolean>
}

export const HighlightsRepository = (): HighlightsRepositoryInterface => {
  return {
    insertHighlight,
    listBySessionId,
    findById,
    updateFastGloss,
    updateNoteAndTags,
    deleteById,
  }
}
