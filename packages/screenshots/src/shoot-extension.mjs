// Captures the extension's in-video surfaces on YouTube, driven by the shot
// manifest (src/manifest.mjs): per video — subtitle overlay, hover-gloss
// popover on a curated word, saved popover, and (German) a multi-word phrase
// selection with its chunk gloss.
//
// Side effect by design: saving the hero word/phrase creates the YouTube study
// sessions + highlights on the demo account — the seed script builds on them.
// Reruns are idempotent: an already-saved target is unsaved (right-click
// toggle) and re-saved so every capture shows the same fresh state.
//
// Prereqs: dev tunnel running (pnpm dev), a dev-config extension build
// (pnpm --filter flicktionaryextension build:dev), and the seed script run
// once (onboarding). First time: playwright:install.
//
// Run: pnpm --filter @flicktionary/screenshots shoot:extension [-- --fresh]

import fs from 'node:fs'
import path from 'node:path'
import {
  cleanYoutubeFrame,
  dismissYoutubeConsent,
  launch,
  resetProfileIfAccountChanged,
  shot,
  signIntoWebApp,
  skipAdsLoop,
} from './lib/browser.mjs'
import { ensureOutDir, EXTENSION_PATH, log, sleep, USER_DATA_DIR } from './lib/env.mjs'
import { ensureUbolite } from './lib/ubolite.mjs'
import { DEMO, VIDEOS } from './manifest.mjs'

const GLOSS_POPOVER = '[data-flicktionary-gloss-popover]'
const SAVED_POPOVER = '[data-flicktionary-saved-popover]'
// Saved words paint yellow (SAVED_SPAN_CLASS in the overlay).
const SAVED_CLASS = 'bg-yellow-400/20'

if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
  throw new Error(`No extension build at ${EXTENSION_PATH} — run: pnpm --filter flicktionaryextension build:dev`)
}
if (process.argv.includes('--fresh')) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })
resetProfileIfAccountChanged(DEMO.email)
ensureOutDir()

// With uBOLite riding along there are two extension service workers; the
// Flicktionary one is the only one shipping popup-ui.html.
const getExtensionId = async (context) => {
  const probe = await context.newPage()
  const deadline = Date.now() + 15000
  try {
    while (Date.now() < deadline) {
      for (const worker of context.serviceWorkers()) {
        const id = new URL(worker.url()).host
        const res = await probe.goto(`chrome-extension://${id}/popup-ui.html`).catch(() => null)
        if (res?.ok()) return id
      }
      await sleep(500)
    }
  } finally {
    await probe.close()
  }
  throw new Error('Flicktionary extension service worker not found')
}

const getExtensionWorker = (context, extId) =>
  context.serviceWorkers().find((w) => new URL(w.url()).host === extId)

