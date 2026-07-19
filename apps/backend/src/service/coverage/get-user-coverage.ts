import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { CoverageSnapshotsRepositoryInterface } from '../../transport/database/coverage-snapshots/coverage-snapshots-repository'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { LemmaRanksRepositoryInterface } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { COVERAGE_BANDS, computeCoverage } from './coverage-math'

// The whole-language coverage read behind coverage.getCoverage: one batched
// response for every practiced language (the dashboard card's chips and the
// detail route share one cached payload). Only COVERED ranks ship — an
// unknown dot is the absence of a rank — so the client can render any rank
// range without a second fetch. A manifest joined to its rank rows is the
// supported gate (an empty ranks table can't claim support; tests can seed
// synthetic language codes).

export type CoverageBandDto = {
  fromRank: number
  // null = the open-ended tail band.
  toRank: number | null
  // 100 × bandCoveredMass / bandMass — knowledge WITHIN the band ("P% of this
  // band's text share"), not the band's share of the headline.
  coveragePct: number
}

export type LanguageCoverageDto = {
  targetLanguage: string
  supported: boolean
  denominator: number | null
  buildVersion: number | null
  // Raw 0–100 floats; the client rounds for display.
  coveragePct: number | null
  verifiedPct: number | null
  studiedRanks: number[]
  knownRanks: number[]
  bands: CoverageBandDto[]
  mweCount: number | null
}

export type CoverageDependencies = {
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
  lemmaRanksRepository: LemmaRanksRepositoryInterface
  coverageSnapshotsRepository: CoverageSnapshotsRepositoryInterface
}

const UNSUPPORTED_OF = (targetLanguage: string): LanguageCoverageDto => ({
  targetLanguage,
  supported: false,
  denominator: null,
  buildVersion: null,
  coveragePct: null,
  verifiedPct: null,
  studiedRanks: [],
  knownRanks: [],
  bands: [],
  mweCount: null,
})

const utcDayOf = (date: Date): string => date.toISOString().slice(0, 10)

export const getUserCoverage = async (
  params: { userId: string; now?: Date },
  deps: CoverageDependencies
): Promise<LanguageCoverageDto[]> => {
  const now = params.now ?? new Date()
  const prefs = await deps.userTargetLanguagePrefsRepository.listForUser(params.userId)
  if (prefs.length === 0) return []

  const results: LanguageCoverageDto[] = []
  for (const pref of prefs) {
    const language = pref.target_language
    const [vocab, knownLemmas] = await Promise.all([
      deps.userLookupsRepository.listCoverageVocab({ userId: params.userId, targetLanguage: language }),
      deps.knownLemmasRepository.listLemmas(params.userId, language),
    ])

    // One rank fetch over the union of both sides' candidate lemmas.
    const candidateLemmas = new Set<string>(knownLemmas)
    for (const row of vocab) {
      for (const lemma of foldUserHeadwordCandidates(row.headword, language)) {
        candidateLemmas.add(lemma)
      }
    }
    const coverageData = await deps.lemmaRanksRepository.getCoverageData({
      targetLanguage: language,
      lemmas: [...candidateLemmas],
      bandUpperBounds: COVERAGE_BANDS,
    })
    if (!coverageData) {
      results.push(UNSUPPORTED_OF(language))
      continue
    }
    const { aggregate, ranksByLemma } = coverageData

    const computation = computeCoverage({ vocab, knownLemmas, ranksByLemma, targetLanguage: language })

    const coveragePct = aggregate.totalMass > 0 ? (100 * computation.coveredMass) / aggregate.totalMass : 0
    const verifiedPct = aggregate.totalMass > 0 ? (100 * computation.verifiedMass) / aggregate.totalMass : 0
    const bands: CoverageBandDto[] = COVERAGE_BANDS.map((bound, i) => ({
      fromRank: i === 0 ? 1 : COVERAGE_BANDS[i - 1] + 1,
      toRank: bound,
      coveragePct: aggregate.bandMasses[i] > 0 ? (100 * computation.bandCoveredMasses[i]) / aggregate.bandMasses[i] : 0,
    }))
    const tailIndex = COVERAGE_BANDS.length
    bands.push({
      fromRank: COVERAGE_BANDS[tailIndex - 1] + 1,
      toRank: null,
      coveragePct:
        aggregate.bandMasses[tailIndex] > 0
          ? (100 * computation.bandCoveredMasses[tailIndex]) / aggregate.bandMasses[tailIndex]
          : 0,
    })

    results.push({
      targetLanguage: language,
      supported: true,
      denominator: aggregate.rowCount,
      buildVersion: aggregate.version,
      coveragePct,
      verifiedPct,
      studiedRanks: computation.studiedRanks,
      knownRanks: computation.knownRanks,
      bands,
      mweCount: computation.mweCount,
    })

    // History collection for a future progress chart: fire-and-forget — the
    // response never waits on or fails from the snapshot write.
    void deps.coverageSnapshotsRepository
      .upsertDaily({
        userId: params.userId,
        targetLanguage: language,
        day: utcDayOf(now),
        buildVersion: aggregate.version,
        denominator: aggregate.rowCount,
        studiedCount: computation.studiedCount,
        knownCount: computation.knownCount,
        mweCount: computation.mweCount,
        coveragePct,
        verifiedPct,
      })
      .catch((error) => {
        logWithSentry({
          message: 'coverage snapshot upsert failed',
          params: { userId: params.userId, targetLanguage: language },
          error,
        })
      })
  }

  return results
}
