import { getLanguageName } from '../constants/supported-languages'

// English verbs are stored with the marked-infinitive convention (`to stink`)
// per the per-language instructions block, but Wiktionary's entry lives at the
// bare lemma (`stink`). Strip the prefix for English verbs only — nouns and
// other parts of speech pass through untouched.
export const normalizeWiktionaryHeadword = (
  headword: string,
  targetLanguage: string,
  pos?: string | null
): string => {
  const trimmed = headword.trim()
  if (targetLanguage === 'en' && pos === 'verb') {
    return trimmed.replace(/^to\s+/i, '').trim()
  }
  return trimmed
}

// Anchor jumps to the target-language section so multi-language entries open
// at the right heading (e.g. `слушание#Russian`). Returns null when the
// normalized headword is empty.
export const buildWiktionaryUrl = (
  headword: string,
  targetLanguage: string,
  pos?: string | null
): string | null => {
  const normalized = normalizeWiktionaryHeadword(headword, targetLanguage, pos)
  if (!normalized) return null
  const langName = getLanguageName(targetLanguage)
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(normalized)}#${encodeURIComponent(langName)}`
}
