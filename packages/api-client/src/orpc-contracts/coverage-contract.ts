import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

// Whole-language vocabulary coverage (the dashboard grid). Supported = the
// language has a lemma_rank_builds manifest row; unsupported languages return
// supported:false with empty/null fields so the client hides them.

const CoverageBandSchema = z.object({
  fromRank: z.number().int(),
  // null = the open-ended tail band.
  toRank: z.number().int().nullable(),
  // 100 × bandCoveredMass / bandMass — knowledge WITHIN the band, not the
  // band's share of the headline number.
  coveragePct: z.number(),
})

const LanguageCoverageSchema = z.object({
  targetLanguage: z.string(),
  supported: z.boolean(),
  denominator: z.number().int().nullable(),
  buildVersion: z.number().int().nullable(),
  // Binary blended token-mass % (studied ∪ known as P=1); raw floats, the
  // client rounds. verifiedPct counts only studied lemmas with a live
  // successful explicit-or-checkpoint meaning review (never the assertion
  // lane) — known-only lemmas stay "claimed" forever.
  coveragePct: z.number().nullable(),
  verifiedPct: z.number().nullable(),
  // Covered ranks only, sorted ascending and disjoint (studied wins a shared
  // lemma); an unknown dot is the absence of a rank, so any rank range
  // renders client-side without another fetch.
  studiedRanks: z.array(z.number().int()),
  knownRanks: z.array(z.number().int()),
  bands: z.array(CoverageBandSchema),
  mweCount: z.number().int().nullable(),
})

export type LanguageCoverage = z.infer<typeof LanguageCoverageSchema>

export const coverageContract = {
  // One batched read for every practiced language — the dashboard card's
  // language chips and the /coverage/$lang detail view share this response.
  getCoverage: oc
    .route({ method: 'GET', path: '/coverage', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({}))
    .output(
      z.object({
        data: z.object({
          languages: z.array(LanguageCoverageSchema),
        }),
      })
    ),

  // The head of the frequency list (index = rank − 1) for the detail view's
  // dot tooltips. buildVersion lets the client refuse to pair these labels
  // with coverage ranks from a different lemma_ranks build.
  getTopLemmas: oc
    .route({ method: 'GET', path: '/coverage/{targetLanguage}/lemmas', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().trim().min(1).max(40),
      })
    )
    .output(
      z.object({
        data: z.object({
          buildVersion: z.number().int(),
          lemmas: z.array(z.string()),
        }),
      })
    ),
}
