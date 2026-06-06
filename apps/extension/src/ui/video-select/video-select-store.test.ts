import { describe, expect, it } from 'vitest'
import { createVideoSelectStore, VideoElement } from './video-select-store.ts'

const video = (src: string): VideoElement => ({ src, imageDataUrl: `data:${src}` })

describe('createVideoSelectStore', () => {
  it('applies only the fields present in a partial', () => {
    const store = createVideoSelectStore()

    store.getState().updateState({ open: true, themeType: 'dark' })

    expect(store.getState().open).toBe(true)
    expect(store.getState().themeType).toBe('dark')
    expect(store.getState().videoElements).toEqual([])
    expect(store.getState().openedFromMiningCommand).toBe(false)
  })

  it('resets the selection whenever a videoElements delta arrives', () => {
    const store = createVideoSelectStore()

    store.getState().updateState({ videoElements: [video('a'), video('b')] })
    store.getState().setSelectedIndex('1')
    expect(store.getState().selectedIndex).toBe('1')

    // A new list invalidates the old index — it could point at the wrong video.
    store.getState().updateState({ videoElements: [video('c'), video('a'), video('b')] })

    expect(store.getState().selectedIndex).toBe('')
    expect(store.getState().videoElements.map((v) => v.src)).toEqual(['c', 'a', 'b'])
  })

  it('keeps the selection across non-videoElements deltas', () => {
    const store = createVideoSelectStore()

    store.getState().updateState({ videoElements: [video('a')] })
    store.getState().setSelectedIndex('0')
    store.getState().updateState({ open: true, openedFromMiningCommand: true })

    expect(store.getState().selectedIndex).toBe('0')
  })
})
