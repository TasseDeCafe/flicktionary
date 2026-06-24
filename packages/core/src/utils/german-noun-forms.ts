// Shared German noun-citation composer. Owns the article + plural + genitive
// display logic so every surface (flashcard, rate-sheet, focus title, CSV Anki
// front) renders a German citation identically — the gender→article derivation
// and the plural/genitive display rules live here, not duplicated at each call
// site. Grammar is read defensively (LLM / JSONB writes leave stray nulls and
// odd shapes), so the input is a loose record.

const GERMAN_CODES = new Set(['de', 'deu', 'german'])

export const isGermanLanguage = (code: string | null | undefined): boolean =>
  !!code && GERMAN_CODES.has(code.trim().toLowerCase())

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null)

// der/die/das from grammatical gender. German has no common gender, so `c` (and
// any unknown value) yields null and the caller falls back to a bare headword.
export const germanArticle = (gender: unknown): 'der' | 'die' | 'das' | null => {
  switch (gender) {
    case 'm':
      return 'der'
    case 'f':
      return 'die'
    case 'n':
      return 'das'
    default:
      return null
  }
}

export type GermanFormDisplay = { kind: 'suffix'; text: string } | { kind: 'full'; text: string }

// Reduce an inflected form to a display: a clean suffix when the inflected form
// merely appends to the base (Bestandteil → Bestandteile ⇒ '-e'), otherwise the
// full form (umlaut / stem change: Haus → Häuser ⇒ 'Häuser'). An identical form
// (no change) renders the em-dash placeholder.
export const deriveFormDisplay = (base: string, inflected: string): GermanFormDisplay => {
  if (inflected.startsWith(base)) {
    const leftover = inflected.slice(base.length)
    return { kind: 'suffix', text: leftover.length > 0 ? `-${leftover}` : '—' }
  }
  return { kind: 'full', text: inflected }
}

// Whether a genitive is worth showing on the card. Feminine genitives never
// inflect (hidden); masc/neut hide the predictable `-(e)s`; weak `-(e)n` and
// mixed `-ns` (Name → Namens) show.
export const isNotableGenitive = (gender: unknown, base: string, genitive: string): boolean => {
  if (gender === 'f') return false
  return genitive !== `${base}s` && genitive !== `${base}es`
}

export type GermanCitation = { title: string; forms: string | null }

export type ComposeGermanCitationInput = {
  headword: string
  grammar: Record<string, unknown> | null | undefined
  targetLanguage: string | null | undefined
}

// The single entry point. For a German noun (gender present) it returns the
// articled title (`der Bestandteil`) plus a `forms` sub-line (plural per the
// suffix-vs-full rule, then a notable genitive). For anything else it returns
// the conventional `display_form || headword` title and no forms, so every call
// site can use this unconditionally in place of the old title expression.
export const composeGermanCitation = ({
  headword,
  grammar,
  targetLanguage,
}: ComposeGermanCitationInput): GermanCitation => {
  const g = (grammar ?? {}) as Record<string, unknown>
  const displayFallback = asString(g.display_form) ?? headword

  if (!isGermanLanguage(targetLanguage) || g.pos !== 'noun') {
    return { title: displayFallback, forms: null }
  }
  const article = germanArticle(g.gender)
  if (!article) return { title: displayFallback, forms: null }

  const title = `${article} ${headword}`

  const parts: string[] = []
  const plural = asString(g.plural)
  if (plural) {
    const d = deriveFormDisplay(headword, plural)
    // The plural article (die) already signals plurality for an irregular full
    // form, so it carries no `pl` prefix; a clean suffix needs the `pl` marker.
    parts.push(d.kind === 'suffix' ? `pl ${d.text}` : `die ${plural}`)
  }
  const genitive = asString(g.genitive)
  if (genitive && isNotableGenitive(g.gender, headword, genitive)) {
    const d = deriveFormDisplay(headword, genitive)
    parts.push(d.kind === 'suffix' ? `Gen. ${d.text}` : `Gen. ${genitive}`)
  }

  return { title, forms: parts.length > 0 ? parts.join(', ') : null }
}
