import { sql } from '../postgres-client'

// Reads over the offline-built frequency asset (docs/DATA-MODEL.md "Lemma
// frequency ranks"). The build manifest is the difficulty feature's
// supported-gate signal: KAIKKI membership alone would claim support against
// an empty ranks table between deploy and the one-off prod build.

export type LemmaRankInfo = { rank: number; freqMass: number }

const listBuiltLanguages = async (): Promise<Set<string>> => {
  const rows = (await sql`
    SELECT target_language FROM public.lemma_rank_builds
  `) as Array<{ target_language: string }>
  return new Set(rows.map((r) => r.target_language))
}

const RANK_CHUNK = 10_000

const listRanksForLemmas = async (params: {
  targetLanguage: string
  lemmas: readonly string[]
}): Promise<Map<string, LemmaRankInfo>> => {
  const result = new Map<string, LemmaRankInfo>()
  for (let i = 0; i < params.lemmas.length; i += RANK_CHUNK) {
    const chunk = params.lemmas.slice(i, i + RANK_CHUNK)
    const rows = (await sql`
      SELECT lemma, rank, freq_mass FROM public.lemma_ranks
      WHERE target_language = ${params.targetLanguage}
        AND lemma = ANY(${sql.array([...chunk])}::text[])
    `) as Array<{ lemma: string; rank: number; freq_mass: number }>
    for (const row of rows) {
      result.set(row.lemma, { rank: row.rank, freqMass: Number(row.freq_mass) })
    }
  }
  return result
}

export type LemmaRankBuildAggregate = {
  version: number
  rowCount: number
  totalMass: number
  // Per-band mass aligned with the caller's upper bounds, plus one trailing
  // entry for the tail beyond the last bound.
  bandMasses: number[]
}

export type LemmaRankCoverageData = {
  aggregate: LemmaRankBuildAggregate
  ranksByLemma: Map<string, LemmaRankInfo>
}

// Coverage totals and the requested user-vocabulary ranks come from one SQL
// statement. PostgreSQL gives one statement one MVCC snapshot, so an atomic
// rank publication can never leave the response combining one build's
// manifest/mass totals with another build's rank positions.
const getCoverageData = async (params: {
  targetLanguage: string
  lemmas: readonly string[]
  bandUpperBounds: readonly [number, number, number]
}): Promise<LemmaRankCoverageData | null> => {
  const [b1, b2, b3] = params.bandUpperBounds
  const rows = (await sql`
    WITH aggregate AS (
      SELECT b.version, b.row_count,
        sum(freq_mass) AS total_mass,
        sum(freq_mass) FILTER (WHERE rank <= ${b1}) AS cum_1,
        sum(freq_mass) FILTER (WHERE rank <= ${b2}) AS cum_2,
        sum(freq_mass) FILTER (WHERE rank <= ${b3}) AS cum_3
      FROM public.lemma_rank_builds b
      JOIN public.lemma_ranks all_r
        ON all_r.target_language = b.target_language
      WHERE b.target_language = ${params.targetLanguage}
      GROUP BY b.version, b.row_count
    )
    SELECT aggregate.version, aggregate.row_count, aggregate.total_mass,
      aggregate.cum_1, aggregate.cum_2, aggregate.cum_3,
      requested.lemma, requested.rank, requested.freq_mass
    FROM aggregate
    LEFT JOIN LATERAL (
      SELECT lemma, rank, freq_mass
      FROM public.lemma_ranks
      WHERE target_language = ${params.targetLanguage}
        AND lemma = ANY(${sql.array([...params.lemmas])}::text[])
    ) requested ON TRUE
  `) as Array<{
    version: number
    row_count: number
    total_mass: number
    cum_1: number | null
    cum_2: number | null
    cum_3: number | null
    lemma: string | null
    rank: number | null
    freq_mass: number | null
  }>
  const first = rows[0]
  if (!first) return null

  const total = Number(first.total_mass)
  const cum1 = Number(first.cum_1 ?? 0)
  const cum2 = Number(first.cum_2 ?? 0)
  const cum3 = Number(first.cum_3 ?? 0)
  const ranksByLemma = new Map<string, LemmaRankInfo>()
  for (const row of rows) {
    if (row.lemma !== null && row.rank !== null && row.freq_mass !== null) {
      ranksByLemma.set(row.lemma, { rank: row.rank, freqMass: Number(row.freq_mass) })
    }
  }
  return {
    aggregate: {
      version: first.version,
      rowCount: first.row_count,
      totalMass: total,
      bandMasses: [cum1, cum2 - cum1, cum3 - cum2, total - cum3],
    },
    ranksByLemma,
  }
}

export type TopLemmasBuild = { version: number; lemmas: string[] }

// The manifest version and ordered labels also share one statement snapshot;
// the returned version therefore always describes the returned lemma order.
const getTopLemmasBuild = async (params: { targetLanguage: string; limit: number }): Promise<TopLemmasBuild | null> => {
  const rows = (await sql`
    SELECT b.version,
      COALESCE(
        array_agg(head.lemma ORDER BY head.rank) FILTER (WHERE head.lemma IS NOT NULL),
        ARRAY[]::text[]
      ) AS lemmas
    FROM public.lemma_rank_builds b
    LEFT JOIN LATERAL (
      SELECT lemma, rank
      FROM public.lemma_ranks
      WHERE target_language = b.target_language
      ORDER BY rank ASC
      LIMIT ${params.limit}
    ) head ON TRUE
    WHERE b.target_language = ${params.targetLanguage}
    GROUP BY b.version
  `) as Array<{ version: number; lemmas: string[] }>
  const row = rows[0]
  return row ? { version: row.version, lemmas: row.lemmas } : null
}

export interface LemmaRanksRepositoryInterface {
  listBuiltLanguages: () => Promise<Set<string>>
  listRanksForLemmas: (params: {
    targetLanguage: string
    lemmas: readonly string[]
  }) => Promise<Map<string, LemmaRankInfo>>
  getCoverageData: (params: {
    targetLanguage: string
    lemmas: readonly string[]
    bandUpperBounds: readonly [number, number, number]
  }) => Promise<LemmaRankCoverageData | null>
  getTopLemmasBuild: (params: { targetLanguage: string; limit: number }) => Promise<TopLemmasBuild | null>
}

export const LemmaRanksRepository = (): LemmaRanksRepositoryInterface => {
  return {
    listBuiltLanguages,
    listRanksForLemmas,
    getCoverageData,
    getTopLemmasBuild,
  }
}
