// Structurally compatible with `GrammarIpaBag` defined in
// @flicktionary/api-client. We re-declare the shape here (instead of importing
// the type) because api-client already depends on core — importing the other
// direction would create a circular dependency. Keep the two shapes in sync
// when adding new dialect buckets.
export type IpaBagShape = {
  ga?: string | null
  rp?: string | null
  untagged?: string | null
}

export type EnglishIpaDialect = 'ga' | 'rp'

export const pickIpa = (
  ipa: IpaBagShape | null | undefined,
  langCode: string,
  englishDialect: EnglishIpaDialect
): string | undefined => {
  if (!ipa) return undefined
  if (langCode === 'en') return ipa[englishDialect] ?? ipa.untagged ?? undefined
  return ipa.untagged ?? undefined
}

const nonEmpty = (s: string | null | undefined): boolean => typeof s === 'string' && s.trim().length > 0

// Whether the IPA bag has any string this language could render — the readiness
// gate for the pronunciation study facet (Trap 12: pickIpa can return undefined,
// so a pronunciation card needs a precondition check, not a blind render). This
// is deliberately dialect-INDEPENDENT (unlike pickIpa, which picks one dialect):
// the pronunciation chip is offerable, and an existing facet kept alive, as long
// as *some* transcription exists. The render falls back across dialects so it is
// never empty when this returns true. For non-English only `untagged` counts;
// for English any of ga/rp/untagged. Used by both the enable gate (frontend) and
// the IPA-vanished delete sync (backend), so neither needs the user's dialect.
export const hasDisplayableIpa = (ipa: IpaBagShape | null | undefined, langCode: string): boolean => {
  if (!ipa) return false
  if (langCode === 'en') return nonEmpty(ipa.ga) || nonEmpty(ipa.rp) || nonEmpty(ipa.untagged)
  return nonEmpty(ipa.untagged)
}

// The transcription to show on a pronunciation card's back. Prefers the user's
// English dialect (pickIpa), then falls back to any available bucket so a card
// that passed hasDisplayableIpa always renders something. Returns undefined only
// when the bag is genuinely empty (the IPA-vanished case → facet deleted).
export const pickIpaForDisplay = (
  ipa: IpaBagShape | null | undefined,
  langCode: string,
  englishDialect: EnglishIpaDialect
): string | undefined => {
  const preferred = pickIpa(ipa, langCode, englishDialect)
  if (preferred) return preferred
  if (!ipa) return undefined
  return ipa.untagged ?? ipa.ga ?? ipa.rp ?? undefined
}
