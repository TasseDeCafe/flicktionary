import type postgres from 'postgres'
import { sql } from '../../transport/database/postgres-client'
import { CITATION_FORM } from '../../transport/database/study-facets/study-facets-repository'
import { newTermNotDecayedSql, newTermOrderSql } from './new-term-priority'

// Pinned-book priority (docs/SRS.md §4 "Pinned book"). While a book is pinned
// for a language, never-introduced recognition terms that occur often in its
// UNREAD parts form a "book stream" that gets up to BOOK_NEW_SHARE of the
// daily new budget, interleaved with the normal tier order. Everything is
// computed live at queue time from book_part_lemma_counts and the reading
// position, so pinning, unpinning and reading take effect on the next fetch.

// Share of the combined daily new budget the book stream may take.
export const BOOK_NEW_SHARE = 0.5

// Minimum estimated occurrences in the unread parts for a term to join the
// book stream: a word met once or twice more isn't worth a priority slot.
export const MIN_BOOK_OCCURRENCES_AHEAD = 3

// Sentinel position for rows ordered after every master row (keyset cursors
// must stay JSON-serializable, so no 'Infinity').
const LAST_POSITION = 1e15

// The daily quota: ceil(share × combined daily max).
export const bookDailyQuota = (maxNewTerms: number): number => Math.ceil(BOOK_NEW_SHARE * maxNewTerms)

// CTEs locating the reader in a book. `contentSourceId` is a SQL expression
// for the book (a literal id, or a subquery). Emits:
//   book_pos(idx, f) — the furthest-reached part and the fraction of it read
//                      (0/0 before any reading). FURTHEST, not most recent:
//                      rereading an early chapter must not re-inflate "ahead".
export const bookPositionCtesSql = (userId: string, contentSourceId: postgres.Fragment | string) => sql`
  book_cur AS (
    SELECT t.book_part_index AS idx,
      LEAST(1.0, (s.furthest_read_segment_index + 1)::numeric / NULLIF(t.profile_segment_count, 0)) AS f
    FROM public.study_sessions s
    JOIN public.text_tracks t ON t.id = s.text_track_id
    WHERE s.user_id = ${userId}
      AND s.content_source_id = ${contentSourceId}
      AND s.deleted_at IS NULL
      AND s.furthest_read_segment_index IS NOT NULL
      AND t.book_part_index IS NOT NULL
    ORDER BY t.book_part_index DESC
    LIMIT 1
  ),
  book_pos AS (
    SELECT COALESCE((SELECT idx FROM book_cur), 0) AS idx,
      COALESCE((SELECT f FROM book_cur), 0) AS f
  )
`

// Occurrences of a lemma still ahead of the reader in one part: the current
// part is pro-rated by what's left of it, later parts count in full. Needs
// `c` (a book_part_lemma_counts row), `t` (its text_tracks row) and `bp`
// (book_pos) in scope; `count` is the column expression to pro-rate.
export const lemmaOccurrencesAheadSql = (count: postgres.Fragment = sql`c.occurrences`) =>
  sql`CASE WHEN t.book_part_index = bp.idx THEN ${count} * (1 - bp.f) ELSE ${count} END`

// CTEs computing each term's estimated occurrences in the pinned book's
// unread parts. The caller defines `book_keys(id, lemma)` — its terms'
// user_headword_lemma_keys — BEFORE these. Emits:
//   book_pin(content_source_id)       — zero rows when nothing is pinned
//   book_pos(idx, f)                  — see bookPositionCtesSql
//   book_term_ahead(id, ahead)        — MAX over a term's keys (the reflexive
//                                       strips are liberal; summing would
//                                       double-count).
export const bookAheadCtesSql = (userId: string, targetLanguage: string) => sql`
  book_pin AS (
    SELECT content_source_id FROM public.book_pins
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  ),
  ${bookPositionCtesSql(userId, sql`(SELECT content_source_id FROM book_pin)`)},
  book_lemma_ahead AS (
    SELECT c.lemma,
      SUM(${lemmaOccurrencesAheadSql()}) AS ahead
    FROM public.book_part_lemma_counts c
    JOIN public.text_tracks t ON t.id = c.text_track_id
    CROSS JOIN book_pos bp
    WHERE t.content_source_id = (SELECT content_source_id FROM book_pin)
      AND t.book_part_index >= bp.idx
      AND c.lemma IN (SELECT lemma FROM book_keys)
    GROUP BY c.lemma
  ),
  book_term_ahead AS (
    SELECT bk.id, MAX(bla.ahead) AS ahead
    FROM book_keys bk
    JOIN book_lemma_ahead bla ON bla.lemma = bk.lemma
    GROUP BY bk.id
  )
`

// Book-stream membership for ONE term, as the pinned book's id (or no row):
// enough occurrences ahead and no enabled production citation facet
// (production-marked words keep their own ordering). The introduction guards
// stamp this on the facet so the daily quota survives pin changes.
export const bookStreamSourceForTermSql = (userLookupId: string, userId: string, targetLanguage: string) => sql`
  WITH book_keys AS (
    SELECT ul.id, k.lemma
    FROM public.user_lookups ul
    CROSS JOIN LATERAL unnest(public.user_headword_lemma_keys(ul.headword, ul.target_language)) AS k(lemma)
    WHERE ul.id = ${userLookupId}
  ),
  ${bookAheadCtesSql(userId, targetLanguage)}
  SELECT (SELECT content_source_id FROM book_pin) AS content_source_id
  FROM book_term_ahead bta
  WHERE bta.id = ${userLookupId}
    AND bta.ahead >= ${MIN_BOOK_OCCURRENCES_AHEAD}
    AND NOT EXISTS (
      SELECT 1 FROM public.study_facets pf
      WHERE pf.user_lookup_id = ${userLookupId}
        AND pf.skill = 'meaning_production'
        AND pf.target_form = ${CITATION_FORM}
        AND pf.disabled_at IS NULL
    )
`

