# How the SRS works

Reference for the practice/SRS system (web app). Describes the code as of PR #111
(per-language daily limits). Update this doc alongside behavior changes — same convention as
`apps/extension/EXTENSION-SPEC.md`.

Code map:

- Scheduler: `apps/backend/src/service/practice/fsrs.ts` (`ts-fsrs` wrapper)
- Rating flow: `rate-term.ts` (`applyTermRating`, `rateTerm`)
- Queue: `list-review-terms.ts` + `listReviewTerms` in `user-lookups-repository.ts`
- Daily budgets: `review-caps.ts` (`resolveReviewCaps`, `clampPracticeSessionLimits`)
- Leeches: `leech-config.ts`, `rehab.ts`, `exercise-bank.ts`
- Reading mode: `generate-reading-text.ts`, `advance-reading-text.ts`
- Audit log: `practice-rating-events-repository.ts`
- Frontend session: `apps/web/src/features/practice/components/flashcard-mode-view.tsx`

All "today" windows below use the **server's `CURRENT_DATE`** (Postgres, UTC) — not the
client's timezone.

## 1. Data model: one row, two pools

A `user_lookups` row is created per (user, target_language, headword, sense) when the user
keeps a card (`set-card-status.ts`; `findOrCreate` + `applyKeepTransition` bumps `count`).
Rows with `count = 0` or `deleted_at` set are invisible to practice.

Every kept term participates in the **passive** pool (recognition). The user can additionally
promote a term to the **active** pool (production) via `learning_mode = 'active'`. The pools
are two *independent* SRS column families on the same row:

| | passive | active |
|---|---|---|
| SRS columns | `srs_*` | `active_srs_*` |
| Leech columns | `leech_parked_at`, `leech_rehab_*` | `active_leech_parked_at`, `active_leech_rehab_*` |
| Daily caps | new + review budgets | **none** (hard ceilings only) |
| Counts toward `added_to_practice_at` | yes (stamped on introduction) | no |
| Counts toward review budget | yes | no |
| 24h interval floor | yes | no |
| Card layout | headword front | prompt front (`ACTIVE_CARD_FACE_CONFIG`) |

- `srs_state IS NULL` = never reviewed in that pool — the UI's **"Unseen"**.
- `added_to_practice_at` is stamped once, when the passive introduction succeeds; it is the
  source of truth for the daily-new count.
- Promoting to active clears stale `active_leech_*` state; passive state is never touched by
  mode changes.

## 2. The scheduler (fsrs.ts)

Thin wrapper around `ts-fsrs`: `new FSRS(generatorParameters({ enable_fuzz: true }))` — all
other parameters are library defaults. App ratings `again | hard | good | easy` map 1:1 to
FSRS grades. States mirror FSRS: `new`, `learning`, `review`, `relearning` (plus DB `NULL` =
not introduced).

`applyRating(row, rating, now, pool)`:

1. Reads the pool's column family into an FSRS card; a never-reviewed row is seeded with
   `createEmptyCard(now)`.
2. Runs `fsrs.next()` and persists `state/due/stability/difficulty/last_review/reps/lapses`.
3. **Passive 24h floor**: for passive, non-`again` ratings, `due` is clamped to at least
   `now + 24h`. This kills FSRS's minutes-away intraday steps for correct answers — finishing
   a session leaves nothing immediately due. `again` is deliberately NOT clamped, so an
   abandoned miss stays due soon. The active pool is never clamped.

Practical effect of the floor: a passive card you get right never comes back the same day; a
card you fail goes to `learning`/`relearning` with a short FSRS step and is served as a
budget-exempt follow-up (see §4).

### State lifecycle quirk: `'new'`

The passive introduction guard (§5) stamps the row `srs_state = 'new'`, due now, in its own
transaction *before* the FSRS write overwrites it with the rating result. Normally invisible;
if the FSRS transaction fails the row survives as `'new'`/due-now and self-heals on the next
rating. This is why `'new'` is grouped with `'review'` everywhere (queue bucket, budget
predicate).

## 3. Daily limits (per language since PR #111)

`practice_max_new_terms` / `practice_max_review_terms` live on
`user_target_language_prefs` (Languages settings screen). Defaults 20/100; hard maxes
100/300; missing row ⇒ defaults. `clampPracticeSessionLimits` clamps to [0, hard-max] and
treats **both-zero as "fall back to defaults"** — a fully-paused language is deliberately not
expressible (the contract also rejects both-zero with a sum>0 refine; the settings UI snaps
invalid drafts back on blur).

