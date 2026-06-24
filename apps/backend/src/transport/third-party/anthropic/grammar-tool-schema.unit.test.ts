import { describe, expect, it } from 'vitest'
import { buildGrammarSchema } from './grammar-tool-schema'

const keysFor = (lang: string): string[] => Object.keys(buildGrammarSchema(lang, 'desc').properties)

describe('buildGrammarSchema', () => {
  it('passes the object description through', () => {
    expect(buildGrammarSchema('de', 'my description').description).toBe('my description')
  })

  it('always offers the universal keys (pos + ipa) for every language', () => {
    for (const lang of ['de', 'ru', 'en', 'es', 'ja', 'unknown-lang']) {
      const keys = keysFor(lang)
      expect(keys).toContain('pos')
      expect(keys).toContain('ipa')
    }
  })

  it('scopes German to its keys and excludes Slavic-only keys', () => {
    const keys = keysFor('de')
    expect(keys).toEqual(
      expect.arrayContaining(['gender', 'plural', 'genitive', 'is_weak_noun', 'is_separable', 'auxiliary'])
    )
    expect(keys).not.toContain('aspect')
    expect(keys).not.toContain('aspect_pair_headword')
    expect(keys).not.toContain('animacy')
  })

  it('scopes Russian to its keys and excludes German-only keys', () => {
    const keys = keysFor('ru')
    expect(keys).toEqual(expect.arrayContaining(['gender', 'aspect', 'aspect_pair_headword', 'animacy']))
    expect(keys).not.toContain('plural')
    expect(keys).not.toContain('genitive')
    expect(keys).not.toContain('auxiliary')
    expect(keys).not.toContain('is_weak_noun')
    expect(keys).not.toContain('is_separable')
  })

  it('falls back to the default config (plus universal) for an unconfigured language', () => {
    const keys = keysFor('ja')
    // Default config: pos, display_form, government, number_only, notable_forms, notes — plus universal ipa.
    expect(keys).toEqual(expect.arrayContaining(['pos', 'ipa', 'government', 'number_only', 'notable_forms', 'notes']))
    expect(keys).not.toContain('gender')
    expect(keys).not.toContain('aspect')
    expect(keys).not.toContain('plural')
  })

  it('keeps the IPA description on the ipa property', () => {
    const ipa = buildGrammarSchema('de', 'desc').properties.ipa
    expect(String(ipa.description)).toContain('IPA transcription')
  })
})
