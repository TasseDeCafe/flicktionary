import { describe, expect, it } from 'vitest'
import type { ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { DEFAULT_IPA_DIALECTS } from '@flicktionary/core/utils/pick-ipa'
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
  ipaSource: null,
}

describe('resolveCardContent', () => {
  it('citation resolves straight from the lemma row', () => {
    const c = resolveCardContent(baseLemma, 'ru', DEFAULT_IPA_DIALECTS)
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
    const c = resolveCardContent(card, 'ru', DEFAULT_IPA_DIALECTS)
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
    const c = resolveCardContent(card, 'ru', DEFAULT_IPA_DIALECTS)
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
    const c = resolveCardContent(card, 'ru', DEFAULT_IPA_DIALECTS)
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
    const c = resolveCardContent(card, 'ru', DEFAULT_IPA_DIALECTS)
    expect(c.translation).toBe('to take a look')
  })

  it('non-German citation has no German forms sub-line', () => {
    const c = resolveCardContent(baseLemma, 'ru', DEFAULT_IPA_DIALECTS)
    expect(c.citationForms).toBeNull()
  })

  it('German citation noun gets the articled title + a forms sub-line', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      headword: 'Bestandteil',
      targetLanguage: 'de',
      grammar: { pos: 'noun', gender: 'm', plural: 'Bestandteile', genitive: 'Bestandteils' },
    }
    const c = resolveCardContent(card, 'de', DEFAULT_IPA_DIALECTS)
    expect(c.displayForm).toBe('der Bestandteil')
    expect(c.citationForms).toBe('pl -e')
  })

  it('German irregular-plural noun uses the plural article in its forms line', () => {
    const card: ReviewTerm = {
      ...baseLemma,
      headword: 'Haus',
      targetLanguage: 'de',
      grammar: { pos: 'noun', gender: 'n', plural: 'Häuser', genitive: 'Hauses' },
    }
    const c = resolveCardContent(card, 'de', DEFAULT_IPA_DIALECTS)
    expect(c.displayForm).toBe('das Haus')
    expect(c.citationForms).toBe('die Häuser')
  })
})
