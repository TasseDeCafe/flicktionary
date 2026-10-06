import type postgres from 'postgres'

// Merges vocabulary rows that hold the same meaning under different sense
// labels (scripts/merge-duplicate-senses.ts) into one row, in one transaction.
// Everything that references the losers moves to the winner, and the losers
// are hard-deleted: a soft-deleted loser would keep its (headword, sense) key
// revivable, so a later save with that label would split the term again.

export type PlannedRow = { id: string; headword: string; sense: string }

// recordEncounter's collapse window: demand within an hour is one episode.
const DEMAND_COLLAPSE_WINDOW_MS = 60 * 60 * 1000

export type MergeOutcome = { status: 'merged'; winnerId: string } | { status: 'skipped'; reason: string }

type LookupRow = {
  id: string
  user_id: string
  target_language: string
  headword: string
  sense: string
  deleted_at: Date | null
  created_at: Date
  count: number
  encounter_count: number
  content_encounter_count: number
  last_encountered_at: Date
  last_demand_at: Date
  last_content_encounter_at: Date | null
  exported_at: Date | null
  zipf_estimate: string | null
  translation: string | null
  definition: string | null
  target_example: string | null
  native_example: string | null
  first_card_id: string | null
  grounded_at: Date | null
  grounding_patch: unknown
  grammar: Record<string, unknown> | null
  exploration_extras: Record<string, unknown> | null
  grammar_user_edited_at: Date | null
}

type FacetRow = {
  id: string
  user_lookup_id: string
  skill: string
  target_form: string
  disabled_at: Date | null
  introduced_at: Date | null
  srs_reps: number
  created_at: Date
}

const maxDate = (dates: Array<Date | null>): Date | null =>
  dates.reduce<Date | null>((best, d) => (d && (!best || d > best) ? d : best), null)

const firstNonNull = <T>(values: Array<T | null | undefined>): T | null => values.find((v) => v != null) ?? null

// Better facet first: enabled, introduced, more practiced, older.
const compareFacets = (a: FacetRow, b: FacetRow): number =>
  Number(a.disabled_at !== null) - Number(b.disabled_at !== null) ||
  Number(a.introduced_at === null) - Number(b.introduced_at === null) ||
  b.srs_reps - a.srs_reps ||
  a.created_at.getTime() - b.created_at.getTime()

