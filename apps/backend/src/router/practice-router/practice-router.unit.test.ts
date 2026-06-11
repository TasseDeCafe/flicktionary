import { describe, expect, it } from 'vitest'
import { computeIpaSource } from './practice-router'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'

// Only the fields computeIpaSource reads.
const row = (overrides: Partial<DbUserLookupWithFacet>): DbUserLookupWithFacet =>
  ({
    target_form: '',
    grounded_at: '2026-06-01T00:00:00Z',
    grounding_patch: { ipa: { untagged: '[stɐˈla]' } },
    grammar: { pos: 'noun', ipa: { untagged: '[stɐˈla]' } },
    ...overrides,
  }) as DbUserLookupWithFacet

describe('computeIpaSource', () => {
  it("returns 'wiktionary' when the live grammar.ipa still matches the grounding snapshot", () => {
    expect(computeIpaSource(row({}))).toBe('wiktionary')
  })

  it('never badges a form card — form IPA is generated, not grounded', () => {
    expect(computeIpaSource(row({ target_form: 'стола' }))).toBeNull()
  })

  it('returns null for an ungrounded row', () => {
    expect(computeIpaSource(row({ grounded_at: null }))).toBeNull()
  })

  it('returns null when the grounding snapshot carried no ipa', () => {
    expect(computeIpaSource(row({ grounding_patch: { pos: 'noun' } }))).toBeNull()
    expect(computeIpaSource(row({ grounding_patch: null }))).toBeNull()
  })

  it('drops the claim once the user edits the transcription away from the snapshot', () => {
    expect(computeIpaSource(row({ grammar: { ipa: { untagged: '[drugoj]' } } }))).toBeNull()
  })

  it('tolerates trim-level differences (normalized compare, not byte equality)', () => {
    expect(computeIpaSource(row({ grammar: { ipa: { untagged: ' [stɐˈla] ' } } }))).toBe('wiktionary')
  })
})
