import { describe, expect, it } from 'vitest'
import type { ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveCardContent } from './resolve-card-content'

// A lemma row with full content + a GA IPA, used as the fallback source.
const baseLemma: ReviewTerm = {
  userLookupId: '00000000-0000-0000-0000-000000000001',
  headword: 'посмотреть',
  sense: '',
  translation: 'to take a look',
  definition: 'to look at something',
  targetExample: 'Давай посмотрим фильм.',
  nativeExample: "Let's watch a film.",
  grammar: { pos: 'verb', display_form: 'посмотре́ть', ipa: { untagged: 'pəsmɐˈtrʲetʲ' } },
  srsState: 'new',
  targetLanguage: 'ru',
  skill: 'meaning_recognition',
  targetForm: '',
  facetPayload: null,
}

describe('resolveCardContent', () => {
  it('citation resolves straight from the lemma row', () => {
    const c = resolveCardContent(baseLemma, 'ru', 'ga')
    expect(c.isForm).toBe(false)
    expect(c.displayForm).toBe('посмотре́ть')
    expect(c.translation).toBe('to take a look')
    expect(c.definition).toBe('to look at something')
    expect(c.targetExample).toBe('Давай посмотрим фильм.')
    expect(c.ipa).toBe('pəsmɐˈtrʲetʲ')
    expect(c.lemma).toBeNull()
  })

  it('form with full payload prefers every form field over the lemma', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      targetForm: 'посмотрим',
      facetPayload: {
        form: 'посмо́трим',
        translation: "let's have a look",
        definition: 'first person plural future',
        targetExample: 'Посмотрим, что будет.',
        nativeExample: "We'll see what happens.",
        grammar: { pos: 'verb' },
      },
    }
    const c = resolveCardContent(card, 'ru', 'ga')
    expect(c.isForm).toBe(true)
    expect(c.displayForm).toBe('посмо́трим')
    expect(c.translation).toBe("let's have a look")
    expect(c.definition).toBe('first person plural future')
    expect(c.targetExample).toBe('Посмотрим, что будет.')
    expect(c.nativeExample).toBe("We'll see what happens.")
    // The lemma is demoted to the secondary line.
    expect(c.lemma).toEqual({ displayForm: 'посмотре́ть', translation: 'to take a look' })
  })

  it('form with partial payload falls back to the lemma per field — but NOT for IPA', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      targetForm: 'посмотрим',
      // Only a form + translation; definition/examples/grammar absent.
      facetPayload: { form: 'посмо́трим', translation: "let's have a look" },
    }
    const c = resolveCardContent(card, 'ru', 'ga')
    expect(c.translation).toBe("let's have a look")
    // Fall back to the lemma for the silent fields.
    expect(c.definition).toBe('to look at something')
    expect(c.targetExample).toBe('Давай посмотрим фильм.')
    expect(c.grammar).toEqual(baseLemma.grammar)
    // IPA never falls back — the form carries none, so it's null.
    expect(c.ipa).toBeNull()
  })

  it('legacy {form, translation} payload renders without crashing', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      targetForm: 'посмотрим',
      facetPayload: { form: 'посмотрим', translation: "let's have a look" },
    }
    const c = resolveCardContent(card, 'ru', 'ga')
    expect(c.isForm).toBe(true)
    expect(c.displayForm).toBe('посмотрим')
    expect(c.translation).toBe("let's have a look")
    expect(c.ipa).toBeNull()
  })

  it('an empty form translation falls back to the lemma translation', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      targetForm: 'посмотрим',
      facetPayload: { form: 'посмотрим', translation: '   ' },
    }
    const c = resolveCardContent(card, 'ru', 'ga')
    expect(c.translation).toBe('to take a look')
  })
})
