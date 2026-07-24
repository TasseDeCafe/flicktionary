// Truthfulness filter for the mark-known sweep's candidate lemmas. The
// resolver deliberately returns EVERY lemma a token could be (checkpoint
// credit is spec'd that way — docs/SRS.md), but crediting them all as "known"
// lets everyday tokens mark junk homograph entries: "because" → becuz,
// "five" → MI5, "damn" → diaminomaleonitrile. Rank membership is the
// arbiter: the offline lemma_ranks build already drops lemmas whose corpus
// mass is epsilon noise, so an unranked candidate standing next to a ranked
// one is almost never the word the reader actually saw.
//
// Pure per-token rules (rank membership is fetched by the caller, at read
// time — nothing rank-dependent is ever stored):
// - multi-word candidates are always dropped (they can never rank or render
//   in the coverage grid),
// - if at least one candidate is ranked, the unranked ones are dropped,
// - if NO candidate is ranked, all are kept — a rare real word that is the
//   sole owner of its token (e.g. "musth" appearing as itself) must stay
//   creditable, and languages without a ranks build pass through unchanged.
export const filterCreditableCandidates = (params: {
  lemmasByToken: ReadonlyMap<string, ReadonlySet<string>>
  rankedLemmas: ReadonlySet<string>
}): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>()
  for (const [token, lemmas] of params.lemmasByToken) {
    const singleWord = [...lemmas].filter((lemma) => !lemma.includes(' '))
    const ranked = singleWord.filter((lemma) => params.rankedLemmas.has(lemma))
    const kept = ranked.length > 0 ? ranked : singleWord
    if (kept.length > 0) result.set(token, new Set(kept))
  }
  return result
}
