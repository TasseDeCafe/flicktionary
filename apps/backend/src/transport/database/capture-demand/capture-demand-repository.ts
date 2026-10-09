import postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import type { FacetSkill, SrsState } from '../study-facets/study-facets-repository'
import { boostableSql, boostActiveSql, boostedDueSql } from '../study-facets/review-boost-sql'

// Demand from "Translate & add": looking up a word you already saved but never
// started is the same evidence as re-saving it, so it moves the term up the
// new-word queue (recordEncounter's signals). Every such change is visible on
// the search row and undoable, so each one is an event recording whether it
// counted (recordEncounter collapses demand within an hour) and the
// timestamps it replaced.

export type CaptureDemandSource = 'search' | 'edit_card' | 'move_up'

export type RecordCaptureDemandOutcome = 'counted' | 'not_counted' | 'skipped' | 'not_eligible'

// A term that was never introduced in any card: no facet has a schedule or an
// introduction (warm-up parking introduces without a schedule). `ul` must be
// the user_lookups alias.
const termNotStartedSql = () => sql`
  NOT EXISTS (
    SELECT 1 FROM public.study_facets s
    WHERE s.user_lookup_id = ul.id AND (s.srs_state IS NOT NULL OR s.introduced_at IS NOT NULL)
  )
`

// Same population as recordEncounter's other callers (findLiveIdsByLemmaKeys):
// kept, live, owned.
const lockEligibleTerm = async (tx: postgres.Sql, params: { userId: string; userLookupId: string }) => {
  const rows = (await tx`
    SELECT ul.last_demand_at, ul.last_encountered_at
    FROM public.user_lookups ul
    WHERE ul.id = ${params.userLookupId}
      AND ul.user_id = ${params.userId}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND ${termNotStartedSql()}
    FOR UPDATE OF ul
  `) as Array<{ last_demand_at: Date; last_encountered_at: Date }>
  return rows[0] ?? null
}

// `search` / `edit_card` fire at most once an hour per term, counting reverted
// events, so refetches and remounts don't refire and an Undo sticks. `move_up`
// is a deliberate tap after an Undo: it skips the collapse window, but not
// while a counted move is still live.
const recordCaptureDemand = async (params: {
  userId: string
  userLookupId: string
  source: CaptureDemandSource
}): Promise<RecordCaptureDemandOutcome> =>
  beginTx(async (tx) => {
    const term = await lockEligibleTerm(tx, params)
    if (!term) return 'not_eligible'
    const recent = await tx`
      SELECT 1 FROM public.capture_demand_events
      WHERE user_lookup_id = ${params.userLookupId}
        AND created_at > NOW() - INTERVAL '1 hour'
        AND (${params.source !== 'move_up'} OR (counted AND reverted_at IS NULL))
      LIMIT 1
    `
    if (recent.length > 0) return 'skipped'

    const forced = params.source === 'move_up'
    const counted = await tx`
      UPDATE public.user_lookups
      SET encounter_count = encounter_count + 1,
          last_encountered_at = NOW(),
          last_demand_at = NOW(),
          last_demand_attempt_at = NOW()
      WHERE id = ${params.userLookupId}
        AND (${forced} OR last_demand_at < NOW() - INTERVAL '1 hour')
      RETURNING id
    `
    if (counted.length === 0) {
      await tx`UPDATE public.user_lookups SET last_demand_attempt_at = NOW() WHERE id = ${params.userLookupId}`
    }
    await tx`
      INSERT INTO public.capture_demand_events
        (user_id, user_lookup_id, source, counted, prev_last_demand_at, prev_last_encountered_at, created_at)
      VALUES
        (${params.userId}, ${params.userLookupId}, ${params.source}, ${counted.length > 0},
         ${term.last_demand_at}, ${term.last_encountered_at}, NOW())
    `
    return counted.length > 0 ? 'counted' : 'not_counted'
  })

// The term's latest live, counted capture event, if it can still be undone:
// no demand of any kind arrived since (last_demand_attempt_at, stamped by
// every recordEncounter call). A later lookup in the collapse window left no
// trace in encounter_count, so undoing the event would erase that demand too.
// The undo reverts exactly what the event wrote: one encounter, and each
// timestamp only while it still holds the event's own value.
const undoCaptureDemand = async (params: { userId: string; userLookupId: string }): Promise<boolean> =>
  beginTx(async (tx) => {
    const events = (await tx`
      SELECT e.id
      FROM public.capture_demand_events e
      JOIN public.user_lookups ul ON ul.id = e.user_lookup_id
      WHERE e.user_lookup_id = ${params.userLookupId}
        AND e.user_id = ${params.userId}
        AND e.counted
        AND e.reverted_at IS NULL
        AND ul.last_demand_attempt_at <= e.created_at
      ORDER BY e.created_at DESC
      LIMIT 1
      FOR UPDATE OF e, ul
    `) as Array<{ id: string }>
    const event = events[0]
    if (!event) return false
    await tx`
      UPDATE public.user_lookups ul
      SET encounter_count = GREATEST(ul.encounter_count - 1, 1),
          last_demand_at = CASE WHEN ul.last_demand_at = e.created_at THEN e.prev_last_demand_at ELSE ul.last_demand_at END,
          last_encountered_at = CASE
            WHEN ul.last_encountered_at = e.created_at THEN e.prev_last_encountered_at
            ELSE ul.last_encountered_at
          END
      FROM public.capture_demand_events e
      WHERE e.id = ${event.id} AND ul.id = e.user_lookup_id
    `
    await tx`UPDATE public.capture_demand_events SET reverted_at = NOW() WHERE id = ${event.id}`
    return true
  })