export const mergeUserLookups = async (
  params: { userId: string; rows: PlannedRow[] },
  // Explicit, not the app's pooled client: the merge script connects on its
  // own without booting the app config for the database.
  sql: postgres.Sql
): Promise<MergeOutcome> => {
  const ids = params.rows.map((row) => row.id)
  if (new Set(ids).size < 2) return { status: 'skipped', reason: 'fewer than two rows' }

  return sql.begin(async (tx): Promise<MergeOutcome> => {
    const lookups = (await tx`
      SELECT * FROM public.user_lookups WHERE id = ANY(${ids}::uuid[]) ORDER BY created_at, id FOR UPDATE
    `) as unknown as LookupRow[]

    // Revalidate the reviewed plan under the locks: a row that vanished, was
    // deleted, moved users, or had its headword/sense edited since planning
    // was judged on stale evidence, so the whole cluster is left alone.
    if (lookups.length !== ids.length) return { status: 'skipped', reason: 'a row no longer exists' }
    const plannedById = new Map(params.rows.map((row) => [row.id, row]))
    for (const lookup of lookups) {
      const planned = plannedById.get(lookup.id)!
      if (lookup.user_id !== params.userId) return { status: 'skipped', reason: 'row belongs to another user' }
      if (lookup.deleted_at !== null) return { status: 'skipped', reason: 'row was deleted' }
      if (lookup.target_language !== lookups[0]!.target_language) {
        return { status: 'skipped', reason: 'rows span languages' }
      }
      if (lookup.headword !== planned.headword || lookup.sense !== planned.sense) {
        return { status: 'skipped', reason: 'headword or sense changed since planning' }
      }
    }

    const eventCounts = (await tx`
      SELECT user_lookup_id, skill, target_form, count(*)::int AS n
      FROM public.practice_rating_events
      WHERE user_lookup_id = ANY(${ids}::uuid[])
      GROUP BY user_lookup_id, skill, target_form
    `) as unknown as Array<{ user_lookup_id: string; skill: string; target_form: string; n: number }>
    const eventsByLookup = new Map<string, number>()
    const facetHasEvents = new Set<string>()
    for (const row of eventCounts) {
      eventsByLookup.set(row.user_lookup_id, (eventsByLookup.get(row.user_lookup_id) ?? 0) + row.n)
      facetHasEvents.add(`${row.user_lookup_id}|${row.skill}|${row.target_form}`)
    }

    // Winner: the row with the most practice history (the investment to keep),
    // then the oldest — `lookups` is already in created_at order.
    const winner = lookups.reduce((best, row) =>
      (eventsByLookup.get(row.id) ?? 0) > (eventsByLookup.get(best.id) ?? 0) ? row : best
    )
    const losers = lookups.filter((row) => row.id !== winner.id)
    const loserIds = losers.map((row) => row.id)

    // Facets are unique per (lookup, skill, target_form). When several rows
    // study the same facet, keep one. A facet with rating history must be the
    // one kept: undo restores the latest event's snapshot per facet identity,
    // so history moved onto a different facet could overwrite it. Two facets
    // that both have history can't be reconciled — skip the cluster.
    const facets = (await tx`
      SELECT id, user_lookup_id, skill, target_form, disabled_at, introduced_at, srs_reps, created_at
      FROM public.study_facets
      WHERE user_lookup_id = ANY(${ids}::uuid[])
      FOR UPDATE
    `) as unknown as FacetRow[]
    const facetGroups = new Map<string, FacetRow[]>()
    for (const facet of facets) {
      const key = `${facet.skill}|${facet.target_form}`
      facetGroups.set(key, [...(facetGroups.get(key) ?? []), facet])
    }
    const keptFacetIds: string[] = []
    const droppedFacetIds: string[] = []
    // A kept facet that is disabled while a dropped duplicate was enabled: the
    // user chose to study it, so the kept one is re-enabled (enabling keeps the
    // SRS state, as the normal toggle does).
    const reenableFacetIds: string[] = []
    for (const group of facetGroups.values()) {
      const withHistory = group.filter((f) => facetHasEvents.has(`${f.user_lookup_id}|${f.skill}|${f.target_form}`))
      if (withHistory.length > 1) return { status: 'skipped', reason: 'conflicting practice history' }
      const kept = withHistory[0] ?? [...group].sort(compareFacets)[0]!
      keptFacetIds.push(kept.id)
      droppedFacetIds.push(...group.filter((f) => f.id !== kept.id).map((f) => f.id))
      if (kept.disabled_at !== null && group.some((f) => f.disabled_at === null)) reenableFacetIds.push(kept.id)
    }

    if (droppedFacetIds.length > 0) {
      await tx`DELETE FROM public.study_facets WHERE id = ANY(${droppedFacetIds}::uuid[])`
    }
    await tx`
      UPDATE public.study_facets SET user_lookup_id = ${winner.id}
      WHERE id = ANY(${keptFacetIds}::uuid[]) AND user_lookup_id <> ${winner.id}
    `
    if (reenableFacetIds.length > 0) {
      await tx`UPDATE public.study_facets SET disabled_at = NULL WHERE id = ANY(${reenableFacetIds}::uuid[])`
    }
    await tx`UPDATE public.cards SET user_lookup_id = ${winner.id} WHERE user_lookup_id = ANY(${loserIds}::uuid[])`
    await tx`
      UPDATE public.practice_rating_events SET user_lookup_id = ${winner.id}
      WHERE user_lookup_id = ANY(${loserIds}::uuid[])
    `
    await tx`
      UPDATE public.practice_exercises SET user_lookup_id = ${winner.id}
      WHERE user_lookup_id = ANY(${loserIds}::uuid[])
    `
    await tx`
      UPDATE public.import_batch_rows SET duplicate_user_lookup_id = ${winner.id}
      WHERE duplicate_user_lookup_id = ANY(${loserIds}::uuid[])
    `
    // Checkpoint claims sheets reference backlog candidates by id; repoint them
    // (deduped) and carry each loser's evidence over unless the winner has its own.
    await tx`
      UPDATE public.study_session_checkpoints c
      SET backlog_candidate_ids = ARRAY(
            SELECT DISTINCT CASE WHEN x = ANY(${loserIds}::uuid[]) THEN ${winner.id}::uuid ELSE x END
            FROM unnest(c.backlog_candidate_ids) AS x
          ),
          backlog_evidence = CASE WHEN c.backlog_evidence IS NULL THEN NULL ELSE (
            SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
            FROM (
              SELECT DISTINCT ON (k) k, v
              FROM (
                SELECT CASE WHEN e.key = ANY(${loserIds}::text[]) THEN ${winner.id}::text ELSE e.key END AS k,
                       e.value AS v,
                       e.key = ANY(${loserIds}::text[]) AS from_loser
                FROM jsonb_each(c.backlog_evidence) AS e
              ) remapped
              ORDER BY k, from_loser
            ) deduped
          ) END
      WHERE c.backlog_candidate_ids && ${loserIds}::uuid[]
    `

    // Winner first, then the losers oldest-first: the winner's own content
    // wins, losers only fill its gaps.
    const ordered = [winner, ...losers]
    const mergeJson = (pick: (row: LookupRow) => Record<string, unknown> | null) =>
      [...ordered].reverse().reduce<Record<string, unknown>>((acc, row) => ({ ...acc, ...(pick(row) ?? {}) }), {})
    const groundingPatch = firstNonNull(ordered.map((r) => r.grounding_patch)) as postgres.JSONValue | null
    // A lookup credits every matching saved row, so split rows share lookup
    // episodes and a sum would inflate demand: start from the max. A later
    // row's creation is a save the max can't see, so it adds one — unless
    // another row had demand within the collapse window around it (a lookup
    // then a save is one episode). Best effort: only each row's latest demand
    // is known. The checkpoint credits every matching row too, so content
    // encounters take the max.
    const extraSaves = lookups.slice(1).filter((row) => {
      const savedAt = row.created_at.getTime()
      return !lookups.some(
        (other) => other.id !== row.id && Math.abs(other.last_demand_at.getTime() - savedAt) < DEMAND_COLLAPSE_WINDOW_MS
      )
    }).length
    const encounterCount = Math.max(...lookups.map((r) => r.encounter_count)) + extraSaves
    const keptCards = (await tx`
      SELECT count(*)::int AS n FROM public.cards WHERE user_lookup_id = ${winner.id} AND status = 'kept'
    `) as unknown as Array<{ n: number }>

    await tx`
      UPDATE public.user_lookups SET
        count = ${keptCards[0]!.n},
        encounter_count = ${encounterCount},
        content_encounter_count = ${Math.max(...lookups.map((r) => r.content_encounter_count))},
        last_encountered_at = ${maxDate(lookups.map((r) => r.last_encountered_at))},
        last_demand_at = ${maxDate(lookups.map((r) => r.last_demand_at))},
        last_content_encounter_at = ${maxDate(lookups.map((r) => r.last_content_encounter_at))},
        exported_at = ${maxDate(lookups.map((r) => r.exported_at))},
        grammar_user_edited_at = ${maxDate(lookups.map((r) => r.grammar_user_edited_at))},
        created_at = ${lookups[0]!.created_at},
        zipf_estimate = ${firstNonNull(ordered.map((r) => r.zipf_estimate))},
        translation = ${firstNonNull(ordered.map((r) => r.translation))},
        definition = ${firstNonNull(ordered.map((r) => r.definition))},
        target_example = ${firstNonNull(ordered.map((r) => r.target_example))},
        native_example = ${firstNonNull(ordered.map((r) => r.native_example))},
        first_card_id = ${firstNonNull(ordered.map((r) => r.first_card_id))},
        grounded_at = ${firstNonNull(ordered.map((r) => r.grounded_at))},
        grounding_patch = ${groundingPatch === null ? null : tx.json(groundingPatch)},
        grammar = ${tx.json(mergeJson((r) => r.grammar) as postgres.JSONValue)},
        exploration_extras = ${tx.json(mergeJson((r) => r.exploration_extras) as postgres.JSONValue)}
      WHERE id = ${winner.id}
    `
    await tx`DELETE FROM public.user_lookups WHERE id = ANY(${loserIds}::uuid[])`

    return { status: 'merged', winnerId: winner.id }
  }) as Promise<MergeOutcome>
}
