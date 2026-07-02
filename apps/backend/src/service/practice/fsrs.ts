import { FSRS, generatorParameters, createEmptyCard, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import type { DbUserLookupWithFacet, SrsState } from '../../transport/database/user-lookups/user-lookups-repository'
import { poolForSkill } from '../../transport/database/study-facets/study-facets-repository'
import { SOFT_REENTRY_DIFFICULTY, SOFT_REENTRY_STABILITY } from './leech-config'

// Recognition-pool facets schedule against a lower desired retention: adding
// terms is cheap and recognition is the default pool every kept term lands in,
// so we accept ~80% recall in exchange for ~2.4x longer intervals. Production
// keeps the FSRS default (0.9) — active recall is the skill worth drilling
// tightly. The lapse-rate consequence is absorbed by the per-pool leech
// threshold in leech-config.ts.
const RECOGNITION_REQUEST_RETENTION = 0.8
const recognitionFsrs = new FSRS(
  generatorParameters({ enable_fuzz: true, request_retention: RECOGNITION_REQUEST_RETENTION })
)
const productionFsrs = new FSRS(generatorParameters({ enable_fuzz: true }))

export type AppRating = 'again' | 'hard' | 'good' | 'easy'

const RATING_MAP: Record<AppRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const STATE_TO_DB: Record<State, SrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const DB_TO_STATE: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}

// Convert a facet's FSRS columns into a ts-fsrs Card. The facet already encodes
// the pool (via its skill), so there is a single column family to read. If the
// state column is null (the facet has never been reviewed) we return null and
// the caller seeds with createEmptyCard.
const facetToFsrs = (row: DbUserLookupWithFacet): FsrsCard | null => {
  if (row.srs_state == null || row.srs_due == null) return null
  const lastReview = row.srs_last_review ? new Date(row.srs_last_review) : undefined
  return {
    due: new Date(row.srs_due),
    stability: row.srs_stability ?? 0,
    difficulty: row.srs_difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.srs_reps,
    lapses: row.srs_lapses,
    state: DB_TO_STATE[row.srs_state],
    last_review: lastReview,
  }
}

export type FsrsResult = {
  state: SrsState
  due: Date
  stability: number
  difficulty: number
  lastReview: Date
  reps: number
  lapses: number
}

// Recognition-pool terms the user got right are never rescheduled sooner than this far
// out. FSRS's intraday learning/relearning steps (minutes away) would otherwise
// surface as straggler follow-ups right after a session ends, requiring a fresh
// session to clear. Clamping the output `due` to a next-day floor means finishing
// a session leaves nothing immediately due. We deliberately do NOT clamp `again`:
// in-session redrilling of misses is driven by ratings (the "stubborn" path), not
// `srs_due`, and if a missed term gets abandoned before its retry we want it to
// stay due soon rather than be pushed a full day out. `now + 24h` matches how
// FSRS already expresses review intervals (offsets from `now`, not midnight).
const MIN_RECOGNITION_INTERVAL_MS = 24 * 60 * 60 * 1000

// Apply a rating event to a row. For never-reviewed rows the FSRS library's
// createEmptyCard provides the seed; the rating then transitions it into
// learning/review with computed intervals. The pool argument selects which
// SRS column family backs the card state.
// SRS values for a leech graduating out of rehab. A softened schedule rather
// than the pre-park one (which was demonstrably failing): review state, due
// tomorrow, low stability, raised difficulty. reps/lapses are deliberately NOT
// part of this result — history is preserved on the row, and the explicit
// parked_at flag (not the lapse count) is the re-park gate. This is written
// directly via unparkAndSoftReentry, NOT through applyRating, so the
// MIN_RECOGNITION_INTERVAL floor doesn't interfere and no FSRS transition runs.
export type SoftReentryResult = {
  state: SrsState
  due: Date
  stability: number
  difficulty: number
  lastReview: Date
}

export const softReentryResult = (now: Date): SoftReentryResult => ({
  state: 'review',
  due: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  stability: SOFT_REENTRY_STABILITY,
  difficulty: SOFT_REENTRY_DIFFICULTY,
  lastReview: now,
})

export const applyRating = (row: DbUserLookupWithFacet, rating: AppRating, now: Date): FsrsResult => {
  // Both the scheduler instance (recognition's lower desired retention) and the
  // next-day floor key off the facet's pool — recognition is meaning_recognition
  // AND pronunciation (Phase 4).
  const isRecognition = poolForSkill(row.skill) === 'recognition'
  const fsrs = isRecognition ? recognitionFsrs : productionFsrs
  const existing = facetToFsrs(row)
  const card: FsrsCard = existing ?? createEmptyCard(now)
  const result = fsrs.next(card, now, RATING_MAP[rating])
  const next = result.card
  const floor = now.getTime() + MIN_RECOGNITION_INTERVAL_MS
  const due = isRecognition && rating !== 'again' && next.due.getTime() < floor ? new Date(floor) : next.due
  return {
    state: STATE_TO_DB[next.state],
    due,
    stability: next.stability,
    difficulty: next.difficulty,
    lastReview: next.last_review ?? now,
    reps: next.reps,
    lapses: next.lapses,
  }
}
