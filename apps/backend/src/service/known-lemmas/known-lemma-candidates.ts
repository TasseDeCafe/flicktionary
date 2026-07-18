import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { foldSelectionTokens } from '../checkpoint/checkpoint-matching'

export type KnownLemmaCandidatesDependencies = {
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
}

// The gloss-sheet chip's read path: which of the selection's candidate lemmas
// has this user marked known? Resolves the selection's folded tokens through
// the shared checkpoint matcher and intersects with known_lemmas. Empty array
// → no chip. Un-marking sends these same candidates back (removing ALL of
// them — symmetric with the sweep marking all candidates of an ambiguous
// token).
export const getKnownLemmaCandidates = async (
  params: { userId: string; targetLanguage: string; selectionText: string },
  deps: KnownLemmaCandidatesDependencies
): Promise<string[]> => {
  if (!KAIKKI_LANGUAGES.has(params.targetLanguage)) return []
  const foldedTokens = foldSelectionTokens(params.selectionText, params.targetLanguage)
  if (foldedTokens.length === 0) return []

  const resolved = await deps.wiktionaryMatchRepository.resolveFoldedLemmasForTokens({
    targetLanguage: params.targetLanguage,
    foldedTokens,
  })
  const candidates = new Set<string>()
  for (const lemmas of resolved.values()) {
    for (const lemma of lemmas) candidates.add(lemma)
  }
  if (candidates.size === 0) return []

  const known = await deps.knownLemmasRepository.filterKnown({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    lemmas: [...candidates],
  })
  return known.sort()
}
