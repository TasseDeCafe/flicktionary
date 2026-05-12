import { describe, expect, it } from 'vitest'
import { pickIpa } from './pick-ipa'

describe('pickIpa', () => {
  it('picks the requested English dialect first', () => {
    const ipa = { ga: '/kæt/', rp: '/kat/', untagged: '/cat/' }

    expect(pickIpa(ipa, 'en', 'ga')).toBe('/kæt/')
    expect(pickIpa(ipa, 'en', 'rp')).toBe('/kat/')
  })

  it('falls back to English untagged when the requested dialect is absent', () => {
    expect(pickIpa({ rp: '/kat/', untagged: '/cat/' }, 'en', 'ga')).toBe('/cat/')
  })

  it('uses only untagged IPA for non-English languages', () => {
    expect(pickIpa({ ga: '/wrong/', untagged: '/sɐˈbakə/' }, 'ru', 'ga')).toBe('/sɐˈbakə/')
  })

  it('returns undefined when no suitable IPA exists', () => {
    expect(pickIpa(null, 'en', 'ga')).toBeUndefined()
    expect(pickIpa({ rp: null }, 'ru', 'ga')).toBeUndefined()
  })
})
