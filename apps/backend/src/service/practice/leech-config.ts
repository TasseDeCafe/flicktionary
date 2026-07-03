import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import { poolForSkill } from '../../transport/database/study-facets/study-facets-repository'
import type { FsrsResult } from './fsrs'

// Shared leech/rehab tuning. One source of truth for both pools.

// A facet whose FSRS lapses reach its pool's threshold gets parked out of every
// practice queue (flashcards AND reading-text candidate selection) until it
// graduates rehab. Recognition schedules at request_retention 0.8 (see
// fsrs.ts), which roughly doubles the expected lapse rate vs production's 0.9
// — so recognition gets a proportionally higher parking bar, keeping
// leech-rehab volume comparable across pools.
export const LEECH_LAPSE_THRESHOLD_RECOGNITION = 6
export const LEECH_LAPSE_THRESHOLD_PRODUCTION = 4

// Correct gate-exercise answers on this many DISTINCT calendar days (server
// CURRENT_DATE) graduate a parked term back into rotation.
export const LEECH_GRADUATION_DAYS = 3

// generate+verify cycles per exercise slot before the slot is marked failed.
export const MAX_GEN_ATTEMPTS = 3

// Composed-queue bounds (compose-practice-queue.ts). MAX_GATES_PER_COMPOSE
// caps how many parked terms one compose/refresh SERVES — and therefore how
// many ensureExerciseBank top-ups can fire per call — independent of how large
// the parked population grows. MAX_WARMUP_INTRO_PER_SESSION caps how many new
// terms one compose may auto-PARK into warm-up across both pools (recognition
// is additionally daily-new-capped; this is the bound for production, which
// has no daily cap, and for a first-ever large vocabulary). The effective
// parking budget is further coupled to the serve slots left after the existing
// backlog, so a compose never parks a term it can't serve in the same session.
export const MAX_WARMUP_INTRO_PER_SESSION = 10
export const MAX_GATES_PER_COMPOSE = 20

// How many hint-exercise generations one compose may kick off for flashcard
// terms whose bank has no hint-type row (see warmHintExerciseBanksForFlashcards).
// Terms past the cap get warmed by a later compose or by the serve-miss backstop.
export const MAX_HINT_WARMS_PER_COMPOSE = 20

// FSRS re-entry values for a graduated term: a softened schedule rather than
// the pre-park one (which was demonstrably failing). Tunable.
export const SOFT_REENTRY_STABILITY = 1
export const SOFT_REENTRY_DIFFICULTY = 5 // ts-fsrs difficulty range is 1..10

export const isParked = (lookup: DbUserLookupWithFacet): boolean => lookup.leech_parked_at != null

// Leeching is restricted to CITATION MEANING facets: rehab gate exercises test
// *meaning*, and `practice_exercises` is keyed `(user_lookup_id, pool, status)`
// with no facet identity — so a form or pronunciation facet that parked would
// collide with the citation facet on the pool-keyed bank. Form/pronunciation
// facets therefore never leech (Trap 19). target_form='' isolates the citation
// card; the skill check excludes 'pronunciation' (Phase 4). In Phase 2 every
// facet is already citation meaning, so this only ever guards future facets.
const isLeechableFacet = (lookup: DbUserLookupWithFacet): boolean =>
  lookup.target_form === '' && (lookup.skill === 'meaning_recognition' || lookup.skill === 'meaning_production')

// Park condition for one rating event. This is a NEW-LAPSE delta, not an
// absolute threshold check: after graduation `lapses` stays >= the threshold
// forever, so an absolute check would re-park the facet on the very next
// rating of any kind. Comparing against the pre-rating lapse count means only
// a rating that itself caused a lapse (an 'again' on a review-state card) can
// park — good/easy ratings on a high-lapse graduated facet never do.
export const shouldParkLeech = (lookup: DbUserLookupWithFacet, result: FsrsResult): boolean => {
  const threshold =
    poolForSkill(lookup.skill) === 'recognition' ? LEECH_LAPSE_THRESHOLD_RECOGNITION : LEECH_LAPSE_THRESHOLD_PRODUCTION
  return (
    isLeechableFacet(lookup) &&
    result.lapses > (lookup.srs_lapses ?? 0) &&
    result.lapses >= threshold &&
    !isParked(lookup)
  )
}
