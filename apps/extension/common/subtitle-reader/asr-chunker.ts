// Re-chunks YouTube auto-generated (ASR) subtitles into phrase/sentence-sized
// cues using the per-word timestamps the srv3 payload carries.
//
// YouTube hard-wraps ASR cues at ~40 characters with no regard for phrase
// structure — measured across real payloads, 54-63% of cue boundaries fall
// mid-phrase. That makes terms span cues, which breaks word/chunk selection in
// the subtitle overlay (selection is per-cue). Rebuilding cues from the word
// stream moves boundaries to actual pauses and sentence ends (~3-7% residual
// mid-phrase boundaries, all of them genuine rhetorical pauses in the audio).
//
// Language notes (validated against real EN/JA/AR payloads):
// - New-model ASR (2025+, mostly English) has punctuation and `>>` speaker
//   markers; old-model ASR has neither. Both are handled: punctuation is the
//   preferred split signal when present, silence gaps otherwise.
// - The pause threshold adapts to the speaker's cadence — a fixed value
//   misfires badly (measured Arabic narration has a *median* inter-word delta
//   of 560ms; a fixed 700ms "pause" would split almost every phrase).
// - Tokens keep the payload's own spacing (Japanese carries none — joining
//   with spaces would corrupt it), except row-initial tokens, which always
//   lack the leading space their mid-row siblings carry and need one
//   re-inserted in space-separated scripts.
// - Japanese tokens beginning with hiragana are overwhelmingly particles or
//   auxiliaries glued to the preceding content word; a cue must not start
//   with one unless the pause is unmistakable.

export interface TimedWord {
  // Absolute start time in ms (row start + word offset).
  start: number
  // Raw token text as it appears in the payload, including any leading space.
  text: string
  // First word of a srv3 row — lacks the leading space mid-row tokens carry.
  rowInitial: boolean
  // End of the row this word belongs to (row start + trimmed duration);
  // bounds the end time of a chunk that finishes on this word.
  rowEnd: number
  // Standalone non-speech row ([music], [applause], ...) — always emitted as
  // its own cue, never merged with neighbors.
  barrier?: boolean
}

export interface AsrChunk {
  start: number
  end: number
  text: string
}

// Sentence-final punctuation across supported scripts: Latin, CJK full-width,
// Arabic (؟ / Urdu ۔), Devanagari danda. Optionally followed by a closing
// quote/bracket.
const sentenceEndRegex = /[.!?…。．！？｡؟۔।॥]["')\]」』”]?\s*$/
// Clause punctuation (preferred over a raw gap when force-splitting a chunk
// that hit the hard cap): Latin, CJK and Arabic commas/semicolons/colons.
const clauseEndRegex = /[,;:、，；：؛]\s*$/
// Scripts written without inter-word spaces: CJK ideographs/kana/CJK
// punctuation, Thai, Lao, Khmer, Burmese. NOT Hangul — Korean is full-width
// but space-separated, so row-initial Korean tokens still need a space.
const noSpaceScriptRegex = /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff]/
// Full-width characters count double toward the line-length caps: CJK, kana,
// Hangul, CJK compatibility/full-width forms.
const wideCharRegex = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g
const hiraganaInitialRegex = /^\s*[\u3040-\u309f]/
// `>>` marks a speaker change in new-model ASR. Stripped from the text and
// turned into a forced cue boundary instead.
const speakerMarkerRegex = /^(\s*)>>\s*/

// Pause threshold = SPEECH_RATE_FACTOR x median inter-word delta, clamped.
const SPEECH_RATE_FACTOR = 3.5
const MIN_GAP_MS = 550
const MAX_GAP_MS = 2200
const FALLBACK_GAP_MS = 900
// A hiragana-initial token only starts a cue when the pause is this much
// larger than the regular threshold.
const PARTICLE_GLUE_FACTOR = 2.5
// Effective-width caps (full-width/no-space-script characters count double).
const MIN_EFF_CHARS = 12
const SOFT_CAP_EFF_CHARS = 84
const HARD_CAP_EFF_CHARS = 110
// How many upcoming words the "sentence ends soon" lookahead considers.
const SENTENCE_LOOKAHEAD_WORDS = 3
// Minimum count of explicitly-timed words for a payload to qualify as ASR.
export const MIN_TIMED_WORDS_FOR_CHUNKING = 10

// Effective display width: characters of no-space scripts are full-width and
// information-dense, so they count double toward the line caps.
const effectiveLength = (text: string): number => {
  const trimmed = text.trim()
  const wide = trimmed.match(wideCharRegex)?.length ?? 0
  return trimmed.length + wide
}

// Concatenate tokens preserving the payload's own spacing. Row-initial tokens
// lack their leading space; re-insert one unless either neighbor character
// belongs to a script written without spaces.
const joinWords = (words: readonly TimedWord[]): string => {
  let out = ''
  for (const w of words) {
    if (out.length > 0 && w.rowInitial && !/\s$/.test(out) && !/^\s/.test(w.text)) {
      const before = out[out.length - 1]
      const after = w.text[0]
      if (!noSpaceScriptRegex.test(before) && !noSpaceScriptRegex.test(after)) {
        out += ' '
      }
    }
    out += w.text
  }
  return out.trim()
}

