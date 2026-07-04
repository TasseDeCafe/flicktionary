import postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import type { PracticePool } from '../user-lookups/user-lookups-repository'

export type DbPracticeExercise = Tables<'practice_exercises'>
export type ExerciseType = Database['public']['Enums']['exercise_type']

const slotLockKey = (userLookupId: string, pool: PracticePool): string => `practice_exercises:${userLookupId}:${pool}`

// Stale-slot recovery threshold. Exercise generation loops generate+verify up
// to MAX_GEN_ATTEMPTS times against Opus, so it's slower than a single text
// generation — be generous before declaring a worker dead.
const STALE_SLOT_SECONDS = 300

// Reserve one 'pending' slot per requested type that doesn't already have a
// live (pending/generating/ready) row for this (user_lookup, pool). Wrapped in
// a per-(term, pool) advisory lock so two concurrent ensure calls (e.g. a
// rating trigger racing a Strengthen-session start) can't double-insert.
// Stuck pending/generating slots older than STALE_SLOT_SECONDS are failed and
// replaced. Returns only the freshly inserted slots — the caller owns kicking
// off generation for exactly these.
const reserveSlots = async (params: {
  userId: string
  userLookupId: string
  targetLanguage: string
  pool: PracticePool
  types: ExerciseType[]
}): Promise<DbPracticeExercise[]> => {
  if (params.types.length === 0) return []
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${slotLockKey(params.userLookupId, params.pool)}))
    `

    await tx`
      UPDATE public.practice_exercises
      SET status = 'failed',
          generation_warning = COALESCE(generation_warning, 'stale slot reclaimed')
      WHERE user_lookup_id = ${params.userLookupId}
        AND pool = ${params.pool}
        AND status IN ('pending', 'generating')
        AND created_at < NOW() - make_interval(secs => ${STALE_SLOT_SECONDS})
    `

    const live = (await tx`
      SELECT exercise_type
      FROM public.practice_exercises
      WHERE user_lookup_id = ${params.userLookupId}
        AND pool = ${params.pool}
        AND status IN ('pending', 'generating', 'ready')
    `) as Array<{ exercise_type: ExerciseType }>
    const liveTypes = new Set(live.map((row) => row.exercise_type))
    const missing = params.types.filter((type) => !liveTypes.has(type))
    if (missing.length === 0) return []

    return (await tx`
      INSERT INTO public.practice_exercises (user_id, user_lookup_id, target_language, pool, exercise_type)
      SELECT ${params.userId}, ${params.userLookupId}, ${params.targetLanguage}, ${params.pool}, t.type::public.exercise_type
      FROM unnest(${missing}::text[]) AS t(type)
      RETURNING *
    `) as DbPracticeExercise[]
  })
}

// Atomically transition pending -> generating and mint the fencing token.
// Callers that lose the race (stale reclaim already moved the slot) get null.
const claimGenerating = async (id: string): Promise<{ token: string } | null> => {
  const result = (await sql`
    UPDATE public.practice_exercises
    SET status = 'generating',
        generation_token = gen_random_uuid()
    WHERE id = ${id} AND status = 'pending'
    RETURNING generation_token
  `) as Array<{ generation_token: string }>
  const row = result[0]
  if (!row) return null
  return { token: row.generation_token }
}

const markReady = async (params: {
  id: string
  token: string
  payload: Record<string, unknown>
  gateEligible: boolean
  generationWarning: string | null
}): Promise<DbPracticeExercise | null> => {
  const payloadJson = sql.json(params.payload as unknown as postgres.JSONValue)
  const result = (await sql`
    UPDATE public.practice_exercises
    SET status = 'ready',
        payload = ${payloadJson}::jsonb,
        gate_eligible = ${params.gateEligible},
        generation_warning = ${params.generationWarning},
        ready_at = NOW()
    WHERE id = ${params.id}
      AND status = 'generating'
      AND generation_token = ${params.token}::uuid
    RETURNING *
  `) as DbPracticeExercise[]
  return result[0] ?? null
}

const markFailed = async (params: { id: string; token: string | null; warning: string }): Promise<void> => {
  if (params.token != null) {
    await sql`
      UPDATE public.practice_exercises
      SET status = 'failed', generation_warning = ${params.warning}
      WHERE id = ${params.id}
        AND generation_token = ${params.token}::uuid
        AND status IN ('pending', 'generating')
    `
    return
  }
  await sql`
    UPDATE public.practice_exercises
    SET status = 'failed', generation_warning = ${params.warning}
    WHERE id = ${params.id}
      AND status IN ('pending', 'generating')
  `
}

// Read-only selection of the next servable exercise: lowest created_at 'ready'
// row matching the filters. Deliberately does NOT stamp anything — refresh /
// abandon before answering re-serves the same exercise (consume-on-answer).
const selectNextExercise = async (params: {
  userLookupId: string
  pool: PracticePool
  gateEligible?: boolean
  type?: ExerciseType
}): Promise<DbPracticeExercise | null> => {
  const gateClause = params.gateEligible === undefined ? sql`` : sql`AND gate_eligible = ${params.gateEligible}`
  const typeClause = params.type === undefined ? sql`` : sql`AND exercise_type = ${params.type}`
  const result = (await sql`
    SELECT *
    FROM public.practice_exercises
    WHERE user_lookup_id = ${params.userLookupId}
      AND pool = ${params.pool}
      AND status = 'ready'
      ${gateClause}
      ${typeClause}
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `) as DbPracticeExercise[]
  return result[0] ?? null
}

// Consume-on-answer: stamp the row used at answer-submission time. The
// status='ready' guard doubles as the stale-answer fence — a second submit
// for the same exercise gets null and the caller rejects it.
const consumeExercise = async (id: string): Promise<DbPracticeExercise | null> => {
  const result = (await sql`
    UPDATE public.practice_exercises
    SET status = 'used',
        seen_at = COALESCE(seen_at, NOW()),
        used_at = NOW()
    WHERE id = ${id} AND status = 'ready'
    RETURNING *
  `) as DbPracticeExercise[]
  return result[0] ?? null
}

// Ownership-checked fetch for the answer endpoint.
const findByIdForUser = async (id: string, userId: string): Promise<DbPracticeExercise | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_exercises
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbPracticeExercise[]
  return result[0] ?? null
}

// One ready bonus exercise per requested term (lowest created first). Powers
// the post-session Strengthen list for this-session again/hard terms.
const listBonusForTerms = async (params: {
  userId: string
  pool: PracticePool
  userLookupIds: string[]
}): Promise<DbPracticeExercise[]> => {
  if (params.userLookupIds.length === 0) return []
  return (await sql`
    SELECT DISTINCT ON (user_lookup_id) *
    FROM public.practice_exercises
    WHERE user_id = ${params.userId}
      AND pool = ${params.pool}
      AND status = 'ready'
      AND user_lookup_id = ANY(${params.userLookupIds}::uuid[])
    ORDER BY user_lookup_id, created_at ASC, id ASC
  `) as DbPracticeExercise[]
}

const countReady = async (params: { userLookupId: string; pool: PracticePool }): Promise<number> => {
  const result = (await sql`
    SELECT COUNT(*)::int AS n
    FROM public.practice_exercises
    WHERE user_lookup_id = ${params.userLookupId}
      AND pool = ${params.pool}
      AND status = 'ready'
  `) as Array<{ n: number }>
  return result[0]?.n ?? 0
}

// In-flight vs failed slot counts for the gate-capable exercise types of a
// (term, pool). Lets the Strengthen/warm-up serve path distinguish "still
// cooking" (inflight > 0) from "terminally exhausted" (no ready, no inflight,
// every gate type has failed) so a term whose required types can't be generated
// stops showing an endless hourglass. `types` is the gate-capable set for the
// pool (use_in_sentence is excluded — it's bonus-only and never gates).
const countGateBankSlots = async (params: {
  userLookupId: string
  pool: PracticePool
  types: ExerciseType[]
}): Promise<{ inflight: number; failed: number; failedTypes: number }> => {
  if (params.types.length === 0) return { inflight: 0, failed: 0, failedTypes: 0 }
  const result = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending', 'generating'))::int AS inflight,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(DISTINCT exercise_type) FILTER (WHERE status = 'failed')::int AS failed_types
    FROM public.practice_exercises
    WHERE user_lookup_id = ${params.userLookupId}
      AND pool = ${params.pool}
      AND exercise_type = ANY(${params.types})
  `) as Array<{ inflight: number; failed: number; failed_types: number }>
  return {
    inflight: result[0]?.inflight ?? 0,
    failed: result[0]?.failed ?? 0,
    failedTypes: result[0]?.failed_types ?? 0,
  }
}

