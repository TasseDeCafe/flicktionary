// Automated extension screenshots (spike-grade; see docs/proposals/automated-screenshots.md).
//
// Flow: mint a magic link (local Supabase admin API) -> sign into the web app ->
// pair the extension from its popup -> open a subtitled YouTube video (track
// auto-sync seeded, so no dialog) -> pause -> hover a word (gloss popover) ->
// right-click save -> re-hover (saved popover). Screenshots land in ./shots.
//
// Prereqs: dev tunnel running (web + backend + dev-tunnel Supabase), and a
// dev-config extension build: pnpm --filter flicktionaryextension build:dev.
// First run: pnpm --filter @flicktionary/screenshots playwright:install
//
// Run: pnpm --filter @flicktionary/screenshots shoot:extension [-- --fresh]
// (--fresh discards the persistent browser profile: re-signs-in and re-pairs.)

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..')

const EMAIL = process.env.SCREENSHOT_EMAIL ?? 'sebastien.stecker@gmail.com'
const WEB_URL = process.env.SCREENSHOT_WEB_URL ?? 'https://web-sebastien.flicktionary.dev'
const VIDEO_ID = process.env.SCREENSHOT_VIDEO_ID ?? '3Uvn7KJYQwY'
const SEEK_TO_S = Number(process.env.SCREENSHOT_SEEK_S ?? 95)
const TRACK_LANGUAGE = process.env.SCREENSHOT_TRACK_LANG ?? 'ru'
const EXTENSION_PATH = path.join(REPO_ROOT, 'apps/extension/.output/chrome-mv3')
const USER_DATA_DIR = path.join(PACKAGE_DIR, 'user-data')
const OUT_DIR = path.join(PACKAGE_DIR, 'shots')

if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
  throw new Error(`No extension build at ${EXTENSION_PATH} — run: pnpm --filter flicktionaryextension build:dev`)
}
if (process.argv.includes('--fresh')) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) })
  log('screenshot:', name)
}

// ---------------------------------------------------------------- auth link
const mintTokenHash = async () => {
  // Local dev-tunnel Supabase; the key is the standard local demo secret
  // (hardcoded in apps/backend/src/config/environment-config.ts for dev).
  const url = 'http://127.0.0.1:34321'
  const key = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (error) throw error
  return data.properties.hashed_token
}

// ---------------------------------------------------------------- browser
const launch = () =>
  chromium.launchPersistentContext(USER_DATA_DIR, {
    // Extensions need a real (headed) Chromium.
    headless: false,
    // Chrome Web Store screenshot size.
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--mute-audio',
      '--lang=en-US',
      '--disable-blink-features=AutomationControlled',
    ],
  })

const getExtensionId = async (context) => {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
  return new URL(worker.url()).host
}

