import { expect, it } from 'vitest'
import { subtitleScaleWidth, surroundingSubtitlesAroundInterval } from './util'

function subtitle(text: string, start: number, end: number) {
  return { text, start, end, originalStart: start, originalEnd: end, track: 0 }
}

it('calculates surrounding subtitles around interval in middle when radius is 0', () => {
  const surrounding = surroundingSubtitlesAroundInterval(
    [subtitle('1', 0, 1), subtitle('2', 10, 20), subtitle('3', 25, 26), subtitle('4', 26, 30)],
    9,
    27,
    0,
    0
  )
  expect(surrounding.subtitle).toEqual(subtitle('2', 10, 20))
  expect(surrounding.surroundingSubtitles).toEqual([
    subtitle('2', 10, 20),
    subtitle('3', 25, 26),
    subtitle('4', 26, 30),
  ])
})

it('calculates surrounding subtitles around interval in middle when radius is 0 and subtitles overlap', () => {
  const surrounding = surroundingSubtitlesAroundInterval(
    [subtitle('1', 0, 1), subtitle('2', 10, 20), subtitle('3', 15, 26), subtitle('4', 26, 30)],
    9,
    25,
    0,
    0
  )
  expect(surrounding.subtitle).toEqual(subtitle('2', 10, 20))
  expect(surrounding.surroundingSubtitles).toEqual([subtitle('2', 10, 20), subtitle('3', 15, 26)])
})

it('scales a 16:9 video by its real width', () => {
  expect(subtitleScaleWidth(1920, 1080)).toBeCloseTo(1920)
  expect(subtitleScaleWidth(640, 360)).toBeCloseTo(640)
})

it('scales a portrait video between its width and the landscape video of the same height', () => {
  const scaleWidth = subtitleScaleWidth(360, 640)
  expect(scaleWidth).toBeGreaterThan(640)
  expect(scaleWidth).toBeLessThan(1137.78)
})

it('scales a video wider than 16:9 by its real width', () => {
  expect(subtitleScaleWidth(2560, 1080)).toBe(2560)
})

it('returns zero for a video with no width', () => {
  expect(subtitleScaleWidth(0, 640)).toBe(0)
})
