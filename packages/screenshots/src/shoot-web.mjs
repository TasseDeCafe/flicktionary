// Captures the web app's main screens against the seeded demo account:
// sessions list, video-session reader (gloss sheet open), text-session reader,
// session vocabulary, focus view with chat, practice exercise (correct-answer
// state), practice flashcard (front + revealed), vocabulary tab.
//
// Prereqs: dev tunnel running (pnpm dev) and the full seed done — i.e. the
// shoot:all order: seed → shoot:extension → seed → shoot:web.
//
// Run: pnpm --filter @flicktionary/screenshots shoot:web

import { connectDb } from './lib/db.mjs'
import { launch, resetProfileIfAccountChanged, shot, signIntoWebApp } from './lib/browser.mjs'
import { ensureOutDir, log, sleep, WEB_URL } from './lib/env.mjs'
import { DEMO, PRACTICE, TEXTS, VIDEOS } from './manifest.mjs'

resetProfileIfAccountChanged(DEMO.email)
ensureOutDir()

const sql = connectDb()

const demoData = async () => {
  const users = await sql`SELECT id FROM auth.users WHERE lower(email) = lower(${DEMO.email})`
  const userId = users[0]?.id
  if (!userId) throw new Error(`demo user missing — run seed first (${DEMO.email})`)

  const german = VIDEOS.find((v) => v.trackLanguage.split('-')[0] === PRACTICE.language)
  const videoSessions = await sql`
    SELECT ss.id, ss.target_language
    FROM study_sessions ss
    JOIN content_sources cs ON cs.id = ss.content_source_id
    WHERE ss.user_id = ${userId} AND ss.deleted_at IS NULL
      AND cs.type = 'youtube' AND cs.metadata::text ILIKE ${'%' + german.videoId + '%'}
    ORDER BY ss.created_at DESC LIMIT 1`
  const videoSession = videoSessions[0]
  if (!videoSession) throw new Error('German video session missing — run shoot:extension first')

  const textTitle = TEXTS[0].title
  const textSessions = await sql`
    SELECT ss.id
    FROM study_sessions ss
    JOIN content_sources cs ON cs.id = ss.content_source_id
    WHERE ss.user_id = ${userId} AND ss.deleted_at IS NULL AND cs.title = ${textTitle}
    ORDER BY ss.created_at DESC LIMIT 1`
  const textSession = textSessions[0]
  if (!textSession) throw new Error('text session missing — run seed first')

  const heroCards = await sql`
    SELECT c.id, c.study_session_id, ul.headword
    FROM cards c
    JOIN user_lookups ul ON ul.id = c.user_lookup_id
    JOIN study_sessions ss ON ss.id = c.study_session_id
    JOIN card_chat_messages m ON m.card_id = c.id
    WHERE ss.user_id = ${userId} AND c.status = 'kept'
    GROUP BY c.id, ul.headword
    ORDER BY max(m.created_at) DESC
    LIMIT 1`
  const heroCard = heroCards[0] ?? null

  const exercises = await sql`
    SELECT payload, exercise_type
    FROM practice_exercises
    WHERE user_id = ${userId} AND target_language = ${videoSession.target_language}
      AND status IN ('ready', 'used') AND payload IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50`

  return { userId, videoSession, textSession, heroCard, exercises }
}

const waitAndSettle = async (page, ms = 1200) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(ms)
}

