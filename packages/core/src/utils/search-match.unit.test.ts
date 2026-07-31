import { describe, expect, it } from 'vitest'
import { createSearchMatcher, matchesSearchQuery, normalizeForSearch } from './search-match'

describe('normalizeForSearch', () => {
  it('strips accents and lowercases', () => {
    expect(normalizeForSearch('Español')).toBe('espanol')
    expect(normalizeForSearch('café')).toBe('cafe')
  })

  it('strips Russian stress marks (combining acute)', () => {
    expect(normalizeForSearch('де́лать')).toBe('делать')
  })

  it('removes joiner punctuation instead of splitting on it', () => {
    expect(normalizeForSearch('panty-waist')).toBe('pantywaist')
    expect(normalizeForSearch("l'homme")).toBe('lhomme')
  })

  it('turns other punctuation into token boundaries', () => {
    expect(normalizeForSearch('Hello, world!')).toBe('hello world')
  })

  it('folds letters NFD cannot decompose, in both cases', () => {
    expect(normalizeForSearch('STRAẞE')).toBe('strasse')
    expect(normalizeForSearch('straße')).toBe('strasse')
    expect(normalizeForSearch('Œuvre')).toBe('oeuvre')
    expect(normalizeForSearch('vitæ')).toBe('vitae')
  })

  it('folds Turkish dotted and dotless i to plain i', () => {
    expect(normalizeForSearch('İstanbul')).toBe('istanbul')
    expect(normalizeForSearch('ışık')).toBe('isik')
  })

  it('preserves meaningful marks in Japanese and Indic scripts', () => {
    expect(normalizeForSearch('が')).not.toBe(normalizeForSearch('か'))
    // Devanagari: virama distinguishes क् from क; the mark must survive.
    expect(normalizeForSearch('क्')).not.toBe(normalizeForSearch('क'))
    // Tamil pulli likewise.
    expect(normalizeForSearch('க்')).not.toBe(normalizeForSearch('க'))
  })

  it('strips Arabic harakat so vocalized and bare text match', () => {
    expect(normalizeForSearch('كَتَبَ')).toBe(normalizeForSearch('كتب'))
  })

  it('collapses whitespace and trims', () => {
    expect(normalizeForSearch('  hello   world  ')).toBe('hello world')
  })
})

describe('matchesSearchQuery', () => {
  it('is hyphen-insensitive in both directions', () => {
    expect(matchesSearchQuery('a real panty-waist', 'pantywaist')).toBe(true)
    expect(matchesSearchQuery('a real pantywaist', 'panty-waist')).toBe(true)
  })

  it('tolerates one typo in words of 4+ letters', () => {
    expect(matchesSearchQuery('the vixen appeared', 'vixin')).toBe(true)
    expect(matchesSearchQuery('Hello, world!', 'wurld')).toBe(true)
  })

  it('does not fuzzy-match short words', () => {
    expect(matchesSearchQuery('the car drove off', 'cat')).toBe(false)
  })

  it('matches accent-insensitively', () => {
    expect(matchesSearchQuery('hablo Español ahora', 'espanol')).toBe(true)
    expect(matchesSearchQuery('un café noir', 'cafe')).toBe(true)
  })

  it('matches phrases across stripped punctuation', () => {
    expect(matchesSearchQuery('Hello, world!', 'hello world')).toBe(true)
  })

  it('matches prefixes via substring', () => {
    expect(matchesSearchQuery('estaba corriendo', 'corr')).toBe(true)
  })

  it("matches through apostrophes: l'homme ≈ lhomme ≈ homme", () => {
    expect(matchesSearchQuery("l'homme est là", 'lhomme')).toBe(true)
    expect(matchesSearchQuery("l'homme est là", 'homme')).toBe(true)
  })

  it('matches CJK substrings without word boundaries', () => {
    expect(matchesSearchQuery('私は学生です', '学生')).toBe(true)
  })

  it('does not conflate Japanese voiced and unvoiced kana', () => {
    expect(matchesSearchQuery('かき', 'がぎ')).toBe(false)
  })

  it('requires every query word to match (AND semantics)', () => {
    expect(matchesSearchQuery('the quick brown fox', 'quick fox')).toBe(true)
    expect(matchesSearchQuery('the quick brown fox', 'quick dog')).toBe(false)
  })

  it('matches everything on an empty or whitespace query', () => {
    expect(matchesSearchQuery('anything', '')).toBe(true)
    expect(matchesSearchQuery('anything', '   ')).toBe(true)
  })
})

describe('createSearchMatcher', () => {
  it('matches pre-normalized haystacks without re-normalizing', () => {
    const matcher = createSearchMatcher('Vixin')
    expect(matcher.matchesNormalized(normalizeForSearch('The Vixen!'))).toBe(true)
    expect(matcher.matchesNormalized(normalizeForSearch('The badger'))).toBe(false)
  })

  it('agrees with matchesSearchQuery on raw haystacks', () => {
    const matcher = createSearchMatcher('panty-waist')
    expect(matcher.matches('a pantywaist remark')).toBe(true)
  })
})
