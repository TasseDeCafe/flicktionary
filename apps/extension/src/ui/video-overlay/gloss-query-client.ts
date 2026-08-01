import { QueryClient } from '@tanstack/react-query'
import {
  FlicktionaryAuthState,
  getFlicktionaryAuth,
  onFlicktionaryAuthChange,
} from '../../services/flicktionary/auth-storage'

// One QueryClient for the content-script realm's gloss lookups, shared across
// the shadow surfaces on the page. Module-level is fine here — the cache is
// realm-wide (per word+sentence), not per-video, unlike the per-controller
// zustand stores.
export const glossQueryClient = new QueryClient()

// Cache identity: glosses are derived background-side from the auth session +
// target language (gloss-handler), which the ['gloss', word, sentence] key
// doesn't capture — so a change of *user* (sign-out, re-pair as another
// account, guest converting to a full account) drops the whole cache. A
// target-language change WITHOUT an auth change can still serve a
// stale-language gloss until gcTime; that matches the old per-mount Map's
// staleness, and including the language in the key would cost a sendMessage
// round-trip per hover — accepted.
//
// Same-identity writes must NOT clear: every token refresh rewrites the auth
// record, and the guest mint lands mid-first-gloss — clearing there would
// cancel the very query that triggered it (and duplicate the LLM call).
// Skipping the no-previous-auth transition is safe because errors are never
// cached (use-gloss), so a signed-out cache holds no successes to invalidate.
export const shouldClearGlossCache = (
  previous: FlicktionaryAuthState | null,
  next: FlicktionaryAuthState | null
): boolean => previous !== null && previous.userId !== next?.userId

let previousAuth: FlicktionaryAuthState | null = null
let sawChange = false
// Seed the baseline from storage; a change event that races the seed wins
// (the seed must not overwrite a newer value).
void getFlicktionaryAuth().then((auth) => {
  if (!sawChange) previousAuth = auth
})
onFlicktionaryAuthChange((next) => {
  sawChange = true
  if (shouldClearGlossCache(previousAuth, next)) {
    glossQueryClient.clear()
  }
  previousAuth = next
})
