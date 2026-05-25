import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'
import { DbHighlight } from '../highlights/highlights-repository'

export type DbGhostCandidate = Tables<'ghost_candidates'>

export type GhostCandidateInsert = {
  studySessionId: string
  segmentId: string
  charStart: number
  charEnd: number
  surfaceForm: string
}

const insertMany = async (candidates: GhostCandidateInsert[]): Promise<void> => {
  if (candidates.length === 0) return
  const rows = candidates.map((c) => ({
    study_session_id: c.studySessionId,
    segment_id: c.segmentId,
    char_start: c.charStart,
    char_end: c.charEnd,
    surface_form: c.surfaceForm,
  }))
  await sql`
    INSERT INTO public.ghost_candidates ${sql(
      rows,
      'study_session_id',
      'segment_id',
      'char_start',
      'char_end',
      'surface_form'
    )}
  `
}

// Live ghosts (not yet adopted/dismissed) for the reader's passive outline layer.
const listLiveBySession = async (sessionId: string): Promise<DbGhostCandidate[]> => {
  return (await sql`
    SELECT * FROM public.ghost_candidates
    WHERE study_session_id = ${sessionId} AND dismissed_at IS NULL
    ORDER BY created_at ASC
  `) as DbGhostCandidate[]
}

const findById = async (id: string): Promise<DbGhostCandidate | null> => {
  const result = (await sql`SELECT * FROM public.ghost_candidates WHERE id = ${id}`) as DbGhostCandidate[]
  return result[0] ?? null
}

export type SwitchGhostResult =
  | { kind: 'switched'; highlight: DbHighlight }
  | { kind: 'ghost_not_found' }
  | { kind: 'provisional_not_found' }

// Atomic span swap (the heart of Phase 2's adoption model). In one transaction:
//   1. validate the ghost is live and the provisional highlight both belong to
//      this session;
//   2. delete the provisional highlight the user's literal selection created,
//      cleaning up its card exactly like deleteWithCardCleanup (its pending
//      enrich job cascades away via the highlight_id FK — the cancel path);
//   3. create a fresh highlight from the ghost's segment/offsets/surface;
//   4. dismiss the ghost so it stops rendering;
//   5. enqueue an enrich job for the new highlight (idempotent per live job).
// A double-tap / retry therefore can never leave two highlights or a stale ghost:
// the second call finds the ghost already dismissed and aborts.
const switchGhostToHighlight = async (params: {
  sessionId: string
  ghostId: string
  provisionalHighlightId: string
  userId: string
  enrichDebounceMs: number
}): Promise<SwitchGhostResult> => {
  return await sql.begin(async (tx) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ghostRows = (await (tx as any)`
      SELECT * FROM public.ghost_candidates
      WHERE id = ${params.ghostId}
        AND study_session_id = ${params.sessionId}
        AND dismissed_at IS NULL
      FOR UPDATE
    `) as DbGhostCandidate[]
    const ghost = ghostRows[0]
    if (!ghost) return { kind: 'ghost_not_found' as const }

    const provisionalRows = (await (tx as any)`
      SELECT * FROM public.highlights
      WHERE id = ${params.provisionalHighlightId} AND study_session_id = ${params.sessionId}
      FOR UPDATE
    `) as DbHighlight[]
    if (!provisionalRows[0]) return { kind: 'provisional_not_found' as const }

    // Card cleanup for the provisional highlight, mirroring deleteWithCardCleanup:
    // decrement vocab count and repoint first_card_id before dropping the card.
    await (tx as any)`
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
      WHERE c.highlight_id = ${params.provisionalHighlightId}
        AND c.status = 'kept'
        AND ul.id = c.user_lookup_id
    `
    await (tx as any)`
      UPDATE public.user_lookups ul
      SET first_card_id = (
        SELECT c2.id
        FROM public.cards c2
        WHERE c2.user_lookup_id = ul.id AND c2.id <> c.id
        ORDER BY (c2.status = 'kept') DESC, c2.created_at ASC
        LIMIT 1
      )
      FROM public.cards c
      WHERE c.highlight_id = ${params.provisionalHighlightId}
        AND c.status <> 'kept'
        AND ul.id = c.user_lookup_id
        AND ul.first_card_id = c.id
    `
    await (tx as any)`DELETE FROM public.cards WHERE highlight_id = ${params.provisionalHighlightId}`
    // Deleting the provisional highlight cascades away its pending enrich job
    // (processing_jobs.highlight_id ON DELETE CASCADE).
    await (tx as any)`DELETE FROM public.highlights WHERE id = ${params.provisionalHighlightId}`

    const insertedRows = (await (tx as any)`
      INSERT INTO public.highlights (
        study_session_id, start_segment_id, end_segment_id,
        start_offset, end_offset, selection_text, note, preset_tags
      )
      VALUES (
        ${params.sessionId},
        ${ghost.segment_id},
        ${ghost.segment_id},
        ${ghost.char_start},
        ${ghost.char_end},
        ${ghost.surface_form},
        ${null},
        ${[] as string[]}
      )
      RETURNING *
    `) as DbHighlight[]
    const newHighlight = insertedRows[0]!

    await (tx as any)`
      UPDATE public.ghost_candidates SET dismissed_at = now() WHERE id = ${params.ghostId}
    `

    // Enqueue enrichment for the adopted span. Same debounce + live-job idempotency
    // as the highlights.create path.
    const runAfter = new Date(Date.now() + params.enrichDebounceMs)
    await (tx as any)`
      INSERT INTO public.processing_jobs (kind, study_session_id, highlight_id, user_id, run_after)
      VALUES ('enrich_highlight', ${params.sessionId}, ${newHighlight.id}, ${params.userId}, ${runAfter})
      ON CONFLICT (highlight_id) WHERE highlight_id IS NOT NULL AND status IN ('pending', 'processing')
      DO NOTHING
    `
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { kind: 'switched' as const, highlight: newHighlight }
  })
}

export interface GhostCandidatesRepositoryInterface {
  insertMany: (candidates: GhostCandidateInsert[]) => Promise<void>
  listLiveBySession: (sessionId: string) => Promise<DbGhostCandidate[]>
  findById: (id: string) => Promise<DbGhostCandidate | null>
  switchGhostToHighlight: (params: {
    sessionId: string
    ghostId: string
    provisionalHighlightId: string
    userId: string
    enrichDebounceMs: number
  }) => Promise<SwitchGhostResult>
}

export const GhostCandidatesRepository = (): GhostCandidatesRepositoryInterface => {
  return {
    insertMany,
    listLiveBySession,
    findById,
    switchGhostToHighlight,
  }
}
