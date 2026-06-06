import { describe, expect, it } from 'vitest'
import { DEFAULT_CARD_FACE_CONFIG, resolveCardSlots, type CardSlotConditions } from './card-face-config'

const cond = (overrides: Partial<CardSlotConditions>): CardSlotConditions => ({
  hideTranslationFields: false,
  hasIpa: false,
  hasTargetExample: false,
  hasNativeExample: false,
  hasTranslation: false,
  hasDefinition: false,
  hasGrammarChips: false,
  ...overrides,
})

describe('resolveCardSlots', () => {
  const back = DEFAULT_CARD_FACE_CONFIG.back

  it('translations on + translation present: translation is the gloss, definition stays hidden', () => {
    const slots = resolveCardSlots(back, cond({ hasTranslation: true, hasDefinition: true }))
    expect(slots).toEqual(['translation'])
  })

  it('translations on + no translation: definition is the fallback gloss', () => {
    const slots = resolveCardSlots(back, cond({ hasDefinition: true }))
    expect(slots).toEqual(['definition'])
  })

  it('translations off: definition is the primary gloss', () => {
    const slots = resolveCardSlots(back, cond({ hideTranslationFields: true, hasDefinition: true }))
    expect(slots).toEqual(['definition'])
  })

  it('translations off + manual translation: definition stays primary, translation renders below it', () => {
    const slots = resolveCardSlots(
      back,
      cond({ hideTranslationFields: true, hasTranslation: true, hasDefinition: true })
    )
    expect(slots).toEqual(['definition', 'translation'])
  })

  it('translations off + manual translation without definition: translation alone', () => {
    const slots = resolveCardSlots(back, cond({ hideTranslationFields: true, hasTranslation: true }))
    expect(slots).toEqual(['translation'])
  })

  it('nativeExample is presence-based regardless of the translations pref', () => {
    const hidden = resolveCardSlots(back, cond({ hideTranslationFields: true, hasNativeExample: true }))
    const shown = resolveCardSlots(back, cond({ hasNativeExample: true }))
    expect(hidden).toContain('nativeExample')
    expect(shown).toContain('nativeExample')
  })

  it('drops slots whose data is missing', () => {
    const front = resolveCardSlots(['headword', 'ipa', 'targetExample'], cond({}))
    expect(front).toEqual(['headword'])
    expect(resolveCardSlots(back, cond({}))).toEqual([])
  })
})