Two independent daily budgets, both passive-only:

- **New budget** = limit − count of rows with `added_to_practice_at` = today. Consumed by
  introductions (first-ever passive rating), from flashcards AND reading mode.
- **Review budget** = limit − `COUNT(DISTINCT user_lookup_id)` of today's
  `practice_rating_events` where `pool='passive'`, `was_introduction=false`,
  `prev_srs_state IN ('new','review')`, `reverted_at IS NULL`. DISTINCT means in-session
  `again` redrills of one card charge one slot. Counting events (not queue state) is what
  fixed the "refresh refills the queue" bug.

**Learning/relearning follow-ups are exempt from both budgets.** A card in
`learning`/`relearning` state is an unfinished intraday step (usually a failed card); it is
served regardless of spent/zero budgets so it can never be stranded. Only the hard max (300)
caps it. *Consequence: setting review-limit 0 does not silence a language that has pending
learning-state cards — they keep appearing under "Follow-ups" until cleared.*

## 4. The queue (listReviewTerms)

Scopes: `mixed` (due first, then new), `review_due` (due only), `learn_new` (new only).
The repository query is three sub-selects, each separately capped:

| bucket | predicate | cap | order |
|---|---|---|---|
| review-state | `srs_state IN ('new','review')`, due | remaining **review budget** | due ASC, headword, sense |
| learning-state | `srs_state IN ('learning','relearning')`, due | hard max only | due ASC, headword, sense |
| new | `srs_state IS NULL` | remaining **new budget** (or batch) | created_at ASC, headword, sense |

Excluded everywhere: parked terms (`*_parked_at IS NOT NULL`) and terms woven into the
currently-open reading text (`excludeUserLookupIds`).

**Learn-new batch bypass**: the "Learn new" flashcard flow opens a sheet (5/10/15/20, plus
"All N" when ≤20 unseen). The chosen N travels as the `count` search param →
`newBatchSize` → `requestedNewCount`, which serves exactly N unseen terms *ignoring* the
remaining daily-new budget (Anki-style custom study). The session's ratings send
`learnNewSession: true` so the introduction guard skips only its count predicate.
Introductions still stamp `added_to_practice_at` (they count toward today; `mixed` won't
re-add more). A learn_new URL without `count`, and ALL of reading mode, get no bypass.

## 5. Rating flow (applyTermRating)

Shared by flashcards (`rateTerm`) and reading advances (`advanceReadingText`). Per rating:

1. **Refusals (no FSRS, no event)**: `not_in_active_pool`; parked term (stale queue/tab —
   accepted as a no-op); introduction over the daily cap.
2. **Introduction guard** (passive, state-NULL only): `initializeSrsStateIfUnderDailyCap`
   runs in its own advisory-lock transaction — atomically counts today's introductions
   against the *full clamped per-language cap* and stamps `srs_state='new'` +
   `added_to_practice_at` only if under it. `bypassDailyCap` (learn-new session) drops only
   the count predicate. Active introductions initialize unconditionally.
3. **FSRS write + event log in one transaction**: `applyFsrsResultForPool` and the
   `practice_rating_events` insert commit together. The event carries the **pre-rating SRS
   snapshot** (`prev_srs_*`), `was_explicit` (false = implicit reading 'good'),
   `was_introduction`, `caused_parking`, `practice_text_id`, and a `reverted_at` tombstone
   column — the foundation for undo (task 6) and the review-budget count. Append-only;
   every event row represents an applied write.
4. **Post-commit, fire-and-forget**: `parkLeech` (if the rating crossed the leech threshold)
   and `warmExerciseBank` (on parked / `again` / `hard` — pre-generates Strengthen
   exercises). A crash window can leave `caused_parking=true` without the park applied
   (accepted; un-parking an unparked term is a no-op).

`rateTerm` resolves the per-language new-cap itself after loading the lookup row (the row
carries `target_language`); the active pool skips the fetch (no daily cap).

## 6. Reading mode

`generateNextReadingText` builds texts from the same `listReviewTerms` candidate set (same
scopes/budgets — no learn-new bypass). On **advance**:

- `claimFinalize` is a one-shot status transition (reading → done); only the winner applies
  ratings — double-clicks/retries are no-ops.
