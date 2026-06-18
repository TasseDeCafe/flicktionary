import { describe, expect, it } from 'vitest'
import {
  buildSegmentDomMap,
  domPointToSegmentOffset,
  findMappedBlock,
  segmentOffsetToDomPoint,
  snapRangeToWords,
  type ArticleSegment,
} from './segment-dom-map.ts'

// Build a detached container holding `<p>`-ish blocks from raw innerHTML so each
// test controls the live DOM shape (nested inline nodes, whitespace, extras).
const blocksFromHtml = (html: string): HTMLElement[] => {
  const host = document.createElement('div')
  host.innerHTML = html
  return Array.from(host.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre'))
}

const seg = (index: number, text: string): ArticleSegment => ({ index, text })

describe('buildSegmentDomMap', () => {
  it('maps clean blocks to segments by exact trimmed equality', () => {
    const blocks = blocksFromHtml('<p>  Hello world  </p><p>Second line</p>')
    const segments = [seg(0, 'Hello world'), seg(1, 'Second line')]
    const map = buildSegmentDomMap(segments, blocks)

    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])
    expect(map.blockBySegmentIndex.get(1)).toBe(blocks[1])
    expect(map.segmentByBlock.get(blocks[0])?.index).toBe(0)
  })

  it('handles leading/trailing whitespace including NBSP', () => {
    const blocks = blocksFromHtml('<p>  Café </p>')
    const map = buildSegmentDomMap([seg(0, 'Café')], blocks)
    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])
  })

  it('skips stripped/extra live blocks via the monotonic cursor', () => {
    // The middle <p> is a nav/aside block Readability stripped (no segment).
    const blocks = blocksFromHtml('<p>Intro</p><p>Advertisement</p><p>Body</p>')
    const segments = [seg(0, 'Intro'), seg(1, 'Body')]
    const map = buildSegmentDomMap(segments, blocks)

    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])
    expect(map.blockBySegmentIndex.get(1)).toBe(blocks[2])
    expect(map.segmentByBlock.has(blocks[1])).toBe(false)
  })

  it('resolves duplicate paragraph text positionally', () => {
    const blocks = blocksFromHtml('<p>Repeat</p><p>Repeat</p>')
    const segments = [seg(0, 'Repeat'), seg(1, 'Repeat')]
    const map = buildSegmentDomMap(segments, blocks)

    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])
    expect(map.blockBySegmentIndex.get(1)).toBe(blocks[1])
  })

  it('leaves a block that differs by more than whitespace unmapped (<pre>/newline split into 2 segments)', () => {
    // A <pre> whose text splits into >1 backend segment normalizes to
    // 'line one line two', matching neither single segment — so it must not map.
    const blocks = blocksFromHtml('<pre>line one\nline two</pre>')
    const segments = [seg(0, 'line one'), seg(1, 'line two')]
    const map = buildSegmentDomMap(segments, blocks)

    expect(map.segmentByBlock.has(blocks[0])).toBe(false)
    expect(map.blockBySegmentIndex.size).toBe(0)
  })

  it('maps a block whose internal whitespace differs from the segment (source-formatted <h1>)', () => {
    // The live block carries source-formatting newlines/indentation the
    // single-spaced segment string does not — a whitespace-only divergence.
    const blocks = blocksFromHtml('<h1>Hello\n   world</h1>')
    const segmentText = 'Hello world'
    const map = buildSegmentDomMap([seg(0, segmentText)], blocks)
    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])

    // Segment offset 6 ('world') resolves to 'w' in the live text, and converts
    // back exactly — offsets align by non-whitespace index, never corrupting.
    const point = segmentOffsetToDomPoint(blocks[0], segmentText, 6)!
    expect(point.node.data[point.offset]).toBe('w')
    expect(domPointToSegmentOffset(blocks[0], segmentText, point.node, point.offset)).toBe(6)
  })

  it('aligns offsets when the segment has the extra whitespace (live is tighter)', () => {
    // Inverse divergence: the segment carries a double space the live text lacks.
    const blocks = blocksFromHtml('<p>Foo bar</p>')
    const segmentText = 'Foo  bar'
    const map = buildSegmentDomMap([seg(0, segmentText)], blocks)
    expect(map.blockBySegmentIndex.get(0)).toBe(blocks[0])

    // 'bar' is at offset 5 in the segment (after the double space).
    const point = segmentOffsetToDomPoint(blocks[0], segmentText, 5)!
    expect(point.node.data[point.offset]).toBe('b')
    expect(domPointToSegmentOffset(blocks[0], segmentText, point.node, point.offset)).toBe(5)
  })
})

