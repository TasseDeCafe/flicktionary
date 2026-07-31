// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { getCaptchaToken } from './turnstile'

type RenderParams = {
  sitekey: string
  callback: (token: string) => void
  'error-callback': () => boolean
}

const installTurnstileFake = (onRender: (params: RenderParams, container: HTMLElement) => void) => {
  const remove = vi.fn()
  window.turnstile = {
    render: (container: HTMLElement, params: RenderParams) => {
      onRender(params, container)
      return 'widget-1'
    },
    remove,
  }
  return { remove }
}

afterEach(() => {
  delete window.turnstile
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.head.querySelectorAll('script').forEach((script) => script.remove())
})

describe('getCaptchaToken', () => {
  test('resolves the token and cleans up the widget and container', async () => {
    const { remove } = installTurnstileFake((params) => queueMicrotask(() => params.callback('turnstile-token')))

    const result = await getCaptchaToken('sitekey-1')

    expect(result).toEqual({ token: 'turnstile-token' })
    expect(remove).toHaveBeenCalledWith('widget-1')
    expect(document.body.querySelectorAll('div')).toHaveLength(0)
  })

  test('classifies the error-callback as challenge_failed and cleans up', async () => {
    const { remove } = installTurnstileFake((params) => queueMicrotask(() => params['error-callback']()))

    const result = await getCaptchaToken('sitekey-1')

    expect(result).toEqual({ failure: 'challenge_failed' })
    expect(remove).toHaveBeenCalledWith('widget-1')
    expect(document.body.querySelectorAll('div')).toHaveLength(0)
  })

  test('classifies a render that throws as challenge_failed', async () => {
    window.turnstile = {
      render: () => {
        throw new Error('invalid sitekey')
      },
      remove: vi.fn(),
    }

    const result = await getCaptchaToken('sitekey-1')

    expect(result).toEqual({ failure: 'challenge_failed' })
  })

  test('classifies a challenge that never resolves as timeout', async () => {
    vi.useFakeTimers()
    installTurnstileFake(() => {})

    const resultPromise = getCaptchaToken('sitekey-1')
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await resultPromise

    expect(result).toEqual({ failure: 'timeout' })
    expect(document.body.querySelectorAll('div')).toHaveLength(0)
  })

  test('classifies a blocked script load as script_blocked', async () => {
    // No window.turnstile: the util injects the script tag; jsdom never
    // fetches it, so firing its error event simulates an adblocker.
    const resultPromise = getCaptchaToken('sitekey-1')
    await vi.waitFor(() => {
      const script = document.head.querySelector('script[src*="challenges.cloudflare.com"]')
      expect(script).not.toBeNull()
      script?.dispatchEvent(new Event('error'))
    })
    const result = await resultPromise

    expect(result).toEqual({ failure: 'script_blocked' })
  })

  test('a blocked load is not cached: the next call re-injects the script', async () => {
    const failFirstLoad = getCaptchaToken('sitekey-1')
    await vi.waitFor(() => {
      const script = document.head.querySelector('script[src*="challenges.cloudflare.com"]')
      expect(script).not.toBeNull()
      script?.dispatchEvent(new Event('error'))
    })
    expect(await failFirstLoad).toEqual({ failure: 'script_blocked' })
    document.head.querySelectorAll('script').forEach((script) => script.remove())

    const secondLoad = getCaptchaToken('sitekey-1')
    await vi.waitFor(() => {
      expect(document.head.querySelector('script[src*="challenges.cloudflare.com"]')).not.toBeNull()
    })
    document.head.querySelector('script[src*="challenges.cloudflare.com"]')?.dispatchEvent(new Event('error'))

    expect(await secondLoad).toEqual({ failure: 'script_blocked' })
  })
})
