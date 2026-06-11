import postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbHighlight = Tables<'highlights'>

export type HighlightInsertParams = {
  studySessionId: string
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
  note: string | null
  presetTags: string[]
  // Gloss-save study intent (StudyIntentSchema shape), applied by the
  // enrich_highlight job once the user_lookup materializes. Kept as a loose
  // record here — the repo stays decoupled from the contract package.
  studyIntent: Record<string, unknown> | null
}

const insertHighlight = async (params: HighlightInsertParams): Promise<DbHighlight> => {
  const result = (await sql`
    INSERT INTO public.highlights (
      study_session_id, start_segment_id, end_segment_id,
      start_offset, end_offset, selection_text, note, preset_tags, study_intent
    )
    VALUES (
      ${params.studySessionId},
      ${params.startSegmentId},
      ${params.endSegmentId},
      ${params.startOffset},
      ${params.endOffset},
      ${params.selectionText},
      ${params.note},
      ${params.presetTags},
      ${params.studyIntent ? sql.json(params.studyIntent as unknown as postgres.JSONValue) : null}
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
  presetTags: string[],
  chatSeedPrompt: string | null
): Promise<DbHighlight | null> => {
  const result = (await sql`
    UPDATE public.highlights
    SET note = ${note}, preset_tags = ${presetTags}, chat_seed_prompt = ${chatSeedPrompt}
    WHERE id = ${id}
    RETURNING *
  `) as DbHighlight[]
  return result[0] ?? null
}

// Delete a highlight together with its card, in one transaction. cards.highlight_id
// is ON DELETE SET NULL, so a bare highlight delete would orphan its card as a
// highlight_id=NULL row that then masquerades as an LLM suggestion — we must drop
// the card first. If the card had been kept, apply the same count decrement as a
// kept→non-kept transition before deleting it.
const deleteWithCardCleanup = async (id: string): Promise<boolean> => {
  return await beginTx(async (tx) => {
    await tx`
      UPDATE public.user_lookups ul
      SET
        count = GREATEST(ul.count - 1, 0),
        first_card_id = CASE
          WHEN ul.first_card_id = c.id THEN (
            SELECT c2.id
            FROM public.cards c2
            WHERE c2.user_lookup_id = ul.id AND c2.id <> c.id
            ORDER BY (c2.status = 'kept') DESC, c2.created_at ASC
            LIMIT 1
          )
          ELSE ul.first_card_id
        END
      FROM public.cards c
      WHERE c.highlight_id = ${id}
        AND c.status = 'kept'
        AND ul.id = c.user_lookup_id
    `
    await tx`
      UPDATE public.user_lookups ul
      SET first_card_id = (
        SELECT c2.id
        FROM public.cards c2
        WHERE c2.user_lookup_id = ul.id AND c2.id <> c.id
        ORDER BY (c2.status = 'kept') DESC, c2.created_at ASC
        LIMIT 1
      )
      FROM public.cards c
      WHERE c.highlight_id = ${id}
        AND c.status <> 'kept'
        AND ul.id = c.user_lookup_id
        AND ul.first_card_id = c.id
    `
    await tx`DELETE FROM public.cards WHERE highlight_id = ${id}`
    const result = await tx`DELETE FROM public.highlights WHERE id = ${id}`
    return result.count === 1
  })
}

export interface HighlightsRepositoryInterface {
  insertHighlight: (params: HighlightInsertParams) => Promise<DbHighlight>
  listBySessionId: (studySessionId: string) => Promise<DbHighlight[]>
  findById: (id: string) => Promise<DbHighlight | null>
  updateFastGloss: (id: string, fastGloss: string) => Promise<void>
  updateNoteAndTags: (
    id: string,
    note: string | null,
    presetTags: string[],
    chatSeedPrompt: string | null
  ) => Promise<DbHighlight | null>
  deleteWithCardCleanup: (id: string) => Promise<boolean>
}

export const HighlightsRepository = (): HighlightsRepositoryInterface => {
  return {
    insertHighlight,
    listBySessionId,
    findById,
    updateFastGloss,
    updateNoteAndTags,
    deleteWithCardCleanup,
  }
}
