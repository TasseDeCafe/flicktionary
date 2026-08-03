// Public entry for kaikki grammar extraction. Per-language logic lives in
// `extract/<lang>.ts`; this file owns the language registry, the generic
// POS-only fallback, and the dispatcher that stitches grammar + display form +
// IPA together. Adding a language = a new `extract/<lang>.ts` plus one
// `LANGUAGE_EXTRACTORS` entry — nothing here grows an if/else chain.

import { extractDisplayForm, type GrammarPatch, type KaikkiEntry } from './extract/shared'
import { extractRussianNoun, extractRussianVerb } from './extract/ru'
import { extractGermanNoun, extractGermanVerb } from './extract/de'
import { extractFrenchNoun } from './extract/fr'
import { extractIpaBag } from './extract/ipa'

// Re-exported so existing importers keep using the stable `./extract` path.
export { extractDisplayForm, extractIpaBag }
export type { GrammarPatch, KaikkiEntry }

const POS_KAIKKI_TO_GRAMMAR: Record<string, GrammarPatch['pos']> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adjective: 'adjective',
  adv: 'adverb',
  adverb: 'adverb',
  prep: 'preposition',
  preposition: 'preposition',
  pron: 'pronoun',
  pronoun: 'pronoun',
  particle: 'particle',
  conj: 'conjunction',
  conjunction: 'conjunction',
  num: 'numeral',
  numeral: 'numeral',
}

type LanguageExtractor = {
  // Bespoke per-POS parsers (kaikki pos string → patch). POS not listed here
  // falls through to the generic POS-only patch.
  byPos?: Partial<Record<string, (entry: KaikkiEntry) => GrammarPatch>>
  // Skip the head-template display-form extraction when its expansion is too
  // noisy to be useful (English head templates, German `Haus n (strong, …)`).
  skipDisplayForm?: boolean
}

// One entry per language with bespoke handling. Languages absent here get the
// generic POS fallback + display form + (untagged) IPA.
const LANGUAGE_EXTRACTORS: Record<string, LanguageExtractor> = {
  ru: { byPos: { verb: extractRussianVerb, noun: extractRussianNoun } },
  de: { byPos: { verb: extractGermanVerb, noun: extractGermanNoun }, skipDisplayForm: true },
  en: { skipDisplayForm: true },
  // es/pt head templates have no ` • ` separator, so extractDisplayForm would
  // return the whole head line (`pie m (plural pies)`) — a card title, not a
  // display form. Same noise class as the German/English skip.
  es: { skipDisplayForm: true },
  pt: { skipDisplayForm: true },
  // French head lines are the same noise class ("maison f (plural maisons)").
  fr: { byPos: { noun: extractFrenchNoun }, skipDisplayForm: true },
}

// Public: extract the structured-grammar patch we want to merge into the
// vocabulary row's `grammar` JSONB column.
export const extractGrammarPatch = (entry: KaikkiEntry, langCode: string): GrammarPatch => {
  const posRaw = typeof entry.pos === 'string' ? entry.pos.toLowerCase() : ''
  const profile = LANGUAGE_EXTRACTORS[langCode]

  const posExtractor = profile?.byPos?.[posRaw]
  const patch: GrammarPatch = posExtractor ? posExtractor(entry) : { pos: POS_KAIKKI_TO_GRAMMAR[posRaw] }

  if (!profile?.skipDisplayForm) {
    const display = extractDisplayForm(entry)
    if (display) patch.display_form = display
  }

  const ipa = extractIpaBag(entry, langCode)
  if (ipa.ga || ipa.rp || ipa.br || ipa.eu || ipa.cas || ipa.lam || ipa.untagged) patch.ipa = ipa

  return patch
}
