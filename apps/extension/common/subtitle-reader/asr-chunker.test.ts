import { describe, expect, it } from 'vitest'
import { TimedWord, chunkTimedWords } from './asr-chunker'

// Tokens mirror the srv3 payload convention: mid-row tokens carry a leading
// space in space-separated scripts, row-initial tokens never do, Japanese
// tokens carry none at all.
const word = (start: number, text: string, opts: Partial<TimedWord> = {}): TimedWord => ({
  start,
  text,
  rowInitial: false,
  rowEnd: opts.rowEnd ?? start + 3000,
  ...opts,
})

// A speech run at the given cadence, one row per call; first token row-initial.
const row = (start: number, cadence: number, tokens: string[], opts: Partial<TimedWord> = {}): TimedWord[] =>
  tokens.map((t, i) =>
    word(start + i * cadence, i === 0 ? t : ` ${t}`, {
      ...opts,
      rowInitial: i === 0,
      rowEnd: opts.rowEnd ?? start + tokens.length * cadence + 1000,
    })
  )

const texts = (words: TimedWord[]) => chunkTimedWords(words).map((c) => c.text)

describe('joining', () => {
  it('re-inserts the missing space before row-initial Latin tokens', () => {
    // "so in" | "college I was" — row-initial "college" has no leading space.
    const words = [...row(0, 200, ['so', 'in']), ...row(400, 200, ['college', 'I', 'was'])]
    expect(texts(words)).toEqual(['so in college I was'])
  })

  it('does not insert spaces between Japanese tokens', () => {
    const words = [
      word(0, '本日', { rowInitial: true }),
      word(300, 'の'),
      word(500, 'テーマ'),
      word(800, 'は', { rowInitial: true }),
    ]
    expect(texts(words)).toEqual(['本日のテーマは'])
  })

  it('keeps spaces for Korean despite full-width characters', () => {
    const words = [...row(0, 200, ['오늘', '날씨가']), ...row(400, 200, ['좋습니다', '정말'])]
    expect(texts(words)).toEqual(['오늘 날씨가 좋습니다 정말'])
  })
})

describe('gap splitting', () => {
  it('splits at a clear pause (fallback threshold)', () => {
    const words = [
      ...row(0, 200, ['this', 'phrase', 'is', 'long', 'enough']),
      ...row(5000, 200, ['next', 'phrase', 'starts', 'here']),
    ]
    expect(texts(words)).toEqual(['this phrase is long enough', 'next phrase starts here'])
  })

  it('does not split before the chunk reaches the minimum length', () => {
    // "so" is far below MIN_EFF_CHARS — the pause must not orphan it.
    const words = [word(0, 'so', { rowInitial: true }), ...row(5000, 200, ['then', 'it', 'happened'])]
    expect(texts(words)).toEqual(['so then it happened'])
  })

  it('adapts the threshold to a slow speaker', () => {
    // Cadence 600ms (>=20 deltas) -> threshold 2100ms; a 1500ms delta is
    // normal cadence for this speaker, not a pause.
    const tokens = Array.from({ length: 22 }, (_, i) => `w${i}`)
    const words = row(0, 600, tokens)
    // Inject a 1500ms "gap" mid-stream by shifting the tail.
    const shifted = words.map((w, i) => (i >= 11 ? { ...w, start: w.start + 900 } : w))
    expect(texts(shifted)).toHaveLength(1)
  })

  it('splits the same absolute gap for a fast speaker', () => {
    // Cadence 150ms -> clamped threshold 550ms; 1500ms is a real pause.
    const tokens = Array.from({ length: 22 }, (_, i) => `w${i}`)
    const words = row(0, 150, tokens)
    const shifted = words.map((w, i) => (i >= 11 ? { ...w, start: w.start + 1350 } : w))
    expect(texts(shifted)).toHaveLength(2)
  })
})

