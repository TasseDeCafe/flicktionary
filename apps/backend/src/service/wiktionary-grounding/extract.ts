// Pure functions that read structured grammar facts out of a kaikki entry's
// `data` blob (the JSONL line preserved untouched at load time). All functions
// are defensive: any unexpected shape returns null/empty rather than throwing.
//
// Russian-specific for v1. Other languages will need their own extractors
// (template names and arg conventions differ); see KAIKKI_ENABLED_LANGUAGES.

export type KaikkiEntry = {
  word?: unknown
  pos?: unknown
  head_templates?: unknown
  senses?: unknown
  forms?: unknown
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
  // government — TODO: extract from senses[].raw_glosses bracketed parentheticals
  // (e.g. "[with от (ot, + genitive)]"). Deferred for v1.
}

const stripStress = (s: string): string => s.replace(/́/g, '')

const firstHeadTemplate = (
  entry: KaikkiEntry
): { name?: string; expansion?: string; args?: Record<string, unknown> } | null => {
  const list = entry.head_templates
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  return first as { name?: string; expansion?: string; args?: Record<string, unknown> }
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

const headTemplateArg = (entry: KaikkiEntry, key: string): string | null => {
  const tpl = firstHeadTemplate(entry)
  const v = tpl?.args?.[key]
  return typeof v === 'string' ? v : null
}

const isReflexiveHeadword = (word: string): boolean => word.endsWith('ся') || word.endsWith('сь')

const extractVerb = (entry: KaikkiEntry): GrammarPatch => {
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
const extractNoun = (entry: KaikkiEntry): GrammarPatch => {
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

// Public: extract the structured-grammar patch we want to merge into the
// vocabulary row's `grammar` JSONB column. Caller is responsible for narrowing
// by language — this is currently Russian-tuned.
export const extractGrammarPatch = (entry: KaikkiEntry): GrammarPatch => {
  const posRaw = typeof entry.pos === 'string' ? entry.pos.toLowerCase() : ''
  let patch: GrammarPatch
  if (posRaw === 'verb') patch = extractVerb(entry)
  else if (posRaw === 'noun') patch = extractNoun(entry)
  else patch = { pos: POS_KAIKKI_TO_GRAMMAR[posRaw] }

  const display = extractDisplayForm(entry)
  if (display) patch.display_form = display

  return patch
}
