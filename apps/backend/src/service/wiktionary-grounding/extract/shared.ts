// Shared primitives for the per-language kaikki extractors. Types + the
// head-template accessors live here so the language modules (`ru.ts`, `de.ts`)
// and the dispatcher (`../extract.ts`) can all import them without a cycle.

export type KaikkiEntry = {
  word?: unknown
  pos?: unknown
  head_templates?: unknown
  senses?: unknown
  forms?: unknown
  lang_code?: unknown
  sounds?: unknown
}

export type GrammarPatch = {
  pos?: 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'pronoun' | 'particle' | 'conjunction' | 'numeral'
  display_form?: string
  gender?: 'm' | 'f' | 'n' | 'c'
  number_only?: 'plurale_tantum' | 'singulare_tantum'
  is_indeclinable?: boolean
  animacy?: 'animate' | 'inanimate'
  aspect?: 'impf' | 'perf' | 'biaspectual'
  aspect_pair_headword?: string
  is_reflexive?: boolean
  // German nominal / verbal facts.
  plural?: string
  genitive?: string
  is_weak_noun?: boolean
  is_separable?: boolean
  auxiliary?: 'haben' | 'sein' | 'haben_or_sein'
  ipa?: {
    ga?: string
    rp?: string
    br?: string
    eu?: string
    cas?: string
    lam?: string
    untagged?: string
  }
  // government — TODO: extract from senses[].raw_glosses bracketed parentheticals
  // (e.g. "[with от (ot, + genitive)]"). Deferred for v1.
}

export const firstHeadTemplate = (
  entry: KaikkiEntry
): { name?: string; expansion?: string; args?: Record<string, unknown> } | null => {
  const list = entry.head_templates
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  return first as { name?: string; expansion?: string; args?: Record<string, unknown> }
}

export const headTemplateArg = (entry: KaikkiEntry, key: string): string | null => {
  const tpl = firstHeadTemplate(entry)
  const v = tpl?.args?.[key]
  return typeof v === 'string' ? v : null
}

// First token of `head_templates[0].expansion` is the surface form, sometimes
// with stress marks. The bullet ` • ` separates it from the romanization etc.
export const extractDisplayForm = (entry: KaikkiEntry): string | null => {
  const tpl = firstHeadTemplate(entry)
  const expansion = tpl?.expansion
  if (typeof expansion !== 'string') return null
  const idx = expansion.indexOf(' • ') // ' • '
  const head = (idx === -1 ? expansion : expansion.slice(0, idx)).trim()
  return head.length > 0 ? head : null
}
