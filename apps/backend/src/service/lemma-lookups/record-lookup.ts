import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { LemmaLookupsRepositoryInterface } from '../../transport/database/lemma-lookups/lemma-lookups-repository'
import type { LemmaRanksRepositoryInterface } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import { applyFrequencyAsymmetryGuard, foldSelectionTokens } from '../checkpoint/checkpoint-matching'
import type { WithTransaction } from '../practice/rate-term'

export type RecordLookupDependencies = {
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  lemmaRanksRepository: LemmaRanksRepositoryInterface
  lemmaLookupsRepository: LemmaLookupsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  withTransaction: WithTransaction
}

// An explicit gloss lookup (a tap that opens the gloss sheet, a pinned
// extension hover gloss — never a bare hover) as a new-term demand signal.
// Single-token selections only; the token resolves through the checkpoint
// matcher plus the homograph guard, so «при» never records «переть». When the
// user already saved the word, the episode goes straight to that term's
// encounter_count (recordEncounter, which collapses on the demand clock) and
// the watermark advances so a later save can't count it again; otherwise it
// waits in lemma_lookups for the save (creditLookupDemand). Languages without
// wiktionary data record nothing.
export const recordLookup = async (
  params: { userId: string; targetLanguage: string; selectionText: string },
  deps: RecordLookupDependencies
): Promise<{ lemmas: string[] }> => {
  const { userId, targetLanguage } = params
  if (!KAIKKI_LANGUAGES.has(targetLanguage)) return { lemmas: [] }
  const tokens = foldSelectionTokens(params.selectionText, targetLanguage)
  if (tokens.length !== 1) return { lemmas: [] }
  const token = tokens[0]

  const resolved = await deps.wiktionaryMatchRepository.resolveFoldedLemmasForTokens({
    targetLanguage,
    foldedTokens: [token],
  })
  const rawLemmas = resolved.get(token)
  if (!rawLemmas || rawLemmas.size === 0) return { lemmas: [] }
  const ranks =
    rawLemmas.size > 1
      ? await deps.lemmaRanksRepository.listRanksForLemmas({ targetLanguage, lemmas: [...rawLemmas] })
      : new Map()
  const lemmas = [...(applyFrequencyAsymmetryGuard(new Map([[token, rawLemmas]]), ranks).get(token) ?? [])]
  if (lemmas.length === 0) return { lemmas: [] }

  await deps.withTransaction(async (tx) => {
    await deps.lemmaLookupsRepository.recordLookupEpisode({ userId, targetLanguage, lemmas }, tx)
    const termIds = await deps.userLookupsRepository.findLiveIdsByLemmaKeys({ userId, targetLanguage, lemmas }, tx)
    if (termIds.length === 0) return
    await deps.userLookupsRepository.recordEncounter(termIds, tx)
    await deps.lemmaLookupsRepository.markCredited({ userId, targetLanguage, lemmas }, tx)
  })
  return { lemmas }
}