// Drop every terminally-failed slot for a term (both pools). Failed rows are
// what countGateBankSlots reads to declare a term's bank "terminally
// exhausted" (and what stops re-reserving doomed slots) — deleting them
// un-terminal-izes the term so the next serve path reserves fresh slots and
// regenerates. Called when the user edits the term's content: the old
// failures were verdicts on the OLD headword/sense/definition, so they no
// longer apply.
const deleteFailedForLookup = async (userLookupId: string): Promise<void> => {
  await sql`
    DELETE FROM public.practice_exercises
    WHERE user_lookup_id = ${userLookupId}
      AND status = 'failed'
  `
}

// Per-term slot-status summary for ONE exercise type, in a single query.
// Powers the compose-time hint warmer's gap detection: a term with no ready,
// no live inflight, and no failed slot of the hint type needs a generation;
// anything else is already served, cooking, or terminally failed. Stale
// inflight slots (older than STALE_SLOT_SECONDS) count as absent so a crashed
// worker doesn't block warming — reserveSlots reclaims them when the ensure
// call runs. Terms with no rows at all are omitted from the result.
const countSlotsByTermForType = async (params: {
  userId: string
  pool: PracticePool
  type: ExerciseType
  userLookupIds: string[]
}): Promise<Array<{ user_lookup_id: string; ready: number; inflight: number; failed: number }>> => {
  if (params.userLookupIds.length === 0) return []
  return (await sql`
    SELECT user_lookup_id,
      COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
      COUNT(*) FILTER (
        WHERE status IN ('pending', 'generating')
          AND created_at >= NOW() - make_interval(secs => ${STALE_SLOT_SECONDS})
      )::int AS inflight,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM public.practice_exercises
    WHERE user_id = ${params.userId}
      AND pool = ${params.pool}
      AND exercise_type = ${params.type}
      AND user_lookup_id = ANY(${params.userLookupIds}::uuid[])
    GROUP BY user_lookup_id
  `) as Array<{ user_lookup_id: string; ready: number; inflight: number; failed: number }>
}

