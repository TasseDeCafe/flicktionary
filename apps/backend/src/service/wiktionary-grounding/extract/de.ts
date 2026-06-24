// German-specific kaikki extraction. Nouns give gender + plural + genitive +
// weak-noun flag; verbs give separability + perfect auxiliary.

import { headTemplateArg, type GrammarPatch, type KaikkiEntry } from './shared'

type FormEntry = { form?: unknown; tags?: unknown; source?: unknown }

// First head-template form (no `source`) carrying `tag`. The declension/
// conjugation table rows duplicate these with extra definite/case tags, so we
// take the canonical citation form by skipping `source`-stamped rows.
const firstHeadFormWithTag = (entry: KaikkiEntry, tag: string): string | null => {
  const forms = entry.forms
  if (!Array.isArray(forms)) return null
  for (const raw of forms) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as FormEntry
    if (f.source) continue
    const tags = Array.isArray(f.tags) ? f.tags : []
    if (typeof f.form === 'string' && tags.includes(tag)) return f.form
  }
  return null
}

// German `de-noun` encodes gender as the first comma-segment of `args.1`
// ("n,,^er" → n; "m,ns.weak" → m) and marks n-declension nouns with a `.weak`
// class suffix. Plural / genitive come from the head-template forms.
export const extractGermanNoun = (entry: KaikkiEntry): GrammarPatch => {
  const out: GrammarPatch = { pos: 'noun' }
  const a1 = headTemplateArg(entry, '1')
  if (a1) {
    const gender = a1.split(',')[0].trim()
    if (gender === 'm' || gender === 'f' || gender === 'n') out.gender = gender
    if (a1.includes('weak')) out.is_weak_noun = true
  }
  const plural = firstHeadFormWithTag(entry, 'plural')
  if (plural) out.plural = plural
  const genitive = firstHeadFormWithTag(entry, 'genitive')
  if (genitive) out.genitive = genitive
  return out
}

// German perfect auxiliary from the conjugation `forms` tagged `auxiliary`.
// Wiktionary lists both `haben` and `sein` (and a combined "haben or sein"
// row) for dual-auxiliary verbs like `fahren`.
const extractGermanAuxiliary = (entry: KaikkiEntry): GrammarPatch['auxiliary'] | undefined => {
  const forms = entry.forms
  if (!Array.isArray(forms)) return undefined
  const auxes = new Set<string>()
  for (const raw of forms) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as FormEntry
    const tags = Array.isArray(f.tags) ? f.tags : []
    if (typeof f.form === 'string' && tags.includes('auxiliary')) auxes.add(f.form.trim())
  }
  if (auxes.has('haben or sein') || (auxes.has('haben') && auxes.has('sein'))) return 'haben_or_sein'
  if (auxes.has('sein')) return 'sein'
  if (auxes.has('haben')) return 'haben'
  return undefined
}

// German `de-verb` encodes separability as a dot in the lemma part of `args.1`
// before the angle-bracket spec ("auf.stehen<…>" → separable; "fahren<…>" →
// not).
export const extractGermanVerb = (entry: KaikkiEntry): GrammarPatch => {
  const out: GrammarPatch = { pos: 'verb' }
  const a1 = headTemplateArg(entry, '1')
  if (a1) {
    const lemmaPart = a1.split('<')[0]
    if (lemmaPart.includes('.')) out.is_separable = true
  }
  const auxiliary = extractGermanAuxiliary(entry)
  if (auxiliary) out.auxiliary = auxiliary
  return out
}
