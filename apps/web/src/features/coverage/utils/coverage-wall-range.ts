import type { LanguageCoverage } from '../api/coverage-hooks'

// The default wall stops where the B2 band does: "everything through B2" is
// a picture a learner can visibly fill, while the full list is mostly the
// long tail. Read from the bands so retuning the levels moves the wall too.
export const getDefaultWallEndRank = (coverage: LanguageCoverage): number => {
  const denominator = coverage.denominator ?? 0
  const throughB2 = coverage.bands.find((band) => band.level === 'B2')?.toRank ?? denominator
  return Math.min(throughB2, denominator)
}
