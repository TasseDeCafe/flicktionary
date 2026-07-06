// Publishes raw captures (shots/) into the landing page's assets: each mapped
// asset is copied full-size under its existing filename (drop-in refresh for
// apps/landing/src/pages/index.astro imports), and — when a crop is defined —
// a tighter `<name>-cropped.png` variant is written next to it for landing
// layouts that want closer framing. Raw shots stay in shots/ for the store
// listings (Chrome Web Store wants exactly 1280×800).
//
// Run: pnpm --filter @flicktionary/screenshots postprocess

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { LANDING_ASSETS_DIR, log, OUT_DIR } from './lib/env.mjs'
import { LANDING_ASSETS } from './manifest.mjs'

const run = async () => {
  let missing = 0
  for (const asset of LANDING_ASSETS) {
    const srcPath = path.join(OUT_DIR, asset.src)
    if (!fs.existsSync(srcPath)) {
      log(`! missing capture, skipping: ${asset.src}`)
      missing += 1
      continue
    }
    const outPath = path.join(LANDING_ASSETS_DIR, asset.out)
    fs.copyFileSync(srcPath, outPath)
    log(`landing asset: ${asset.out} <- ${asset.src}`)
    if (asset.crop) {
      const croppedName = `${path.basename(asset.out, '.png')}-cropped.png`
      await sharp(srcPath).extract(asset.crop).toFile(path.join(LANDING_ASSETS_DIR, croppedName))
      log(`landing asset: ${croppedName} (crop ${asset.crop.width}×${asset.crop.height})`)
    }
  }
  if (missing > 0) log(`${missing} capture(s) missing — run shoot:extension / shoot:web first`)
}

await run()
