// Pure functions that read structured grammar facts out of a kaikki entry's
// `data` blob (the JSONL line preserved untouched at load time). All functions
// are defensive: any unexpected shape returns null/empty rather than throwing.
//
// Russian noun/verb extraction is language-specific (template names and arg
// conventions differ); English uses the generic POS fallback plus the
// dialect-aware IPA bag. Add new per-language extractors before adding the
// language to KAIKKI_ENABLED_LANGUAGES.

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
  ipa?: {
    ga?: string
    rp?: string
    untagged?: string
  }
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

// Tags that mark a pronunciation as non-standard / not-what-a-learner-wants.
// `crayon`, for example, has a `nonstandard` /kræn/ that would confuse beginners.
const REJECTED_QUALITY_TAGS = new Set([
  'uncommon',
  'dated',
  'obsolete',
  'nonstandard',
  'dialectal',
  'archaic',
  'sometimes',
  'rare',
])

// Tags that bucket a pronunciation as RP (UK). We accept either the explicit
// RP label or a bare `UK` tag.
const RP_TAGS = new Set(['Received-Pronunciation', 'RP', 'UK'])

// Tags that bucket a pronunciation as General American.
const GA_TAGS = new Set(['General-American', 'GenAm'])

// Bare `US` is GA *unless* a narrower US region is also present (Southern,
// Boston, etc.) — those are too regional to call GA.
const NARROWER_US_TAGS = new Set([
  'Southern-US',
  'Boston',
  'New-York',
  'New-York-City',
  'Northeast-US',
  'Northeastern',
  'Northeastern-US',
  'Midwestern',
  'Midwestern-US',
  'Inland-Northern-American',
  'Inland-Northern-American-English',
  'Inland-North',
  'African-American-Vernacular-English',
  'AAVE',
  'Pacific-Northwest',
  'California',
])

const PRONUNCIATION_POS_TAG_TO_KAIKKI: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adj',
  adj: 'adj',
  adverb: 'adv',
  adv: 'adv',
  preposition: 'prep',
  prep: 'prep',
  pronoun: 'pron',
  pron: 'pron',
  interjection: 'intj',
  intj: 'intj',
  conjunction: 'conj',
  conj: 'conj',
  numeral: 'num',
  num: 'num',
  particle: 'particle',
}

const normalizeKaikkiPos = (pos: unknown): string | null => {
  if (typeof pos !== 'string') return null
  const normalized = pos.trim().toLowerCase()
  return PRONUNCIATION_POS_TAG_TO_KAIKKI[normalized] ?? normalized
}

const filterEnglishPronunciationTags = (tags: string[], entryPos: string | null): string[] | null => {
  const pronunciationPosTags = tags.flatMap((tag) => {
    const pos = PRONUNCIATION_POS_TAG_TO_KAIKKI[tag.toLowerCase()]
    return pos ? [pos] : []
  })
  if (pronunciationPosTags.length === 0) return tags
  if (entryPos && !pronunciationPosTags.includes(entryPos)) return null
  return tags.filter((tag) => !PRONUNCIATION_POS_TAG_TO_KAIKKI[tag.toLowerCase()])
}

// Any regional tag that isn't UK/US and isn't a quality tag — e.g.
// Australia, Canada, Ireland, New-Zealand, South-African. We don't want to
// mix these into either GA or RP.
const UNRELATED_REGIONAL_TAGS = new Set([
  'Australia',
  'Australian',
  'Canada',
  'Canadian',
  'Ireland',
  'Irish',
  'New-Zealand',
  'South-Africa',
  'South-African',
  'Scotland',
  'Scottish',
  'Wales',
  'Welsh',
  'India',
  'Indian-English',
])

type SoundEntry = {
  ipa?: unknown
  tags?: unknown
}

const tagsOf = (sound: SoundEntry): string[] => {
  if (!Array.isArray(sound.tags)) return []
  const out: string[] = []
  for (const t of sound.tags) {
    if (typeof t === 'string') out.push(t)
  }
  return out
}

const hasAnyTag = (tags: string[], set: ReadonlySet<string>): boolean => {
  for (const t of tags) if (set.has(t)) return true
  return false
}

const hasRejectedQualityTag = (tags: string[]): boolean => hasAnyTag(tags, REJECTED_QUALITY_TAGS)

const isPhonemic = (ipa: string): boolean => ipa.startsWith('/')
const isPhonetic = (ipa: string): boolean => ipa.startsWith('[')