export interface PracticeExercisesRepositoryInterface {
  reserveSlots: (params: {
    userId: string
    userLookupId: string
    targetLanguage: string
    pool: PracticePool
    types: ExerciseType[]
  }) => Promise<DbPracticeExercise[]>
  claimGenerating: (id: string) => Promise<{ token: string } | null>
  markReady: (params: {
    id: string
    token: string
    payload: Record<string, unknown>
    gateEligible: boolean
    generationWarning: string | null
  }) => Promise<DbPracticeExercise | null>
  markFailed: (params: { id: string; token: string | null; warning: string }) => Promise<void>
  selectNextExercise: (params: {
    userLookupId: string
    pool: PracticePool
    gateEligible?: boolean
    type?: ExerciseType
  }) => Promise<DbPracticeExercise | null>
  consumeExercise: (id: string) => Promise<DbPracticeExercise | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbPracticeExercise | null>
  listBonusForTerms: (params: {
    userId: string
    pool: PracticePool
    userLookupIds: string[]
  }) => Promise<DbPracticeExercise[]>
  countReady: (params: { userLookupId: string; pool: PracticePool }) => Promise<number>
  countGateBankSlots: (params: {
    userLookupId: string
    pool: PracticePool
    types: ExerciseType[]
  }) => Promise<{ inflight: number; failed: number; failedTypes: number }>
  deleteFailedForLookup: (userLookupId: string) => Promise<void>
  countSlotsByTermForType: (params: {
    userId: string
    pool: PracticePool
    type: ExerciseType
    userLookupIds: string[]
  }) => Promise<Array<{ user_lookup_id: string; ready: number; inflight: number; failed: number }>>
}

export const PracticeExercisesRepository = (): PracticeExercisesRepositoryInterface => {
  return {
    reserveSlots,
    claimGenerating,
    markReady,
    markFailed,
    selectNextExercise,
    consumeExercise,
    findByIdForUser,
    listBonusForTerms,
    countReady,
    countGateBankSlots,
    deleteFailedForLookup,
    countSlotsByTermForType,
  }
}
