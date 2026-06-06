import { QueryClient } from '@tanstack/react-query'
import { onFlicktionaryAuthChange } from '../../services/flicktionary/auth-storage'

// One QueryClient for the content-script realm's gloss lookups, shared across
// the shadow surfaces on the page. Module-level is fine here — the cache is
// realm-wide (per word+sentence), not per-video, unlike the per-controller
// zustand stores.
export const glossQueryClient = new QueryClient()

// Cache identity: glosses are derived background-side from the auth session +
// target language (gloss-handler), which the ['gloss', word, sentence] key
// doesn't capture — so any auth change (sign-out, re-pair as another user)
// drops the whole cache. A target-language change WITHOUT an auth change can
// still serve a stale-language gloss until gcTime; that matches the old
// per-mount Map's staleness, and including the language in the key would cost
// a sendMessage round-trip per hover — accepted.
onFlicktionaryAuthChange(() => {
  glossQueryClient.clear()
})
