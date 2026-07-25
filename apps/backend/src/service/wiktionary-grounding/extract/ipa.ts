// IPA-bag extraction from a kaikki entry's `sounds[]`. Dialect-split
// languages bucket by dialect (driven by the user's pref downstream):
// English GA/RP from region tags, Portuguese BR/EU from bare Brazil/Portugal
// tags, Spanish Castilian/LatAm from the θ-twin rule over untagged variants.
// Every other language uses the untagged bucket, plus sounds tagged only as
// the standard reference pronunciation.

import type { KaikkiEntry } from './shared'

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

// Non-English sounds are kept when untagged or tagged only as the standard
// reference pronunciation. German marks its reference form `standard` (and
// occasionally `Germany`); everything else regional is dropped.
const NON_ENGLISH_ACCEPTED_TAGS = new Set(['standard', 'Germany'])

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
  // Bare `US` counts as General American unless a narrower US region tag
  // (Southern, Boston, …) pins it to a sub-accent we don't want to call GA.
  const isGa = (isExplicitGa || hasBareUs) && !hasNarrowerUs
  // Wiktionary often lumps a shared pronunciation into one sound row tagged
  // with several regions at once — e.g. `revel` is a single `/ˈɹɛv.əl/` tagged
  // [UK, US], and `speculation` is tagged
  // [Canada, General-American, Received-Pronunciation]. Each applicable dialect
  // label claims that pronunciation independently — the labels are additive,
  // not mutually exclusive, so a [UK, US] sound lands in BOTH buckets. Only drop
  // the sound for an unrelated region when no GA/RP/US anchor is alongside it.
  if (hasUnrelated && !isRp && !isGa) return []
  const out: Array<'ga' | 'rp'> = []
  if (isRp && !hasNarrowerUs) out.push('rp')
  if (isGa) out.push('ga')
  return out
}

const pushUnique = (bucket: string[], ipa: string): void => {
  if (!bucket.includes(ipa)) bucket.push(ipa)
}

// --- Spanish θ-twin classification -----------------------------------------
// kaikki emits Spanish distinción pairs as UNTAGGED variants: the Castilian
// /θ/ form and its seseo twin (θ→s) side by side. A variant containing θ whose
// twin is present goes to `cas`, the twin to `lam`; everything unpaired and
// θ-free is dialect-neutral (loanword variants, optional sounds) and stays
// shared in `untagged`. Full-dump validation (2026-05-12 dump): exact twins
// cover 28,151/28,777 θ-variants and the fuzzy comparison below pairs 621 of
// the remaining 626 (99.98% total).

const deTheta = (s: string): string => s.replace(/θ/g, 's')

// Comparison key for near-twins: seseo merges adjacent s-sounds
// (/bisθeˈɾal/ → /biseˈɾal/, not /bisseˈɾal/), and the merge can shift the
// stress mark's position — so compare with stress/syllable marks stripped and
// s-runs collapsed. Keys are for MATCHING only; buckets keep original strings.
const spanishFuzzyKey = (s: string): string => deTheta(s).replace(/[ˈˌ.]/g, '').replace(/s+/g, 's')

const classifySpanishVariants = (candidates: string[]): { cas: string[]; lam: string[]; untagged: string[] } => {
  const cas: string[] = []
  const lam: string[] = []
  const claimed = new Set<string>()
  for (const variant of candidates) {
    if (!variant.includes('θ')) continue
    const twin = candidates.find(
      (other) =>
        other !== variant &&
        !other.includes('θ') &&
        (other === deTheta(variant) || spanishFuzzyKey(other) === spanishFuzzyKey(variant))
    )
    pushUnique(cas, variant)
    claimed.add(variant)
    if (twin) {
      pushUnique(lam, twin)
      claimed.add(twin)
    }
    // Unpaired θ (a handful of entries in the whole dump) stays cas-only —
    // never served to a LatAm user as the default; display falls back.
  }
  const untagged = candidates.filter((c) => !claimed.has(c))
  return { cas, lam, untagged }
}

export type IpaBag = {
  ga?: string
  rp?: string
  br?: string
  eu?: string
  cas?: string
  lam?: string
  untagged?: string
}

export const extractIpaBag = (entry: KaikkiEntry, langCode: string): IpaBag => {
  const sounds = entry.sounds
  if (!Array.isArray(sounds)) return {}

  const ga: string[] = []
  const rp: string[] = []
  const br: string[] = []
  const eu: string[] = []
  const untagged: string[] = []
  // Spanish candidates classified AFTER the loop — the θ-twin rule needs the
  // whole variant list at once.
  const esCandidates: string[] = []
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

    if (langCode === 'pt') {
      // Portuguese kaikki IPA is ~98% dialect-tagged. Accept ONLY the bare
      // one-tag reference rows (97.8% / 96.0% coverage) — a narrower region
      // alongside (Rio-de-Janeiro, Southern-Brazil, Caipira, São-Paulo,
      // Northern|Portugal, …) pins a sub-accent we don't want to serve as the
      // dialect default, same discipline as bare `US` vs NARROWER_US_TAGS.
      if (tags.length === 1 && tags[0] === 'Brazil') pushUnique(br, ipa)
      else if (tags.length === 1 && tags[0] === 'Portugal') pushUnique(eu, ipa)
      else if (tags.length === 0) pushUnique(untagged, ipa)
      continue
    }

    if (langCode === 'es') {
      if (tags.length === 0) pushUnique(esCandidates, ipa)
      continue
    }

    // Other non-English: keep untagged sounds, plus those marked only as the
    // language's standard reference pronunciation (German tags its reference
    // form `standard` / `Germany`). Any regional tag — Austria, Switzerland,
    // Southern-Germany, etc. — fails the `every` check and is dropped, so a
    // German learner is never served an Austrian pronunciation.
    if (tags.length === 0 || tags.every((tag) => NON_ENGLISH_ACCEPTED_TAGS.has(tag))) {
      pushUnique(untagged, ipa)
    }
  }

  const cas: string[] = []
  const lam: string[] = []
  if (langCode === 'es') {
    const classified = classifySpanishVariants(esCandidates)
    cas.push(...classified.cas)
    lam.push(...classified.lam)
    untagged.push(...classified.untagged)
  }

  const out: IpaBag = {}
  const buckets: Array<[keyof IpaBag, string[]]> = [
    ['ga', ga],
    ['rp', rp],
    ['br', br],
    ['eu', eu],
    ['cas', cas],
    ['lam', lam],
    ['untagged', untagged],
  ]
  for (const [key, candidates] of buckets) {
    const picked = pickPreferredFromBucket(candidates)
    if (picked) out[key] = picked
  }
  return out
}