export type CaptureFacetStatus = {
  skill: FacetSkill
  targetForm: string
  srsState: SrsState | null
  // Days from the server's today to the due date (0 or less: due today).
  dueInDays: number | null
  enabled: boolean
  // Has a schedule of its own (re-enabling it resumes that schedule).
  hasHistory: boolean
  parked: boolean
  dataReady: boolean
  boostActive: boolean
  boostable: boolean
  // The boost is still untouched, so its undo would restore boostPrevDue.
  boostUndoable: boolean
  boostPrevDue: string | null
}

export type CaptureTermStatus = {
  notStarted: boolean
  facets: CaptureFacetStatus[]
  // The term's latest capture demand today.
  demand: { counted: boolean; reverted: boolean; undoable: boolean } | null
}

// What a capture search row shows for each matched term: every card's state,
// boost eligibility from the same predicate the boost write uses, and today's
// capture demand.
const listCaptureStatus = async (params: {
  userId: string
  userLookupIds: string[]
}): Promise<Map<string, CaptureTermStatus>> => {
  if (params.userLookupIds.length === 0) return new Map()
  const rows = (await sql`
    SELECT
      ul.id,
      ${termNotStartedSql()} AS not_started,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'skill', f.skill,
              'targetForm', f.target_form,
              'srsState', f.srs_state,
              'dueInDays', f.srs_due::date - CURRENT_DATE,
              'enabled', f.disabled_at IS NULL,
              'hasHistory', f.srs_state IS NOT NULL,
              'parked', f.leech_parked_at IS NOT NULL,
              'dataReady', f.data_status = 'ready',
              'boostActive', ${boostActiveSql()},
              'boostable', COALESCE(${boostableSql()}, false),
              'boostUndoable', COALESCE(
                ${boostActiveSql()} AND f.boost_prev_due IS NOT NULL AND f.srs_due = ${boostedDueSql()},
                false
              ),
              'boostPrevDue', f.boost_prev_due
            )
            ORDER BY f.skill, f.target_form
          )
          FROM public.study_facets f
          WHERE f.user_lookup_id = ul.id
        ),
        '[]'::json
      ) AS facets,
      ev.counted AS demand_counted,
      ev.reverted AS demand_reverted,
      (ev.counted AND NOT ev.reverted AND ul.last_demand_attempt_at <= ev.created_at) AS demand_undoable
    FROM public.user_lookups ul
    LEFT JOIN LATERAL (
      SELECT e.counted, e.reverted_at IS NOT NULL AS reverted, e.created_at
      FROM public.capture_demand_events e
      WHERE e.user_lookup_id = ul.id AND e.created_at >= CURRENT_DATE::timestamptz
      ORDER BY e.created_at DESC
      LIMIT 1
    ) ev ON true
    WHERE ul.id = ANY(${params.userLookupIds}::uuid[])
      AND ul.user_id = ${params.userId}
  `) as Array<{
    id: string
    not_started: boolean
    facets: CaptureFacetStatus[]
    demand_counted: boolean | null
    demand_reverted: boolean | null
    demand_undoable: boolean | null
  }>
  return new Map(
    rows.map((row) => [
      row.id,
      {
        notStarted: row.not_started,
        facets: row.facets,
        demand:
          row.demand_counted === null
            ? null
            : {
                counted: row.demand_counted,
                reverted: row.demand_reverted ?? false,
                undoable: row.demand_undoable ?? false,
              },
      },
    ])
  )
}

export interface CaptureDemandRepositoryInterface {
  recordCaptureDemand: (params: {
    userId: string
    userLookupId: string
    source: CaptureDemandSource
  }) => Promise<RecordCaptureDemandOutcome>
  undoCaptureDemand: (params: { userId: string; userLookupId: string }) => Promise<boolean>
  listCaptureStatus: (params: { userId: string; userLookupIds: string[] }) => Promise<Map<string, CaptureTermStatus>>
}

export const CaptureDemandRepository = (): CaptureDemandRepositoryInterface => ({
  recordCaptureDemand,
  undoCaptureDemand,
  listCaptureStatus,
})
