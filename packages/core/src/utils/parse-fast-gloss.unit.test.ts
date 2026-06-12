import { describe, expect, it } from 'vitest'
import { parseFastGloss } from './parse-fast-gloss'

describe('parseFastGloss', () => {
  it('reads the POS-first layout (gloss\\nPOS\\nregister)', () => {
    expect(parseFastGloss('to run\nverb\ninformal')).toEqual({
      gloss: 'to run',
      pos: 'verb',
      register: 'informal',
    })
  })

  it('reads the register-first layout (gloss\\nregister\\nPOS)', () => {
    expect(parseFastGloss('to run\ninformal\nverb')).toEqual({
      gloss: 'to run',
      pos: 'verb',
      register: 'informal',
    })
  })

  it('treats a single non-POS metadata line as the register', () => {
    expect(parseFastGloss('to run\nslang')).toEqual({
      gloss: 'to run',
      pos: null,
      register: 'slang',
    })
  })

  it('returns null metadata when only the gloss line is present', () => {
    expect(parseFastGloss('to run')).toEqual({ gloss: 'to run', pos: null, register: null })
  })

  it('splits on CRLF line endings and skips blank metadata lines', () => {
    expect(parseFastGloss('to run\r\n\r\nverb\r\n')).toEqual({
      gloss: 'to run',
      pos: 'verb',
      register: null,
    })
  })

  it('matches POS aliases case-insensitively and through trailing punctuation', () => {
    expect(parseFastGloss('to run\n[Verb]\nformal')).toEqual({
      gloss: 'to run',
      pos: '[Verb]',
      register: 'formal',
    })
  })
})
