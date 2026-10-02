import { describe, expect, test } from 'vitest'
import type { GlossWordFamily } from '@flicktionary/core/types/gloss-view-state'
import { frontClueFor } from './card-word-family'

const family = (overrides: Partial<GlossWordFamily>): GlossWordFamily => ({
  formOf: null,
  parts: null,
  anchors: [],
  cognates: [],
  insightPending: false,
  ...overrides,
})

describe('frontClueFor', () => {
  test('no family or nothing informative gives no clue', () => {
    expect(frontClueFor(null)).toBeNull()
    expect(frontClueFor(undefined)).toBeNull()
    expect(frontClueFor(family({}))).toBeNull()
    expect(
      frontClueFor(
        family({
          parts: [
            { text: 'за-', isAffix: true, meaning: null },
            { text: 'мёрзнуть', isAffix: false, meaning: null },
          ],
        })
      )
    ).toBeNull()
  })

  test('cognates alone are not a front clue', () => {
    expect(frontClueFor(family({ cognates: ['dozen'] }))).toBeNull()
  })

  test('an anchor, a form-of note or an explained part qualifies, without cognates', () => {
    const anchored = frontClueFor(family({ anchors: [{ lemma: 'мороз', source: 'known' }], cognates: ['frost'] }))
    expect(anchored?.anchors).toEqual([{ lemma: 'мороз', source: 'known' }])
    expect(anchored?.cognates).toEqual([])

    expect(frontClueFor(family({ formOf: { kind: 'participle', lemma: 'замёрзнуть' } }))).not.toBeNull()

    const explained = frontClueFor(
      family({
        parts: [
          { text: 'за-', isAffix: true, meaning: 'into a state' },
          { text: 'мёрзнуть', isAffix: false, meaning: null },
        ],
      })
    )
    expect(explained?.parts?.[0].meaning).toBe('into a state')
  })
})
