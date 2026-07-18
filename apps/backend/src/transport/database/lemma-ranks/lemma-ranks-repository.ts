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

// Whole-language mass totals for the coverage headline and band percentages.
// One aggregate scan per language (16–50k rows — milliseconds); the manifest
// join doubles as the supported gate, so languages without a build row are
// simply absent from the map.
const listBuildAggregates = async (
  bandUpperBounds: readonly [number, number, number]
): Promise<Map<string, LemmaRankBuildAggregate>> => {
  const [b1, b2, b3] = bandUpperBounds
  const rows = (await sql`
    SELECT b.target_language, b.version, b.row_count,
      agg.total_mass, agg.cum_1, agg.cum_2, agg.cum_3
    FROM public.lemma_rank_builds b
    JOIN (
      SELECT target_language,
        sum(freq_mass) AS total_mass,
        sum(freq_mass) FILTER (WHERE rank <= ${b1}) AS cum_1,
        sum(freq_mass) FILTER (WHERE rank <= ${b2}) AS cum_2,
        sum(freq_mass) FILTER (WHERE rank <= ${b3}) AS cum_3
      FROM public.lemma_ranks
      GROUP BY target_language
    ) agg ON agg.target_language = b.target_language
  `) as Array<{
    target_language: string
    version: number
    row_count: number
    total_mass: number
    cum_1: number | null
    cum_2: number | null
    cum_3: number | null
  }>
  const result = new Map<string, LemmaRankBuildAggregate>()
  for (const row of rows) {
    const total = Number(row.total_mass)
    const cum1 = Number(row.cum_1 ?? 0)
    const cum2 = Number(row.cum_2 ?? 0)
    const cum3 = Number(row.cum_3 ?? 0)
    result.set(row.target_language, {
      version: row.version,
      rowCount: row.row_count,
      totalMass: total,
      bandMasses: [cum1, cum2 - cum1, cum3 - cum2, total - cum3],
    })
  }
  return result
}

export type LemmaRankBuildManifest = { version: number; rowCount: number }

const findBuildManifest = async (targetLanguage: string): Promise<LemmaRankBuildManifest | null> => {
  const rows = (await sql`
    SELECT version, row_count FROM public.lemma_rank_builds
    WHERE target_language = ${targetLanguage}
  `) as Array<{ version: number; row_count: number }>
  const row = rows[0]
  return row ? { version: row.version, rowCount: row.row_count } : null
}

// The head of the frequency list, for the detail view's dot tooltips (index =
// rank − 1). Rides the (target_language, rank) index.
const listTopLemmas = async (params: { targetLanguage: string; limit: number }): Promise<string[]> => {
  const rows = (await sql`
    SELECT lemma FROM public.lemma_ranks
    WHERE target_language = ${params.targetLanguage}
    ORDER BY rank ASC
    LIMIT ${params.limit}
  `) as Array<{ lemma: string }>
  return rows.map((r) => r.lemma)
}

export interface LemmaRanksRepositoryInterface {
  listBuiltLanguages: () => Promise<Set<string>>
  listRanksForLemmas: (params: {
    targetLanguage: string
    lemmas: readonly string[]
  }) => Promise<Map<string, LemmaRankInfo>>
  listBuildAggregates: (
    bandUpperBounds: readonly [number, number, number]
  ) => Promise<Map<string, LemmaRankBuildAggregate>>
  findBuildManifest: (targetLanguage: string) => Promise<LemmaRankBuildManifest | null>
  listTopLemmas: (params: { targetLanguage: string; limit: number }) => Promise<string[]>
}

export const LemmaRanksRepository = (): LemmaRanksRepositoryInterface => {
  return {
    listBuiltLanguages,
    listRanksForLemmas,
    listBuildAggregates,
    findBuildManifest,
    listTopLemmas,
  }
}