describe('punctuation', () => {
  it('splits after sentence-final punctuation without needing a pause', () => {
    const words = [
      ...row(0, 200, ['the', 'first', 'sentence', 'ends.']),
      ...row(800, 200, ['the', 'second', 'one', 'continues']),
    ]
    expect(texts(words)).toEqual(['the first sentence ends.', 'the second one continues'])
  })

  it('holds a pause-split when the sentence ends within the lookahead', () => {
    // Pause right before "view." — the punctuation boundary must win.
    const words = [
      ...row(0, 200, ['observe', 'them', 'with', 'an', 'unobstructed']),
      word(3000, ' view.'),
      ...row(3400, 200, ['When', 'these', 'objects', 'flew']),
    ]
    expect(texts(words)).toEqual(['observe them with an unobstructed view.', 'When these objects flew'])
  })

  it('splits CJK sentence punctuation', () => {
    const words = [
      word(0, '今日は良い天気です。', { rowInitial: true }),
      word(500, '明日も晴れるでしょう', { rowInitial: true }),
    ]
    expect(texts(words)).toEqual(['今日は良い天気です。', '明日も晴れるでしょう'])
  })
})

describe('japanese particle glue', () => {
  it('does not start a cue with a hiragana-initial token at a normal pause', () => {
    const words = [
      word(0, '私たちに', { rowInitial: true }),
      word(300, '学校'),
      // 1200ms pause before の — a particle must stay glued.
      word(1500, 'の', { rowInitial: true }),
      word(1700, '議論'),
      word(2000, 'を'),
    ]
    expect(texts(words)).toEqual(['私たちに学校の議論を'])
  })

  it('still splits before a kanji-initial token at the same pause', () => {
    const words = [
      word(0, '私たちに', { rowInitial: true }),
      word(300, '学校'),
      word(600, 'の'),
      word(2200, '議論', { rowInitial: true }),
      word(2500, 'を'),
      word(2700, '提供'),
    ]
    expect(texts(words)).toEqual(['私たちに学校の', '議論を提供'])
  })
})

describe('caps', () => {
  it('back-splits an unpaused run at the best clause boundary', () => {
    // 30 words, no pauses, one comma inside the trailing back-split window
    // (the hard cap trips around the 16th ~7-eff-char token).
    const tokens = Array.from({ length: 30 }, (_, i) => (i === 12 ? 'pause,' : `word${i}`))
    const words = row(0, 200, tokens)
    const result = texts(words)
    expect(result.length).toBeGreaterThan(1)
    expect(result[0].endsWith('pause,')).toBe(true)
  })
})

describe('barriers and speaker markers', () => {
  it('keeps non-speech rows as standalone cues', () => {
    const words = [
      ...row(0, 200, ['speech', 'before', 'the', 'music']),
      word(2000, '[music]', { rowInitial: true, barrier: true }),
      ...row(4000, 200, ['speech', 'after', 'the', 'music']),
    ]
    expect(texts(words)).toEqual(['speech before the music', '[music]', 'speech after the music'])
  })

  it('strips >> markers and splits on speaker change', () => {
    const words = [
      ...row(0, 200, ['the', 'first', 'speaker', 'talks']),
      ...row(1000, 200, ['>> And', 'the', 'second', 'replies']),
    ]
    expect(texts(words)).toEqual(['the first speaker talks', 'And the second replies'])
  })
})

describe('timing', () => {
  it('clips cue ends to the next cue start', () => {
    const first = row(0, 200, ['this', 'phrase', 'is', 'long', 'enough'], { rowEnd: 99000 })
    const second = row(5000, 200, ['next', 'phrase', 'starts', 'here'])
    const chunks = chunkTimedWords([...first, ...second])
    expect(chunks).toHaveLength(2)
    expect(chunks[0].end).toBeLessThanOrEqual(chunks[1].start)
    expect(chunks[0].end).toBeGreaterThan(chunks[0].start)
  })
})
