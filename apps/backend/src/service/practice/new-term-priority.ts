import { sql } from '../../transport/database/postgres-client'

// New-term (never-introduced) priority: the queue's new buckets serve tiers
// instead of pure created_at FIFO. The signals live on user_lookups
// (encounter_count / last_encountered_at, maintained by recordEncounter at
// user-intent boundaries; zipf_estimate, emitted by the basic-data pass and
// the backfill script). The SQL fragments below are the single source for the
// tier expression, the decay predicate, and the new-bucket ORDER BY so the
// three serving queries and the landing-page count queries cannot drift.
//
// All predicates are NOW()-relative, so `pnpm db:advance-day` time travel
// keeps working.

// A term encountered again within this window counts as a "fresh save"
// (tier 2) even with a single recorded encounter.
export const NEW_TERM_FRESHNESS_DAYS = 14

// Virtual shelf: a never-introduced term whose last encounter is older than
// this stops being served (and counted) as a new term. It stays visible in
// the Vocabulary list, and any re-encounter (recordEncounter) revives it.
// Leech-rehab / warm-up parked terms are deliberately OUTSIDE this predicate —
// parked terms have their own lifecycle.
export const NEW_TERM_DECAY_DAYS = 90

// Tier for a never-introduced row, lower = served first:
//   1 — revealed demand: encountered at least twice (re-saved, or a lesson
//       import confirmed it as a duplicate)
//   2 — fresh saves: last encountered inside the freshness window
//   3 — the backlog (ordered by frequency prior within the tier)
// `ul` must be the user_lookups alias in the enclosing query.
export const newTermTierSql = () => sql`
  CASE WHEN ul.encounter_count >= 2 THEN 1
       WHEN ul.last_encountered_at > NOW() - make_interval(days => ${NEW_TERM_FRESHNESS_DAYS}) THEN 2
       ELSE 3 END
`

// Decay predicate — true while the term is still on the new-term shelf. Apply
// to every never-introduced serving population AND its matching count query,
// or the practice badges advertise terms the queue never serves.
export const newTermNotDecayedSql = () => sql`
  ul.last_encountered_at > NOW() - make_interval(days => ${NEW_TERM_DECAY_DAYS})
`

// Full new-bucket ordering: tier, then most-frequent-first within the tier
// (NULL zipf = not yet estimated, sorts last), then the pre-tier FIFO order as
// the stable tiebreak.
export const newTermOrderSql = () => sql`
  ${newTermTierSql()} ASC, ul.zipf_estimate DESC NULLS LAST,
  ul.created_at ASC, ul.headword ASC, ul.sense ASC
`
