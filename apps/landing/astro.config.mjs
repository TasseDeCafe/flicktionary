import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// Static marketing/legal site served at the apex domain. The product itself
// lives at app.flicktionary.app (apps/web).
export default defineConfig({
  site: 'https://flicktionary.app',
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Emit privacy-policy.html instead of privacy-policy/index.html so the
    // server can answer /privacy-policy with a 200 instead of a 301 to the
    // trailing-slash URL — these exact URLs are configured in the Google
    // OAuth console and the Chrome Web Store listing.
    format: 'file',
  },
})
