import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { composeGermanCitation } from '@flicktionary/core/utils/german-noun-forms'
import type { Grammar, ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The content a flashcard actually renders, after resolving a form card against
// its lemma. A form facet now carries its OWN full payload (translation /
// definition / examples / grammar); this prefers the form's payload per field
// and falls back to the lemma only where the form is silent — EXCEPT IPA, which
// never falls back (a lemma's transcription is wrong for an inflection). Citation
// cards (target_form='') resolve straight from the lemma row.
export type ResolvedCardContent = {
  isForm: boolean
  // Main text for the 'headword' slot (the form's display, or the lemma's).
  // For a German citation noun this is the articled title (`der Bestandteil`).
  displayForm: string
  // German citation sub-line (`pl -e`, `die Häuser`, `pl -n, Gen. -ns`) rendered
  // beneath the headword. null for non-German nouns and form cards.
  citationForms: string | null
  // Resolved transcription: the form's own IPA for forms (no lemma fallback),
  // the lemma's IPA for citation. null when none is displayable.
  ipa: string | null
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  // Morphology bag for the chips (form's own when present, else the lemma's).
  grammar: Grammar | null
  // Secondary "lemma — gloss" line shown beneath a form card's answer. null for
  // citation cards (the lemma IS the card).
  lemma: { displayForm: string; translation: string | null } | null
}

// A non-empty trimmed string, or null (treats '' and whitespace as absent so the
// slot machinery hides the field and the lemma fallback can take over).
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null)

const grammarOf = (payload: Record<string, unknown> | null | undefined): Grammar =>
  payload && typeof payload.grammar === 'object' && payload.grammar !== null && !Array.isArray(payload.grammar)
    ? (payload.grammar as Grammar)
    : {}

export const resolveCardContent = (
  card: ReviewTerm,
  targetLanguage: string,
  englishIpaDialect: 'ga' | 'rp'
): ResolvedCardContent => {
  const lemmaGrammar = (card.grammar ?? {}) as Grammar

  const payload = card.facetPayload
  const isForm = card.targetForm !== '' && !!payload && typeof payload.form === 'string'

  if (!isForm) {
    const citation = composeGermanCitation({
      headword: card.headword,
      grammar: lemmaGrammar,
      targetLanguage,
    })
    return {
      isForm: false,
      displayForm: citation.title,
      citationForms: citation.forms,
      ipa: pickIpa(lemmaGrammar.ipa, targetLanguage, englishIpaDialect) ?? null,
      translation: card.translation,
      definition: card.definition,
      targetExample: card.targetExample,
      nativeExample: card.nativeExample,
      grammar: card.grammar,
      lemma: null,
    }
  }

  const p = payload as Record<string, unknown>
  const formGrammar = grammarOf(p)
  const hasFormGrammar = Object.keys(formGrammar).length > 0
  const formDisplay = (typeof formGrammar.display_form === 'string' && formGrammar.display_form) || (p.form as string)
  const lemmaDisplay = (typeof lemmaGrammar.display_form === 'string' && lemmaGrammar.display_form) || card.headword

  return {
    isForm: true,
    displayForm: formDisplay,
    citationForms: null,
    // Form IPA only — never the lemma's (it would be wrong for the inflection).
    ipa: hasFormGrammar ? (pickIpa(formGrammar.ipa, targetLanguage, englishIpaDialect) ?? null) : null,
    translation: str(p.translation) ?? card.translation,
    definition: str(p.definition) ?? card.definition,
    targetExample: str(p.targetExample) ?? card.targetExample,
    nativeExample: str(p.nativeExample) ?? card.nativeExample,
    grammar: hasFormGrammar ? formGrammar : card.grammar,
    lemma: { displayForm: lemmaDisplay, translation: card.translation },
  }
}
