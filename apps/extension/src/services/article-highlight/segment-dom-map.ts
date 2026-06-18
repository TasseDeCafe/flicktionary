// The live-DOM ↔ backend-segment mapper — the one genuinely new piece of the
// on-page article-highlight feature.
//
// The backend segments ARE the Readability block `textContent`s, one per block,
// in document order, each `.trim()`'d (see `extract-article.ts`). Readability
// parses a *clone*, so its nodes aren't selectable; we instead match LIVE block
// elements to the returned segment STRINGS.
//
// Matching is **whitespace-tolerant**: Readability's serialized content and the
// live DOM frequently differ only in internal whitespace (newlines/indentation
// from the page's source, runs of spaces), and the title we prepend is
// Readability's collapsed `article.title`. We match on the whitespace-normalized
// form, so an `<h1>`/standfirst whose live text carries source-formatting
// newlines still maps. Crucially this stays provably correct: a match requires
// the two strings to be IDENTICAL under whitespace-normalization — i.e. the same
// sequence of non-whitespace characters — so offsets align character-for-
// character by non-whitespace index (`alignOffset`) and can never land in the
// wrong place. Blocks that differ by anything other than whitespace (e.g.
// Readability stripped an inline element's text, or a `<pre>` split into >1
// segment) normalize differently and are left unmapped, exactly as before.

import { getWordRanges, type WordRange } from '@flicktionary/core/dom/word-segmenter'

export interface ArticleSegment {
  index: number
  text: string
}

export interface SegmentDomMap {
  // segment index → the live block element that holds its text.
  blockBySegmentIndex: Map<number, HTMLElement>
  // live block element → the segment it maps to (text + index for offset math).
  segmentByBlock: Map<HTMLElement, ArticleSegment>
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

const isWhitespace = (ch: string): boolean => /\s/.test(ch)

// Collapse internal whitespace runs to a single space + trim — the matching key.
// JS `\s` covers NBSP (U+00A0) and the other Unicode spaces `String.trim()`
// strips, so this is consistent with how the extractor and backend trim.
export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

// Map an offset in `source` to the aligned offset in `target`, where
// normalizeWhitespace(source) === normalizeWhitespace(target). Both strings then
// share the identical sequence of non-whitespace characters (only whitespace-run
// lengths differ), so an offset is aligned by the index of the non-whitespace
// character it sits before — exact at word boundaries; offsets inside a
// whitespace run are refined later by snapRangeToWords.
export const alignOffset = (source: string, target: string, sourceOffset: number): number => {
  const offset = clamp(sourceOffset, 0, source.length)
  let nonWsBefore = 0
  for (let i = 0; i < offset; i++) if (!isWhitespace(source[i])) nonWsBefore += 1
  let seen = 0
  for (let j = 0; j < target.length; j++) {
    if (!isWhitespace(target[j])) {
      if (seen === nonWsBefore) return j
      seen += 1
    }
  }
  return target.length
}

// Match live blocks (a superset — Readability strips nav/aside/comment blocks) to
// segment strings with a monotonic cursor. Duplicate paragraph text resolves
// positionally; stripped/extra live blocks are skipped; non-exact blocks (e.g. a
// `<pre>` whose trimmed text contains `\n` and split into >1 segment) never map.
export const buildSegmentDomMap = (
  segments: readonly ArticleSegment[],
  blocks: readonly HTMLElement[]
): SegmentDomMap => {
  // Match on the whitespace-normalized text (see the module header). Precompute
  // each segment's normalized form, and an index normalized-text → ascending
  // array-positions (positions, not `index`, so the cursor compares apples to
  // apples even if indices aren't 0-contiguous).
  const normalizedSegments = segments.map((segment) => normalizeWhitespace(segment.text))
  const positionsByNormalized = new Map<string, number[]>()
  normalizedSegments.forEach((normalized, position) => {
    const existing = positionsByNormalized.get(normalized)
    if (existing) existing.push(position)
    else positionsByNormalized.set(normalized, [position])
  })

  const blockBySegmentIndex = new Map<number, HTMLElement>()
  const segmentByBlock = new Map<HTMLElement, ArticleSegment>()
  let next = 0 // monotonic cursor into the ordered `segments` array

  for (const block of blocks) {
    const normalized = normalizeWhitespace(block.textContent ?? '')
    if (normalized.length === 0) continue

    // Fast path: the next unconsumed segment matches in order.
    if (next < segments.length && normalizedSegments[next] === normalized) {
      const segment = segments[next]
      blockBySegmentIndex.set(segment.index, block)
      segmentByBlock.set(block, segment)
      next += 1
      continue
    }

    // Otherwise look up the first occurrence at or after the cursor (skips the
    // stripped blocks Readability removed between the last match and this one).
    const positions = positionsByNormalized.get(normalized)
    const position = positions?.find((candidate) => candidate >= next)
    if (position === undefined) continue // unmatched / already-consumed → skip

    const segment = segments[position]
    blockBySegmentIndex.set(segment.index, block)
    segmentByBlock.set(block, segment)
    next = position + 1
  }

  return { blockBySegmentIndex, segmentByBlock }
}

// Walk up from a selection-endpoint node to the nearest mapped block, or null if
// the point is outside any mapped block (stripped region, our own shadow host…).
export const findMappedBlock = (node: Node | null, map: SegmentDomMap): HTMLElement | null => {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement && map.segmentByBlock.has(current)) return current
    current = current.parentNode
  }
  return null
}

