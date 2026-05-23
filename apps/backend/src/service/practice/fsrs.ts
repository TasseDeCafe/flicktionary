import { FSRS, generatorParameters, createEmptyCard, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import type {
  DbUserLookup,
  PracticePool,
  SrsState,
} from '../../transport/database/user-lookups/user-lookups-repository'

const fsrs = new FSRS(generatorParameters({ enable_fuzz: true }))

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

// Convert a user_lookups row's SRS columns into a ts-fsrs Card. The pool
// argument selects which SRS column family to read — passive reads srs_*,
// active reads active_srs_*. If the relevant state column is null (the row
// has never been reviewed in this pool) we return null and the caller seeds
// with createEmptyCard.
const userLookupToFsrs = (row: DbUserLookup, pool: PracticePool): FsrsCard | null => {
  if (pool === 'passive') {
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
  if (row.active_srs_state == null || row.active_srs_due == null) return null
  const lastReview = row.active_srs_last_review ? new Date(row.active_srs_last_review) : undefined
  return {
    due: new Date(row.active_srs_due),
    stability: row.active_srs_stability ?? 0,
    difficulty: row.active_srs_difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.active_srs_reps,
    lapses: row.active_srs_lapses,
    state: DB_TO_STATE[row.active_srs_state],
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

// Passive terms the user got right are never rescheduled sooner than this far
// out. FSRS's intraday learning/relearning steps (minutes away) would otherwise
// surface as straggler follow-ups right after a session ends, requiring a fresh
// session to clear. Clamping the output `due` to a next-day floor means finishing
// a session leaves nothing immediately due. We deliberately do NOT clamp `again`:
// in-session redrilling of misses is driven by ratings (the "stubborn" path), not
// `srs_due`, and if a missed term gets abandoned before its retry we want it to
// stay due soon rather than be pushed a full day out. `now + 24h` matches how
// FSRS already expresses review intervals (offsets from `now`, not midnight).
const MIN_PASSIVE_INTERVAL_MS = 24 * 60 * 60 * 1000

// Apply a rating event to a row. For never-reviewed rows the FSRS library's
// createEmptyCard provides the seed; the rating then transitions it into
// learning/review with computed intervals. The pool argument selects which
// SRS column family backs the card state.
export const applyRating = (row: DbUserLookup, rating: AppRating, now: Date, pool: PracticePool): FsrsResult => {
  const existing = userLookupToFsrs(row, pool)
  const card: FsrsCard = existing ?? createEmptyCard(now)
  const result = fsrs.next(card, now, RATING_MAP[rating])
  const next = result.card
  const floor = now.getTime() + MIN_PASSIVE_INTERVAL_MS
  const due =
    pool === 'passive' && rating !== 'again' && next.due.getTime() < floor ? new Date(floor) : next.due
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
