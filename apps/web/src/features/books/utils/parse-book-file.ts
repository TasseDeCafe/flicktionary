import type { FoliateBook, FoliateTocItem } from 'foliate-js/view.js'
import { extractSectionChunks, type SectionCut } from './extract-book-text'
import type { RawChapter } from './build-book-parts'

export const BOOK_FILE_ACCEPT = '.epub,.fb2,.fbz,.fb2.zip,.mobi,.azw,.azw3,.prc'

export type ParsedBookFile = {
  title: string | null
  author: string | null
  language: string | null
  chapters: RawChapter[]
}

export type ParseBookFileResult =
  { ok: true; book: ParsedBookFile } | { ok: false; reason: 'unsupported' | 'drm' | 'empty' | 'unreadable' }

// foliate metadata values are strings, arrays, or {name}/language-map objects
// depending on the format.
const readMetadataText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return value.map(readMetadataText).filter(Boolean).join(', ') || null
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('name' in record) return readMetadataText(record.name)
    return readMetadataText(Object.values(record)[0])
  }
  return null
}

const readLanguage = (value: unknown): string | null => {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !raw.trim()) return null
  return raw.trim().toLowerCase().split(/[-_]/)[0] ?? null
}

// MOBI/AZW headers carry the DRM flag in the PalmDOC record-0 header
// (encryption type at byte 12); foliate would decode such a file to garbage.
const isDrmProtectedMobi = async (file: File): Promise<boolean> => {
  const header = new DataView(await file.slice(0, 78 + 8).arrayBuffer())
  if (header.byteLength < 86) return false
  const signature = new TextDecoder('ascii').decode(new Uint8Array(header.buffer, 60, 8))
  if (signature !== 'BOOKMOBI' && signature !== 'TEXtREAd') return false
  const record0Offset = header.getUint32(78)
  const record0 = new DataView(await file.slice(record0Offset, record0Offset + 16).arrayBuffer())
  return record0.byteLength >= 14 && record0.getUint16(12) !== 0
}

// Encrypted EPUB content decodes to binary noise rather than failing: a book
// whose extracted text is mostly non-letters is treated as DRM-protected.
const looksLikeGarbage = (chapters: readonly RawChapter[]): boolean => {
  const sample = chapters
    .flatMap((chapter) => chapter.paragraphs)
    .join(' ')
    .slice(0, 20_000)
  if (sample.length < 200) return false
  const readable = sample.match(/[\p{L}\p{N}\p{P}\s]/gu)?.length ?? 0
  return readable / sample.length < 0.8
}

type TocEntry = { title: string; href: string }

const flattenToc = (items: readonly FoliateTocItem[] | null | undefined): TocEntry[] =>
  (items ?? []).flatMap((item) => [
    ...(item.href ? [{ title: (item.label ?? '').replace(/\s+/g, ' ').trim(), href: item.href }] : []),
    ...flattenToc(item.subitems),
  ])

type ResolvedTocEntry = { title: string; sectionIndex: number; anchor: (doc: Document) => unknown }

const resolveToc = async (book: FoliateBook): Promise<ResolvedTocEntry[]> => {
  const resolved: ResolvedTocEntry[] = []
  for (const entry of flattenToc(book.toc)) {
    try {
      const target = await book.resolveHref?.(entry.href)
      if (!target || target.index < 0) continue
      resolved.push({ title: entry.title, sectionIndex: target.index, anchor: target.anchor })
    } catch {
      // An unresolvable TOC link only costs a chapter boundary.
    }
  }
  return resolved
}

const toCutElement = (anchor: unknown, doc: Document): Element | null => {
  if (anchor instanceof Element) return anchor === doc.body || anchor === doc.documentElement ? null : anchor
  if (typeof Range !== 'undefined' && anchor instanceof Range) {
    const node = anchor.startContainer
    return node instanceof Element ? node : node.parentElement
  }
  return null
}

// Chapters come from TOC entries resolved to anchors, not from the file's
// sections: one EPUB XHTML file (or MOBI section) can hold several chapters,
// and one chapter can span several files. When the TOC is usable, a section
// without a TOC entry continues the previous chapter; text before the first
// TOC entry is kept as its own untitled chapters (front matter).
export const parseBookFile = async (file: File): Promise<ParseBookFileResult> => {
  if (/\.(mobi|azw3?|prc)$/i.test(file.name) && (await isDrmProtectedMobi(file))) return { ok: false, reason: 'drm' }

  const { makeBook, UnsupportedTypeError } = await import('foliate-js/view.js')
  let book: FoliateBook
  try {
    book = await makeBook(file)
  } catch (error) {
    return { ok: false, reason: error instanceof UnsupportedTypeError ? 'unsupported' : 'unreadable' }
  }

  try {
    const toc = await resolveToc(book)
    const tocUsable = toc.length >= 2
    const chapters: RawChapter[] = []
    let seenTocEntry = false

    for (const [sectionIndex, section] of book.sections.entries()) {
      if (section.linear === 'no') continue
      const doc = await section.createDocument()
      const root = doc.body ?? doc.documentElement
      const entries = tocUsable ? toc.filter((entry) => entry.sectionIndex === sectionIndex) : []
      const cuts = entries
        .map((entry) => ({ title: entry.title, element: toCutElement(entry.anchor(doc), doc) }))
        .filter((cut) => cut.element === null || root.contains(cut.element))
        .sort((a, b) => {
          if (a.element === null) return -1
          if (b.element === null) return 1
          return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        })
      const sectionCuts: SectionCut[] = cuts.map((cut) => ({ element: cut.element }))

      for (const chunk of extractSectionChunks(root, sectionCuts)) {
        if (chunk.cutIndex >= 0) {
          seenTocEntry = true
          chapters.push({ title: cuts[chunk.cutIndex]!.title || null, paragraphs: chunk.paragraphs })
          continue
        }
        if (chunk.paragraphs.length === 0) continue
        const previous = chapters[chapters.length - 1]
        // Untitled text continues the running chapter once the TOC has
        // started; before that (or without a usable TOC) it stands alone.
        if (tocUsable && seenTocEntry && previous) previous.paragraphs.push(...chunk.paragraphs)
        else chapters.push({ title: null, paragraphs: chunk.paragraphs })
      }
    }

    const nonEmpty = chapters.filter((chapter) => chapter.paragraphs.length > 0)
    if (nonEmpty.length === 0) return { ok: false, reason: 'empty' }
    if (looksLikeGarbage(nonEmpty)) return { ok: false, reason: 'drm' }
    return {
      ok: true,
      book: {
        title: readMetadataText(book.metadata?.title),
        author: readMetadataText(book.metadata?.author),
        language: readLanguage(book.metadata?.language),
        chapters: nonEmpty,
      },
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    book.destroy?.()
  }
}
