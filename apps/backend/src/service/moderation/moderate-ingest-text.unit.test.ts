import { describe, expect, test, vi } from 'vitest'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type { ModerationVerdict } from '../../transport/third-party/anthropic/passes/moderation-pass'
import { buildBookModerationSample, chunkForModeration, moderateIngestText } from './moderate-ingest-text'

const passesWith = (moderationPass: (chunk: string) => Promise<ModerationVerdict | null>) =>
  MockAnthropicPasses({ moderationPass: moderationPass as never })

describe('chunkForModeration', () => {
  test('returns nothing for blank input and one chunk for short input', () => {
    expect(chunkForModeration('   \n ')).toEqual([])
    expect(chunkForModeration('hello world')).toEqual(['hello world'])
  })

  test('covers the full text with chunks of at most 20k chars — no blind spots', () => {
    const text = 'x'.repeat(500_000)
    const chunks = chunkForModeration(text)
    expect(chunks.length).toBe(25)
    expect(chunks.every((c) => c.length <= 20_000)).toBe(true)
    expect(chunks.join('')).toBe(text)
  })
})

describe('moderateIngestText', () => {
  test('all chunks allow → clean with full coverage', async () => {
    const passes = passesWith(vi.fn().mockResolvedValue({ verdict: 'allow' }))
    const outcome = await moderateIngestText('x'.repeat(45_000), passes, { surface: 'paste' })
    expect(outcome).toEqual({ allowed: true, status: 'clean', category: null })
    expect(passes.moderationPass).toHaveBeenCalledTimes(3)
  })

  test('a single blocked chunk among allows rejects the whole document', async () => {
    const moderationPass = vi.fn(async (chunk: string): Promise<ModerationVerdict> => {
      return chunk.includes('BAD') ? { verdict: 'block', category: 'sexual-explicit' } : { verdict: 'allow' }
    })
    // Content buried in the second chunk — full coverage must find it.
    const text = 'x'.repeat(25_000) + 'BAD' + 'x'.repeat(25_000)
    const outcome = await moderateIngestText(text, passesWith(moderationPass), { surface: 'lesson-import' })
    expect(outcome).toEqual({ allowed: false, category: 'sexual-explicit' })
  })

  test('a flagged chunk among allows flags the document with its category', async () => {
    const moderationPass = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 'allow' })
      .mockResolvedValueOnce({ verdict: 'flag', category: 'violence' })
    const outcome = await moderateIngestText('x'.repeat(30_000), passesWith(moderationPass), { surface: 'paste' })
    expect(outcome).toEqual({ allowed: true, status: 'flagged', category: 'violence' })
  })

  test('a failing chunk fails open (null status) but a block from a surviving chunk still wins', async () => {
    const moderationPass = vi
      .fn()
      .mockRejectedValueOnce(new Error('anthropic down'))
      .mockResolvedValueOnce({ verdict: 'block', category: 'csam' })
    const outcome = await moderateIngestText('x'.repeat(30_000), passesWith(moderationPass), { surface: 'telegram' })
    expect(outcome).toEqual({ allowed: false, category: 'csam' })
  })

  test('an allow alongside a failed chunk yields incomplete coverage — allowed but unverified', async () => {
    const moderationPass = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 'allow' })
      .mockRejectedValueOnce(new Error('anthropic down'))
    const outcome = await moderateIngestText('x'.repeat(30_000), passesWith(moderationPass), { surface: 'srt-upload' })
    expect(outcome).toEqual({ allowed: true, status: null, category: null })
  })

  test('an unparseable verdict counts as a failed chunk', async () => {
    const passes = passesWith(vi.fn().mockResolvedValue(null))
    const outcome = await moderateIngestText('short text', passes, { surface: 'paste' })
    expect(outcome).toEqual({ allowed: true, status: null, category: null })
  })

  test('empty input allows without calling the pass', async () => {
    const passes = passesWith(vi.fn())
    const outcome = await moderateIngestText('   ', passes, { surface: 'paste' })
    expect(outcome).toEqual({ allowed: true, status: null, category: null })
    expect(passes.moderationPass).not.toHaveBeenCalled()
  })
})

describe('moderateIngestText hard-block narrowing', () => {
  test('a block outside the surface hard-block set downgrades to a flag', async () => {
    const passes = passesWith(vi.fn().mockResolvedValue({ verdict: 'block', category: 'sexual-explicit' }))
    const outcome = await moderateIngestText('a novel', passes, {
      surface: 'book-upload',
      hardBlockCategories: ['csam'],
    })
    expect(outcome).toEqual({ allowed: true, status: 'flagged', category: 'sexual-explicit' })
  })

  test('a block inside the surface hard-block set still rejects', async () => {
    const passes = passesWith(vi.fn().mockResolvedValue({ verdict: 'block', category: 'csam' }))
    const outcome = await moderateIngestText('a novel', passes, {
      surface: 'book-upload',
      hardBlockCategories: ['csam'],
    })
    expect(outcome).toEqual({ allowed: false, category: 'csam' })
  })
})

describe('buildBookModerationSample', () => {
  test('short books are sampled whole', () => {
    expect(buildBookModerationSample('  short book  ')).toBe('short book')
  })

  test('long books sample the opening plus spread windows that fit one moderation chunk', () => {
    // Unique 5-char tokens, so every window's position in the text is unambiguous.
    const text = Array.from({ length: 200_000 }, (_, i) => String(i).padStart(5, '0')).join('')
    const sample = buildBookModerationSample(text, () => 0.5)
    const windows = sample.split('\n\n')
    expect(windows).toHaveLength(4)
    expect(windows[0]!.startsWith('00000')).toBe(true)
    expect(windows.every((w) => w.length === 4_900)).toBe(true)
    expect(chunkForModeration(sample)).toHaveLength(1)
    // Each random window lands in its own third of the remaining text.
    const offsets = windows.slice(1).map((w) => text.indexOf(w))
    expect(offsets[0]!).toBeLessThan(text.length / 3)
    expect(offsets[2]!).toBeGreaterThan((2 * text.length) / 3)
  })
})
