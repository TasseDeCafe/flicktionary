export type ParsedTextLine = {
  index: number
  text: string
}

// Splits arbitrary pasted text (Reddit comment, news excerpt, Telegram post)
// into one segment per non-empty line. Mirrors the shape of `parseSrt` so the
// import service can swap parsers transparently.
export const parsePastedText = (raw: string): ParsedTextLine[] => {
  const stripped = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const lines = stripped.split('\n')
  const segments: ParsedTextLine[] = []
  let nextIndex = 0
  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    segments.push({ index: nextIndex, text })
    nextIndex += 1
  }
  return segments
}
