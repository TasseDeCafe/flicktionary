// Russian-specific kaikki extraction. Template names and arg conventions are
// Russian-specific, so noun/verb get bespoke parsers.

import { firstHeadTemplate, headTemplateArg, type GrammarPatch, type KaikkiEntry } from './shared'

const stripStress = (s: string): string => s.replace(/́/g, '')

const isReflexiveHeadword = (word: string): boolean => word.endsWith('ся') || word.endsWith('сь')

export const extractRussianVerb = (entry: KaikkiEntry): GrammarPatch => {
  const out: GrammarPatch = { pos: 'verb' }
  const aspect = headTemplateArg(entry, '2')
  if (aspect === 'pf') out.aspect = 'perf'
  else if (aspect === 'impf') out.aspect = 'impf'
  else if (aspect === 'biasp' || aspect === 'biaspectual') out.aspect = 'biaspectual'

  const pairRaw = headTemplateArg(entry, 'impf') ?? headTemplateArg(entry, 'pf')
  if (pairRaw) {
    const first = pairRaw
      .split(',')
      .map((s) => stripStress(s.trim()))
      .filter((s) => s.length > 0)[0]
    if (first) out.aspect_pair_headword = first
  }

  const word = typeof entry.word === 'string' ? entry.word : ''
  if (word) out.is_reflexive = isReflexiveHeadword(word)
  return out
}

// Parses the parenthesized gender/animacy/number header in the expansion,
// e.g. "кни́га • (kníga) f inan (genitive кни́ги, ...)". `args.1` is unreliable
// (sometimes Cyrillic, sometimes Zaliznyak class), so we always parse
// expansion.
export const extractRussianNoun = (entry: KaikkiEntry): GrammarPatch => {
  const out: GrammarPatch = { pos: 'noun' }
  const tpl = firstHeadTemplate(entry)
  const expansion = typeof tpl?.expansion === 'string' ? tpl.expansion : ''
  if (!expansion) return out

  // The chunk between the closing paren of the romanization and either the
  // next opening paren or end-of-string carries the gender/animacy tokens.
  const afterRoman = /\)\s+(.+?)(?:\s*\(|$)/.exec(expansion)?.[1] ?? ''

  const genderMatch = /\b(m|f|n|c)\b/.exec(afterRoman)
  if (genderMatch) out.gender = genderMatch[1] as 'm' | 'f' | 'n' | 'c'

  const animacyMatch = /\b(anim|inan)\b/.exec(afterRoman)
  if (animacyMatch) out.animacy = animacyMatch[1] === 'anim' ? 'animate' : 'inanimate'

  if (/\bpl\b/.test(afterRoman)) out.number_only = 'plurale_tantum'

  if (/\bindeclinable\b/i.test(expansion)) out.is_indeclinable = true

  return out
}
