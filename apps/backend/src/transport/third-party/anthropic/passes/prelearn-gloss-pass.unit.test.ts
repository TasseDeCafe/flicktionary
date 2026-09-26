import { describe, expect, it } from 'vitest'
import { parsePrelearnGlossPassText } from './prelearn-gloss-pass'

describe('parsePrelearnGlossPassText', () => {
  it('maps numbered lines to items, tolerating separators, quotes, gaps and extras', () => {
    const text = ['1: lieutenant', '2) «greatcoat»', 'noise line', '4. to remind', '5: extra'].join('\n')
    expect(parsePrelearnGlossPassText(text, 4)).toEqual(['lieutenant', 'greatcoat', null, 'to remind'])
  })

  it('drops empty glosses and caps long ones', () => {
    const long = 'x'.repeat(200)
    expect(parsePrelearnGlossPassText(`1: ""\n2: ${long}`, 2)).toEqual([null, 'x'.repeat(80)])
  })
})