- Every woven annotation's term gets rated: explicit if the user rated it in the sheet,
  otherwise an **implicit `good`** (`was_explicit = false`).
- Skipped: terms already reviewed after the text was prepared
  (`wasReviewedAfterTextWasPrepared`) and terms ineligible for the session's scope.

## 7. Leeches: parking, rehab, Strengthen

- **Detection** (`shouldParkLeech`): a rating that *itself causes a new lapse* (an `again` on
  a review-state card) and brings `lapses ≥ 4` (`LEECH_LAPSE_THRESHOLD`) parks the term —
  new-lapse **delta**, not an absolute check, so graduated high-lapse terms aren't re-parked
  by good/easy ratings. Per pool.
- **Parked** = out of every queue (flashcards and reading candidates). Ratings from stale
  queues are accepted as no-ops.
- **Rehab**: parked terms surface in **Strengthen** as gate exercises. One correct gate
  answer per server calendar day advances rehab; **3 distinct days**
  (`LEECH_GRADUATION_DAYS`) graduate the term. Gate type ladder by rehab day: passive
  `mc_cloze → mc_comprehension → mc_cloze`, active `mc_cloze → production_cloze →
  production_cloze` (typed answers tolerate edit distance 1).
- **Graduation** (`unparkAndSoftReentry`): atomic — clears parked/rehab columns and writes a
  *softened* re-entry directly (review state, due +24h, stability 1, difficulty 5), NOT the
  demonstrably-failing pre-park schedule. `reps`/`lapses` are preserved; the `parked_at`
  flag, not the lapse count, is the re-park gate. `added_to_practice_at` untouched.
- **Exercise bank** (`exercise-bank.ts`): per (term, pool) slots — passive
  `mc_cloze, mc_comprehension, use_in_sentence`; active `mc_cloze, production_cloze,
  use_in_sentence`. Generated + adversarially verified in the background (≤3 attempts per
  slot), warmed on park/again/hard. Strengthen serves one gate exercise per parked term
  (oldest first) plus bonus exercises for this session's again/hard set.

## 8. Frontend session model (flashcard-mode-view.tsx)

- The queue is fetched **once** and held in client state — navigation drops the session
  (constraint for tasks 6/7: undo/edit must not leave the view).
- **Again-redrill**: rating `again` optimistically appends a copy of the card to the local
  queue in the same render as the index advance (so the Learning pill never dips); the copy
  is rolled back by object identity if the server says cap-rejected / parked / error, guarded
  by `indexRef` so an already-consumed copy is never removed.
- `sessionHardRef` collects this session's again/hard terms → offered to Strengthen
  afterwards.
- The back-chevron (`peekBack`) is a **read-only** peek at the previous card (front+back); no
  re-rating yet (task 6).
- Counter pills derive from the remaining local queue (`getRemainingCounts`), with redrill
  copies counted as Learning.
- Landing/status lines compute servable work client-side from the due summary + per-language
  limits (`getPracticeLimitsForLanguage`): `servableReviewDue = min(reviewDueCount,
  reviewBudgetLeft)`; precedence when nothing is servable: "Daily review limit reached." >
  "Daily new limit reached." > "No terms are ready right now.".

The **due summary** endpoint returns per language: `newCount` (unseen), `reviewDueCount`,
`learningDueCount`, `nextLearningDueAt`, `newIntroducedTodayCount`, `reviewedTodayCount`
(off the event log), `parkedCount`, and the `active*` mirrors.

## 9. FAQ / gotchas

- **"I set the review limit to 0 but still get cards."** Learning/relearning-state cards are
  budget-exempt by design (§3). The limit only gates review-state cards.
- **"I set both limits to 0 and it didn't stick."** Both-zero is rejected (sum>0 contract
  refine) and the clamp treats 0/0 as defaults; the settings inputs snap back on blur.
  Pausing a language is currently not a feature.
- **"A card I answered correctly came back the same day."** Only possible via `again`
  (no 24h floor) or in the active pool (never floored).
- **"Why did my failed card disappear from rotation?"** Probably parked as a leech (4th
  lapse). Check `parkedCount` / the Strengthen screen — it graduates after 3 rehab days.
- **Daily windows roll over at UTC midnight** (server `CURRENT_DATE`), not local midnight.
- **Refreshing mid-session** refetches a fresh queue but cannot refill spent budgets — the
  review budget is counted off the append-only event log.
