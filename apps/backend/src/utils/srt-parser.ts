export type ParsedSrtSegment = {
  index: number
  text: string
  startMs: number
  endMs: number
}

const TIMESTAMP_RE = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/

const toMs = (h: string, m: string, s: string, ms: string): number =>
  Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1_000 + Number(ms)

// Parses .srt content. Tolerates BOM, CRLF, and multi-line cues. Cues with malformed
// timestamps are skipped silently so a partial file still yields usable segments.
export const parseSrt = (raw: string): ParsedSrtSegment[] => {
  const stripped = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const blocks = stripped.split(/\n{2,}/)
  const segments: ParsedSrtSegment[] = []
  let nextIndex = 0

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) continue

    const timestampLineIndex = lines.findIndex((l) => TIMESTAMP_RE.test(l))
    if (timestampLineIndex === -1) continue

    const match = lines[timestampLineIndex]!.match(TIMESTAMP_RE)
    if (!match) continue

    const startMs = toMs(match[1]!, match[2]!, match[3]!, match[4]!)
    const endMs = toMs(match[5]!, match[6]!, match[7]!, match[8]!)
    const textLines = lines.slice(timestampLineIndex + 1)
    const text = textLines.join(' ').trim()
    if (!text) continue

    segments.push({ index: nextIndex, text, startMs, endMs })
    nextIndex += 1
  }

  return segments
}
