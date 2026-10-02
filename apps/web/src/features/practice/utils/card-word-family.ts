import { WORD_FAMILY_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
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

export type ProductionCluePart = {
  role: 'prefix' | 'root' | 'suffix'
  meaning: string
  // Set when the part is a word the learner has, so the clue can point at it
  // without spelling it.
  anchor: 'known' | 'saved' | null
}

export type ProductionClue = {
  formOfKind: NonNullable<GlossWordFamily['formOf']>['kind'] | null
  parts: ProductionCluePart[]
}

// Target-language script in an explanation: a meaning should never carry it,
// but one that does would spell part of the answer. Widen this when a
// language in another script joins WORD_FAMILY_LANGUAGES.
const TARGET_SCRIPT = /\p{Script=Cyrillic}/u

// Etymology notes ("from french sérieux") quote the donor word, whose sound is
// the answer of a loanword. Only en explanations are matched; other languages
// rely on the cognate rule and the insight prompt.
const DONOR_NOTE =
  /\bfrom (?:old )?(?:french|german|latin|greek|english|italian|dutch|polish|turkic|turkish|tatar|arabic|persian|church slavonic|old church slavonic|swedish|norse|yiddish|spanish)\b/i

const roleOf = (part: { text: string; isAffix: boolean }): ProductionCluePart['role'] | 'interfix' => {
  if (!part.isAffix) return 'root'
  const leading = part.text.startsWith('-')
  const trailing = part.text.endsWith('-')
  if (leading && trailing) return 'interfix'
  return trailing ? 'prefix' : 'suffix'
}

// The meaning-only clue a production front can show (#517): what each part of
// the answer contributes and whether it is a participle etc., but never a
// spelling — the parts, anchors and form-of lemma all spell the answer. Null
// when there is nothing safe and useful: no explained part, or cognates (a
// loanword, whose sound is the answer).
export const productionClueFor = (
  wordFamily: GlossWordFamily | null | undefined,
  targetLanguage: string
): ProductionClue | null => {
  if (!wordFamily?.parts || wordFamily.cognates.length > 0) return null
  const roles = wordFamily.parts.map(roleOf)
  // An affix-only breakdown (по- + -нимать) still has a stem: the first
  // non-prefix affix reads as the root.
  if (!roles.includes('root')) {
    const stem = roles.findIndex((role) => role === 'suffix')
    if (stem >= 0) roles[stem] = 'root'
  }

  const anchors = new Map(
    wordFamily.anchors.map((anchor) => [foldCheckpointToken(anchor.lemma, targetLanguage), anchor.source])
  )
  const parts = wordFamily.parts.flatMap((part, index): ProductionCluePart[] => {
    const role = roles[index]
    // A linking vowel (водопад's -о-) means nothing on its own.
    if (role === 'interfix' || !part.meaning) return []
    const anchor = role === 'root' ? (anchors.get(foldCheckpointToken(part.text, targetLanguage)) ?? null) : null
    return [{ role, meaning: part.meaning, anchor }]
  })
  if (parts.length === 0) return null
  if (parts.some((part) => TARGET_SCRIPT.test(part.meaning) || DONOR_NOTE.test(part.meaning))) return null
  return { formOfKind: wordFamily.formOf?.kind ?? null, parts }
}
