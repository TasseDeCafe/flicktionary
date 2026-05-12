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
