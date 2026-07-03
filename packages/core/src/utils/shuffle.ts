// Fisher–Yates over a copy. The rng is injectable so callers that need
// reproducibility (tests, seeded question builds) can pass their own.
export const shuffled = <T>(items: T[], rng: () => number = Math.random): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}
