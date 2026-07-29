import { describe, expect, test } from 'vitest'
import { classifyTmdbFailure } from './tmdb-client'
import { UpstreamRateLimitError } from '../upstream-rate-limit-error'

describe('classifyTmdbFailure', () => {
  test('maps 429 to a transient rate-limit error', () => {
    const error = classifyTmdbFailure('search', { status: 429, statusText: 'Too Many Requests' })

    expect(error).toBeInstanceOf(UpstreamRateLimitError)
    expect(error).toMatchObject({ service: 'tmdb', kind: 'rate_limited' })
  })

  test('other failures stay generic errors carrying status and label', () => {
    const error = classifyTmdbFailure('TV details', { status: 404, statusText: 'Not Found' })

    expect(error).not.toBeInstanceOf(UpstreamRateLimitError)
    expect(error.message).toBe('TMDB TV details failed: 404 Not Found')
  })
})