describe('offset conversion', () => {
  it('round-trips an offset through a clean block', () => {
    const blocks = blocksFromHtml('<p>  Hello world  </p>')
    const segmentText = 'Hello world'
    const map = buildSegmentDomMap([seg(0, segmentText)], blocks)
    const block = map.blockBySegmentIndex.get(0)!

    // 'world' starts at offset 6 in the segment text.
    const point = segmentOffsetToDomPoint(block, segmentText, 6)!
    expect(point.node.data.slice(point.offset, point.offset + 5)).toBe('world')

    const back = domPointToSegmentOffset(block, segmentText, point.node, point.offset)
    expect(back).toBe(6)
  })

  it('spans nested inline text nodes correctly', () => {
    const blocks = blocksFromHtml('<p>Foo <b>bar</b> baz</p>')
    const segmentText = 'Foo bar baz'
    const map = buildSegmentDomMap([seg(0, segmentText)], blocks)
    const block = map.blockBySegmentIndex.get(0)!

    // 'bar' is at offset 4, living inside the <b> child.
    const point = segmentOffsetToDomPoint(block, segmentText, 4)!
    expect(point.node.data[point.offset]).toBe('b')
    expect(point.node.parentElement?.tagName).toBe('B')

    const back = domPointToSegmentOffset(block, segmentText, point.node, point.offset)
    expect(back).toBe(4)

    // End of 'baz' = offset 11.
    const end = segmentOffsetToDomPoint(block, segmentText, 11)!
    expect(domPointToSegmentOffset(block, segmentText, end.node, end.offset)).toBe(11)
  })

  it('clamps an offset that lands in the trailing-trim region', () => {
    const blocks = blocksFromHtml('<p>Hi  </p>')
    const segmentText = 'Hi'
    const block = blocks[0]
    const point = segmentOffsetToDomPoint(block, segmentText, 2)!
    // Round-trips to the segment length, never past it.
    expect(domPointToSegmentOffset(block, segmentText, point.node, point.offset)).toBe(2)
  })
})

describe('findMappedBlock', () => {
  it('walks up from an inner text node to its mapped block', () => {
    const blocks = blocksFromHtml('<p>Foo <b>bar</b></p>')
    const map = buildSegmentDomMap([seg(0, 'Foo bar')], blocks)
    const innerText = blocks[0].querySelector('b')!.firstChild!
    expect(findMappedBlock(innerText, map)).toBe(blocks[0])
  })

  it('returns null for a node outside any mapped block', () => {
    const blocks = blocksFromHtml('<p>Mapped</p>')
    const map = buildSegmentDomMap([seg(0, 'Mapped')], blocks)
    const stray = document.createElement('span')
    stray.textContent = 'elsewhere'
    expect(findMappedBlock(stray.firstChild, map)).toBeNull()
  })
})

describe('snapRangeToWords', () => {
  const text = 'The quick brown fox'

  it('snaps a collapsed caret to the single covering word', () => {
    // caret at offset 6, inside 'quick' [4,9)
    expect(snapRangeToWords(text, 6, 6, 'en')).toEqual([4, 9])
  })

  it('snaps a drag outward to cover both partial words', () => {
    // from inside 'quick' to inside 'brown' → [4,15)
    expect(snapRangeToWords(text, 6, 12, 'en')).toEqual([4, 15])
  })

  it('returns null for a caret strictly inside a whitespace gap', () => {
    // 'The  fox' has a 2-space gap (offsets 3,4,5); offset 4 sits between the
    // spaces, touching neither word boundary.
    expect(snapRangeToWords('The  fox', 4, 4, 'en')).toBeNull()
  })
})
