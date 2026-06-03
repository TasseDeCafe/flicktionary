import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPolicyView } from '@/features/legal/components/privacy-policy-view'

// Public (unauthenticated) — linked from the Chrome Web Store listing, so it
// must be reachable without signing in.
export const Route = createFileRoute('/privacy-policy')({
  component: PrivacyPolicyView,
})
