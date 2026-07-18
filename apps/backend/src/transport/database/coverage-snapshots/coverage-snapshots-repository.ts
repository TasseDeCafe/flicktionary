import { sql } from '../postgres-client'

// Lazy per-day history of the whole-language coverage stat (docs/DATA-MODEL.md
// "Coverage snapshots"). Written fire-and-forget by the coverage read; the
// coverage response never waits on or fails from this write. Same-day
// recomputes update the row in place, so history is one row per
// (user, language, UTC day), each pinned to the lemma_ranks build it was
// computed against.

export type UpsertCoverageSnapshotInput = {
  userId: string
  targetLanguage: string
  // UTC calendar date, 'YYYY-MM-DD'.
  day: string
  buildVersion: number
  denominator: number
  studiedCount: number
  knownCount: number
  mweCount: number
  coveragePct: number
  verifiedPct: number
}

const upsertDaily = async (input: UpsertCoverageSnapshotInput): Promise<void> => {
  await sql`
    INSERT INTO public.coverage_snapshots (
      user_id, target_language, day, build_version, denominator,
      studied_count, known_count, mwe_count, coverage_pct, verified_pct
    ) VALUES (
      ${input.userId}, ${input.targetLanguage}, ${input.day}, ${input.buildVersion},
      ${input.denominator}, ${input.studiedCount}, ${input.knownCount},
      ${input.mweCount}, ${input.coveragePct}, ${input.verifiedPct}
    )
    ON CONFLICT (user_id, target_language, day) DO UPDATE SET
      build_version = EXCLUDED.build_version,
      denominator = EXCLUDED.denominator,
      studied_count = EXCLUDED.studied_count,
      known_count = EXCLUDED.known_count,
      mwe_count = EXCLUDED.mwe_count,
      coverage_pct = EXCLUDED.coverage_pct,
      verified_pct = EXCLUDED.verified_pct,
      updated_at = now()
  `
}

export interface CoverageSnapshotsRepositoryInterface {
  upsertDaily: (input: UpsertCoverageSnapshotInput) => Promise<void>
}

export const CoverageSnapshotsRepository = (): CoverageSnapshotsRepositoryInterface => {
  return {
    upsertDaily,
  }
}
