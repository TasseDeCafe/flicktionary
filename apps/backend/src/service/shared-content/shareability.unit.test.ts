import { describe, expect, it } from 'vitest'
import type { DbContentSource } from '../../transport/database/content-sources/content-sources-repository'
import type { DbTextTrack } from '../../transport/database/text-tracks/text-tracks-repository'
import { canonicalKeyForShare, isShareAllowed } from './shareability'

describe('isShareAllowed', () => {
  it('auto-shares youtube and article on both triggers', () => {
    expect(isShareAllowed('youtube', 'auto')).toBe(true)
    expect(isShareAllowed('youtube', 'user')).toBe(true)
    expect(isShareAllowed('article', 'auto')).toBe(true)
    expect(isShareAllowed('article', 'user')).toBe(true)
  })

  it('shares text only on an explicit user request', () => {
    expect(isShareAllowed('text', 'auto')).toBe(false)
    expect(isShareAllowed('text', 'user')).toBe(true)
  })

  it('never shares subtitle-backed, lesson, book, or adhoc sources', () => {
    for (const type of ['movie', 'tv', 'streaming', 'lesson', 'book', 'adhoc'] as const) {
      expect(isShareAllowed(type, 'auto')).toBe(false)
      expect(isShareAllowed(type, 'user')).toBe(false)
    }
  })
})

describe('canonicalKeyForShare', () => {
  const track = { hash: 'abc123' } as DbTextTrack

  it('keys youtube sources on the video id', () => {
    const source = { type: 'youtube', metadata: { youtubeVideoId: 'dQw4w9WgXcQ' } } as unknown as DbContentSource
    expect(canonicalKeyForShare(source, track)).toBe('youtube:dQw4w9WgXcQ')
  })

  it('falls back to the track hash when a youtube source has no video id', () => {
    const source = { type: 'youtube', metadata: {} } as unknown as DbContentSource
    expect(canonicalKeyForShare(source, track)).toBe('hash:abc123')
  })

  it('keys everything else on the track hash', () => {
    const source = { type: 'article', metadata: { contentHash: 'meta-hash' } } as unknown as DbContentSource
    expect(canonicalKeyForShare(source, track)).toBe('hash:abc123')
  })
})
