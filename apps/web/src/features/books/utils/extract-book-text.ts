// Turns a rendered book section (the XHTML document foliate-js produces for
// EPUB, MOBI and FB2 alike) into plain paragraphs.
//
// Paragraph boundaries come from block elements: consecutive text nodes that
// share the same nearest block ancestor form one paragraph, and inline markup
// is concatenated WITHOUT separators — drop caps and small caps split words
// across tags (`D<span>OCTOR</span>`), so a space per tag would corrupt text.

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
])

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'math', 'head', 'title', 'template'])

const EPUB_NS = 'http://www.idpf.org/2007/ops'

const isNoteReference = (element: Element): boolean => {
  if (element.localName !== 'a') return false
  const epubType = element.getAttributeNS(EPUB_NS, 'type') ?? element.getAttribute('epub:type') ?? ''
  if (epubType.split(/\s+/).includes('noteref')) return true
  return element.getAttribute('role') === 'doc-noteref'
}

const isSkipped = (element: Element): boolean => SKIPPED_TAGS.has(element.localName) || isNoteReference(element)

const nearestBlock = (node: Node, root: Element): Element => {
  let current = node.parentElement
  while (current && current !== root) {
    if (BLOCK_TAGS.has(current.localName)) return current
    current = current.parentElement
  }
  return root
}

const normalizeParagraph = (text: string): string => text.replace(/[­​﻿]/g, '').replace(/\s+/g, ' ').trim()

// A chapter start inside a section: text at or after `element` belongs to the
// chapter; null = the section's own start.
export type SectionCut = { element: Element | null }

export type SectionChunk = {
  // Index into the cuts array; -1 = text before the first cut.
  cutIndex: number
  paragraphs: string[]
}

// `true` when `node` sits at or after `cut` in document order.
const isAtOrAfter = (node: Node, cut: Element): boolean => {
  if (cut === node || cut.contains(node)) return true
  return Boolean(cut.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
}

// Walks the section once, emitting paragraphs grouped by the chapter cut they
// fall after. Cuts must be in document order.
export const extractSectionChunks = (root: Element, cuts: readonly SectionCut[]): SectionChunk[] => {
  const doc = root.ownerDocument
  const chunks: SectionChunk[] = []
  let cutIndex = -1
  // Cuts at the section start are passed immediately.
  while (cutIndex + 1 < cuts.length && cuts[cutIndex + 1]!.element === null) cutIndex++
  let current: SectionChunk = { cutIndex, paragraphs: [] }
  chunks.push(current)

  let paragraph = ''
  let paragraphBlock: Element | null = null
  const flush = () => {
    const text = normalizeParagraph(paragraph)
    if (text) current.paragraphs.push(text)
    paragraph = ''
    paragraphBlock = null
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT
      const element = node as Element
      if (isSkipped(element)) return NodeFilter.FILTER_REJECT
      // <br> separates lines within one block (verse, addresses).
      return element.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let nextCutIndex = cutIndex
    while (nextCutIndex + 1 < cuts.length) {
      const cut = cuts[nextCutIndex + 1]!.element
      if (cut && !isAtOrAfter(node, cut)) break
      nextCutIndex++
    }
    if (nextCutIndex !== cutIndex) {
      flush()
      cutIndex = nextCutIndex
      current = { cutIndex, paragraphs: [] }
      chunks.push(current)
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      flush()
      continue
    }
    const block = nearestBlock(node, root)
    if (block !== paragraphBlock) {
      flush()
      paragraphBlock = block
    }
    paragraph += node.textContent ?? ''
  }
  flush()
  return chunks.filter((chunk) => chunk.paragraphs.length > 0 || chunk.cutIndex >= 0)
}
