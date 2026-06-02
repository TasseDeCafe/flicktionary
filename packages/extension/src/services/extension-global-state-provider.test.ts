import { expect, it } from 'vitest'
import { ExtensionGlobalStateProvider } from './extension-global-state-provider'
import { MockStorageArea } from './mock-storage-area'

it('can retrieve list of keys', async () => {
  const provider = new ExtensionGlobalStateProvider(new MockStorageArea())
  expect(await provider.get(['ftueHasSeenSubtitleTrackSelector'])).toEqual({
    ftueHasSeenSubtitleTrackSelector: false,
  })
  await provider.set({ ftueHasSeenSubtitleTrackSelector: true })
  expect(await provider.get(['ftueHasSeenSubtitleTrackSelector'])).toEqual({
    ftueHasSeenSubtitleTrackSelector: true,
  })
})

it('can retrieve 0 keys', async () => {
  const provider = new ExtensionGlobalStateProvider(new MockStorageArea())
  expect(await provider.get([])).toEqual({})
})

it('can retrieve all keys', async () => {
  const provider = new ExtensionGlobalStateProvider(new MockStorageArea())
  expect(await provider.getAll()).toEqual({
    ftueHasSeenSubtitleTrackSelector: false,
  })
})
