import { describe, expect, it } from 'vitest'
import { normalizeTargetForm } from './normalize-target-form'

describe('normalizeTargetForm', () => {
  it('strips Russian combining stress (U+0301) and lowercases', () => {
    // 'Стола́' (capital С + combining acute on а) → 'стола'
    expect(normalizeTargetForm('Стола́')).toBe('стола')
    expect(normalizeTargetForm('е́сли')).toBe('если')
  })

  it('lowercases so case variants collapse to one key', () => {
    expect(normalizeTargetForm('Houses')).toBe('houses')
    expect(normalizeTargetForm('houses')).toBe('houses')
    expect(normalizeTargetForm('СТОЛ')).toBe('стол')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeTargetForm('  êtes ')).toBe('êtes')
  })

  it('preserves precomposed accents (NFC) that are not stress marks', () => {
    // 'êtes' must stay 'êtes' — only the combining acute U+0301 is stripped.
    expect(normalizeTargetForm('êtes')).toBe('êtes')
  })

  it('NFC-composes decomposed input to match the SQL normalize(...,NFC) twin', () => {
    // e + combining circumflex (U+0302) → precomposed ê; U+0302 is NOT stripped.
    expect(normalizeTargetForm('êtes')).toBe('êtes')
  })
})
