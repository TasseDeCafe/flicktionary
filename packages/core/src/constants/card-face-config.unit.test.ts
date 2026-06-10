import { describe, expect, it } from 'vitest'
import {
  ACTIVE_CARD_FACE_CONFIG,
  DEFAULT_CARD_FACE_CONFIG,
  getCardFaceConfig,
  resolveCardSlots,
  type CardSlotConditions,
} from './card-face-config'

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

describe('active card face', () => {
  it('getCardFaceConfig returns the active config for any language', () => {
    expect(getCardFaceConfig('ru', 'production')).toBe(ACTIVE_CARD_FACE_CONFIG)
    expect(getCardFaceConfig('de', 'production')).toBe(ACTIVE_CARD_FACE_CONFIG)
    expect(getCardFaceConfig(null, 'production')).toBe(ACTIVE_CARD_FACE_CONFIG)
  })

  it('front prompts with the translation when translations are on', () => {
    const slots = resolveCardSlots(
      ACTIVE_CARD_FACE_CONFIG.front,
      cond({ hasTranslation: true, hasDefinition: true, hasNativeExample: true })
    )
    expect(slots).toEqual(['translation', 'nativeExample'])
  })

  it('front falls back to the definition when translations are off', () => {
    const slots = resolveCardSlots(
      ACTIVE_CARD_FACE_CONFIG.front,
      cond({ hideTranslationFields: true, hasDefinition: true })
    )
    expect(slots).toEqual(['definition'])
  })

  it('front resolves empty when the card has no gloss data (caller falls back to passive layout)', () => {
    expect(resolveCardSlots(ACTIVE_CARD_FACE_CONFIG.front, cond({}))).toEqual([])
  })

  it('back reveals the term, pronunciation and target example', () => {
    const slots = resolveCardSlots(
      ACTIVE_CARD_FACE_CONFIG.back,
      cond({ hasIpa: true, hasTargetExample: true, hasGrammarChips: true })
    )
    expect(slots).toEqual(['headword', 'ipa', 'targetExample', 'grammar'])
  })
})
