// Seeds the demo account with everything the screenshots need. Idempotent —
// run it as often as you like; it only creates what's missing.
//
// What it does (in order):
//   1. Ensures the demo user exists and is onboarded (native language, CEFR).
//   2. Creates the plain-text sources via the real import-text endpoint.
//   3. Adds curated vocabulary highlights to every existing session (the
//      YouTube sessions are created by shoot-extension.mjs, so those get their
//      vocabulary on the second seed pass — see shoot:all).
//   4. Waits for the real enrichment pipeline to turn highlights into cards
//      (requires the backend running with an Anthropic key, i.e. pnpm dev).
//   5. Seeds one real card-chat exchange on the hero card.
//   6. Shapes practice state: promotes some facets to due review flashcards,
//      composes the practice queue once (which parks the rest into warm-up and
//      fires exercise generation), then waits for ready exercises.
//
// Prereq: dev tunnel running (web + backend + dev-tunnel Supabase).
// Run: pnpm --filter @flicktionary/screenshots seed

import { adminClient, ensureUser, ensureUserMetadataEmail, mintAccessToken } from './lib/supabase.mjs'
import { apiClient } from './lib/api.mjs'
import { connectDb } from './lib/db.mjs'
import { log, sleep } from './lib/env.mjs'
import { CHAT, DEMO, PRACTICE, TEXTS, VIDEOS } from './manifest.mjs'

const sql = connectDb()
const admin = adminClient()

const findUserId = async (email) => {
  const rows = await sql`SELECT id FROM auth.users WHERE lower(email) = lower(${email})`
  return rows[0]?.id ?? null
}

const findTextSession = async (userId, title) => {
  const rows = await sql`
    SELECT ss.id, ss.text_track_id
    FROM study_sessions ss
    JOIN content_sources cs ON cs.id = ss.content_source_id
    WHERE ss.user_id = ${userId} AND ss.deleted_at IS NULL AND cs.title = ${title}
    ORDER BY ss.created_at DESC
    LIMIT 1`
  return rows[0] ?? null
}

const findVideoSession = async (userId, videoId) => {
  const rows = await sql`
    SELECT ss.id, ss.text_track_id, ss.target_language
    FROM study_sessions ss
    JOIN content_sources cs ON cs.id = ss.content_source_id
    WHERE ss.user_id = ${userId} AND ss.deleted_at IS NULL
      AND cs.type = 'youtube' AND cs.metadata::text ILIKE ${'%' + videoId + '%'}
    ORDER BY ss.created_at DESC
    LIMIT 1`
  return rows[0] ?? null
}

// Creates a highlight per word through the real endpoint (so enrichment runs),
// locating each word's segment and character offsets from the stored track.
const ensureHighlights = async (api, session, words) => {
  const existing = await sql`SELECT selection_text FROM highlights WHERE study_session_id = ${session.id}`
  const have = new Set(existing.map((row) => row.selection_text.toLowerCase()))
  for (const word of words) {
    if (have.has(word.toLowerCase())) continue
    const segments = await sql`
      SELECT id, text FROM text_segments
      WHERE text_track_id = ${session.text_track_id} AND text ILIKE ${'%' + word + '%'}
      ORDER BY index
      LIMIT 1`
    if (segments.length === 0) {
      log(`  ! word not found in any segment, skipping: ${word}`)
      continue
    }
    const { id: segmentId, text } = segments[0]
    let start = text.indexOf(word)
    let selection = word
    if (start === -1) {
      start = text.toLowerCase().indexOf(word.toLowerCase())
      selection = text.slice(start, start + word.length)
    }
    await api.createHighlight(session.id, {
      startSegmentId: segmentId,
      endSegmentId: segmentId,
      startOffset: start,
      endOffset: start + word.length,
      selectionText: selection,
    })
    log(`  highlight created: ${selection}`)
  }
}

// Enrichment turns each highlight into a kept card in the background; poll
// until no highlight is left without one.
const waitForEnrichment = async (userId, timeoutMs = 6 * 60 * 1000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = await sql`
      SELECT count(*)::int AS pending
      FROM highlights h
      JOIN study_sessions ss ON ss.id = h.study_session_id
      LEFT JOIN cards c ON c.highlight_id = h.id AND c.status <> 'removed'
      WHERE ss.user_id = ${userId} AND (c.id IS NULL OR c.status = 'needs_data')`
    const pending = rows[0].pending
    if (pending === 0) {
      log('enrichment: all highlights have kept cards')
      return
    }
    if (Date.now() > deadline) {
      log(`enrichment: WARNING — ${pending} highlight(s) still unenriched after timeout; is the backend running?`)
      return
    }
    log(`enrichment: waiting on ${pending} highlight(s)…`)
    await sleep(5000)
  }
}

const findHeroCard = async (userId) => {
  for (const pattern of CHAT.cardHeadwordLike) {
    const rows = await sql`
      SELECT c.id, ul.headword
      FROM cards c
      JOIN user_lookups ul ON ul.id = c.user_lookup_id
      JOIN study_sessions ss ON ss.id = c.study_session_id
      WHERE ss.user_id = ${userId} AND c.status = 'kept' AND ul.headword ILIKE ${pattern}
      ORDER BY c.created_at DESC
      LIMIT 1`
    if (rows[0]) return rows[0]
  }
  return null
}

