import { sharesStem } from './parse-word-family'

// The offline half of the word-family graph (scripts/build-word-family.ts):
// turns each entry's direct parents and related words into the edge rows of
// wiktionary_word_family_edges. Inputs are already folded and restricted to
// content lemmas; this only walks and filters. Free of workspace-package
// imports for the standalone build script.

export const MAX_WORD_FAMILY_DEPTH = 3

export type EntryFamilyFacts = {
  lemma: string
  pos: string
  parents: readonly string[]
  relatedWords: readonly string[]
}

export type WordFamilyEdge = {
  lemma: string
  lemmaPos: string
  relative: string
  kind: 'ancestor' | 'related'
  depth: number
}

export const computeWordFamilyEdges = (
  facts: readonly EntryFamilyFacts[],
  prefixes: readonly string[]
): WordFamilyEdge[] => {
  // Walking needs a headword's parents regardless of its POS: template
  // components don't say which homograph they mean.
  const parentsByLemma = new Map<string, Set<string>>()
  for (const fact of facts) {
    if (fact.parents.length === 0) continue
    const set = parentsByLemma.get(fact.lemma) ?? new Set<string>()
    for (const parent of fact.parents) if (parent !== fact.lemma) set.add(parent)
    parentsByLemma.set(fact.lemma, set)
  }

  const edges = new Map<string, WordFamilyEdge>()
  const addEdge = (edge: WordFamilyEdge) => {
    const key = `${edge.lemma}\t${edge.lemmaPos}\t${edge.relative}\t${edge.kind}`
    if (!edges.has(key)) edges.set(key, edge)
  }

  for (const fact of facts) {
    // Breadth-first, so each ancestor is recorded at its shortest depth;
    // `seen` also stops etymology cycles.
    const seen = new Set<string>([fact.lemma])
    let frontier = [...fact.parents]
    for (let depth = 1; depth <= MAX_WORD_FAMILY_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const ancestor of frontier) {
        if (seen.has(ancestor)) continue
        seen.add(ancestor)
        addEdge({ lemma: fact.lemma, lemmaPos: fact.pos, relative: ancestor, kind: 'ancestor', depth })
        for (const grand of parentsByLemma.get(ancestor) ?? []) next.push(grand)
      }
      frontier = next
    }

    for (const related of fact.relatedWords) {
      if (related !== fact.lemma && sharesStem(fact.lemma, related, prefixes)) {
        addEdge({ lemma: fact.lemma, lemmaPos: fact.pos, relative: related, kind: 'related', depth: 1 })
      }
    }
  }
  return [...edges.values()]
}
