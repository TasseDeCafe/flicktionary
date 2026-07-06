import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { adminClient, mintTokenHash } from './supabase.mjs'
import { EXTENSION_PATH, OUT_DIR, UBOLITE_DIR, USER_DATA_DIR, WEB_URL, log } from './env.mjs'

// The persistent profile keeps sign-in/pairing across runs, but it is bound to
// one account: if the manifest email changes, the profile is wiped so the run
// can't silently capture another account's data.
const ACCOUNT_MARKER = path.join(USER_DATA_DIR, '.account')

export const resetProfileIfAccountChanged = (email) => {
  if (!fs.existsSync(USER_DATA_DIR)) return
  const current = fs.existsSync(ACCOUNT_MARKER) ? fs.readFileSync(ACCOUNT_MARKER, 'utf8').trim() : null
  if (current !== email) {
    log(`profile belongs to ${current ?? 'an unknown account'}, wiping for ${email}`)
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })
  }
}

const markProfileAccount = (email) => {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true })
  fs.writeFileSync(ACCOUNT_MARKER, email)
}

export const launch = ({ withExtension = false } = {}) => {
  // uBlock Origin Lite rides along (when downloaded) so YouTube captures
  // aren't interrupted by ads.
  const extensionPaths = [EXTENSION_PATH, fs.existsSync(path.join(UBOLITE_DIR, 'manifest.json')) ? UBOLITE_DIR : null]
    .filter(Boolean)
    .join(',')
  return chromium.launchPersistentContext(USER_DATA_DIR, {
    // Extensions need a real (headed) Chromium; keep web captures headed too so
    // both scripts render identically.
    headless: false,
    // Chrome Web Store screenshot size.
    viewport: { width: 1280, height: 800 },
    args: [
      ...(withExtension ? [`--disable-extensions-except=${extensionPaths}`, `--load-extension=${extensionPaths}`] : []),
      '--mute-audio',
      '--lang=en-US',
      '--disable-blink-features=AutomationControlled',
    ],
  })
}

export const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) })
  log('screenshot:', name)
}

// Sign into the web app without email round-trips: mint a magic-link token
// hash via the local Supabase admin API and drive the verify route.
export const signIntoWebApp = async (context, email) => {
  const page = await context.newPage()
  await page.goto(`${WEB_URL}/sessions`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  if (!page.url().includes('/login')) {
    log('web app: already signed in')
    await page.close()
    return
  }
  log('web app: signing in via minted magic link')
  const tokenHash = await mintTokenHash(adminClient(), email)
  await page.goto(`${WEB_URL}/login/email/verify?token_hash=${encodeURIComponent(tokenHash)}`)
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForURL(/\/(sessions|onboarding)/, { timeout: 20000 })
  if (page.url().includes('/onboarding')) {
    throw new Error('account is not onboarded — run the seed script first (pnpm --filter @flicktionary/screenshots seed)')
  }
  markProfileAccount(email)
  log('web app: signed in')
  await page.close()
}

// ---------------------------------------------------------------- youtube
export const dismissYoutubeConsent = async (page, ms = 15000) => {
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

export const skipAdsLoop = async (page, ms) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    // YouTube renames the skip button's class regularly — match real, visible
    // <button>s by class prefix or text, and click via JS (the overlayed
    // button doesn't always take a trusted Playwright click).
    const clicked = await page
      .evaluate(() => {
        const target = [...document.querySelectorAll('.ad-showing button, [class*="ytp-ad-skip"] button')].find(
          (b) =>
            b.offsetParent !== null &&
            (/^\s*skip\b/i.test(b.textContent ?? '') || /ytp-(ad-)?skip/.test(b.className ?? ''))
        )
        if (target) {
          target.click()
          return true
        }
        return false
      })
      .catch(() => false)
    if (clicked) log('youtube: skipped ad')
    if ((await page.locator('.ad-showing').count()) === 0) return
    await page.waitForTimeout(1000)
  }
  log('youtube: WARNING — ad still showing after skip window')
}

// Dismiss the watch-history nag and YouTube's own caption rendering (it
// double-renders behind the overlay).
export const cleanYoutubeFrame = async (page) => {
  await page.evaluate(() => {
    const nag = [...document.querySelectorAll('button')].find((b) => /leave history off/i.test(b.textContent ?? ''))
    nag?.click()
    const cc = document.querySelector('.ytp-subtitles-button[aria-pressed="true"]')
    cc?.click()
  })
}