// ---------------------------------------------------------------- web sign-in
const signIntoWebApp = async (context) => {
  const page = await context.newPage()
  await page.goto(`${WEB_URL}/sessions`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  if (!page.url().includes('/login')) {
    log('web app: already signed in')
    await page.close()
    return
  }
  log('web app: signing in via minted magic link')
  const tokenHash = await mintTokenHash()
  await page.goto(`${WEB_URL}/login/email/verify?token_hash=${encodeURIComponent(tokenHash)}`)
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForURL('**/sessions**', { timeout: 20000 })
  log('web app: signed in')
  await page.close()
}

// ---------------------------------------------------------------- pairing
const pairExtension = async (context, extId) => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup-ui.html`)
  await popup.waitForTimeout(1500)
  if ((await popup.getByText(/Signed in as/i).count()) > 0) {
    log('extension: already paired')
    await popup.close()
    return
  }
  log('extension: pairing...')
  await popup.getByRole('button', { name: /Sign in with Flicktionary/i }).click()
  await popup.getByText(/Signed in as/i).waitFor({ timeout: 30000 })
  log('extension: paired')
  await shot(popup, '00-popup-paired')
  await popup.close()
}

// ---------------------------------------------------------------- youtube
const dismissYoutubeConsent = async (page, ms = 15000) => {
  // The EU consent dialog renders late and its buttons don't expose a
  // Playwright-visible button role — JS-click by text, across frames.
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const clicked = await frame
        .evaluate(() => {
          const els = [...document.querySelectorAll('button, tp-yt-paper-button, [role="button"]')]
          const target = els.find((e) => /^\s*reject all\s*$/i.test(e.textContent ?? ''))
          if (target) {
            target.click()
            return true
          }
          return false
        })
        .catch(() => false)
      if (clicked) {
        log('youtube: dismissed consent')
        await page.waitForTimeout(2000)
        return
      }
    }
    await page.waitForTimeout(500)
  }
  log('youtube: no consent dialog seen')
}

const skipAdsLoop = async (page, ms) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const skip = page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern').first()
    if (await skip.isVisible().catch(() => false)) {
      await skip.click().catch(() => {})
      log('youtube: skipped ad')
    }
    if ((await page.locator('.ad-showing').count()) === 0) return
    await page.waitForTimeout(1000)
  }
}

const run = async () => {
  const context = await launch()
  try {
    const extId = await getExtensionId(context)
    log('extension id:', extId)

    await signIntoWebApp(context)
    await pairExtension(context, extId)

    // Seed the remembered track language for youtube.com so streamingAutoSync
    // loads the track silently on bind. The prompt-on-failure track dialog
    // renders unreliably under automation (root cause unknown — the page-script
    // handshake works; the dialog host just doesn't always mount), so the
    // script never depends on it.
    const [sw] = context.serviceWorkers()
    await sw.evaluate(async (lang) => {
      await chrome.storage.local.set({
        streamingLastLanguagesSynced: { 'www.youtube.com': [lang] },
      })
    }, TRACK_LANGUAGE)
    log('seeded remembered track language:', TRACK_LANGUAGE)

    const page = await context.newPage()
    await page.goto(`https://www.youtube.com/watch?v=${VIDEO_ID}`, { waitUntil: 'domcontentloaded' })
    await dismissYoutubeConsent(page)
    await page.waitForSelector('video', { timeout: 30000 })
    await skipAdsLoop(page, 60000)

    // ---- wait for tokenized subtitle words (overlay shadow DOM is open) ----
    const wordSpan = page.locator('[data-word]')
    await page.evaluate(() => document.querySelector('video')?.play())
    const wordDeadline = Date.now() + 30000
    while (Date.now() < wordDeadline) {
      if ((await wordSpan.count()) > 0) break
      await page.waitForTimeout(500)
    }
    if ((await wordSpan.count()) === 0) {
      await page.evaluate((t) => {
        const v = document.querySelector('video')
        if (v) v.currentTime = t
      }, SEEK_TO_S)
      await page.waitForTimeout(3000)
    }
    if ((await wordSpan.count()) === 0) throw new Error('no tokenized subtitle words appeared')
    log('subtitle words tokenized:', await wordSpan.count())

    // ---- pause on a line with words ----
    await page.evaluate((t) => {
      const v = document.querySelector('video')
      if (v) v.currentTime = t
    }, SEEK_TO_S)
    await page.waitForTimeout(2000)
    await page.evaluate(() => document.querySelector('video')?.pause())
    await page.waitForTimeout(1000)
    let tries = 0
    while ((await wordSpan.count()) === 0 && tries < 10) {
      await page.evaluate(() => {
        const v = document.querySelector('video')
        if (v) v.currentTime += 3
      })
      await page.waitForTimeout(1500)
      tries++
    }

    // Clean the frame: dismiss the watch-history nag, turn off YouTube's own
    // caption rendering (it double-renders behind the overlay), fullscreen.
    await page.evaluate(() => {
      const nag = [...document.querySelectorAll('button')].find((b) => /leave history off/i.test(b.textContent ?? ''))
      nag?.click()
      const cc = document.querySelector('.ytp-subtitles-button[aria-pressed="true"]')
      cc?.click()
    })
    await page.keyboard.press('f')
    await page.waitForTimeout(1500)

    const words = await wordSpan.all()
    log('words on screen:', words.length)
    await shot(page, '01-subtitle-overlay')

    // Pick the longest word on screen — better gloss target than an arbitrary
    // index. TODO(proposal): per-shot curated word targets instead.
    let target = words[0]
    let targetText = ''
    for (const w of words) {
      const text = (await w.getAttribute('data-word')) ?? ''
      if (text.length > targetText.length) {
        target = w
        targetText = text
      }
    }

    // ---- hover gloss ----
    log('hovering word:', targetText)
    await target.hover()
    await page.waitForTimeout(3500) // 300ms hover debounce + fastGloss fetch
    await shot(page, '02-hover-gloss')

    // ---- save via right-click, then saved popover ----
    await target.click({ button: 'right' })
    log('right-click save sent')
    await page.waitForTimeout(4000)
    await shot(page, '03-after-save')

    await page.mouse.move(100, 100)
    await page.waitForTimeout(800)
    await target.hover()
    await page.waitForTimeout(2500)
    await shot(page, '04-saved-popover')

    log('done — screenshots in', OUT_DIR)
  } finally {
    await context.close()
  }
}

await run()
