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
  bandUpperBounds: readonly number[]
}): Promise<LemmaRankCoverageData | null> => {
  // width_bucket counts the thresholds at or below the rank, so shifting each
  // inclusive upper bound by one makes its result the band index.
  const bandLowerBounds = params.bandUpperBounds.map((bound) => bound + 1)
  const rows = (await sql`
    WITH band_masses AS (
      SELECT width_bucket(rank, ${sql.array(bandLowerBounds)}::int[]) AS band,
        sum(freq_mass) AS mass
      FROM public.lemma_ranks
      WHERE target_language = ${params.targetLanguage}
      GROUP BY 1
    ),
    aggregate AS (
      SELECT b.version, b.row_count,
        (SELECT sum(mass) FROM band_masses) AS total_mass,
        (SELECT jsonb_object_agg(band, mass) FROM band_masses) AS band_masses
      FROM public.lemma_rank_builds b
      WHERE b.target_language = ${params.targetLanguage}
        AND EXISTS (SELECT 1 FROM band_masses)
    )
    SELECT aggregate.version, aggregate.row_count, aggregate.total_mass,
      aggregate.band_masses,
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
    band_masses: Record<string, number>
    lemma: string | null
    rank: number | null
    freq_mass: number | null
  }>
  const first = rows[0]
  if (!first) return null

  const ranksByLemma = new Map<string, LemmaRankInfo>()
  for (const row of rows) {
    if (row.lemma !== null && row.rank !== null && row.freq_mass !== null) {
      ranksByLemma.set(row.lemma, { rank: row.rank, freqMass: Number(row.freq_mass) })
    }
  }
  const bandMasses: number[] = []
  for (let band = 0; band <= params.bandUpperBounds.length; band++) {
    bandMasses.push(Number(first.band_masses[band] ?? 0))
  }
  return {
    aggregate: {
      version: first.version,
      rowCount: first.row_count,
      totalMass: Number(first.total_mass),
      bandMasses,
    },
    ranksByLemma,
  }
}

export type TopLemmasBuild = { version: number; lemmas: string[] }

// The manifest version and ordered labels also share one statement snapshot;
// the returned version therefore always describes the returned lemma order.
const getTopLemmasBuild = async (params: { targetLanguage: string }): Promise<TopLemmasBuild | null> => {
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
    ) head ON TRUE
    WHERE b.target_language = ${params.targetLanguage}
    GROUP BY b.version
  `) as Array<{ version: number; lemmas: string[] }>
  const row = rows[0]
  return row ? { version: row.version, lemmas: row.lemmas } : null
}

// When the language's ranks were last (re)built — the freshness anchor for
// detecting track profiles computed against older reference data.
const getRankBuildTime = async (targetLanguage: string): Promise<Date | null> => {
  const rows = (await sql`
    SELECT built_at FROM public.lemma_rank_builds WHERE target_language = ${targetLanguage}
  `) as Array<{ built_at: Date }>
  return rows[0]?.built_at ?? null
}

export interface LemmaRanksRepositoryInterface {
  listBuiltLanguages: () => Promise<Set<string>>
  getRankBuildTime: (targetLanguage: string) => Promise<Date | null>
  listRanksForLemmas: (params: {
    targetLanguage: string
    lemmas: readonly string[]
  }) => Promise<Map<string, LemmaRankInfo>>
  getCoverageData: (params: {
    targetLanguage: string
    lemmas: readonly string[]
    bandUpperBounds: readonly number[]
  }) => Promise<LemmaRankCoverageData | null>
  getTopLemmasBuild: (params: { targetLanguage: string }) => Promise<TopLemmasBuild | null>
}

export const LemmaRanksRepository = (): LemmaRanksRepositoryInterface => {
  return {
    listBuiltLanguages,
    getRankBuildTime,
    listRanksForLemmas,
    getCoverageData,
    getTopLemmasBuild,
  }
}
