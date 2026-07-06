// Fetches uBlock Origin Lite (MV3) so YouTube captures aren't fighting ads.
// The unpacked extension lands in vendor/ubolite (gitignored) and is loaded
// alongside the Flicktionary extension.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { log, UBOLITE_DIR } from './env.mjs'

export const ensureUbolite = async () => {
  if (fs.existsSync(path.join(UBOLITE_DIR, 'manifest.json'))) return
  log('downloading uBlock Origin Lite…')
  const release = await (await fetch('https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest')).json()
  const asset = release.assets.find((a) => a.name.endsWith('.chromium.zip'))
  if (!asset) throw new Error('no chromium asset in latest uBOLite release')
  const zipPath = path.join(path.dirname(UBOLITE_DIR), 'ubolite.zip')
  fs.mkdirSync(path.dirname(UBOLITE_DIR), { recursive: true })
  const body = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
  fs.writeFileSync(zipPath, body)
  execFileSync('unzip', ['-oq', zipPath, '-d', UBOLITE_DIR])
  fs.rmSync(zipPath)
  log(`uBOLite ready: ${release.tag_name}`)
}
