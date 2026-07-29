import { describe, expect, test } from 'vitest'
import { classifyOpenSubtitlesFailure } from './opensubtitles-client'
import { UpstreamRateLimitError } from '../upstream-rate-limit-error'

describe('classifyOpenSubtitlesFailure', () => {
  test('maps 429 to a transient rate-limit error on any endpoint', () => {
    const error = classifyOpenSubtitlesFailure('search', { status: 429, statusText: 'Too Many Requests' })

    expect(error).toBeInstanceOf(UpstreamRateLimitError)
    expect(error).toMatchObject({ service: 'opensubtitles', kind: 'rate_limited' })
  })

  test('maps 406 on download to the spent daily quota', () => {
    const error = classifyOpenSubtitlesFailure(
      'download (link)',
      { status: 406, statusText: 'Not Acceptable' },
      { isDownload: true }
    )

    expect(error).toBeInstanceOf(UpstreamRateLimitError)
    expect(error).toMatchObject({ service: 'opensubtitles', kind: 'quota_exceeded' })
  })

  test('406 outside the download step stays a generic error', () => {
    const error = classifyOpenSubtitlesFailure('search', { status: 406, statusText: 'Not Acceptable' })

    expect(error).not.toBeInstanceOf(UpstreamRateLimitError)
    expect(error.message).toContain('406')
  })

  test('other failures stay generic errors carrying status and label', () => {
    const error = classifyOpenSubtitlesFailure('episode search', { status: 503, statusText: 'Service Unavailable' })

    expect(error).not.toBeInstanceOf(UpstreamRateLimitError)
    expect(error.message).toBe('OpenSubtitles episode search failed: 503 Service Unavailable')
  })
})
