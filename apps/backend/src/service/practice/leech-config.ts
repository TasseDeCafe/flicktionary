import type { DbUserLookup, PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { FsrsResult } from './fsrs'

// Shared leech/rehab tuning. One source of truth for both pools — the
// thresholds are deliberately identical for passive and active.

// A term whose FSRS lapses reach this count gets parked out of every practice
// queue (flashcards AND reading-text candidate selection) until it graduates
// rehab.
export const LEECH_LAPSE_THRESHOLD = 4

// Correct gate-exercise answers on this many DISTINCT calendar days (server
// CURRENT_DATE) graduate a parked term back into rotation.
export const LEECH_GRADUATION_DAYS = 3

// generate+verify cycles per exercise slot before the slot is marked failed.
export const MAX_GEN_ATTEMPTS = 3

// Damerau-Levenshtein tolerance for typed production-cloze answers.
export const PRODUCTION_CLOZE_MAX_EDIT_DISTANCE = 1

// FSRS re-entry values for a graduated term: a softened schedule rather than
// the pre-park one (which was demonstrably failing). Tunable.
export const SOFT_REENTRY_STABILITY = 1
export const SOFT_REENTRY_DIFFICULTY = 5 // ts-fsrs difficulty range is 1..10

export const isParked = (lookup: DbUserLookup, pool: PracticePool): boolean =>
  pool === 'passive' ? lookup.leech_parked_at != null : lookup.active_leech_parked_at != null

// Park condition for one rating event. This is a NEW-LAPSE delta, not an
// absolute threshold check: after graduation `lapses` stays >= the threshold
// forever, so an absolute check would re-park the term on the very next
// rating of any kind. Comparing against the pre-rating lapse count means only
// a rating that itself caused a lapse (an 'again' on a review-state card) can
// park — good/easy ratings on a high-lapse graduated term never do.
export const shouldParkLeech = (lookup: DbUserLookup, result: FsrsResult, pool: PracticePool): boolean => {
  const prevLapses = pool === 'passive' ? lookup.srs_lapses : lookup.active_srs_lapses
  return result.lapses > (prevLapses ?? 0) && result.lapses >= LEECH_LAPSE_THRESHOLD && !isParked(lookup, pool)
}
