import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@asbplayer-fork/common/settings'
import pagesConfig from '../pages.json'
import { matchesActivationUrl } from './activation-url'

it('page settings and page configs are consistent', () => {
  for (const page of pagesConfig.pages) {
    expect(page.key in defaultSettings.streamingPages).toBe(true)
  }

  for (const key of Object.keys(defaultSettings.streamingPages)) {
    expect(pagesConfig.pages.find((p) => p.key === key) !== undefined).toBe(true)
  }
})

describe('activateAt', () => {
  const amazon = pagesConfig.pages.find((p) => p.key === 'amazonPrime')!
  const activates = (url: string) => matchesActivationUrl(amazon.activateAt, new URL(url))

  it('activates on Prime Video pages under every Amazon storefront', () => {
    expect(activates('https://www.amazon.de/gp/video/detail/B0CH1234/ref=atv_dp')).toBe(true)
    expect(activates('https://www.amazon.de/gp/video/storefront')).toBe(true)
    expect(activates('https://www.amazon.co.uk/gp/video')).toBe(true)
    expect(activates('https://www.amazon.com/-/es/gp/video/detail/B0CH1234')).toBe(true)
    expect(activates('https://www.amazon.de/Prime-Video/b?node=3010075031')).toBe(true)
    expect(activates('https://www.amazon.com/Amazon-Video/b?node=2858778011')).toBe(true)
    expect(activates('https://www.primevideo.com/detail/0ABC/ref=atv_hm')).toBe(true)
    expect(activates('https://www.primevideo.com/')).toBe(true)
  })

  it('stays inert on the Amazon shopping site, whose ad videos autoplay', () => {
    expect(activates('https://www.amazon.de/')).toBe(false)
    expect(activates('https://www.amazon.de/dp/B0CH1234')).toBe(false)
    expect(activates('https://www.amazon.de/s?k=conditioner')).toBe(false)
    expect(activates('https://www.amazon.de/gp/videos/anything')).toBe(false)
    expect(activates('https://www.amazon.de/stores/page/gp/video/')).toBe(false)
  })

  it('activates everywhere on rows without activateAt', () => {
    expect(matchesActivationUrl(undefined, new URL('https://www.netflix.com/browse'))).toBe(true)
  })
})
