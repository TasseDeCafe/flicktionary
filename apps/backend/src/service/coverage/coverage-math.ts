import { foldUserHeadwordCandidates } from '@flicktionary/core/utils/checkpoint-fold'
import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { CoverageVocabRow } from '../../transport/database/user-lookups/user-lookups-repository'

// Pure math for the whole-language coverage stat. The headline is BINARY
// blended token-mass coverage: studied ∪ known lemmas count as P(known)=1 —
// deliberately NOT FSRS retrievability, so the number is stable and only
// moves when the user's vocabulary actually changes (the difficulty stat is
// the retrievability-weighted instrument; this one is a progress picture).

// Rank-band upper bounds for the per-band breakdown; the tail beyond the last
// bound is an implicit fourth band.
export const COVERAGE_BANDS = [1000, 3000, 10000] as const

export type CoverageComputation = {
  // Sorted ascending; disjoint (studied wins a shared lemma).
  studiedRanks: number[]
  knownRanks: number[]
  studiedCount: number
  knownCount: number
  coveredMass: number
  // Mass of verified STUDIED lemmas only — a known-only lemma stays "claimed"
  // forever (no review history can exist for it).
  verifiedMass: number
  // Covered mass per band, aligned with COVERAGE_BANDS + trailing tail entry.
  bandCoveredMasses: number[]
  mweCount: number
}

// A saved headword counts as a multi-word expression only if EVERY fold
// candidate still contains whitespace: en "to run" folds to the single-word
// dot "run", so it belongs to the grid, not the expressions counter.
const isExpressionHeadword = (headword: string, targetLanguage: string): boolean => {
  const candidates = foldUserHeadwordCandidates(headword, targetLanguage)
  return candidates.length > 0 && candidates.every((candidate) => /\s/.test(candidate))
}

export const computeCoverage = (params: {
  vocab: readonly CoverageVocabRow[]
  knownLemmas: readonly string[]
  ranksByLemma: ReadonlyMap<string, LemmaRankInfo>
  targetLanguage: string
}): CoverageComputation => {
  // Studied side: every fold candidate of every live saved headword. A lemma
  // is verified if ANY contributing saved row carries verifying evidence.
  const studiedVerified = new Map<string, boolean>()
  const expressions = new Set<string>()
  for (const row of params.vocab) {
    if (isExpressionHeadword(row.headword, params.targetLanguage)) {
      // Dedupe across saved senses: one folded expression = one counter entry.
      expressions.add(foldUserHeadwordCandidates(row.headword, params.targetLanguage)[0] ?? row.headword)
      continue
    }
    for (const lemma of foldUserHeadwordCandidates(row.headword, params.targetLanguage)) {
      studiedVerified.set(lemma, (studiedVerified.get(lemma) ?? false) || row.hasVerifiedReview)
    }
  }

  const bandCoveredMasses = new Array<number>(COVERAGE_BANDS.length + 1).fill(0)
  const bandIndexOf = (rank: number): number => {
    for (let i = 0; i < COVERAGE_BANDS.length; i++) {
      if (rank <= COVERAGE_BANDS[i]) return i
    }
    return COVERAGE_BANDS.length
  }

  const studiedRanks: number[] = []
  const knownRanks: number[] = []
  let coveredMass = 0
  let verifiedMass = 0

  for (const [lemma, verified] of studiedVerified) {
    const rankInfo = params.ranksByLemma.get(lemma)
    if (!rankInfo) continue
    studiedRanks.push(rankInfo.rank)
    coveredMass += rankInfo.freqMass
    bandCoveredMasses[bandIndexOf(rankInfo.rank)] += rankInfo.freqMass
    if (verified) verifiedMass += rankInfo.freqMass
  }

  // Known marks fill only lemmas with no live saved lookup (studied > known —
  // the same read-time precedence as the difficulty knowledge map).
  for (const lemma of new Set(params.knownLemmas)) {
    if (studiedVerified.has(lemma)) continue
    const rankInfo = params.ranksByLemma.get(lemma)
    if (!rankInfo) continue
    knownRanks.push(rankInfo.rank)
    coveredMass += rankInfo.freqMass
    bandCoveredMasses[bandIndexOf(rankInfo.rank)] += rankInfo.freqMass
  }

  studiedRanks.sort((a, b) => a - b)
  knownRanks.sort((a, b) => a - b)

  return {
    studiedRanks,
    knownRanks,
    studiedCount: studiedRanks.length,
    knownCount: knownRanks.length,
    coveredMass,
    verifiedMass,
    bandCoveredMasses,
    mweCount: expressions.size,
  }
}