// DOM point `(container, offset)` → offset into `segment.text`. The Range from the
// block start to the point yields the absolute offset into `block.textContent`
// (handling nested inline text nodes and element-boundary containers uniformly),
// which `alignOffset` maps into the segment's coordinate space across any
// whitespace divergence.
export const domPointToSegmentOffset = (
  block: HTMLElement,
  segmentText: string,
  container: Node,
  offset: number
): number => {
  const doc = block.ownerDocument
  const range = doc.createRange()
  range.setStart(block, 0)
  range.setEnd(container, offset)
  const absolute = range.toString().length
  return alignOffset(block.textContent ?? '', segmentText, absolute)
}

// Inverse: offset into `segment.text` → `(textNode, offset)` so the caller can
// rebuild a Range (word-snap re-apply + saved-highlight repaint). Aligns the
// segment offset back into the live block's coordinate space, then walks the
// text-node stream to the matching node.
export const segmentOffsetToDomPoint = (
  block: HTMLElement,
  segmentText: string,
  segmentOffset: number
): { node: Text; offset: number } | null => {
  const absolute = alignOffset(segmentText, block.textContent ?? '', segmentOffset)
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let lastText: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    const length = node.data.length
    // Strict `<` so a point exactly on a node boundary anchors to the START of
    // the next text node rather than the end of this one (nicer for painting),
    // with the final node's end handled by the trailing clamp below.
    if (absolute < consumed + length) {
      return { node, offset: absolute - consumed }
    }
    consumed += length
    lastText = node
    node = walker.nextNode() as Text | null
  }
  // Past the end (e.g. trailing-trim region) → clamp to the end of the last node.
  if (lastText) return { node: lastText, offset: lastText.data.length }
  return null
}

// Build a live DOM `Range` spanning `[startOffset, endOffset)` of a segment,
// used to paint a saved highlight or re-apply a word-snapped selection. Null when
// either endpoint can't resolve to a text node (empty/detached block).
export const buildDomRange = (
  block: HTMLElement,
  segmentText: string,
  startOffset: number,
  endOffset: number
): Range | null => {
  const start = segmentOffsetToDomPoint(block, segmentText, startOffset)
  const end = segmentOffsetToDomPoint(block, segmentText, endOffset)
  if (!start || !end) return null
  const range = block.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

// Snap a raw selection `[start, end)` (block-relative offsets into `segment.text`)
// outward to whole word boundaries. A collapsed caret resolves to the single word
// under it; a drag covers every word it intersects. Returns null when the
// selection lands only on whitespace/punctuation (no-op, mirroring the overlay).
export const snapRangeToWords = (segmentText: string, start: number, end: number, locale: string): WordRange | null => {
  const ranges = getWordRanges(segmentText, locale)
  if (ranges.length === 0) return null

  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const collapsed = lo === hi

  const covering = ranges.filter(([wordStart, wordEnd]) =>
    collapsed ? wordStart <= lo && lo <= wordEnd : wordStart < hi && wordEnd > lo
  )
  if (covering.length === 0) return null

  const snapStart = Math.min(...covering.map(([wordStart]) => wordStart))
  const snapEnd = Math.max(...covering.map(([, wordEnd]) => wordEnd))
  return [snapStart, snapEnd]
}
