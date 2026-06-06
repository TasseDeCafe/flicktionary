import { describe, expect, it } from 'vitest'
import { VideoDataSubtitleTrack } from '@asbplayer-fork/common'
import { createVideoDataSyncStore } from './video-data-sync-store.ts'

const track = (id: string, label = id): VideoDataSubtitleTrack => ({
  id,
  language: 'en',
  url: `https://example.com/${id}`,
  label,
  extension: 'srt',
})

describe('createVideoDataSyncStore', () => {
  it('applies only the fields present in a partial', () => {
    const store = createVideoDataSyncStore()

    store.getState().updateState({ open: true, isLoading: false })

    expect(store.getState().open).toBe(true)
    expect(store.getState().isLoading).toBe(false)
    // Untouched fields keep their initial values.
    expect(store.getState().suggestedName).toBe('')
    expect(store.getState().selectedSubtitleTrackIds).toEqual(['-', '-', '-'])
  })

  it('prunes selections that no longer resolve to a track on a subtitles delta', () => {
    const store = createVideoDataSyncStore()

    store.getState().updateState({ subtitles: [track('a'), track('b')] })
    store.getState().updateState({ selectedSubtitle: ['a', 'b', '-'] })

    // 'b' disappears from the pushed list — its selection resets to Empty,
    // 'a' and the placeholder survive.
    store.getState().updateState({ subtitles: [track('a'), track('c')] })

    expect(store.getState().rawSubtitles.map((t) => t.id)).toEqual(['a', 'c'])
    expect(store.getState().selectedSubtitleTrackIds).toEqual(['a', '-', '-'])
  })

  it('lets an explicit selectedSubtitle in the same partial win over the prune', () => {
    const store = createVideoDataSyncStore()

    store.getState().updateState({ subtitles: [track('a')], selectedSubtitle: ['b', '-', '-'] })

    expect(store.getState().selectedSubtitleTrackIds).toEqual(['b', '-', '-'])
  })

  it('replaces the selection on a selectedSubtitle delta', () => {
    const store = createVideoDataSyncStore()

    store.getState().updateState({ subtitles: [track('a'), track('b')] })
    store.getState().updateState({ selectedSubtitle: ['b', '-', '-'] })

    expect(store.getState().selectedSubtitleTrackIds).toEqual(['b', '-', '-'])
  })

  it('appends local file tracks and selects the first one in the given slot', () => {
    const store = createVideoDataSyncStore()

    store.getState().updateState({ subtitles: [track('a')] })
    store.getState().addLocalFileTracks([track('blob:1', 'one.srt'), track('blob:2', 'two.srt')], 1)

    expect(store.getState().rawSubtitles.map((t) => t.id)).toEqual(['a', 'blob:1', 'blob:2'])
    expect(store.getState().selectedSubtitleTrackIds).toEqual(['-', 'blob:1', '-'])
  })

  it('replaces locally-added tracks when the controller pushes a new subtitles list', () => {
    const store = createVideoDataSyncStore()

    store.getState().addLocalFileTracks([track('blob:1', 'one.srt')], 0)
    store.getState().updateState({ subtitles: [track('a')] })

    // The pushed list replaces the whole track list; the stale local selection
    // is pruned back to Empty.
    expect(store.getState().rawSubtitles.map((t) => t.id)).toEqual(['a'])
    expect(store.getState().selectedSubtitleTrackIds).toEqual(['-', '-', '-'])
  })

  it('maps a settings delta to themeType/profiles/activeProfile', () => {
    const store = createVideoDataSyncStore()

    const profiles = [{ name: 'p1' }]
    store.getState().updateState({ settings: { themeType: 'dark', profiles, activeProfile: 'p1' } })

    expect(store.getState().themeType).toBe('dark')
    expect(store.getState().profiles).toEqual(profiles)
    expect(store.getState().activeProfile).toBe('p1')

    // Missing themeType falls back to 'system' (matches the old wrapper).
    store.getState().updateState({ settings: { profiles: [], activeProfile: undefined } })
    expect(store.getState().themeType).toBe('system')
  })
})
