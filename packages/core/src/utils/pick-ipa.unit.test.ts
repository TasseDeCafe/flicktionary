import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IPA_DIALECTS,
  hasDisplayableIpa,
  ipaDialectsFromPrefs,
  pickIpa,
  pickIpaForDisplay,
  type IpaDialects,
} from './pick-ipa'

const dialects = (overrides?: Partial<IpaDialects>): IpaDialects => ({ ...DEFAULT_IPA_DIALECTS, ...overrides })

describe('pickIpa', () => {
  it('picks the requested English dialect first', () => {
    const ipa = { ga: '/kæt/', rp: '/kat/', untagged: '/cat/' }

    expect(pickIpa(ipa, 'en', dialects({ en: 'ga' }))).toBe('/kæt/')
    expect(pickIpa(ipa, 'en', dialects({ en: 'rp' }))).toBe('/kat/')
  })

  it('falls back to English untagged when the requested dialect is absent', () => {
    expect(pickIpa({ rp: '/kat/', untagged: '/cat/' }, 'en', dialects({ en: 'ga' }))).toBe('/cat/')
  })

  it('picks the requested Spanish dialect first', () => {
    const ipa = { cas: '/θeɾˈbeθa/', lam: '/seɾˈvesa/', untagged: '/x/' }

    expect(pickIpa(ipa, 'es', dialects({ es: 'cas' }))).toBe('/θeɾˈbeθa/')
    expect(pickIpa(ipa, 'es', dialects({ es: 'lam' }))).toBe('/seɾˈvesa/')
  })

  it('picks the requested Portuguese dialect first', () => {
    const ipa = { br: '/teˈzaw.ɾus/', eu: '/tɨˈzaw.ɾuʃ/' }

    expect(pickIpa(ipa, 'pt', dialects({ pt: 'br' }))).toBe('/teˈzaw.ɾus/')
    expect(pickIpa(ipa, 'pt', dialects({ pt: 'eu' }))).toBe('/tɨˈzaw.ɾuʃ/')
  })

  it('falls back to untagged for es/pt when the requested dialect bucket is absent', () => {
    expect(pickIpa({ untagged: '/ˈpje/' }, 'es', dialects())).toBe('/ˈpje/')
    expect(pickIpa({ untagged: '/u/' }, 'pt', dialects())).toBe('/u/')
  })

  it('uses only untagged IPA for languages without a dialect split', () => {
    expect(pickIpa({ ga: '/wrong/', untagged: '/sɐˈbakə/' }, 'ru', dialects())).toBe('/sɐˈbakə/')
    expect(pickIpa({ cas: '/wrong/' }, 'ru', dialects())).toBeUndefined()
  })

  it('returns undefined when no suitable IPA exists', () => {
    expect(pickIpa(null, 'en', dialects())).toBeUndefined()
    expect(pickIpa({ rp: null }, 'ru', dialects())).toBeUndefined()
    // The other language's buckets never leak: a cas-only bag is invisible to pt.
    expect(pickIpa({ cas: '/θ/' }, 'pt', dialects())).toBeUndefined()
  })
})

describe('hasDisplayableIpa', () => {
  it('counts any of the language own dialect buckets or untagged', () => {
    expect(hasDisplayableIpa({ cas: '/θeɾˈbeθa/' }, 'es')).toBe(true)
    expect(hasDisplayableIpa({ lam: '/seɾˈvesa/' }, 'es')).toBe(true)
    expect(hasDisplayableIpa({ br: '/x/' }, 'pt')).toBe(true)
    expect(hasDisplayableIpa({ eu: '/x/' }, 'pt')).toBe(true)
    expect(hasDisplayableIpa({ ga: '/x/' }, 'en')).toBe(true)
    expect(hasDisplayableIpa({ untagged: '/x/' }, 'ru')).toBe(true)
  })

  it('ignores buckets belonging to other languages', () => {
    expect(hasDisplayableIpa({ cas: '/θ/' }, 'pt')).toBe(false)
    expect(hasDisplayableIpa({ br: '/x/' }, 'es')).toBe(false)
    expect(hasDisplayableIpa({ ga: '/x/' }, 'ru')).toBe(false)
    expect(hasDisplayableIpa({}, 'es')).toBe(false)
  })
})

describe('pickIpaForDisplay', () => {
  it('prefers the picked dialect, then untagged', () => {
    expect(pickIpaForDisplay({ lam: '/s/', cas: '/θ/' }, 'es', dialects({ es: 'lam' }))).toBe('/s/')
    expect(pickIpaForDisplay({ untagged: '/u/', cas: '/θ/' }, 'es', dialects({ es: 'lam' }))).toBe('/u/')
  })

  it('falls back to the language other dialect bucket when the preferred one is absent', () => {
    // The unpaired-θ case: a cas-only Spanish entry must still render for a
    // lam user — hasDisplayableIpa accepted it, so display can never be empty.
    expect(pickIpaForDisplay({ cas: '/θeɾˈbeθa/' }, 'es', dialects({ es: 'lam' }))).toBe('/θeɾˈbeθa/')
    expect(pickIpaForDisplay({ eu: '/tɨ/' }, 'pt', dialects({ pt: 'br' }))).toBe('/tɨ/')
    expect(pickIpaForDisplay({ rp: '/kat/' }, 'en', dialects({ en: 'ga' }))).toBe('/kat/')
  })

  it('returns undefined only when the bag is empty for this language', () => {
    expect(pickIpaForDisplay(null, 'es', dialects())).toBeUndefined()
    expect(pickIpaForDisplay({ cas: '/θ/' }, 'pt', dialects())).toBeUndefined()
  })
})

describe('ipaDialectsFromPrefs', () => {
  it('fills defaults for missing prefs', () => {
    expect(ipaDialectsFromPrefs(null)).toEqual({ en: 'ga', es: 'lam', pt: 'br' })
    expect(ipaDialectsFromPrefs({ englishIpaDialect: 'rp' })).toEqual({ en: 'rp', es: 'lam', pt: 'br' })
    expect(
      ipaDialectsFromPrefs({ englishIpaDialect: 'ga', spanishIpaDialect: 'cas', portugueseIpaDialect: 'eu' })
    ).toEqual({ en: 'ga', es: 'cas', pt: 'eu' })
  })
})
