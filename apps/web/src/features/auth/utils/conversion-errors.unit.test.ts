import { describe, expect, test } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'
import { classifyEmailConversionError, parseOAuthLinkError } from './conversion-errors'

describe('classifyEmailConversionError', () => {
  test('maps the email_exists code to a conflict', () => {
    const error = new AuthApiError('A user with this email address has already been registered', 422, 'email_exists')
    expect(classifyEmailConversionError(error)).toBe('email_exists')
  })

  test('maps the send rate limit code to rate_limited', () => {
    const error = new AuthApiError('Too many requests', 429, 'over_email_send_rate_limit')
    expect(classifyEmailConversionError(error)).toBe('rate_limited')
  })

  test('maps a 429 without a code to rate_limited', () => {
    const error = new AuthApiError('Too many requests', 429, undefined)
    expect(classifyEmailConversionError(error)).toBe('rate_limited')
  })

  test('maps other auth errors and non-auth errors to unknown', () => {
    expect(classifyEmailConversionError(new AuthApiError('Invalid email', 422, 'email_address_invalid'))).toBe(
      'unknown'
    )
    expect(classifyEmailConversionError(new Error('network down'))).toBe('unknown')
    expect(classifyEmailConversionError(undefined)).toBe('unknown')
  })
})

describe('parseOAuthLinkError', () => {
  test('returns null when the URL carries no error params', () => {
    expect(parseOAuthLinkError('?linked=google', '')).toBeNull()
    expect(parseOAuthLinkError('', '#access_token=abc&token_type=bearer')).toBeNull()
  })

  test('detects an already-linked identity from the error_code in the query', () => {
    expect(parseOAuthLinkError('?error=unprocessable_entity&error_code=identity_already_exists', '')).toBe(
      'identity_exists'
    )
  })

  test('detects an already-linked identity from the description in the fragment', () => {
    expect(
      parseOAuthLinkError('', '#error=server_error&error_description=Identity+is+already+linked+to+another+user')
    ).toBe('identity_exists')
  })

  test('maps any other error to oauth_failed', () => {
    expect(parseOAuthLinkError('?error=access_denied&error_description=User+denied+access', '')).toBe('oauth_failed')
  })
})
