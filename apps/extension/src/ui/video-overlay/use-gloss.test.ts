import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { requestGloss } from '../../services/flicktionary/flicktionary-client'
import { glossQueryKey, glossQueryOptions } from './use-gloss.ts'

vi.mock('../../services/flicktionary/flicktionary-client', () => ({
  requestGloss: vi.fn(),
}))

const mockedRequestGloss = vi.mocked(requestGloss)

// The invariants under test mirror the old hand-rolled glossCache Map:
// successes cache (re-hover instant), errors NEVER cache (re-hover refetches —
// a cached "Sign in to translate" error must not survive sign-in).
describe('glossQueryOptions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
  })

  afterEach(() => {
    queryClient.clear()
    vi.clearAllMocks()
  })

  it('maps a successful response, defaulting absent fields to null', async () => {
    mockedRequestGloss.mockResolvedValueOnce({ gloss: 'кот → cat', pos: 'noun' })

    const data = await queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true))

    expect(data).toEqual({ gloss: 'кот → cat', pos: 'noun', register: null, ipaDisplay: null, ipaLemma: null })
    expect(mockedRequestGloss).toHaveBeenCalledWith('кот', 'кот спит', undefined)
  })

  it('caches successes: a re-hover does not refetch', async () => {
    mockedRequestGloss.mockResolvedValue({ gloss: 'кот → cat' })
    const options = glossQueryOptions('кот', 'кот спит', true)

    await queryClient.fetchQuery(options)
    // staleTime Infinity: the cached gloss is served without a network hop.
    await queryClient.fetchQuery(options)

    expect(mockedRequestGloss).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(glossQueryKey('кот', 'кот спит'))).toMatchObject({ gloss: 'кот → cat' })
  })

  it('throws on an {error} response and caches nothing', async () => {
    mockedRequestGloss.mockResolvedValueOnce({ error: 'Sign in to Flicktionary to translate.' })
    const options = glossQueryOptions('кот', 'кот спит', true)

    await expect(queryClient.fetchQuery(options)).rejects.toThrow('Sign in to Flicktionary to translate.')
    expect(queryClient.getQueryData(glossQueryKey('кот', 'кот спит'))).toBeUndefined()

    // Re-hover after the failure (e.g. after signing in) refetches and the
    // success replaces the error.
    mockedRequestGloss.mockResolvedValueOnce({ gloss: 'кот → cat' })
    await expect(queryClient.fetchQuery(options)).resolves.toMatchObject({ gloss: 'кот → cat' })
    expect(mockedRequestGloss).toHaveBeenCalledTimes(2)
  })

  it('falls back to a generic message when the response has neither gloss nor error', async () => {
    mockedRequestGloss.mockResolvedValueOnce({})

    await expect(queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true))).rejects.toThrow(
      'No translation available'
    )
  })

  it('wraps sendMessage rejections (service worker mid-reload) in a friendly message', async () => {
    mockedRequestGloss.mockRejectedValueOnce(new Error('Extension context invalidated.'))

    await expect(queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true))).rejects.toThrow(
      'Could not fetch a translation.'
    )
    expect(queryClient.getQueryData(glossQueryKey('кот', 'кот спит'))).toBeUndefined()
  })

  it('keys by word AND sentence: the same word in another sentence is a separate lookup', async () => {
    mockedRequestGloss.mockResolvedValue({ gloss: 'кот → cat' })

    await queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true))
    await queryClient.fetchQuery(glossQueryOptions('кот', 'кот ест', true))

    expect(mockedRequestGloss).toHaveBeenCalledTimes(2)
  })

  it('keys by target language: the detected language landing refetches instead of serving the fallback gloss', async () => {
    mockedRequestGloss.mockResolvedValue({ gloss: 'кот → cat' })

    // Before the overlay knows the video's language the lookup runs without it
    // (the background falls back to the user's primary target language)…
    await queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true))
    // …and once the detected language lands, the same (word, sentence) is a
    // NEW key — the possibly-wrong-language gloss must not be served.
    await queryClient.fetchQuery(glossQueryOptions('кот', 'кот спит', true, 'ru'))

    expect(mockedRequestGloss).toHaveBeenCalledTimes(2)
    expect(mockedRequestGloss).toHaveBeenLastCalledWith('кот', 'кот спит', 'ru')
  })

  it('is disabled without a word/sentence', () => {
    expect(glossQueryOptions(undefined, undefined, true).enabled).toBe(false)
    expect(glossQueryOptions('кот', 'кот спит', false).enabled).toBe(false)
    expect(glossQueryOptions('кот', 'кот спит', true).enabled).toBe(true)
  })
})
