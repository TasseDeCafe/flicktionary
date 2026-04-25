import { describe, expect, it } from 'vitest'
import { _sanitizeEmails } from './sentry-utils'

describe('sentry-utils', () => {
  it('hide emails from logging', () => {
    const someJson = JSON.stringify({ field: 'asdf,some@email.com%20asdf' })
    expect(_sanitizeEmails(someJson)).toEqual(JSON.stringify({ field: 'asdf,[EMAIL_REDACTED]%20asdf' }))
  })
  it('should replace email addresses with [EMAIL_REDACTED]', () => {
    const input = `User john.doe@example.com reported an error. 
        Contact support@company.co.uk or admin@test.io for assistance. 
        Invalid email: not.an.email`

    const expected = `User [EMAIL_REDACTED] reported an error. 
        Contact [EMAIL_REDACTED] or [EMAIL_REDACTED] for assistance. 
        Invalid email: not.an.email`

    expect(_sanitizeEmails(input)).toBe(expected)
  })
})
