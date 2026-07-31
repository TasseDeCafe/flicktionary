import { damerauLevenshtein } from './typed-answer-grading'

// Combining marks that are OPTIONAL for search and safe to strip: the Latin/
// Cyrillic combining-diacritics block (accents, Russian stress U+0301, the
// combining dot from lowercased Turkish İ) plus Arabic harakat (subtitle text
// is usually unvocalized, so a vocalized query should still match). A blanket
// \p{Diacritic} strip would corrupt supported scripts — NFD decomposes
// Japanese が to か + U+3099, and Tamil/Devanagari viramas and vowel signs are
// meaningful letters, so those marks must survive.
const STRIPPABLE_MARKS = /[\u0300-\u036f\u064b-\u0652]/g

// Joiner punctuation is removed outright (not replaced with a space) so
// "panty-waist" normalizes to "pantywaist" and matches the unhyphenated query:
// hyphens/dashes, apostrophes, periods, middle dots.
const JOINER_PUNCTUATION = /[-\u2010-\u2015'\u2018\u2019\u02bc.\u00b7\u2027]/g

// Everything else in \p{P}/\p{S} (commas, !, ?, quotes, …) becomes a space so
// subtitle text like "Hello, world!" tokenizes to clean words and the typo
// pass compares "wurld" against "world", not "world!".
const OTHER_PUNCTUATION = /[\p{P}\p{S}]/gu

// Lowercase forms NFD can't decompose into base + mark. Applied after
// lowercasing, so Œ/Æ/ẞ are covered via their lowercase forms.
const foldSpecialLetters = (value: string): string =>
  value.replace(/ß/g, 'ss').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ı/g, 'i')

export const normalizeForSearch = (value: string): string =>
  foldSpecialLetters(value.normalize('NFD').replace(STRIPPABLE_MARKS, '').toLowerCase())
    .replace(JOINER_PUNCTUATION, '')
    .replace(OTHER_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// One allowed edit (insertion/deletion/substitution/transposition) per query
// word — but only for words long enough that a single edit is still selective;
// below 4 letters one edit matches half the dictionary (cat ≈ car/can/cut).
const MIN_FUZZY_TOKEN_LENGTH = 4
const MAX_EDIT_DISTANCE = 1

const tokenMatches = (queryToken: string, haystackTokens: string[]): boolean =>
  haystackTokens.some((haystackToken) => {
    if (haystackToken.includes(queryToken)) return true
    if (queryToken.length < MIN_FUZZY_TOKEN_LENGTH) return false
    if (Math.abs(haystackToken.length - queryToken.length) > MAX_EDIT_DISTANCE) return false
    return damerauLevenshtein(queryToken, haystackToken) <= MAX_EDIT_DISTANCE
  })

export interface SearchMatcher {
  matches: (haystack: string) => boolean
  // For callers filtering large lists repeatedly (e.g. every keystroke over a
  // 10k-segment track): pre-normalize the haystacks once with
  // normalizeForSearch and pass them here, skipping per-call normalization.
  matchesNormalized: (normalizedHaystack: string) => boolean
}

// The query is normalized and tokenized once per matcher, not per haystack.
// Matching: full-phrase substring first (covers prefixes and scripts without
// word boundaries), then per-query-word AND — each word must be a substring of
// some haystack word or within one edit of it.
export const createSearchMatcher = (query: string): SearchMatcher => {
  const normalizedQuery = normalizeForSearch(query)
  if (normalizedQuery.length === 0) {
    return { matches: () => true, matchesNormalized: () => true }
  }
  const queryTokens = normalizedQuery.split(' ')
  const matchesNormalized = (normalizedHaystack: string): boolean => {
    if (normalizedHaystack.includes(normalizedQuery)) return true
    const haystackTokens = normalizedHaystack.split(' ')
    return queryTokens.every((queryToken) => tokenMatches(queryToken, haystackTokens))
  }
  return {
    matches: (haystack) => matchesNormalized(normalizeForSearch(haystack)),
    matchesNormalized,
  }
}

export const matchesSearchQuery = (haystack: string, query: string): boolean =>
  createSearchMatcher(query).matches(haystack)
