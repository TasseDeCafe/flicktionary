import { describe, expect, test } from 'vitest'
import { parseModerationVerdict } from './moderation-pass'

describe('parseModerationVerdict', () => {
  test('parses a bare allow', () => {
    expect(parseModerationVerdict('allow')).toEqual({ verdict: 'allow' })
  })

  test('parses flag with a known category', () => {
    expect(parseModerationVerdict('flag violence')).toEqual({ verdict: 'flag', category: 'violence' })
  })

  test('parses block with a hard-block category', () => {
    expect(parseModerationVerdict('block sexual-explicit')).toEqual({ verdict: 'block', category: 'sexual-explicit' })
    expect(parseModerationVerdict('block csam')).toEqual({ verdict: 'block', category: 'csam' })
  })

  test('promotes flag to block for hard-block categories — the policy lives here, not in the prompt', () => {
    expect(parseModerationVerdict('flag sexual-explicit')).toEqual({ verdict: 'block', category: 'sexual-explicit' })
    expect(parseModerationVerdict('flag csam')).toEqual({ verdict: 'block', category: 'csam' })
  })

  test('downgrades block to flag for every non-hard-block category', () => {
    expect(parseModerationVerdict('block violence')).toEqual({ verdict: 'flag', category: 'violence' })
    expect(parseModerationVerdict('block hate')).toEqual({ verdict: 'flag', category: 'hate' })
    expect(parseModerationVerdict('block other')).toEqual({ verdict: 'flag', category: 'other' })
  })

  test('keeps a recognized verb with a bogus category as a generic flag', () => {
    expect(parseModerationVerdict('flag something-new')).toEqual({ verdict: 'flag', category: 'other' })
    expect(parseModerationVerdict('block')).toEqual({ verdict: 'flag', category: 'other' })
  })

  test('tolerates case and surrounding whitespace', () => {
    expect(parseModerationVerdict('  ALLOW  ')).toEqual({ verdict: 'allow' })
    expect(parseModerationVerdict('\nFlag  Violence\n')).toEqual({ verdict: 'flag', category: 'violence' })
  })

  test('returns null for unrecognized output', () => {
    expect(parseModerationVerdict('')).toBeNull()
    expect(parseModerationVerdict('   ')).toBeNull()
    expect(parseModerationVerdict('I cannot classify this text.')).toBeNull()
    expect(parseModerationVerdict('verdict: allow')).toBeNull()
  })
})
