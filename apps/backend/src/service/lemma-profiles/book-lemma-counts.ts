import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import { applyFrequencyAsymmetryGuard } from '../checkpoint/checkpoint-matching'

export type ProfileTokenGroupInput = {
  foldedToken: string
  tokenCount: number
  candidateLemmas: readonly string[]
}

// The lemmas whose ranks the guard needs: only ambiguous groups consult ranks.
export const lemmasNeedingRanks = (groups: readonly ProfileTokenGroupInput[]): string[] => {
  const lemmas = new Set<string>()
  for (const group of groups) {
    if (group.candidateLemmas.length < 2) continue
    for (const lemma of group.candidateLemmas) lemmas.add(lemma)
  }
  return [...lemmas]
}

export type BookPartLemmaCount = {
  // Every occurrence the lemma is a plausible reading of (after the guard).
  occurrences: number
  // Occurrences where it is the MOST LIKELY reading: the highest-freq_mass
  // survivor of its token (alphabetical on ties, for determinism).
  primaryOccurrences: number
}

// Per-lemma occurrences for one book part. The profile's raw candidate groups
// first go through the checkpoint homograph guard (so «при» never counts
// toward «переть»). Then:
//   - occurrences: every surviving candidate is credited the group's FULL
//     token count — the pinned-book priority's input. The question there is
//     "will I run into this word", and after the guard the survivors are
//     genuinely plausible readings; splitting the count would undercount the
//     rarer reading exactly where the text could mean either.
//   - primaryOccurrences: only the most likely survivor is credited — the
//     "Learn before you read" list's input, which shows words to a person: an
//     ambiguous form like «полок» must list one word, not «полка», «полк» and
//     «полок» side by side.
export const countBookPartLemmas = (
  groups: readonly ProfileTokenGroupInput[],
  ranks: ReadonlyMap<string, LemmaRankInfo>
): Map<string, BookPartLemmaCount> => {
  const guarded = applyFrequencyAsymmetryGuard(
    new Map(groups.map((group) => [group.foldedToken, new Set(group.candidateLemmas)])),
    ranks
  )
  const counts = new Map<string, BookPartLemmaCount>()
  for (const group of groups) {
    const survivors = [...(guarded.get(group.foldedToken) ?? [])]
    if (survivors.length === 0) continue
    const primary = mostLikelyReading(survivors, ranks)
    for (const lemma of survivors) {
      const count = counts.get(lemma) ?? { occurrences: 0, primaryOccurrences: 0 }
      count.occurrences += group.tokenCount
      if (lemma === primary) count.primaryOccurrences += group.tokenCount
      counts.set(lemma, count)
    }
  }
  return counts
}

// The most frequent reading of an ambiguous token (unranked readings weigh 0),
// alphabetical on ties. The difficulty stat picks its representative the same way.
export const mostLikelyReading = (lemmas: readonly string[], ranks: ReadonlyMap<string, LemmaRankInfo>): string => {
  let best = lemmas[0]!
  let bestMass = ranks.get(best)?.freqMass ?? 0
  for (const lemma of lemmas.slice(1)) {
    const mass = ranks.get(lemma)?.freqMass ?? 0
    if (mass > bestMass || (mass === bestMass && lemma < best)) {
      best = lemma
      bestMass = mass
    }
  }
  return best
}
