// IPA-bag extraction from a kaikki entry's `sounds[]`. English buckets into
// GA/RP (driven by the user's dialect pref downstream); every other language
// uses the untagged bucket, plus sounds tagged only as the standard reference
// pronunciation. This is the one piece of extraction that isn't split per
// language — there is an English path and a non-English path, nothing more.

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

    // Non-English: keep untagged sounds, plus those marked only as the
    // language's standard reference pronunciation (German tags its reference
    // form `standard` / `Germany`). Any regional tag — Austria, Switzerland,
    // Southern-Germany, etc. — fails the `every` check and is dropped, so a
    // German learner is never served an Austrian pronunciation.
    if (tags.length === 0 || tags.every((tag) => NON_ENGLISH_ACCEPTED_TAGS.has(tag))) {
      pushUnique(untagged, ipa)
    }
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
