// French-specific kaikki extraction. Real lemma nouns use the `fr-noun` head
// template, which encodes gender (and pluralia tantum) in `args.1`: 'f', 'm',
// 'f-p', 'm-p', 'mf', 'mfbysense', 'm,f', occasionally with inline modifiers
// ('m,f<q:Louisiana>'). Only unambiguous single-gender values ground `gender`;
// dual-gender nouns stay unset for the LLM to explain. The generic `head`
// template rows are noun *forms* / misspellings / abbreviations — no reliable
// gender there, so they get the bare POS patch.

import { firstHeadTemplate, headTemplateArg, type GrammarPatch, type KaikkiEntry } from './shared'

export const extractFrenchNoun = (entry: KaikkiEntry): GrammarPatch => {
  const out: GrammarPatch = { pos: 'noun' }
  if (firstHeadTemplate(entry)?.name !== 'fr-noun') return out
  const a1 = headTemplateArg(entry, '1')
  if (!a1) return out
  const base = a1.split('<')[0].trim()
  if (base.includes(',')) return out
  const isPluraleTantum = base.endsWith('-p')
  const genderPart = isPluraleTantum ? base.slice(0, -'-p'.length) : base
  if (isPluraleTantum) out.number_only = 'plurale_tantum'
  if (genderPart === 'm' || genderPart === 'f') out.gender = genderPart
  return out
}
