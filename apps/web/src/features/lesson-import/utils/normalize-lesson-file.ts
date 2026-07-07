import * as XLSX from 'xlsx'

// Client-side normalization to markdown — the batch identity (input hash) and
// the extraction input are both computed from this output, so it must be
// deterministic for the same file.
//
//   - paste / .md / .txt: passthrough (Google-Docs markdown exports already
//     carry the `### **DD/MM/YYYY**` lesson headings the backend splits on).
//   - .xlsx: one markdown table per sheet, preserving intra-cell bold as
//     `**…**` (teachers mark corrections and stressed vowels with bold — the
//     extractor reads it). Broken formula cells (#ERROR!/#NAME?) are dropped.

const BROKEN_CELL = /^#(ERROR|NAME|REF|VALUE|N\/A)[!?]?/

// SheetJS exposes intra-cell rich text as HTML in cell.h (cellHTML). Convert
// bold runs to markdown and strip the rest via DOM parsing — regexing entities
// out of HTML is how you lose the é in "résumé".
const htmlCellToMarkdown = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const inner = Array.from(el.childNodes).map(walk).join('')
    const isBold =
      el.tagName === 'B' ||
      el.tagName === 'STRONG' ||
      /font-weight:\s*(bold|[6-9]00)/.test(el.getAttribute('style') ?? '')
    return isBold && inner.trim().length > 0 ? `**${inner}**` : inner
  }
  return Array.from(doc.body.childNodes).map(walk).join('')
}

const cellToMarkdown = (cell: XLSX.CellObject | undefined): string => {
  if (!cell) return ''
  const raw = cell.h ? htmlCellToMarkdown(cell.h) : String(cell.v ?? '')
  const trimmed = raw.trim()
  if (BROKEN_CELL.test(trimmed)) return ''
  // Pipes and newlines would break the markdown table geometry.
  return trimmed.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

const sheetToMarkdown = (ws: XLSX.WorkSheet): string => {
  if (!ws['!ref']) return ''
  const range = XLSX.utils.decode_range(ws['!ref'])
  const lines: string[] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      cells.push(cellToMarkdown(ws[XLSX.utils.encode_cell({ r, c })]))
    }
    if (cells.every((text) => text === '')) continue
    lines.push(`| ${cells.join(' | ')} |`)
    // Markdown tables need the header separator after the first row.
    if (lines.length === 1) lines.push(`| ${cells.map(() => '-----').join(' | ')} |`)
  }
  return lines.join('\n')
}

export const normalizeXlsxToMarkdown = (buffer: ArrayBuffer): string => {
  const workbook = XLSX.read(buffer, { type: 'array', cellHTML: true, cellStyles: true })
  const sections = workbook.SheetNames.map((name) => {
    const table = sheetToMarkdown(workbook.Sheets[name]!)
    if (table.length === 0) return ''
    // Sheet names double as lesson identifiers (the second-teacher convention
    // is one sheet per file; the Italki archive names sheets DDMMYYYY). A
    // heading per sheet keeps multi-sheet files splittable server-side.
    return workbook.SheetNames.length > 1 ? `### **${name}**\n\n${table}` : table
  }).filter((section) => section.length > 0)
  return sections.join('\n\n')
}

export type NormalizedLessonFile = { ok: true; markdown: string } | { ok: false; reason: 'unsupported' | 'empty' }

export const normalizeLessonFile = async (file: File): Promise<NormalizedLessonFile> => {
  const name = file.name.toLowerCase()
  const markdown = name.endsWith('.xlsx')
    ? normalizeXlsxToMarkdown(await file.arrayBuffer())
    : name.endsWith('.md') || name.endsWith('.txt') || file.type.startsWith('text/')
      ? await file.text()
      : null
  if (markdown === null) return { ok: false, reason: 'unsupported' }
  if (markdown.trim().length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, markdown }
}

// Title suggestion: the file name without its extension.
export const suggestTitleFromFileName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '').trim()
