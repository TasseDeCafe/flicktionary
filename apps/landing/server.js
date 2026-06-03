// Tiny static server for the Astro build, mirroring apps/web/server.js so the
// landing site deploys to Railway the same way as the rest of the stack.

import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

// Astro fingerprints everything under /_astro, so it can be cached forever
app.use(
  '/_astro',
  express.static(join(dist, '_astro'), {
    maxAge: '1y',
    immutable: true,
  })
)

// Static pages and public/ assets with a short cache; extensionless URLs
// resolve to their .html file (e.g. /privacy-policy -> privacy-policy.html)
app.use(
  express.static(dist, {
    maxAge: '1h',
    extensions: ['html'],
  })
)

// Fallback to Astro's 404 page (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.status(404).sendFile(join(dist, '404.html'))
})

app.listen(process.env.PORT || 3000)