// `phonemic` (slashes) is preferred — it's the abstract form a learner cares
// about. Fall back to `phonetic` (brackets) only when no phonemic candidate
// exists for the bucket.
const pickPreferredFromBucket = (candidates: string[]): string | undefined => {
  const phonemic = candidates.find(isPhonemic)
  if (phonemic) return phonemic
  const phonetic = candidates.find(isPhonetic)
  return phonetic
}

const classifyEnglishBuckets = (tags: string[]): Array<'ga' | 'rp' | 'untagged'> => {
  if (tags.length === 0) return ['untagged']
  const isRp = hasAnyTag(tags, RP_TAGS)
  const isExplicitGa = hasAnyTag(tags, GA_TAGS)
  const hasBareUs = tags.includes('US')
  const hasNarrowerUs = hasAnyTag(tags, NARROWER_US_TAGS)
  const hasUnrelated = hasAnyTag(tags, UNRELATED_REGIONAL_TAGS)
  // Wiktionary often lumps shared pronunciations into one sound row with
  // multiple regional tags (e.g. `speculation` is tagged
  // [Canada, General-American, Received-Pronunciation] under a single IPA).
  // Explicit GA/RP labels still apply in that case — the unrelated tag is
  // additional information, not a disqualifier. Only drop the sound for
  // unrelated regional tags when no explicit GA/RP label is also present.
  if (hasUnrelated && !isRp && !isExplicitGa && !hasBareUs) return []
  const out: Array<'ga' | 'rp'> = []
  if (isRp && !hasBareUs && !hasNarrowerUs) out.push('rp')
  if (isExplicitGa && !hasNarrowerUs) out.push('ga')
  else if (hasBareUs && !isRp && !hasNarrowerUs) out.push('ga')
  return out
}

const pushUnique = (bucket: string[], ipa: string): void => {
  if (!bucket.includes(ipa)) bucket.push(ipa)
}

export const extractIpaBag = (
  entry: KaikkiEntry,
  langCode: string
): { ga?: string; rp?: string; untagged?: string } => {
  const sounds = entry.sounds
  if (!Array.isArray(sounds)) return {}

  const ga: string[] = []
  const rp: string[] = []
  const untagged: string[] = []
  const entryPos = langCode === 'en' ? normalizeKaikkiPos(entry.pos) : null

  for (const raw of sounds) {
    if (!raw || typeof raw !== 'object') continue
    const sound = raw as SoundEntry
    const ipa = typeof sound.ipa === 'string' ? sound.ipa.trim() : ''
    if (!ipa) continue
    const tags = tagsOf(sound)
    if (hasRejectedQualityTag(tags)) continue

    if (langCode === 'en') {
      const pronunciationTags = filterEnglishPronunciationTags(tags, entryPos)
      if (!pronunciationTags) continue

      for (const bucket of classifyEnglishBuckets(pronunciationTags)) {
        if (bucket === 'ga') pushUnique(ga, ipa)
        else if (bucket === 'rp') pushUnique(rp, ipa)
        else if (bucket === 'untagged') pushUnique(untagged, ipa)
      }
      continue
    }

    // Non-English: only untagged entries land in the bag.
    if (tags.length === 0) pushUnique(untagged, ipa)
  }

  const out: { ga?: string; rp?: string; untagged?: string } = {}
  const pickedGa = pickPreferredFromBucket(ga)
  if (pickedGa) out.ga = pickedGa
  const pickedRp = pickPreferredFromBucket(rp)
  if (pickedRp) out.rp = pickedRp
  const pickedUntagged = pickPreferredFromBucket(untagged)
  if (pickedUntagged) out.untagged = pickedUntagged
  return out
}

// Public: extract the structured-grammar patch we want to merge into the
// vocabulary row's `grammar` JSONB column. Russian-specific noun/verb logic is
// gated to `ru`; other languages get the POS fallback, display form, and IPA.
export const extractGrammarPatch = (entry: KaikkiEntry, langCode: string): GrammarPatch => {
  const posRaw = typeof entry.pos === 'string' ? entry.pos.toLowerCase() : ''
  let patch: GrammarPatch
  if (langCode === 'ru' && posRaw === 'verb') patch = extractVerb(entry)
  else if (langCode === 'ru' && posRaw === 'noun') patch = extractNoun(entry)
  else patch = { pos: POS_KAIKKI_TO_GRAMMAR[posRaw] }

  const display = langCode === 'en' ? null : extractDisplayForm(entry)
  if (display) patch.display_form = display

  const ipa = extractIpaBag(entry, langCode)
  if (ipa.ga || ipa.rp || ipa.untagged) patch.ipa = ipa

  return patch
}
