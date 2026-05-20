import { describe, expect, it } from 'vitest'
import { parseFastGlossText } from './fast-gloss-pass'

describe('parseFastGlossText', () => {
  it('parses the normal gloss / POS / register shape', () => {
    expect(parseFastGlossText('having a sugary taste\nadj\ninformal')).toEqual({
      gloss: 'having a sugary taste',
      pos: 'adj',
      register: 'informal',
    })
  })

  it('treats a single blank-separated POS line as POS, not register', () => {
    expect(parseFastGlossText('having a sugary taste\n\nadj')).toEqual({
      gloss: 'having a sugary taste',
      pos: 'adj',
      register: null,
    })
  })

  it('keeps a single non-POS metadata line as register', () => {
    expect(parseFastGlossText('not used in ordinary speech\nformal')).toEqual({
      gloss: 'not used in ordinary speech',
      pos: null,
      register: 'formal',
    })
  })
})
