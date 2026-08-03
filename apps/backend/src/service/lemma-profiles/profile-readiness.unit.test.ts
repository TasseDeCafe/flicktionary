import { describe, expect, it, vi } from 'vitest'
import type { DbTextTrackWithSourceType } from '../../transport/database/text-tracks/text-tracks-repository'
import { resolveTrackProfileReadiness, type ProfileReadinessDependencies } from './profile-readiness'

const track = (overrides: Partial<DbTextTrackWithSourceType> = {}): DbTextTrackWithSourceType =>
  ({
    id: 'track-1',
    language: 'ru',
    content_source_type: 'youtube',
    profile_built_at: '2026-08-02T19:23:25.000Z',
    profile_segment_count: 133,
    profile_max_segment_index: 132,
    profile_word_token_count: 1676,
    profile_matched_token_count: 900,
    ...overrides,
  }) as DbTextTrackWithSourceType

const buildDeps = ({
  rankBuildTime = null,
  latestJobStatus = 'done',
}: {
  rankBuildTime?: Date | null
  latestJobStatus?: 'done' | 'failed' | null
} = {}) => {
  const enqueueBuildTrackLemmaProfile = vi.fn().mockResolvedValue(undefined)
  const deps = {
    textTracksRepository: {},
    textSegmentsRepository: {
      getSegmentStats: vi.fn().mockResolvedValue({ segmentCount: 133, maxIndex: 132 }),
    },
    processingJobsRepository: {
      getLatestBuildProfileJobStatus: vi.fn().mockResolvedValue(latestJobStatus),
      enqueueBuildTrackLemmaProfile,
    },
    lemmaRanksRepository: {
      getRankBuildTime: vi.fn().mockResolvedValue(rankBuildTime),
    },
  } as unknown as ProfileReadinessDependencies
  return { deps, enqueueBuildTrackLemmaProfile }
}

describe('resolveTrackProfileReadiness — zero-match staleness guard', () => {
  it('keeps a healthy stamped profile available', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({ rankBuildTime: new Date('2026-08-03T14:09:12Z') })
    await expect(resolveTrackProfileReadiness(track(), 'user-1', deps)).resolves.toBe('available')
    expect(enqueueBuildTrackLemmaProfile).not.toHaveBeenCalled()
  })

  it('rebuilds a zero-match profile older than the current rank build', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({ rankBuildTime: new Date('2026-08-03T14:09:12Z') })
    const stale = track({ profile_matched_token_count: 0 })
    await expect(resolveTrackProfileReadiness(stale, 'user-1', deps)).resolves.toBe('pending')
    expect(enqueueBuildTrackLemmaProfile).toHaveBeenCalledWith({ textTrackId: 'track-1', userId: 'user-1' })
  })

  it('keeps a zero-match profile available when it is newer than the rank build', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({ rankBuildTime: new Date('2026-08-01T00:00:00Z') })
    const genuinelyEmpty = track({ profile_matched_token_count: 0 })
    await expect(resolveTrackProfileReadiness(genuinelyEmpty, 'user-1', deps)).resolves.toBe('available')
    expect(enqueueBuildTrackLemmaProfile).not.toHaveBeenCalled()
  })

  it('keeps a zero-match profile available when the language has no rank build', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({ rankBuildTime: null })
    const stale = track({ profile_matched_token_count: 0 })
    await expect(resolveTrackProfileReadiness(stale, 'user-1', deps)).resolves.toBe('available')
    expect(enqueueBuildTrackLemmaProfile).not.toHaveBeenCalled()
  })

  it('surfaces a terminal rebuild failure instead of re-enqueueing', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({
      rankBuildTime: new Date('2026-08-03T14:09:12Z'),
      latestJobStatus: 'failed',
    })
    const stale = track({ profile_matched_token_count: 0 })
    await expect(resolveTrackProfileReadiness(stale, 'user-1', deps)).resolves.toBe('failed')
    expect(enqueueBuildTrackLemmaProfile).not.toHaveBeenCalled()
  })

  it('ignores zero matches on a text with no word tokens at all', async () => {
    const { deps, enqueueBuildTrackLemmaProfile } = buildDeps({ rankBuildTime: new Date('2026-08-03T14:09:12Z') })
    const empty = track({ profile_word_token_count: 0, profile_matched_token_count: 0 })
    await expect(resolveTrackProfileReadiness(empty, 'user-1', deps)).resolves.toBe('available')
    expect(enqueueBuildTrackLemmaProfile).not.toHaveBeenCalled()
  })
})
