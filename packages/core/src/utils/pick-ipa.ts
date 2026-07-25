// Structurally compatible with `GrammarIpaBag` defined in
// @flicktionary/api-client. We re-declare the shape here (instead of importing
// the type) because api-client already depends on core — importing the other
// direction would create a circular dependency. Keep the two shapes in sync
// when adding new dialect buckets.
export type IpaBagShape = {
  ga?: string | null
  rp?: string | null
  br?: string | null
  eu?: string | null
  cas?: string | null
  lam?: string | null
  untagged?: string | null
}

export type EnglishIpaDialect = 'ga' | 'rp'
export type SpanishIpaDialect = 'cas' | 'lam'
export type PortugueseIpaDialect = 'br' | 'eu'

// The user's per-language dialect picks, resolved from user prefs. Languages
// without a dialect split never read from this object.
export type IpaDialects = {
  en: EnglishIpaDialect
  es: SpanishIpaDialect
  pt: PortugueseIpaDialect
}

export const DEFAULT_IPA_DIALECTS: IpaDialects = { en: 'ga', es: 'lam', pt: 'br' }

// Languages whose IPA has a dialect split (and therefore a user pref).
// Callers use this to skip the prefs read for every other language.
export const IPA_DIALECT_LANGUAGES: ReadonlySet<string> = new Set(['en', 'es', 'pt'])

// Builds the dialects object from a user-prefs DTO (fields optional so both
// the web prefs shape and partial backend rows can feed it).
export const ipaDialectsFromPrefs = (
  prefs:
    | {
        englishIpaDialect?: EnglishIpaDialect | null
        spanishIpaDialect?: SpanishIpaDialect | null
        portugueseIpaDialect?: PortugueseIpaDialect | null
      }
    | null
    | undefined
): IpaDialects => ({
  en: prefs?.englishIpaDialect ?? DEFAULT_IPA_DIALECTS.en,
  es: prefs?.spanishIpaDialect ?? DEFAULT_IPA_DIALECTS.es,
  pt: prefs?.portugueseIpaDialect ?? DEFAULT_IPA_DIALECTS.pt,
})

// The bag buckets each dialect-split language can carry, preferred-first for
// the given dialect pick. Single source of truth for pickIpa /
// hasDisplayableIpa / pickIpaForDisplay so the three never disagree about
// which buckets "belong" to a language.
const dialectBucketsFor = (langCode: string, dialects: IpaDialects): Array<keyof IpaBagShape> => {
  if (langCode === 'en') return dialects.en === 'rp' ? ['rp', 'ga'] : ['ga', 'rp']
  if (langCode === 'es') return dialects.es === 'cas' ? ['cas', 'lam'] : ['lam', 'cas']
  if (langCode === 'pt') return dialects.pt === 'eu' ? ['eu', 'br'] : ['br', 'eu']
  return []
}

export const pickIpa = (
  ipa: IpaBagShape | null | undefined,
  langCode: string,
  dialects: IpaDialects
): string | undefined => {
  if (!ipa) return undefined
  const [preferred] = dialectBucketsFor(langCode, dialects)
  if (preferred) return ipa[preferred] ?? ipa.untagged ?? undefined
  return ipa.untagged ?? undefined
}

const nonEmpty = (s: string | null | undefined): boolean => typeof s === 'string' && s.trim().length > 0

// Whether the IPA bag has any string this language could render — the readiness
// gate for the pronunciation study facet (Trap 12: pickIpa can return undefined,
// so a pronunciation card needs a precondition check, not a blind render). This
// is deliberately dialect-INDEPENDENT (unlike pickIpa, which picks one dialect):
// the pronunciation chip is offerable, and an existing facet kept alive, as long
// as *some* transcription exists. The render falls back across the language's
// own buckets so it is never empty when this returns true. For languages
// without a dialect split only `untagged` counts; for en/es/pt any of the
// language's dialect buckets or `untagged`. Used by both the enable gate
// (frontend) and the IPA-vanished delete sync (backend), so neither needs the
// user's dialect.
export const hasDisplayableIpa = (ipa: IpaBagShape | null | undefined, langCode: string): boolean => {
  if (!ipa) return false
  const buckets = dialectBucketsFor(langCode, DEFAULT_IPA_DIALECTS)
  return buckets.some((b) => nonEmpty(ipa[b])) || nonEmpty(ipa.untagged)
}

// The transcription to show on a pronunciation card's back. Prefers the user's
// dialect pick (pickIpa), then falls back across the language's OWN buckets —
// preferred → untagged → the language's other dialect — so a card that passed
// hasDisplayableIpa always renders something (e.g. a `cas`-only Spanish entry
// still renders for a `lam` user). Returns undefined only when the bag is
// genuinely empty for this language (the IPA-vanished case → facet deleted).
export const pickIpaForDisplay = (
  ipa: IpaBagShape | null | undefined,
  langCode: string,
  dialects: IpaDialects
): string | undefined => {
  const preferred = pickIpa(ipa, langCode, dialects)
  if (preferred) return preferred
  if (!ipa) return undefined
  if (nonEmpty(ipa.untagged)) return ipa.untagged ?? undefined
  const fallback = dialectBucketsFor(langCode, dialects).find((b) => nonEmpty(ipa[b]))
  return fallback ? (ipa[fallback] ?? undefined) : undefined
}
