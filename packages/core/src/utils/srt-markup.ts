// SRT cues sometimes carry inline markup (`<i>`, `<b>`, `<font color="...">`, etc.).
// We strip it across the stack: the backend strips at parse time so storage / FTS /
// LLM passes never see markup; the frontend strips defensively at render time so
// already-imported tracks also display cleanly.

export const stripSrtMarkup = (text: string): string => text.replace(/<[^>]*>/g, '')

// Strip variant that also returns a position map. `map[i]` is the index in the
// stripped string that corresponds to position `i` in the original — including
// `i = original.length` so end-exclusive offsets remap cleanly. Tag chars map to
// the position the next non-tag char will occupy.
export const stripSrtMarkupWithMap = (original: string): { stripped: string; map: number[] } => {
  const map: number[] = new Array(original.length + 1)
  let out = ''
  let inTag = false
  for (let i = 0; i < original.length; i++) {
    map[i] = out.length
    const c = original[i]!
    if (c === '<') {
      inTag = true
      continue
    }
    if (c === '>') {
      inTag = false
      continue
    }
    if (!inTag) out += c
  }
  map[original.length] = out.length
  return { stripped: out, map }
}
