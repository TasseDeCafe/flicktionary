import { useQuery } from '@tanstack/react-query'
import type { FlicktionaryGlossResponse } from '@asbplayer-fork/common'
import { GlossData, requestGloss } from '../../services/flicktionary/flicktionary-client'

export const glossQueryKey = (word: string, sentence: string) => ['gloss', word, sentence] as const

// The gloss lookup as a query. Errors must NOT be cached (the old per-mount
// Map only stored successes; a cached "Sign in to translate" error surviving
// sign-in would be a regression), so the queryFn THROWS on `{error}` responses
// and on sendMessage rejections (background SW mid-reload) — TanStack Query
// caches data, not errors, so a re-hover refetches after a failure while
// successes stay instant.
export function useGloss(word: string | undefined, sentence: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: glossQueryKey(word ?? '', sentence ?? ''),
    queryFn: async (): Promise<GlossData> => {
      let response: FlicktionaryGlossResponse
      try {
        response = await requestGloss(word!, sentence!)
      } catch {
        throw new Error('Could not fetch a translation.')
      }
      if (response.gloss === undefined) {
        throw new Error(response.error || 'No translation available')
      }
      return {
        gloss: response.gloss,
        pos: response.pos ?? null,
        register: response.register ?? null,
        ipa: response.ipa ?? null,
      }
    },
    enabled: enabled && !!word && !!sentence,
    // A (word, sentence) gloss never changes within a session — cache hits are
    // instant on re-hover; bound memory with a finite gcTime.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    // "No translation available" must not auto-retry.
    retry: false,
  })
}
