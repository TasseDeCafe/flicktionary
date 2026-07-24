import { expect, type Mock } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  buildAuthorizationHeaders,
} from '../../test/test-utils'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { sql } from '../../transport/database/postgres-client'

// Shared fixtures for the checkpoint-review integration tests
// (study-sessions-checkpoints / study-sessions-assert-known).

// Test words are nonsense Russian words with per-test unique CYRILLIC
// suffixes (mixed-script suffixes would make Intl.Segmenter split them): the
// shared test DB is never reset, and matching keys on exact folded strings,
// so suffixed words are fully isolated.
const CYRILLIC = 'абвгдежзиклмнопрстуфхцчшщыэюя'
export const uniqueCyrillicSuffix = (): string =>
  [...__generateUniqueId('').replace(/[^a-z0-9]/g, '')].map((c) => CYRILLIC[parseInt(c, 36) % CYRILLIC.length]).join('')

const REAL_LEMMA_DATA = { head_templates: [{ name: 'head' }], senses: [{ glosses: ['test gloss'] }] }

// The ranks-manifest supported gate (difficulty AND the mark-known sweep)
// needs a build row for ru; the shared test DB is never reset, so an
// idempotent insert is safe across parallel files.
export const ensureRuLemmaRankManifest = async (): Promise<void> => {
  await sql`
    INSERT INTO public.lemma_rank_builds (target_language, version, wordfreq_version, row_count, mass_matched_pct)
    VALUES ('ru', 1, 'test', 0, 99)
    ON CONFLICT (target_language) DO NOTHING
  `
}

export const insertWiktionaryLemma = async (headword: string, forms: string[]): Promise<void> => {
  const [row] = (await sql`
    INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
    VALUES ('ru', ${headword}, 'noun', ${sql.json(REAL_LEMMA_DATA)})
    RETURNING id
  `) as [{ id: number }]
  for (const form of forms) {
    await sql`
      INSERT INTO public.wiktionary_forms (target_language, form, entry_id)
      VALUES ('ru', ${form}, ${row.id})
      ON CONFLICT DO NOTHING
    `
  }
}

export const adhocChunk = (headword: string, sense: string) => ({
  source: 'highlight' as const,
  headword,
  sense,
  surfaceForm: headword,
  segmentId: 'rebound-to-the-real-segment',
  translation: 'translation',
  surfaceTranslation: null,
  definition: 'определение',
  targetExample: null,
  nativeExample: null,
  grammar: { pos: 'noun' },
  belowCefr: false,
  zipf: 3.0,
})

export type FacetPatch = {
  state?: 'new' | 'learning' | 'review' | 'relearning' | null
  dueOffsetDays?: number
  leechParked?: boolean
}

export const patchRecognitionFacet = async (userLookupId: string, patch: FacetPatch): Promise<void> => {
  const state = patch.state ?? null
  const due = patch.dueOffsetDays
  await sql`
    UPDATE public.study_facets
    SET srs_state = ${state},
        srs_due = ${due === undefined ? null : sql`NOW() + ${`${due} days`}::interval`},
        srs_stability = ${state === null ? null : 5},
        srs_difficulty = ${state === null ? null : 5},
        srs_last_review = ${state === null ? null : sql`NOW() - INTERVAL '5 days'`},
        srs_reps = ${state === null ? 0 : 3},
        leech_parked_at = ${patch.leechParked ? sql`NOW()` : null}
    WHERE user_lookup_id = ${userLookupId}
      AND skill = 'meaning_recognition'
      AND target_form = ''
  `
}

export type RecognitionFacetState = {
  srs_state: string | null
  srs_due: string | null
  srs_stability: number | null
  srs_reps: number
  introduced_at: string | null
  leech_parked_at: string | null
  leech_rehab_correct_days: number
  leech_rehab_last_correct_on: string | null
}

export const getRecognitionFacet = async (userLookupId: string): Promise<RecognitionFacetState | null> => {
  const rows = (await sql`
    SELECT srs_state, srs_due, srs_stability, srs_reps, introduced_at,
      leech_parked_at, leech_rehab_correct_days, leech_rehab_last_correct_on
    FROM public.study_facets
    WHERE user_lookup_id = ${userLookupId} AND skill = 'meaning_recognition' AND target_form = ''
  `) as RecognitionFacetState[]
  return rows[0] ?? null
}

export const setupCheckpointUser = async (testApp: Express): Promise<{ userId: string; token: string }> => {
  const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
  await __createOrGetUserWithOurApi({ testApp, token, referral: null })
  await UsersRepository().setNativeLanguage(id, 'en')
  await UserTargetLanguagePrefsRepository().upsertCefr(id, 'ru', 'B1')
  return { userId: id, token }
}

export const saveAdhocTerm = async (
  testApp: Express,
  token: string,
  basicDataPass: Mock,
  targetLanguage: string,
  headword: string,
  sense: string
): Promise<string> => {
  basicDataPass.mockResolvedValueOnce([adhocChunk(headword, sense)])
  const created = await request(testApp)
    .post('/api/v1/cards/adhoc')
    .set(buildAuthorizationHeaders(token))
    .send({ targetLanguage, headword, context: null })
  expect(created.status).toBe(200)
  const card = await request(testApp)
    .get(`/api/v1/cards/${created.body.data.cardId}`)
    .set(buildAuthorizationHeaders(token))
  expect(card.status).toBe(200)
  return card.body.data.userLookupId as string
}

// A dedicated reading session (NOT the adhoc session): adhoc card saves
// create highlights in the adhoc session, and highlight suppression would
// correctly suppress every credit there.
export const createReadingSession = async (
  userId: string,
  targetLanguage: string
): Promise<{ id: string; text_track_id: string }> => {
  const [source] = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES ('text', 'checkpoint test', ${targetLanguage}, '{}'::jsonb, ${userId})
    RETURNING id
  `) as [{ id: string }]
  const [track] = (await sql`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (${source.id}, 'paste', ${targetLanguage}, NULL, ${__generateUniqueId('track')})
    RETURNING id
  `) as [{ id: string }]
  const [session] = (await sql`
    INSERT INTO public.study_sessions (user_id, content_source_id, text_track_id, native_language, target_language, cefr_level)
    VALUES (${userId}, ${source.id}, ${track.id}, 'en', ${targetLanguage}, 'B1')
    RETURNING *
  `) as [{ id: string; text_track_id: string }]
  return session
}

export const appendSegment = async (textTrackId: string, text: string): Promise<number> => {
  const segment = await TextSegmentsRepository().appendSegmentAtomic({ textTrackId, text, startMs: null, endMs: null })
  return segment.index
}
