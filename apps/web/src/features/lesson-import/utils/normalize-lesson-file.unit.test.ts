// @vitest-environment jsdom
// (the xlsx cell normalizer parses SheetJS's rich-text HTML with DOMParser)
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { sheetNameToHeading, sheetsToMarkdown, xlsxToSheets } from './normalize-lesson-file'

// The backend splitter only splits on separator-carrying date headings
// (DD/MM/YYYY or DD.MM.YYYY), so packed-date sheet names must be rewritten or a
// multi-sheet archive collapses into one giant extraction section.
describe('sheetNameToHeading', () => {
  it('rewrites DDMMYYYY sheet names to DD/MM/YYYY', () => {
    expect(sheetNameToHeading('07102022')).toBe('07/10/2022')
    expect(sheetNameToHeading('05102022')).toBe('05/10/2022')
  })

  it('rewrites DDMMYY sheet names with a 20YY century', () => {
    expect(sheetNameToHeading('300922')).toBe('30/09/2022')
    expect(sheetNameToHeading('260922')).toBe('26/09/2022')
  })

  it('rewrites DMMYYYY sheet names with a zero-padded day', () => {
    expect(sheetNameToHeading('9122021')).toBe('09/12/2021')
    expect(sheetNameToHeading('5112021')).toBe('05/11/2021')
  })

  it('drops the same-day counter suffix', () => {
    expect(sheetNameToHeading('24052021(2)')).toBe('24/05/2021')
    expect(sheetNameToHeading('21052021 (2)')).toBe('21/05/2021')
  })

  it('leaves non-date names untouched', () => {
    expect(sheetNameToHeading('Template')).toBe('Template')
    expect(sheetNameToHeading('Topics')).toBe('Topics')
    expect(sheetNameToHeading('Sheet1')).toBe('Sheet1')
    expect(sheetNameToHeading('Flashcards 27082021')).toBe('Flashcards 27082021')
  })

  it('leaves digit blobs that are not plausible dates untouched', () => {
    expect(sheetNameToHeading('99999999')).toBe('99999999')
    // US-style MMDDYYYY reads as month 24 — refused rather than misdated.
    expect(sheetNameToHeading('11242021')).toBe('11242021')
    expect(sheetNameToHeading('123456789')).toBe('123456789')
  })
})

const workbookBuffer = (sheets: Record<string, string[][]>): ArrayBuffer => {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('xlsxToSheets', () => {
  it('drops empty sheets and rewrites packed-date names into titles', () => {
    const sheets = xlsxToSheets(
      workbookBuffer({
        '07102022': [['слово', 'перевод']],
        Empty: [[]],
        Topics: [['тема']],
      })
    )
    expect(sheets.map((s) => s.title)).toEqual(['07/10/2022', 'Topics'])
    expect(sheets[0]!.name).toBe('07102022')
    expect(sheets[0]!.markdown).toContain('| слово | перевод |')
  })
})

describe('sheetsToMarkdown', () => {
  it('emits a date heading per sheet so the server splitter sections them', () => {
    const sheets = xlsxToSheets(
      workbookBuffer({
        '07102022': [['раз']],
        '05102022': [['два']],
      })
    )
    const markdown = sheetsToMarkdown(sheets)
    expect(markdown).toContain('### **07/10/2022**')
    expect(markdown).toContain('### **05/10/2022**')
    expect(markdown.indexOf('### **07/10/2022**')).toBeLessThan(markdown.indexOf('раз'))
  })
})