// Turn the oldest warm-up facets into plausible due review flashcards. All
// practice day-logic compares against Postgres now(), so backdating srs
// fields is exactly equivalent to the terms having been studied days ago.
// Count-based (not a word list) so it survives whatever lemma enrichment
// picks as the headword.
const promoteFacetsToReview = async (userId, targetLanguage, count) => {
  const rows = await sql`
    UPDATE study_facets sf SET
      srs_state = 'review',
      srs_due = now() - interval '2 hours',
      srs_stability = 4.5,
      srs_difficulty = 5.2,
      srs_reps = 3,
      srs_lapses = 0,
      srs_last_review = now() - interval '3 days',
      introduced_at = COALESCE(sf.introduced_at, now() - interval '5 days'),
      leech_parked_at = NULL
    WHERE sf.id IN (
      SELECT sf2.id
      FROM study_facets sf2
      JOIN user_lookups ul ON ul.id = sf2.user_lookup_id
      WHERE sf2.user_id = ${userId}
        AND sf2.target_language = ${targetLanguage}
        AND sf2.skill = 'meaning_recognition'
        AND sf2.target_form = ''
        AND ul.deleted_at IS NULL AND ul.count > 0
      ORDER BY ul.created_at
      LIMIT ${count}
    )
    RETURNING (SELECT headword FROM user_lookups WHERE id = sf.user_lookup_id) AS headword`
  log(`practice: promoted ${rows.length} facet(s) to due review: ${rows.map((r) => r.headword).join(', ')}`)
}

const waitForExercises = async (userId, targetLanguage, minReady = 2, timeoutMs = 5 * 60 * 1000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = await sql`
      SELECT count(*)::int AS ready
      FROM practice_exercises
      WHERE user_id = ${userId} AND target_language = ${targetLanguage} AND status = 'ready'`
    if (rows[0].ready >= minReady) {
      log(`practice: ${rows[0].ready} exercise(s) ready`)
      return
    }
    if (Date.now() > deadline) {
      log(`practice: WARNING — only ${rows[0].ready} exercise(s) ready after timeout`)
      return
    }
    log(`practice: waiting for exercises (${rows[0].ready}/${minReady} ready)…`)
    await sleep(5000)
  }
}

const run = async () => {
  // 1. Account + onboarding.
  await ensureUser(admin, DEMO.email)
  const userId = await findUserId(DEMO.email)
  if (!userId) throw new Error(`user not found after creation: ${DEMO.email}`)
  await ensureUserMetadataEmail(admin, userId, DEMO.email)
  // The app row normally created by the web signup flow; admin-created auth
  // users skip it, so mirror users-repository.insertUser here.
  await sql`INSERT INTO public.users (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`

  // --reset wipes the account's content so a curation change (new video, new
  // word list) starts clean. Sessions go first (cascades cards/highlights/
  // chat), which satisfies the cards→user_lookups RESTRICT before lookups
  // (cascading facets/exercises) are deleted. Auth user, onboarding, and
  // extension pairing survive. Orphaned content_sources rows are harmless.
  if (process.argv.includes('--reset')) {
    log('resetting demo account content…')
    await sql`DELETE FROM study_sessions WHERE user_id = ${userId}`
    await sql`DELETE FROM user_lookups WHERE user_id = ${userId}`
    await sql`DELETE FROM practice_texts WHERE user_id = ${userId}`
  }
  const api = apiClient(await mintAccessToken(admin, DEMO.email))
  await api.completeOnboarding(DEMO.nativeLanguage)
  for (const { language, level } of DEMO.cefr) {
    await api.setCefrForLanguage(language, level)
  }
  log(`account ready: ${DEMO.email} (${userId})`)

  // 2. Text sources + their highlights.
  for (const t of TEXTS) {
    let session = await findTextSession(userId, t.title)
    if (!session) {
      const res = await api.importText({ title: t.title, text: t.text })
      session = { id: res.data.sessionId, text_track_id: res.data.textTrackId }
      log(`text source created: ${t.title}`)
    }
    await ensureHighlights(api, session, t.highlights)
  }

  // 3. Video-session vocabulary (sessions exist only after shoot-extension ran).
  let practiceLanguage = null
  for (const v of VIDEOS) {
    const session = await findVideoSession(userId, v.videoId)
    if (!session) {
      log(`no session yet for ${v.label} video — run shoot:extension, then seed again`)
      continue
    }
    log(`seeding vocabulary for ${v.label} video session`)
    await ensureHighlights(api, session, v.vocabulary)
    if (session.target_language === PRACTICE.language) practiceLanguage = session.target_language
  }

  // 4. Enrichment.
  await waitForEnrichment(userId)

  // 5. Card chat.
  const hero = await findHeroCard(userId)
  if (hero) {
    const count = await sql`SELECT count(*)::int AS n FROM card_chat_messages WHERE card_id = ${hero.id}`
    if (count[0].n === 0) {
      log(`chat: asking about "${hero.headword}"…`)
      await api.sendCardChatMessage(hero.id, CHAT.question)
      log('chat: exchange seeded')
    } else {
      log('chat: already seeded')
    }
  } else {
    log('chat: hero card not found yet (run shoot:extension + seed again)')
  }

  // 6. Practice shaping.
  if (practiceLanguage) {
    await promoteFacetsToReview(userId, practiceLanguage, PRACTICE.promoteCount)
    await api.composePracticeQueue(practiceLanguage)
    await waitForExercises(userId, practiceLanguage)
  } else {
    log('practice: skipped (no practice-language video session yet)')
  }

  log('seed complete')
}

try {
  await run()
} finally {
  await sql.end()
}
