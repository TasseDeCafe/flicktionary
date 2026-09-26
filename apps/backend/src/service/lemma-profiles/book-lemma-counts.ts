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

// Per-lemma occurrences for one book part, the input of the pinned-book
// "occurrences ahead" priority. The profile's raw candidate groups first go
// through the checkpoint homograph guard (so «при» never counts toward
// «переть»), then every surviving candidate is credited the group's FULL
// token count. The question is "will I run into this word", and after the
// guard the survivors are genuinely plausible readings — splitting the count
// would undercount the rarer reading exactly where the text could mean either.
export const countBookPartLemmas = (
  groups: readonly ProfileTokenGroupInput[],
  ranks: ReadonlyMap<string, LemmaRankInfo>
): Map<string, number> => {
  const guarded = applyFrequencyAsymmetryGuard(
    new Map(groups.map((group) => [group.foldedToken, new Set(group.candidateLemmas)])),
    ranks
  )
  const counts = new Map<string, number>()
  for (const group of groups) {
    for (const lemma of guarded.get(group.foldedToken) ?? []) {
      counts.set(lemma, (counts.get(lemma) ?? 0) + group.tokenCount)
    }
  }
  return counts
}