// The recognition introduction order as CTEs, ending in
// `intro_order(id, is_master, book_ahead, boosted, intro_pos, intro_lane, intro_seq)`
// — order by (intro_pos, intro_lane, intro_seq).
//
// Population = the Vocabulary "Up next" stage (enabled, never-introduced,
// unparked, undecayed recognition citation facet). The MASTER rows are the
// introduction candidates (listEligibleNewCitationFacets' population — no
// live production sibling); the rest are bridge-pending terms, which only Up
// next lists. Master rows split into:
//   - boosted: the first `bookRemaining` book-stream terms by occurrences ahead
//     (then the normal order), at fair-share positions k / share;
//   - normal: every other master row in newTermOrderSql order, at j / (1 − share).
// Ties go to the book (lane 0 before 2). Book-stream terms past the quota are
// simply normal rows. Non-master rows are SLOTTED immediately before the next
// normal master row in newTermOrderSql order (lane 1), consuming no position —
// so filtering them out of any consumer leaves discovery's order exactly.
export const introductionOrderCtesSql = (params: {
  userId: string
  targetLanguage: string
  bookRemaining: number
}) => sql`
  intro_pop AS (
    SELECT ul.id, ul.headword, ul.sense, ul.target_language, ul.encounter_count, ul.last_encountered_at,
      ul.zipf_estimate, ul.created_at,
      NOT EXISTS (
        SELECT 1 FROM public.study_facets pfx
        WHERE pfx.user_lookup_id = ul.id
          AND pfx.skill = 'meaning_production'
          AND pfx.target_form = ${CITATION_FORM}
          AND pfx.disabled_at IS NULL
          AND (pfx.srs_state IS NOT NULL OR pfx.leech_parked_at IS NOT NULL)
      ) AS is_master,
      EXISTS (
        SELECT 1 FROM public.study_facets pfe
        WHERE pfe.user_lookup_id = ul.id
          AND pfe.skill = 'meaning_production'
          AND pfe.target_form = ${CITATION_FORM}
          AND pfe.disabled_at IS NULL
      ) AS production_marked
    FROM public.user_lookups ul
    JOIN public.study_facets rf
      ON rf.user_lookup_id = ul.id AND rf.skill = 'meaning_recognition' AND rf.target_form = ${CITATION_FORM}
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND rf.disabled_at IS NULL
      AND rf.srs_state IS NULL
      AND rf.leech_parked_at IS NULL
      AND ${newTermNotDecayedSql()}
  ),
  book_keys AS (
    SELECT p.id, k.lemma
    FROM intro_pop p
    CROSS JOIN LATERAL unnest(public.user_headword_lemma_keys(p.headword, p.target_language)) AS k(lemma)
    WHERE ${params.bookRemaining} > 0 AND EXISTS (
      SELECT 1 FROM public.book_pins
      WHERE user_id = ${params.userId} AND target_language = ${params.targetLanguage}
    )
  ),
  ${bookAheadCtesSql(params.userId, params.targetLanguage)},
  intro_flagged AS (
    SELECT ul.*, COALESCE(bta.ahead, 0) AS book_ahead,
      (ul.is_master AND NOT ul.production_marked AND COALESCE(bta.ahead, 0) >= ${MIN_BOOK_OCCURRENCES_AHEAD})
        AS book_member,
      ROW_NUMBER() OVER (ORDER BY ${newTermOrderSql()}) AS intro_seq
    FROM intro_pop ul
    LEFT JOIN book_term_ahead bta ON bta.id = ul.id
  ),
  intro_booked AS (
    SELECT f.*,
      f.book_member AND ROW_NUMBER() OVER (
        PARTITION BY f.book_member ORDER BY f.book_ahead DESC, f.intro_seq
      ) <= ${params.bookRemaining} AS boosted,
      ROW_NUMBER() OVER (
        PARTITION BY f.book_member ORDER BY f.book_ahead DESC, f.intro_seq
      ) AS book_rank
    FROM intro_flagged f
  ),
  intro_normal AS (
    SELECT b.*,
      CASE WHEN b.is_master AND NOT b.boosted THEN
        ROW_NUMBER() OVER (PARTITION BY (b.is_master AND NOT b.boosted) ORDER BY b.intro_seq)
      END AS normal_rank
    FROM intro_booked b
  ),
  intro_anchored AS (
    SELECT n.*,
      MIN(n.normal_rank) OVER (ORDER BY n.intro_seq ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS anchor_rank
    FROM intro_normal n
  ),
  intro_order AS (
    SELECT a.id, a.is_master, a.book_ahead, a.boosted, a.intro_seq,
      CASE
        WHEN a.boosted THEN a.book_rank::numeric / ${BOOK_NEW_SHARE}
        WHEN a.normal_rank IS NOT NULL THEN a.normal_rank::numeric / ${1 - BOOK_NEW_SHARE}
        ELSE COALESCE(a.anchor_rank::numeric / ${1 - BOOK_NEW_SHARE}, ${LAST_POSITION})
      END AS intro_pos,
      CASE WHEN a.boosted THEN 0 WHEN a.normal_rank IS NOT NULL THEN 2 ELSE 1 END AS intro_lane
    FROM intro_anchored a
  )
`
