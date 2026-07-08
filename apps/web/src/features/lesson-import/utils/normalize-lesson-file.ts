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

// Sheet names that are packed dates become DD/MM/YYYY headings — the
// server-side section splitter and the extractor's lesson_date only recognize
// separator-carrying dates. The Italki archive names lesson sheets DDMMYYYY,
// with older variants DMMYYYY / DDMMYY and a same-day counter ("24052021(2)",
// dropped: the splitter splits on every date heading, so the second lesson
// still gets its own section). Non-date names pass through untouched.
export const sheetNameToHeading = (name: string): string => {
  const packed = /^(\d{6,8})(?:\s*\(\d+\))?$/.exec(name.trim())
  if (!packed) return name
  const digits = packed[1]!
  const [day, month, year] =
    digits.length === 8
      ? [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
      : digits.length === 7
        ? [`0${digits.slice(0, 1)}`, digits.slice(1, 3), digits.slice(3)]
        : [digits.slice(0, 2), digits.slice(2, 4), `20${digits.slice(4)}`]
  const dayNum = Number(day)
  const monthNum = Number(month)
  if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return name
  return `${day}/${month}/${year}`
}

// One non-empty sheet of an uploaded workbook. `title` is the lesson-heading
// text (packed-date names already rewritten); `name` is the raw sheet name so
// the picker can disambiguate when the rewrite collapsed a suffix.
export type LessonSheet = { name: string; title: string; markdown: string }

export const xlsxToSheets = (buffer: ArrayBuffer): LessonSheet[] => {
  const workbook = XLSX.read(buffer, { type: 'array', cellHTML: true, cellStyles: true })
  return workbook.SheetNames.flatMap((name) => {
    const table = sheetToMarkdown(workbook.Sheets[name]!)
    return table.length === 0 ? [] : [{ name, title: sheetNameToHeading(name), markdown: table }]
  })
}

// Sheet titles double as lesson identifiers (the second-teacher convention is
// one sheet per file; the Italki archive names sheets by date). A heading per
// sheet keeps multi-sheet selections splittable server-side.
export const sheetsToMarkdown = (sheets: LessonSheet[]): string =>
  sheets.map((sheet) => `### **${sheet.title}**\n\n${sheet.markdown}`).join('\n\n')

export type NormalizedLessonFile =
  // A multi-sheet workbook surfaces its sheets so the wizard can offer a picker.
  | { ok: true; kind: 'sheets'; sheets: LessonSheet[] }
  | { ok: true; kind: 'text'; markdown: string }
  | { ok: false; reason: 'unsupported' | 'empty' }

export const normalizeLessonFile = async (file: File): Promise<NormalizedLessonFile> => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const sheets = xlsxToSheets(await file.arrayBuffer())
    if (sheets.length === 0) return { ok: false, reason: 'empty' }
    if (sheets.length > 1) return { ok: true, kind: 'sheets', sheets }
    return { ok: true, kind: 'text', markdown: sheets[0]!.markdown }
  }
  const markdown =
    name.endsWith('.md') || name.endsWith('.txt') || file.type.startsWith('text/') ? await file.text() : null
  if (markdown === null) return { ok: false, reason: 'unsupported' }
  if (markdown.trim().length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, kind: 'text', markdown }
}

// Title suggestion: the file name without its extension.
export const suggestTitleFromFileName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '').trim()
