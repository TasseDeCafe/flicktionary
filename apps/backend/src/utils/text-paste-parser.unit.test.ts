import { describe, expect, it } from 'vitest'
import { parsePastedText } from './text-paste-parser'

describe('parsePastedText', () => {
  it('splits on newlines and re-indexes', () => {
    expect(parsePastedText('First line\nSecond line\nThird line')).toEqual([
      { index: 0, text: 'First line' },
      { index: 1, text: 'Second line' },
      { index: 2, text: 'Third line' },
    ])
  })

  it('drops empty and whitespace-only lines, trims surrounding whitespace', () => {
    const raw = '\n  Hello  \n\n\t\nWorld\n   \n'
    expect(parsePastedText(raw)).toEqual([
      { index: 0, text: 'Hello' },
      { index: 1, text: 'World' },
    ])
  })

  it('handles BOM and CRLF', () => {
    const raw = '﻿Hi\r\n\r\nThere'
    expect(parsePastedText(raw)).toEqual([
      { index: 0, text: 'Hi' },
      { index: 1, text: 'There' },
    ])
  })

  it('returns an empty array for blank input', () => {
    expect(parsePastedText('')).toEqual([])
    expect(parsePastedText('   \n\n\t\n')).toEqual([])
  })

  it('treats a paste with no newlines as a single segment', () => {
    expect(parsePastedText('one long blob with no breaks')).toEqual([
      { index: 0, text: 'one long blob with no breaks' },
    ])
  })
})
