import { WORD_FAMILY_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { GlossWordFamily } from '@flicktionary/core/types/gloss-view-state'
import type { ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The glosses.wordFamily request for a flashcard — shared by the face (the
// back's line) and the practice view (the front Clue), so both read one
// cached query. Null for pronunciation cards and languages without
// word-family data.
export const cardWordFamilyParams = (
  card: ReviewTerm,
  targetLanguage: string
): { headword: string; targetLanguage: string; pos: string | null } | null =>
  card.skill !== 'pronunciation' && WORD_FAMILY_LANGUAGES.has(targetLanguage)
    ? { headword: card.headword, targetLanguage, pos: card.grammar?.pos ?? null }
    : null

// The part of a word's family line a recognition front can show as a clue,
// or null when there is nothing worth a Clue button. Cognates stay on the
// back: "Looks like: dozen" is close to the answer itself. A relative the
// learner has, a form-of note, or an explained part is a real clue; bare
// parts (за- + мёрзнуть without meanings) mostly restate the headword.
export const frontClueFor = (wordFamily: GlossWordFamily | null | undefined): GlossWordFamily | null => {
  if (!wordFamily) return null
  const explained = wordFamily.parts?.some((part) => part.meaning) ?? false
  if (wordFamily.anchors.length === 0 && !wordFamily.formOf && !explained) return null
  return { ...wordFamily, cognates: [] }
}
