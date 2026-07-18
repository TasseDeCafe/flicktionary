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

export interface LemmaRanksRepositoryInterface {
  listBuiltLanguages: () => Promise<Set<string>>
  listRanksForLemmas: (params: {
    targetLanguage: string
    lemmas: readonly string[]
  }) => Promise<Map<string, LemmaRankInfo>>
}

export const LemmaRanksRepository = (): LemmaRanksRepositoryInterface => {
  return {
    listBuiltLanguages,
    listRanksForLemmas,
  }
}