const median = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

// Pause threshold adapted to the speaker's cadence, from the deltas between
// consecutive word starts within the same row (cross-row deltas are the
// boundaries we're re-deciding, so they're excluded from the baseline).
const adaptiveGapMs = (words: readonly TimedWord[]): number => {
  const deltas: number[] = []
  for (let i = 1; i < words.length; i++) {
    if (!words[i].rowInitial && !words[i].barrier && !words[i - 1].barrier) {
      const delta = words[i].start - words[i - 1].start
      if (delta > 0) {
        deltas.push(delta)
      }
    }
  }
  const medianDelta = median(deltas)
  if (medianDelta === undefined || deltas.length < 20) {
    return FALLBACK_GAP_MS
  }
  return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, Math.round(SPEECH_RATE_FACTOR * medianDelta)))
}

export const chunkTimedWords = (inputWords: readonly TimedWord[]): AsrChunk[] => {
  const gapMs = adaptiveGapMs(inputWords)
  const chunks: TimedWord[][] = []
  let current: TimedWord[] = []
  let currentLength = 0
  // Set when a speaker marker forces the next word to start a new cue.
  let forceSplit = false

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current)
      current = []
      currentLength = 0
    }
  }

  // Strip speaker markers up front; a marker forces a boundary before its word.
  const words: TimedWord[] = []
  const splitBefore = new Set<number>()
  for (const word of inputWords) {
    if (speakerMarkerRegex.test(word.text)) {
      const stripped = word.text.replace(speakerMarkerRegex, '$1')
      splitBefore.add(words.length)
      if (stripped.trim().length > 0) {
        words.push({ ...word, text: stripped })
      } else {
        // Token was only the marker: the boundary applies to the next word.
        continue
      }
    } else {
      words.push(word)
    }
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]

    if (word.barrier) {
      flush()
      chunks.push([word])
      continue
    }

    if (current.length > 0) {
      if (splitBefore.has(i) || forceSplit) {
        flush()
        forceSplit = false
        current.push(word)
        currentLength = effectiveLength(joinWords(current))
        continue
      }

      const previous = current[current.length - 1]
      const gap = word.start - previous.start

      // Lookahead: if the sentence ends within the next few words and still
      // fits under the hard cap, hold the chunk so the punctuation split wins.
      let sentenceEndsSoon = false
      let lookaheadLength = currentLength
      for (let k = i; k < Math.min(i + SENTENCE_LOOKAHEAD_WORDS, words.length); k++) {
        lookaheadLength += effectiveLength(words[k].text)
        if (lookaheadLength > HARD_CAP_EFF_CHARS) {
          break
        }
        if (sentenceEndRegex.test(words[k].text)) {
          sentenceEndsSoon = true
          break
        }
      }

      // Hiragana-initial tokens are particles/auxiliaries glued to the
      // preceding content word; only a much larger pause may split here.
      const particleGlue = hiraganaInitialRegex.test(word.text) && gap < PARTICLE_GLUE_FACTOR * gapMs

      if (gap > gapMs && currentLength >= MIN_EFF_CHARS && !sentenceEndsSoon && !particleGlue) {
        flush()
      } else if (sentenceEndRegex.test(previous.text) && currentLength >= MIN_EFF_CHARS) {
        flush()
      } else if (currentLength + effectiveLength(word.text) > HARD_CAP_EFF_CHARS) {
        // Over the hard cap: back-split at the best point in the trailing
        // 2/3 — prefer sentence ends, then clause punctuation, then the
        // largest silence gap.
        let bestIndex = -1
        let bestScore = -1
        for (let k = Math.floor(current.length / 3); k < current.length; k++) {
          if (k === 0) {
            continue
          }
          const splitGap = current[k].start - current[k - 1].start
          const beforeSplit = current[k - 1].text
          const score =
            splitGap + (sentenceEndRegex.test(beforeSplit) ? 5000 : 0) + (clauseEndRegex.test(beforeSplit) ? 1500 : 0)
          if (score >= bestScore) {
            bestScore = score
            bestIndex = k
          }
        }
        if (bestIndex > 0) {
          const tail = current.splice(bestIndex)
          chunks.push(current)
          current = tail
          currentLength = effectiveLength(joinWords(tail))
        } else {
          flush()
        }
      } else if (currentLength >= SOFT_CAP_EFF_CHARS && gap > gapMs / 2 && !sentenceEndsSoon && !particleGlue) {
        flush()
      }
    }

    current.push(word)
    currentLength = effectiveLength(joinWords(current))
  }

  flush()

  // Materialize chunk timing: a chunk runs from its first word to the end of
  // the row its last word came from, clipped so consecutive cues never overlap.
  const result: AsrChunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunkWords = chunks[i]
    const start = chunkWords[0].start
    let end = Math.max(start + 1, chunkWords[chunkWords.length - 1].rowEnd)
    if (i + 1 < chunks.length) {
      end = Math.max(start + 1, Math.min(end, chunks[i + 1][0].start))
    }
    result.push({ start, end, text: joinWords(chunkWords) })
  }
  return result
}