const pairExtension = async (context, extId) => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup-ui.html`)
  await popup.waitForTimeout(1500)
  if ((await popup.getByText(/Signed in as/i).count()) === 0) {
    log('extension: pairing...')
    popup.on('console', (msg) => {
      if (msg.type() === 'error') log('popup console error:', msg.text().slice(0, 300))
    })
    await popup.getByRole('button', { name: /Sign in with Flicktionary/i }).click()
    try {
      await popup.getByText(/Signed in as/i).waitFor({ timeout: 30000 })
    } catch (error) {
      await shot(popup, 'debug-popup-pairing-failed')
      throw error
    }
    log('extension: paired')
  } else {
    log('extension: already paired')
  }
  await shot(popup, '00-popup-paired')
  await popup.close()
}

const seekTo = (page, t) =>
  page.evaluate((s) => {
    const v = document.querySelector('video')
    if (v) v.currentTime = s
  }, t)

const pauseVideo = (page) => page.evaluate(() => document.querySelector('video')?.pause())
const playVideo = (page) => page.evaluate(() => document.querySelector('video')?.play())

const sameWord = (a, b) => (a ?? '').normalize('NFC').toLowerCase() === (b ?? '').normalize('NFC').toLowerCase()

// First on-screen span whose data-word matches (case-insensitive, so ASR
// tracks with lowercased text still match the manifest word).
const findWordSpan = async (page, word) => {
  const spans = await page.locator('[data-word]').all()
  for (const span of spans) {
    if (sameWord(await span.getAttribute('data-word'), word)) return span
  }
  return null
}

// Seek near the target time (paused) until the wanted word is on screen. ASR
// re-chunking can shift cue boundaries, so scan forward in small steps. A
// whole scan pass can be eaten by a mid-roll ad break (server-stitched ads
// swallow seeks and `.ad-showing` can stick around) — between passes, try the
// skip button and let playback run a few seconds so the player clears the
// break itself.
const showCueWithWord = async (page, word, seekToS) => {
  for (let pass = 0; pass < 3; pass += 1) {
    for (let offset = -1; offset <= 6; offset += 1) {
      await seekTo(page, seekToS + offset)
      await page.waitForTimeout(1200)
      await pauseVideo(page)
      await disableYoutubeCaptions(page)
      await page.waitForTimeout(500)
      const span = await findWordSpan(page, word)
      if (span) return span
    }
    log(`"${word}" not found in scan pass ${pass + 1} — letting playback clear any ad break`)
    await skipAdsLoop(page, 45000)
    await playVideo(page)
    await page.waitForTimeout(4000)
  }
  const onScreen = await Promise.all((await page.locator('[data-word]').all()).map((s) => s.getAttribute('data-word')))
  const videoTime = await page.evaluate(() => document.querySelector('video')?.currentTime)
  await shot(page, 'debug-cue-not-found')
  throw new Error(
    `word "${word}" never appeared around t=${seekToS}s (video at ${videoTime}s, on screen: ${onScreen.join(' ')})`
  )
}

// The popover mounts immediately but its gloss body fills in after the fetch;
// capture only once the loading skeletons are gone and the text has settled.
const waitForGlossLoaded = async (page, selector = GLOSS_POPOVER) => {
  const popover = page.locator(selector)
  await popover.waitFor({ timeout: 20000 })
  const deadline = Date.now() + 25000
  let prev = ''
  while (Date.now() < deadline) {
    const text = (await popover.innerText().catch(() => '')).trim()
    const skeletons = await popover.locator('[data-slot="skeleton"]').count()
    if (skeletons === 0 && text.length > 30 && text === prev) return
    prev = text
    await sleep(700)
  }
  log('WARNING: gloss popover did not settle, capturing anyway')
}

// YouTube's own caption renderer double-renders behind the overlay, and it can
// switch on when the extension syncs the track — force it off (idempotent).
const disableYoutubeCaptions = (page) =>
  page.evaluate(() => {
    document.querySelector('.ytp-subtitles-button[aria-pressed="true"]')?.click()
  })

// The player controls (title, progress bar) fade ~3s after the last mouse
// move; wait them out so captures show a clean frame.
const settleForShot = () => sleep(3300)

const isSavedSpan = async (span) => ((await span.getAttribute('class')) ?? '').includes(SAVED_CLASS)

// Right-click toggles save/remove in place; used to reset an already-saved
// target on reruns so the fresh-gloss shot exists every run.
const unsaveSpan = async (page, span) => {
  await span.click({ button: 'right' })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (!(await isSavedSpan(span))) break
    await sleep(400)
  }
  // Re-seek to clear any popover the toggle left open.
  await page.mouse.move(40, 40)
  await sleep(600)
}

const captureGlossAndSave = async (page, video) => {
  const { word, seekToS } = video.gloss
  let span = await showCueWithWord(page, word, seekToS)
  await settleForShot()
  await shot(page, `ext-${video.label}-overlay`)

  if (await isSavedSpan(span)) {
    log(`"${word}" already saved — unsaving for a fresh capture`)
    await unsaveSpan(page, span)
    span = await showCueWithWord(page, word, seekToS)
  }

  log(`hovering word: ${word}`)
  await span.hover()
  await waitForGlossLoaded(page)
  await settleForShot()
  await shot(page, `ext-${video.label}-gloss-popover`)

  // The hover preview isn't pinned and can re-render/detach under the click —
  // fall back to right-click save (the toggle needs no popover) if it does.
  try {
    await page.locator(GLOSS_POPOVER).getByRole('button', { name: /^Save$/ }).click({ timeout: 8000 })
  } catch {
    log('popover Save click failed — saving via right-click')
    await span.click({ button: 'right' })
  }
  await page.locator(SAVED_POPOVER).waitFor({ timeout: 20000 }).catch(async () => {
    // Saved popover didn't morph in — re-hover the (now saved) word to open it.
    await page.mouse.move(40, 40)
    await sleep(800)
    await span.hover()
  })
  await page.locator(SAVED_POPOVER).waitFor({ timeout: 20000 })
  await waitForGlossLoaded(page, SAVED_POPOVER)
  await settleForShot()
  await shot(page, `ext-${video.label}-saved-popover`)
}

const captureMultiword = async (page, video) => {
  const { words, seekToS } = video.multiword
  await showCueWithWord(page, words[words.length - 1], seekToS)

  // Find the consecutive run of spans matching the phrase.
  const spans = await page.locator('[data-word]').all()
  const texts = await Promise.all(spans.map((s) => s.getAttribute('data-word')))
  let startIndex = -1
  for (let i = 0; i + words.length <= texts.length; i += 1) {
    if (words.every((w, j) => sameWord(texts[i + j], w))) {
      startIndex = i
      break
    }
  }
  if (startIndex === -1) throw new Error(`phrase "${words.join(' ')}" not found on screen`)
  const phraseSpans = spans.slice(startIndex, startIndex + words.length)

  for (const span of phraseSpans) {
    if (await isSavedSpan(span)) {
      log('phrase already saved — unsaving for a fresh capture')
      await unsaveSpan(page, span)
      await showCueWithWord(page, words[words.length - 1], seekToS)
      return captureMultiword(page, video)
    }
  }

  // Drag across the phrase: mousedown on the first word, move through each
  // following word (the overlay extends the selection on word mouseenter),
  // mouseup opens the pinned chunk gloss.
  const boxes = []
  for (const span of phraseSpans) boxes.push(await span.boundingBox())
  log(`selecting phrase: ${words.join(' ')}`)
  await page.mouse.move(boxes[0].x + boxes[0].width / 2, boxes[0].y + boxes[0].height / 2)
  await page.mouse.down()
  for (const box of boxes.slice(1)) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
    await sleep(120)
  }
  await page.mouse.up()

  await waitForGlossLoaded(page)
  await settleForShot()
  await shot(page, `ext-${video.label}-multiword-selection`)

  // Save the phrase too — it becomes the hero card the web shots build on.
  await page.locator(GLOSS_POPOVER).getByRole('button', { name: /^Save$/ }).click()
  await page.locator(SAVED_POPOVER).waitFor({ timeout: 20000 })
  await waitForGlossLoaded(page, SAVED_POPOVER)
  await settleForShot()
  await shot(page, `ext-${video.label}-multiword-saved`)
}

const run = async () => {
  await ensureUbolite()
  const context = await launch({ withExtension: true })
  try {
    const extId = await getExtensionId(context)
    log('extension id:', extId)

    await signIntoWebApp(context, DEMO.email)
    await pairExtension(context, extId)

    const page = await context.newPage()
    for (const video of VIDEOS) {
      log(`--- video: ${video.label} (${video.videoId}) ---`)

      // Seed the remembered track language so streamingAutoSync loads the
      // track silently on bind (the prompt-on-failure dialog mounts
      // unreliably under automation).
      const sw = getExtensionWorker(context, extId)
      await sw.evaluate(async (lang) => {
        await chrome.storage.local.set({
          streamingLastLanguagesSynced: { 'www.youtube.com': [lang] },
        })
      }, video.trackLanguage)

      await page.goto(`https://www.youtube.com/watch?v=${video.videoId}`, { waitUntil: 'domcontentloaded' })
      await dismissYoutubeConsent(page)
      await page.waitForSelector('video', { timeout: 30000 })
      await skipAdsLoop(page, 60000)

      // Play until the overlay tokenizes subtitle words.
      await playVideo(page)
      const wordSpan = page.locator('[data-word]')
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        if ((await wordSpan.count()) > 0) break
        await page.waitForTimeout(500)
      }
      if ((await wordSpan.count()) === 0) throw new Error('no tokenized subtitle words appeared')

      await cleanYoutubeFrame(page)
      await page.keyboard.press('f')
      await page.waitForTimeout(1500)

      await captureGlossAndSave(page, video)
      if (video.multiword) await captureMultiword(page, video)

      await page.keyboard.press('f')
      await page.waitForTimeout(800)
    }
    log('done')
  } finally {
    await context.close()
  }
}

await run()
