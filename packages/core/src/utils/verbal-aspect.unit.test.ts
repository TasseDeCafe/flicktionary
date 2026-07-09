import { describe, expect, it } from 'vitest'
import { getAspectTag, renderAspectLabel } from './verbal-aspect'

describe('renderAspectLabel', () => {
  it('abbreviates the known aspect values', () => {
    expect(renderAspectLabel('impf')).toBe('impf.')
    expect(renderAspectLabel('perf')).toBe('perf.')
    expect(renderAspectLabel('biaspectual')).toBe('biasp.')
  })

  it('passes unknown values through', () => {
    expect(renderAspectLabel('habitual')).toBe('habitual')
  })
})

describe('getAspectTag', () => {
  it('tags a Russian verb', () => {
    expect(getAspectTag({ pos: 'verb', aspect: 'impf' }, 'ru')).toBe('impf.')
    expect(getAspectTag({ pos: 'verb', aspect: 'biaspectual' }, 'ru')).toBe('biasp.')
  })

  it('ignores a stray aspect value on a non-verb POS', () => {
    expect(getAspectTag({ pos: 'adjective', aspect: 'perf' }, 'ru')).toBeNull()
  })

  it('tags when the POS is missing or a catch-all (no narrowing)', () => {
    expect(getAspectTag({ aspect: 'perf' }, 'ru')).toBe('perf.')
    expect(getAspectTag({ pos: 'phrase', aspect: 'perf' }, 'ru')).toBe('perf.')
  })

  it('returns null for languages whose grammar config has no aspect', () => {
    expect(getAspectTag({ pos: 'verb', aspect: 'impf' }, 'es')).toBeNull()
    expect(getAspectTag({ pos: 'verb', aspect: 'impf' }, undefined)).toBeNull()
  })

  it('returns null on missing/blank/non-string aspect and missing grammar', () => {
    expect(getAspectTag({ pos: 'verb' }, 'ru')).toBeNull()
    expect(getAspectTag({ pos: 'verb', aspect: '  ' }, 'ru')).toBeNull()
    expect(getAspectTag({ pos: 'verb', aspect: 3 }, 'ru')).toBeNull()
    expect(getAspectTag(null, 'ru')).toBeNull()
  })
})
