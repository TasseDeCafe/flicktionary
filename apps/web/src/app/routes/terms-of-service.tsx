import { createFileRoute } from '@tanstack/react-router'

// The canonical terms of service live on the public landing site (apps/landing).
// This route only exists so older links keep working.
export const Route = createFileRoute('/terms-of-service')({
  beforeLoad: () => {
    window.location.replace('https://flicktionary.app/terms-of-service')
  },
})
