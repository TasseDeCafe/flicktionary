import { describe, test, expect } from 'vitest'
import { parseEmails, resolveCaptchaSiteKey } from './environment-config-utils'

describe('processEmails', () => {
  test('should correctly separate valid and invalid emails', () => {
    const emailString = 'valid@example.com, invalid@email, another.valid@example.com, spaces@example.com '
    const result = parseEmails(emailString)

    expect(result.validEmails).toEqual(['valid@example.com', 'another.valid@example.com', 'spaces@example.com'])
    expect(result.invalidEmails).toEqual(['invalid@email'])
  })

  test('should handle empty string', () => {
    const result = parseEmails('')

    expect(result.validEmails).toEqual([])
    expect(result.invalidEmails).toEqual([])
  })

  test('should handle too many comas', () => {
    const result = parseEmails('a@b.com,,')

    expect(result.validEmails).toEqual(['a@b.com'])
    expect(result.invalidEmails).toEqual([])
  })

  test('should handle string with only invalid emails', () => {
    const emailString = 'invalid1, invalid2@, @invalid3'
    const result = parseEmails(emailString)

    expect(result.validEmails).toEqual([])
    expect(result.invalidEmails).toEqual(['invalid1', 'invalid2@', '@invalid3'])
  })

  test('should handle string with only valid emails', () => {
    const emailString = 'valid1@example.com,valid2@example.com'
    const result = parseEmails(emailString)

    expect(result.validEmails).toEqual(['valid1@example.com', 'valid2@example.com'])
    expect(result.invalidEmails).toEqual([])
  })

  test('should trim whitespace from emails', () => {
    const emailString = ' whitespace@example.com , another@example.com'
    const result = parseEmails(emailString)

    expect(result.validEmails).toEqual(['whitespace@example.com', 'another@example.com'])
    expect(result.invalidEmails).toEqual([])
  })
})

describe('resolveCaptchaSiteKey', () => {
  test('returns the sitekey when the flag is on and a key is set', () => {
    expect(resolveCaptchaSiteKey({ CAPTCHA_ENABLED: 'true', TURNSTILE_SITE_KEY: '1x00000000000000000000BB' })).toBe(
      '1x00000000000000000000BB'
    )
  })

  test('returns null when the flag is off, regardless of the key', () => {
    expect(resolveCaptchaSiteKey({ TURNSTILE_SITE_KEY: '1x00000000000000000000BB' })).toBeNull()
    expect(
      resolveCaptchaSiteKey({ CAPTCHA_ENABLED: 'false', TURNSTILE_SITE_KEY: '1x00000000000000000000BB' })
    ).toBeNull()
    expect(resolveCaptchaSiteKey({})).toBeNull()
  })

  test('throws when the flag is on but the key is missing or empty', () => {
    expect(() => resolveCaptchaSiteKey({ CAPTCHA_ENABLED: 'true' })).toThrow(/TURNSTILE_SITE_KEY/)
    expect(() => resolveCaptchaSiteKey({ CAPTCHA_ENABLED: 'true', TURNSTILE_SITE_KEY: '' })).toThrow(
      /TURNSTILE_SITE_KEY/
    )
  })
})
