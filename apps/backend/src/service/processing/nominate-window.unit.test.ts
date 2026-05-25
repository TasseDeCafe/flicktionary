import { describe, expect, it } from 'vitest'
import { reconcileOffsets } from './nominate-window'

describe('reconcileOffsets', () => {
  const text = 'el desfibrilador no estaba'

  it('keeps the model offsets when they already match the surface form', () => {
    // "desfibrilador" sits at [3, 16).
    expect(reconcileOffsets(text, { segmentId: 's', surfaceForm: 'desfibrilador', charStart: 3, charEnd: 16 })).toEqual(
      {
        charStart: 3,
        charEnd: 16,
      }
    )
  })

  it('relocates to the literal occurrence when the model miscounts', () => {
    expect(
      reconcileOffsets(text, { segmentId: 's', surfaceForm: 'desfibrilador', charStart: 99, charEnd: 112 })
    ).toEqual({ charStart: 3, charEnd: 16 })
  })

  it('drops a candidate whose surface form is not in the segment text', () => {
    expect(reconcileOffsets(text, { segmentId: 's', surfaceForm: 'inexistente', charStart: 0, charEnd: 11 })).toBeNull()
  })

  it('disambiguates a unit occurring twice via the model offsets (second occurrence)', () => {
    // "casa" appears at [0,4) and [9,13). Correct offsets for the *second* one are kept.
    const twice = 'casa de la casa'
    expect(reconcileOffsets(twice, { segmentId: 's', surfaceForm: 'casa', charStart: 11, charEnd: 15 })).toEqual({
      charStart: 11,
      charEnd: 15,
    })
  })

  it('drops a recurring unit when offsets are wrong', () => {
    const twice = 'casa de la casa'
    expect(reconcileOffsets(twice, { segmentId: 's', surfaceForm: 'casa', charStart: 50, charEnd: 54 })).toBeNull()
  })
})
