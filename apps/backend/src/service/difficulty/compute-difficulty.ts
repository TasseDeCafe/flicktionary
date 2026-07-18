import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'

// Pure blend logic for the personalized difficulty stat (design pins in the
// checkpoint proposal / docs/READER-SPEC.md): expected coverage = Σ over the
// track's matched token mass of P(known), where each token group contributes
// token_count × max(P(candidate)) exactly once — ambiguity conserves mass, so
// coverage can never exceed 100%.

// P(known) source per lemma, precedence already resolved by the caller: any
// live saved lookup wins over a known mark; a scheduled facet carries its
// FSRS retrievability; a saved-but-not-started term is deliberately 0
// (saving a marked-known word is the correction signal that the user does
// NOT know it).
export type LemmaKnowledge =
  { kind: 'scheduled'; retrievability: number } | { kind: 'saved_not_started' } | { kind: 'known' }

export type ProfileTokenGroup = {
  tokenCount: number
  candidateLemmas: readonly string[]
}

export type DifficultyComputation = {
  // Raw fraction in [0, 1]; null when the profile has no matched tokens.
  expectedCoverage: number | null
  matchedTokenCount: number
  // Distinct representative lemmas (highest freq_mass candidate) of token
  // groups where EVERY candidate is unknown.
  unknownLemmas: string[]
  // The unknown representatives at or above the frequency threshold.
  frequentUnknownLemmas: string[]
  // Distinct saved-not-started lemmas that kept a token group at P=0 — "in
  // your vocabulary, not started", never counted as unknown.
  savedNotStartedLemmas: string[]
  // Distinct marked-known lemmas that contributed P=1 somewhere.
  knownLemmas: string[]
}

// "Frequent" split threshold for unknown words (initial tuning constant).
export const FREQUENT_RANK_THRESHOLD = 5_000

const pickRepresentative = (lemmas: readonly string[], ranks: ReadonlyMap<string, LemmaRankInfo>): string => {
  let best = lemmas[0]
  let bestMass = -1
  for (const lemma of lemmas) {
    const mass = ranks.get(lemma)?.freqMass ?? 0
    if (mass > bestMass) {
      best = lemma
      bestMass = mass
    }
  }
  return best
}

export const computeDifficulty = (params: {
  groups: readonly ProfileTokenGroup[]
  knowledgeByLemma: ReadonlyMap<string, LemmaKnowledge>
  ranksByLemma: ReadonlyMap<string, LemmaRankInfo>
}): DifficultyComputation => {
  let matchedTokenCount = 0
  let coveredMass = 0
  const unknownLemmas = new Set<string>()
  const frequentUnknownLemmas = new Set<string>()
  const savedNotStartedLemmas = new Set<string>()
  const knownLemmas = new Set<string>()

  for (const group of params.groups) {
    if (group.candidateLemmas.length === 0 || group.tokenCount <= 0) continue
    matchedTokenCount += group.tokenCount

    let maxP = 0
    let sawSavedNotStarted: string | null = null
    let allUnknown = true
    for (const lemma of group.candidateLemmas) {
      const knowledge = params.knowledgeByLemma.get(lemma)
      if (!knowledge) continue
      allUnknown = false
      if (knowledge.kind === 'scheduled') {
        // Clamp defensively — a candidate can never contribute more than 1.
        maxP = Math.max(maxP, Math.min(1, Math.max(0, knowledge.retrievability)))
      } else if (knowledge.kind === 'known') {
        maxP = 1
        knownLemmas.add(lemma)
      } else {
        sawSavedNotStarted = sawSavedNotStarted ?? lemma
      }
    }
    coveredMass += group.tokenCount * maxP

    if (allUnknown) {
      const representative = pickRepresentative(group.candidateLemmas, params.ranksByLemma)
      unknownLemmas.add(representative)
      const rank = params.ranksByLemma.get(representative)?.rank
      if (rank !== undefined && rank <= FREQUENT_RANK_THRESHOLD) frequentUnknownLemmas.add(representative)
    } else if (maxP === 0 && sawSavedNotStarted !== null) {
      savedNotStartedLemmas.add(sawSavedNotStarted)
    }
  }

  return {
    expectedCoverage: matchedTokenCount > 0 ? coveredMass / matchedTokenCount : null,
    matchedTokenCount,
    unknownLemmas: [...unknownLemmas].sort(),
    frequentUnknownLemmas: [...frequentUnknownLemmas].sort(),
    savedNotStartedLemmas: [...savedNotStartedLemmas].sort(),
    knownLemmas: [...knownLemmas].sort(),
  }
}

export type DifficultyLabel = 'comfortable' | 'challenging' | 'frustrating'

// Extensive-reading thresholds, computed on the RAW fraction — the displayed
// percent is floored separately so a shown "98%" never carries a sub-0.98
// label.
export const labelForCoverage = (coverage: number): DifficultyLabel => {
  if (coverage >= 0.98) return 'comfortable'
  if (coverage >= 0.95) return 'challenging'
  return 'frustrating'
}

export const flooredCoveragePercent = (coverage: number): number => {
  return Math.floor(Math.min(1, Math.max(0, coverage)) * 100)
}
