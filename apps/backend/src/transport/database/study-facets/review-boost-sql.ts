import { sql } from '../postgres-client'

// "Review tomorrow" (a boost): the learner pulled a reviewed card's next
// review forward to the start of the next server day, never today — they just
// saw the answer, and a same-day review would credit short-term memory as a
// success. The fragments below are the single source for both the status the
// capture search shows and the boost write, so they can't disagree. `f` must
// be the study_facets alias and `ul` the user_lookups alias.

// A boost is active until the facet's next review: every review or credit
// stamps srs_last_review, which moves past boosted_at and ends it with no
// extra write.
export const boostActiveSql = () => sql`
  (f.boosted_at IS NOT NULL AND f.boosted_at > COALESCE(f.srs_last_review, '-infinity'::timestamptz))
`

// Boostable: a kept, queue-eligible facet in review, due after tomorrow. A
// card already due by tomorrow has nothing to pull forward, so it is never
// tagged boosted (and never gets the boost's queue priority for free).
export const boostableSql = () => sql`
  ul.count > 0
  AND ul.deleted_at IS NULL
  AND f.disabled_at IS NULL
  AND f.data_status = 'ready'
  AND f.leech_parked_at IS NULL
  AND f.srs_state = 'review'
  AND f.srs_due::date > CURRENT_DATE + 1
`

// The due date a boost sets, and the one an untouched boost still holds.
export const boostDueSql = () => sql`(CURRENT_DATE + 1)::timestamptz`
export const boostedDueSql = () => sql`(f.boosted_at::date + 1)::timestamptz`