// The gloss sheet fetches its content after opening; wait for the footer Save
// button, then give the body a beat to fill in.
const waitForGlossSheet = async (page) => {
  await page.getByRole('button', { name: /^Save$/ }).first().waitFor({ timeout: 20000 })
  await sleep(3500)
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim()

// Pull the exercise's correct answer out of the stored bank payload (answers
// are stripped from the served payload, but the DB row keeps them).
const answerFromPayload = (payload) => {
  if (typeof payload.answer === 'string') return payload.answer
  if (typeof payload.answerIndex === 'number' && Array.isArray(payload.options)) {
    return payload.options[payload.answerIndex]
  }
  if (Array.isArray(payload.acceptedForms) && payload.acceptedForms.length > 0) {
    return payload.acceptedForms[0]
  }
  return null
}

const findCorrectAnswer = (exercises, onScreenOptions) => {
  const wanted = onScreenOptions.map(normalize).sort().join('||')
  for (const { payload } of exercises) {
    if (!Array.isArray(payload?.options)) continue
    const stored = payload.options.map((o) => normalize(String(o))).sort().join('||')
    if (stored === wanted) {
      const answer = answerFromPayload(payload)
      if (answer) return normalize(String(answer))
    }
  }
  return null
}

const capturePracticeExercise = async (page, lang, exercises) => {
  await page.goto(`${WEB_URL}/practice/composed/${lang}?render=exercises_only`)
  await waitAndSettle(page, 2000)

  const typedInput = page.locator('input[placeholder="Type the missing word…"]')
  if (await typedInput.isVisible().catch(() => false)) {
    // Typed production exercise: fill the expected answer from the bank.
    const candidates = exercises.map(({ payload }) => answerFromPayload(payload ?? {})).filter(Boolean)
    for (const answer of candidates) {
      await typedInput.fill(answer)
      await page.getByRole('button', { name: 'Check' }).click()
      if (await page.getByText('Correct!').isVisible({ timeout: 4000 }).catch(() => false)) break
    }
  } else {
    // Multiple choice: options are the buttons with a keyboard badge.
    const optionButtons = page.locator('button:has(kbd)').filter({ hasNotText: /^(Hint|Skip|Next)/ })
    await optionButtons.first().waitFor({ timeout: 20000 })
    const options = await optionButtons.allInnerTexts()
    const cleaned = options.map((t) => normalize(t.replace(/^\d+\s*/, '')))
    const answer = findCorrectAnswer(exercises, cleaned)
    if (!answer) throw new Error(`could not resolve the correct answer for options: ${cleaned.join(' | ')}`)
    log(`exercise: answering "${answer}"`)
    await optionButtons.filter({ hasText: answer }).first().click()
  }

  await page.getByText('Correct!').waitFor({ timeout: 10000 })
  await sleep(600)
  await shot(page, 'web-practice-exercise-correct')
}

const capturePracticeFlashcard = async (page, lang) => {
  await page.goto(`${WEB_URL}/practice/composed/${lang}?render=flashcards_only`)
  await waitAndSettle(page, 2000)
  const show = page.getByRole('button', { name: 'Show answer' })
  await show.waitFor({ timeout: 20000 })
  await shot(page, 'web-practice-flashcard-front')
  await show.click()
  await page.getByRole('button', { name: 'Good' }).waitFor({ timeout: 10000 })
  await sleep(600)
  await shot(page, 'web-practice-flashcard-back')
}

const run = async () => {
  const data = await demoData()
  const lang = data.videoSession.target_language

  const context = await launch()
  try {
    await signIntoWebApp(context, DEMO.email)
    const page = await context.newPage()

    // 1. Sessions list.
    await page.goto(`${WEB_URL}/sessions`)
    await page.getByRole('heading', { name: 'Sessions' }).waitFor({ timeout: 20000 })
    await page.locator('a[href*="/sessions/"]').first().waitFor({ timeout: 20000 })
    await waitAndSettle(page, 2500)
    await shot(page, 'web-sessions')

    // 2. Video session reader with the gloss sheet open, on a deliberately
    // unsaved word (manifest readerGlossWord) so it shows the fresh-gloss state.
    const readerWord = VIDEOS.find((v) => v.readerGlossWord)?.readerGlossWord
    await page.goto(`${WEB_URL}/sessions/${data.videoSession.id}`)
    await page.locator('[data-segment-id]').first().waitFor({ timeout: 20000 })
    await waitAndSettle(page)
    const segment = page.locator('[data-segment-id]').filter({ hasText: readerWord }).first()
    await segment.scrollIntoViewIfNeeded()
    await sleep(400)
    await segment.getByText(readerWord, { exact: true }).first().click()
    await waitForGlossSheet(page)
    await shot(page, 'web-session-video')

    // 3. Text session reader (saved highlights visible).
    await page.goto(`${WEB_URL}/sessions/${data.textSession.id}`)
    await page.locator('[data-segment-id]').first().waitFor({ timeout: 20000 })
    await waitAndSettle(page)
    await shot(page, 'web-session-text')

    // 4. Session vocabulary list.
    await page.goto(`${WEB_URL}/sessions/${data.videoSession.id}/review`)
    await page.getByRole('heading', { name: 'Session vocabulary' }).waitFor({ timeout: 20000 })
    // Give lingering "Enriching…" rows a chance to resolve before capturing.
    const enrichingDeadline = Date.now() + 60000
    while (Date.now() < enrichingDeadline) {
      if ((await page.getByText('Enriching…').count()) === 0) break
      await sleep(2000)
    }
    await waitAndSettle(page)
    await shot(page, 'web-session-vocabulary')

    // 5. Focus view with the chat panel open.
    if (data.heroCard) {
      await page.goto(`${WEB_URL}/sessions/${data.heroCard.study_session_id}/review/${data.heroCard.id}`)
      await page.getByRole('heading', { name: /Card \d+ of \d+|./ }).first().waitFor({ timeout: 20000 })
      await waitAndSettle(page)
      await page.locator('button[aria-label^="Chat"], button[aria-label="Open chat"]').first().click()
      await page.getByRole('heading', { name: 'Chat' }).waitFor({ timeout: 20000 })
      await waitAndSettle(page, 2000)
      await shot(page, 'web-focus-chat')
    } else {
      log('WARNING: no hero card with chat — skipping web-focus-chat')
    }

    // 6 + 7. Practice: exercise correct-state, then flashcard front/back.
    await capturePracticeExercise(page, lang, data.exercises)
    await capturePracticeFlashcard(page, lang)

    // 8. Vocabulary tab.
    await page.goto(`${WEB_URL}/vocabulary`)
    await page.getByRole('heading', { name: 'Vocabulary' }).waitFor({ timeout: 20000 })
    await waitAndSettle(page, 2000)
    await shot(page, 'web-vocabulary')

    log('done')
  } finally {
    await context.close()
    await sql.end()
  }
}

await run()
