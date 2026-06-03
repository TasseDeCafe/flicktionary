import { createFileRoute } from '@tanstack/react-router'

// The canonical privacy policy lives on the public landing site (apps/landing).
// This route only exists so older links (e.g. the original Chrome Web Store
// listing URL) keep working.
export const Route = createFileRoute('/privacy-policy')({
  beforeLoad: () => {
    window.location.replace('https://flicktionary.app/privacy-policy')
  },
})
