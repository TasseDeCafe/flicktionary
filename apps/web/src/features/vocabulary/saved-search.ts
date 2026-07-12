import type { ChunksSort, VocabFilterSkill, VocabStatus } from '@flicktionary/api-client/orpc-contracts/chunks-contract'

// The Vocabulary tab's URL search shape (sort & filter state + deep-linked
// target language).
export type VocabularySearch = {
  lang?: string
  sort?: ChunksSort
  status?: VocabStatus
  skills?: VocabFilterSkill[]
  forms?: boolean
}

// Module-level stash of the last sort/filter state, mirrored from the list's
// URL search. The focus view's chevron-back reads it so returning from a card
// restores the filters the user was browsing under — the URL alone can't, since
// the close navigation rebuilds /vocabulary without its search. Scoped to that
// return trip on purpose: navigating to the tab fresh (sidebar/bottom-bar) is
// "go home" and should NOT restore, so this is only read on focus-view close.
let savedSearch: VocabularySearch = {}

export const setSavedVocabularySearch = (next: VocabularySearch) => {
  savedSearch = next
}

export const getSavedVocabularySearch = (): VocabularySearch => savedSearch
