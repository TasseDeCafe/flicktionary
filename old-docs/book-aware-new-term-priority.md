# Book-aware new-term priority (#476, with #475)

> **Status: historical** (archived 2026-09-26). Design for pinned-book priority (#476) with the fresh-save frequency floor and lookup-demand signal (#475), implemented by PRs #479–#482 and #484 (learn before you read); kept for design rationale. Current behavior lives in `../docs/SRS.md` §4 (new-term order, pinned book), `../docs/READER-SPEC.md` (book page) and `../docs/DATA-MODEL.md` (book pins, part lemma counts).

## Problem

New-card intake is capped by memory (~20–30 introductions/day), not by reading time, and the cap is already reached from school, articles and videos. Books make saving cheap, so two failure modes appear:

1. **Rare fresh saves crowd out the backlog** (#475). Tier 2 ("fresh saves", last 14 days) outranks the whole backlog regardless of frequency. Binge-save 200 words from a novel and next week's introductions are those words, ahead of older and more frequent backlog words.
2. **Book-frequent words get no priority** (#476). метла is rare in general (low Zipf) but appears on every other page of Harry Potter. Learning it early makes the rest of the book faster. The current ordering can't see this.

These pull in opposite directions for the same word (#475 would demote метла, #476 wants to promote it), so they're designed together. The result is that rare words are demoted by default and promoted only when there's evidence they'll come back: you pinned a book they're frequent in, or you keep looking them up.

## Decisions already made (from the issues)

- The active book is **explicitly pinned**, never inferred.
- The boost is based on occurrences **ahead of the reading position**, so it fades while you read and disappears when you finish or unpin.
- It **reallocates** the existing combined daily new budget and never adds a separate one. The mechanism is a **quota**, not a blended score.
- Only **never-introduced** words are reordered. Introduced words keep their own schedules after unpin.
- **No boost for Production.** Production introductions are unaffected by the pin.
- "Learn before you read" is an **opt-in** list.
- Lemma counting reuses the checkpoint homograph guards.

## Current state (what this builds on)

- **Ordering.** `newTermOrderSql()` in `apps/backend/src/service/practice/new-term-priority.ts`: tier (1 revealed demand, 2 fresh, 3 backlog), then `zipf_estimate DESC NULLS LAST`, then FIFO. Three consumers share it:
  - `listEligibleNewCitationFacets` is the composed queue's introduction discovery, and effectively the only introduction path. The composed queue serves no new citation flashcards; new terms enter as warm-up gates.
  - The new bucket of `listReviewTerms`, used by reading mode.
  - The Vocabulary tab's `Up next` list, a keyset-paged copy of the same order. SRS.md promises that the list a user inspects there is the introduction order.
- **Allocation.** `planPracticeQueue` (`plan-practice-queue.ts`) takes `parkBudget = min(MAX_WARMUP_INTRO_PER_SESSION = 10, remaining daily budget)`. It gives production candidates first, then recognition takes the rest, and each pool takes the **head** of its ordered candidate list. Whoever controls the order controls who gets introduced.
- **Book text.** Each part is a `text_track` with `book_part_index`. Every part has a lemma profile (`text_track_lemma_profiles`: `folded_token`, `token_count`, `candidate_lemmas[]`), built at upload by `build-track-lemma-profile.ts`.
- **Profiles are unguarded.** The candidate groups are the raw matcher output. The frequency-asymmetry guard (`applyFrequencyAsymmetryGuard`, which kills при→переть) runs only inside checkpoint matching. Also, `countFoldedTokens` does **not** apply the digit+hyphen skip that `tokenizeSegments` does, so «27-летний» counts as an occurrence of «летний». Both matter once profiles feed counts that drive priority. The difficulty stat is milder about it, because a spurious candidate there only raises P(known).
- **Reading position.** `study_sessions.furthest_read_segment_index` (monotonic, per part session) and `last_read_at`. A book's "current part" on the book page is the session with the latest `last_read_at`.

---

## #476 — Pinned book quota

### 1. Where the pin lives

New table, one pin per (user, language):

```
book_pins
  user_id            uuid -> auth.users (ON DELETE CASCADE)
  target_language    text                 -- pk (user_id, target_language)
  content_source_id  uuid -> content_sources (ON DELETE CASCADE)
  pinned_at          timestamptz
```

- **One per language, not one global.** You can read a Russian novel and a German one at the same time. Each language's queue sees only its own pin.
- **Why a table instead of a column:**
  - A column on `content_sources` (`pinned_at`) needs a partial unique index over `(created_by_user_id, language)` to enforce "one pin". Clearing it on remove then becomes an ad-hoc write on a row that deliberately **survives** removal (`books.remove` soft-deletes the part sessions but keeps the source for dedup). A forgotten clear would silently resurrect the pin on re-upload.
  - A column on `user_target_language_prefs` works too, but that table is limits and levels. A dedicated table keeps the invariant in the primary key and makes the remove path an explicit `DELETE`.
- **Pinning another book in the same language replaces the pin** (upsert on the PK). The toggle's confirm copy names the book being unpinned.
- **Writes:** `books.pin` and `books.unpin` (`apps/backend/src/router/books-router/`). Pin checks ownership (`created_by_user_id`), `type='book'` and `importStatus='ready'`. Anything else returns NOT_FOUND, so the endpoint doesn't reveal whether a book exists.

### 2. Counting occurrences per part (build time)

New derived table, written by the same job that builds the part's profile:

```
book_part_lemma_counts
  text_track_id   uuid -> text_track (ON DELETE CASCADE)
  lemma           text           -- checkpoint_fold-folded; pk (text_track_id, lemma)
  occurrences     int            -- CHECK > 0
  index (lemma, text_track_id)   -- queue-time lookup is lemma-driven
```

**Build**, in `build-track-lemma-profile.ts`, for `content_source.type = 'book'` only, in the same transaction as the profile swap:

1. Take the profile's token groups.
2. Run `applyFrequencyAsymmetryGuard` over them with `lemma_ranks`, the same function checkpoints use, so the two can't drift.
3. Add the group's full `token_count` to **every surviving candidate**.

**Why full credit instead of splitting the count across candidates.** The question being answered is "will I run into this word", not "how much of the text is this word". After the guard, the survivors are genuinely plausible readings: comparable frequency, or common, or an identity reading. Splitting by rank probability would undercount the rarer reading in exactly the equal-frequency case where the book could be using either.

The overcount this accepts is the same-spelling different-lexeme class (стих "poem" vs «ветер стих»). The mechanical guard can't separate that class, and checkpoints handle it with a Haiku pass that's too expensive to run over a whole book. At worst the quota orders one wrong word early. It can't create a card.

**Why a table instead of applying the guard at query time.** Doing it at query time would mean either duplicating `applyFrequencyAsymmetryGuard` in SQL, or loading the profile and ranks into TS on every queue fetch. Profiles never change after upload, so precomputing once is strictly cheaper.

**Size:** a 100k-token novel has roughly 8–12k distinct lemmas. Summed over parts, that's around 50–150k rows per book. It only exists for books.

**Fixes that ship with it:**

- **Digit-hyphen skip in `countFoldedTokens`.** Extract the skip from `tokenizeSegments` into a shared predicate and use it in both tokenizers. This also slightly corrects the difficulty stat, which is fine.
- **`profile_version` on `text_track`.** A version mismatch counts as stale in `resolveTrackProfileReadiness`, the same path that re-enqueues missing or stale profiles today. That makes existing profiles, and the books uploaded before this change, rebuild lazily. Pinning a book also enqueues any part whose profile is missing, stale or out of version, so counts exist by the time the queue reads them.
- **Rank rebuilds.** A `lemma_ranks` rebuild can change the guard's output. I'd **accept** that staleness rather than version counts against the rank build: rank builds are rare, and a stale guard decision costs ordering precision, not correctness. If it matters later, store the rank build version next to `profile_version`.

### 3. Occurrences ahead (query time)

**Reading position.** The anchor is the book's **furthest-reached part**, not the most recently read one:

```
cur_idx = MAX(book_part_index) over the book's live part sessions
          (deleted_at IS NULL) with furthest_read_segment_index IS NOT NULL
f       = (furthest_read_segment_index + 1) / segment_count     -- fraction of cur part read
ahead(lemma) = (1 − f) · occurrences in part cur_idx
             + Σ occurrences in parts with book_part_index > cur_idx
```

- **Why furthest rather than latest.** The book page's "current part" is the latest `last_read_at`. Going back to reread chapter 2 while you're at chapter 10 would jump "ahead" back up to nearly the whole book and flood the quota with words you've already read past. The furthest part is monotonic, so priority only ever decreases while you read.
  - The opposite edge: jumping straight to the epilogue collapses "ahead" to almost nothing. I think that's rarer and easier to understand.
- **With no reading yet** (the pin comes before the first page), `cur_idx = 0` and `f = 0`: the whole book is ahead.
- **Why pro-rate the current part** instead of counting it fully, or storing per-segment counts:
  - Counting the current part fully would keep a word boosted at full strength until you leave a chapter that no longer contains it.
  - Per-segment counts would be exact, but they'd multiply the table by ~50×.
  - Parts are at most 30k characters, so assuming uniform distribution inside one part is a small error.
- **Parts without counts yet** contribute 0. "Has counts" is read from build bookkeeping (`profile_built_at` set and `profile_version` current), never from the existence of count rows: a successfully built part can legitimately match zero lemmas. The pin toggle's analysis state:
  - **Unsupported language** (not in `KAIKKI_LANGUAGES`; books accept any language code, profiles build only for the six): no toggle. `books.pin` refuses with `UNSUPPORTED_LANGUAGE`, the same code checkpoints use.
  - **Analyzing:** some parts are pending. The boost already works on the built parts.
  - **Partly failed:** a part's latest profile job terminally failed (`resolveTrackProfileReadiness` → `'failed'`). The pin stays usable, the book page says "N chapters couldn't be analyzed", and it offers **Retry**, which re-enqueues those parts. Nothing re-enqueues automatically, matching the difficulty stat, so a broken part can't loop.
  - **Ready.**

**Mapping terms to lemmas.** `user_lookups.headword` is LLM-normalized. `foldUserHeadwordCandidates` (TS) turns it into lemma keys: the fold, plus en `to `, de `sich `, fr `se ` and es/pt reflexive stripping. The queue queries are SQL, so this needs an **SQL twin**, `public.user_headword_lemma_keys(headword text, lang text) RETURNS text[]` (IMMUTABLE). It's built on the existing `checkpoint_fold` SQL twin and pinned by a parity test against the TS function over a fixture corpus, the same discipline `checkpoint_fold` already follows. A term's `ahead` is the **max** over its keys, not the sum. The reflexive strip is deliberately liberal: `ducharse` also matches `duchar`, and summing would double-count.

- Alternative considered: a stored `user_lookups.lemma_keys` column. It would need every headword write path to maintain it (`findOrCreate`, `updateContent`, merges) plus a backfill. The twin is a single definition.
- Multi-word headwords (MWEs) get **no** book boost. Their occurrences can't be counted from single-token profiles, and the checkpoint MWE path needs an LLM confirm.

### 4. The book stream and the quota

Eligible **recognition** introduction candidates split into two streams:

- **Book stream:** the candidate's term has `ahead ≥ MIN_BOOK_OCCURRENCES_AHEAD` (start at **3**, then tune), **and** has no enabled production citation facet. That second condition is the "no boost for Production" rule: production-marked words keep going through the production pool's own ordering, which is already served first. Ordered by `ahead DESC`, then `newTermOrderSql()` as the tiebreak.
- **Normal stream:** every other candidate, in today's `newTermOrderSql()` order. Unchanged.

Membership is by **occurrences, not provenance**. A word saved from an article that turns out to appear 40 times in the pinned book belongs in the book stream. That's the whole point of "expected encounters ahead".
- The issue comment framed pool (a) as "saved words from the book". Filtering by provenance would drop that case and would need a highlight→book join for nothing.

**The quota** is a daily cap on how many book-stream introductions can happen, combined with interleaving:

```
book_quota          = ceil(BOOK_NEW_SHARE · daily_max)          -- BOOK_NEW_SHARE = 0.5
book_introduced_today = count of citation facets with introduced_at today
                        AND book_quota_source_id IS NOT NULL   -- any book, any pin
book_remaining      = max(0, book_quota − book_introduced_today)
```

1. The first `book_remaining` book-stream terms are **interleaved** with the normal stream by fair-share position: book term *k* sits at `k / s`, normal term *j* at `j / (1 − s)`, and ties go to the book. At `s = 0.5` that gives B N B N ….
2. Book-stream terms **past** `book_remaining` fall back into the normal stream at their normal tier position. They're never dropped.
3. `listEligibleNewCitationFacets` returns this merged order. The planner is **unchanged**: it still takes the head.

**Why a counter plus interleaving, and not interleaving alone.** A stateless interleave would give roughly half, but only if every compose ran to the end. Planned gates are claimed at display time. If you do three short sessions and stop after the first gate each time, a stateless B-first interleave introduces three book words and zero normal ones. The counter caps the book side for the whole day, whatever the session shapes.
- **Why the counter is stamped, not recomputed.** Recomputing it from *current* stream membership looks free, but it resets whenever membership shifts in bulk. Replacing the pin empties the count, so ten book words this morning plus a new pin at noon would grant ten more. Finishing a chapter drops every word whose last occurrence was in it. So the introduction write stamps a new `study_facets.book_quota_source_id` (nullable uuid → content_sources, ON DELETE SET NULL). It's set when the term is in the pinned book's stream at the moment of introduction, by the same membership predicate. That covers both write paths: the warm-up park guard (`initializeAndParkCitationFacetIfUnderDailyCap`) and the rating-path guard (`initializeCitationFacetIfUnderDailyCap`, which reading mode uses). Once stamped, the count survives pin changes and reading progress. The column also gives provenance for free ("introduced for <book>"). Known assertions don't stamp `introduced_at`, so they never touch it. Undo of an introduction clears it alongside `introduced_at`.

**Why interleave instead of book-first up to the quota.** Production is allocated first from the shared budget. With `daily_max = 20` and 10 production introductions, recognition gets 10 slots:
- Book-first would give all 10 to the book, and the normal stream would get **nothing** that day.
- Interleaving gives 5 and 5.

So the book gets "up to half of the budget": exactly half when production is idle, less when production is busy. That matches the "up to", and the pin can never starve school or lesson words.

**Learn extra** takes the same merged list past the planned slice, so extras keep the same mix while book quota remains.

**Other consumers.** The consumers serve *different populations*, so interleaving each population separately would give different orders. If Up next held an extra bridge-pending term P ranked before N1, a per-population interleave would give discovery `B1, N1, B2` but Up next `B1, P, B2, N1`. So there is one **master order**, computed over the recognition introduction population (discovery's). Every other population is **slotted** into it without consuming slots:
- a master-population row takes its master `intro_position`;
- any other row (bridge-pending in Up next, a `data_status` difference in `listReviewTerms`) sits immediately before the first master **normal-stream** row that follows it in `newTermOrderSql()`, or after the last one. The key is `(anchor_position, 0, normal_rank)` against `(intro_position, 1, 0)` for master rows.

Filtering the extra rows out of any consumer therefore yields discovery's order exactly. That's the invariant the tests pin. `newTermIntroductionOrderSql({userId, targetLanguage})` in `new-term-priority.ts` emits the master positions. The slotting is a small shared SQL fragment, so no consumer re-implements it. Rows outside the book predicate (production-marked, below the threshold, past the quota, or anything when there's no pin) sit in the normal stream at their `newTermOrderSql()` rank, so every row gets a position and nothing is dropped.
- **`listEligibleNewCitationFacets`:** the recognition pool's population gets the book stream. The production pool's population has no book-eligible rows by construction (they all have an enabled production facet), so its order is unchanged.
- **`listReviewTerms` new buckets:** the recognition primary-citation bucket gets positions. The production bucket and the opt-in bucket (pronunciation/forms) have no book-eligible rows, so their positions equal their current order. `intro_position` has to be selected as a column and carried into the `spaced` window and the final `ORDER BY`, in place of `new_tier, zipf_estimate`. Those outer stages re-sort after the bucket `LIMIT`s, the same trap the existing comment describes for tiers, so ordering only inside the bucket would select by position but serve by tier.
- **`Up next`:** its population (an enabled recognition citation facet, never introduced; `vocabStageClauseSql('up_next')`) deliberately includes bridge-pending terms that discovery excludes. Those are slotted as above. Membership and counts are unchanged; production-only terms stay in `unseen` as today. The keyset cursor becomes `(intro_position, id)` instead of `(tier, −zipf, created_at, headword, sense, id)`. Rows get a "📖 in <book>" badge with the `ahead` count, so the reordering explains itself.

This keeps the "the list you inspect is the introduction order" invariant. The cost is that positions depend on today's `book_introduced_today`, so they can shift between page loads when an introduction happens in between. The current tier order can already shift when an encounter lands, so that's accepted.

**Counts don't change.** `new_count` and the landing badges count each population's **members**. Positions only reorder rows inside a population and never filter, so the counts need no book join.

**Decay.** The 90-day shelf still applies to book-stream terms. A term saved months ago that turns out to be frequent in a newly pinned book stays shelved until re-encountered. A checkpoint collect over a span containing it revives it through `recordContentEncounter`, and so does a re-save. Exempting book-stream terms from decay is possible, but every count query would then need the book join to stay consistent with the queue. Deferred (decided).

**Cost.** Per queue fetch, one extra CTE:
1. Resolve the pin and `cur_idx`/`f` (two small lookups).
2. Compute `user_headword_lemma_keys` for the eligible terms (a few thousand at most).
3. `SUM` over `book_part_lemma_counts` rows with `lemma = ANY(keys)` in parts `≥ cur_idx`, using the `(lemma, text_track_id)` index.

With no pin, the CTE short-circuits to the current ordering. I'll measure on a real book with `EXPLAIN ANALYZE` before merging; the fallback is to cache `ahead` per (pin, cur_idx, f bucket).

### 5. Unpin, finish, remove

| Event | Effect |
|---|---|
| **Unpin** | Delete the `book_pins` row. The next queue fetch has no book stream, so unstarted book words go back to their normal tier position instantly (live computation, no backfill). Words already introduced keep their schedules. Gates already parked for onboarding stay parked: that's committed work, same as today. |
| **Finish** | Nothing is written. As `f → 1` on the last part, `ahead → 0` and the stream empties by itself. The book page shows "Finished" on the pin toggle and offers Unpin. No auto-unpin, so a finished book can't vanish mid-session, and pinning the next book replaces it anyway. |
| **Remove book** (`books.remove`) | Delete the pin **in the same transaction** as the session soft-deletes. The source row survives for dedup, and a re-upload must not come back pinned. `cur_idx` already ignores deleted sessions. |
| **Account deletion** | Cascades via `user_id`. |

### 6. "Learn before you read"

An opt-in section on the book page (collapsed by default): **Words worth knowing for this book**.

- **Endpoint** `books.getPrelearnCandidates({contentSourceId, horizon: 'next_part' | 'rest_of_book'})`. It takes lemmas from `book_part_lemma_counts` over the horizon (same `ahead` formula; `next_part` = remainder of `cur_idx` plus `cur_idx + 1`) and excludes:
  - lemmas in `known_lemmas`;
  - lemmas matching any live saved lookup's `user_headword_lemma_keys`. Those are already cards, and the book stream handles them. The section shows "N of these are already queued" instead.
  - unranked lemmas (junk homographs, archaisms the rank build doesn't know);
  - lemmas with `ahead < MIN_BOOK_OCCURRENCES_AHEAD` over the **whole rest of the book**, whatever the horizon. A card created from the list must qualify for the book stream, or a rare pick would land in tier 3 (fresh but under the Zipf floor) and never get the priority the list implies.

  It's ordered by `ahead DESC` and capped at 30.
- **Why the list needs a "Known" action.** "Not in your known-words profile" is weak evidence. Most users have never marked дом as known, so the raw list is full of words they know. Each row has **Learn** and **Known** actions:
  - **Known** writes `known_lemmas` with a new `source = 'book_prelearn'` and a `sweep_batch_id` for undo. The list cleans itself and doubles as a targeted known-words sweep.
  - **Learn selected** creates cards through the adhoc path, `cards.createAdhoc`-equivalent server-side, batched and capped at 20 per press. Each card gets:
    - `headword = lemma`;
    - `context` = the **first occurrence ahead**, so the basic-data pass picks the sense the book actually uses. It's found by scanning segments after the reading position for a folded token whose **guarded** candidate set contains the lemma: the same `applyFrequencyAsymmetryGuard` output the counts were built from, so an earlier «при» can never supply the context for «переть». Pro-rating can predict occurrences ahead in the current part when every real one sits before the position. If the scan finds none there, it continues into later parts, and a lemma with no occurrence anywhere ahead is dropped from the list rather than created without context;
    - `studyIntent = {skills: [meaning_recognition]}`.
- **Why no rank-based "probably known" filter.** Hiding lemmas above rank *N* based on CEFR level would hide exactly the core words a weaker learner is missing. The Known action is honest and cheap. If the list still feels noisy after real use, add the filter then.
- The new cards are ordinary fresh saves. They're book-stream members, so the quota orders them, and they consume the normal budget. They add no intake of their own.
- **Alternative considered:** create them as **highlights** at their first occurrence rather than adhoc cards. You'd see them underlined when you reach them, and provenance would link back to the book. That needs a server-side "highlight at occurrence" write path (`highlights.create` is client-driven with offsets) and a lazily created part session. It's a nice v2. Adhoc is enough, because stream membership is by occurrence, not provenance.

### 7. UI

- **Book page** (`book-detail-view.tsx`):
  - A pin toggle in the header ("Prioritize words from this book"). Its states are pinned, unpinned, analyzing and finished, and the confirm copy names the book it replaces.
  - While pinned: a one-line explainer ("Up to half of your new words each day come from the chapters ahead") and today's split ("3 of 10 book words introduced today").
  - The prelearn section below the parts list.
- **Sessions/dashboard book cards:** a small pin glyph.
- **Up next:** the badge described in §4.

Follow `web-ui-patterns` and `web-query-hooks`. Pin and unpin invalidate the practice preview, the landing counts and `Up next`.

### 8. Tests

**Unit**

- The fair-share merge with quota, as a pure TS function mirrored by the SQL, or tested only through integration if the SQL is the single implementation. Cases: `book_remaining = 0`, an empty normal stream, overflow falling back to normal, and the tie rule.
- The book counts builder: guard applied (a при-class fixture with an unranked переть drops), full credit to multiple survivors, identity readings kept, digit-hyphen tokens not counted.
- Parity between `user_headword_lemma_keys` and `foldUserHeadwordCandidates` over a fixture corpus (all six languages, including reflexive and particle cases).

**Repository integration**, on the shared test DB, with per-test unique fixtures via the `backend-testing` skill:

- `listEligibleNewCitationFacets` with a pinned book:
  - interleaved order;
  - quota exhaustion after N book introductions today;
  - a production-enabled term excluded from the book stream;
  - `ahead` below the threshold stays in the normal stream;
  - unpin restores the old order;
  - `f` pro-rating moves a word out of the stream;
  - rereading an earlier part does not raise `ahead`;
  - deleted sessions are ignored;
  - `book_quota_source_id` stamped at introduction on both write paths (park guard, rating guard); replacing the pin or finishing a chapter doesn't refill the quota; undo clears the stamp.
- `listReviewTerms` serves the recognition new bucket in `intro_position` order after the `spaced` re-sort; production and opt-in buckets keep their order.
- `Up next` with a pin still lists bridge-pending terms, and its counts equal the no-pin counts. With them filtered out, its order equals discovery's order exactly (a fixture where a bridge-pending term outranks a normal-stream term).
- The `Up next` keyset ordering equals the discovery order: the invariant test.

**Planner** (`plan-practice-queue` unit, mocked repositories): unchanged allocation; learn-extra takes from the merged list.

**Books router integration:**

- pin: golden path, 401, NOT_FOUND for another user's book or a non-ready upload;
- unpin;
- remove clears the pin;
- pin replaces the existing same-language pin;
- `getPrelearnCandidates` exclusions (known, saved, unranked);
- pin refused for an unsupported language; a failed part surfaces as partly-failed and Retry re-enqueues it.
- Prelearn context: a guard-dropped reading never supplies the context; a lemma whose only occurrences in the current part are behind the position takes context from a later part, or is dropped.

**Docs:** SRS.md §4 (ordering and quota), DATA-MODEL.md (`book_pins`, `book_part_lemma_counts`, `profile_version`), READER-SPEC.md (book page pin and prelearn).

---

## #475 — Fresh-save frequency floor and lookup demand

### A. Frequency floor on tier 2

```sql
CASE WHEN ul.encounter_count >= 2 THEN 1
     WHEN ul.last_encountered_at > NOW() - 14 days
          AND (ul.zipf_estimate IS NULL OR ul.zipf_estimate >= FRESH_SAVE_MIN_ZIPF) THEN 2
     ELSE 3 END
```

- It's a single edit in `newTermTierSql()`. Every consumer already goes through it, including the up_next cursor, which selects the tier as a column.
- **NULL passes.** The estimate lands within the enrichment pass, seconds after the save. Treating NULL as rare would briefly demote every new save.
- **Consequence to accept knowingly.** A demoted rare save lands in tier 3, where the order is `zipf DESC`, so it sits at the **tail** of the backlog. In practice it won't be introduced unless it:
  - earns tier 1 (re-saved, lesson-confirmed, or looked up again, see B);
  - enters a pinned book's stream (#476);
  - is started manually (focus view / Learn extra).

  Otherwise it decays off the shelf after 90 days. That's the intent: rare words need a second piece of evidence.
- **Threshold: `FRESH_SAVE_MIN_ZIPF = 3.5`.** Tuned on prod saves from the last 30 days (2026-09-26 query, ru n=462 from one user, en n=107):

  | floor | ru demoted | en demoted |
  |---|---|---|
  | 2.5 | 1.9% | 5.6% |
  | 3.0 | 4.1% | 10.3% |
  | 3.5 | 21.9% | 22.4% |
  | 4.0 | 43.1% | 36.4% |

  The LLM estimates run high: грабельки 2.2, иноходец 2.8, отшиб 2.8. So the originally proposed 2.5 would demote about 9 ru words a month and not stop a binge. A random sample of each band backs 3.5:
  - 3.0–3.5 is mostly genuinely low-priority: подневольный, шмон, биодобавка, чечевица, физиотерапевт, текучка кадров.
  - 3.5–4.0 is everyday vocabulary worth fast intake: ночлег, правописание, обогреватель, часовой пояс, единомышленник.

  3.5 demotes about a fifth of saves (around 3 a day at the ru save rate). 4.0 would demote the everyday band.
- **Tests:** tier SQL integration cases for a rare fresh save (tier 3), a NULL-zipf fresh save (tier 2), a rare re-saved term (tier 1), and a common fresh save (tier 2).

### B. Lookups as a demand signal

Today only saves and lesson-import confirms call `recordEncounter`. Repeated **lookups** of a word you haven't saved (or saved once) are strong evidence that it keeps coming back, and nothing records them.

**Where lookups live.** An aggregate table, not an event log:

```
lemma_lookups
  user_id            uuid -> auth.users (ON DELETE CASCADE)
  target_language    text
  lemma              text           -- checkpoint_fold-folded; pk (user_id, target_language, lemma)
  lookup_count       int            -- collapsed episodes
  credited_count     int            -- episodes already folded into a term's encounter_count (watermark)
  last_looked_up_at  timestamptz
```

plus one column on `user_lookups`: `last_demand_at timestamptz NOT NULL DEFAULT NOW()`, the collapse clock for explicit demand (saves, lesson confirms, lookups). The default matters: `findOrCreate` relies on column defaults for the encounter signals (`encounter_count = 1`, `last_encountered_at = NOW()`), and creation IS the first demand episode. A nullable clock would make the collapse predicate never pass on new rows.

**The write.** A bump increments `lookup_count` only when `last_looked_up_at < NOW() − 1 hour`, the same window `recordEncounter` uses: re-tapping a word three times in one reading session is one encounter. Keys are the selection's **guarded** candidate lemmas, single-token selections only. `fastGloss` already resolves candidates for `knownLemmaCandidates`, so the resolution is free.

**Only explicit lookups count.** The extension's hover gloss calls `glosses.fastGloss` after a 300 ms debounce (EXTENSION-SPEC, "Hover gloss"). Recording inside `fastGloss` would count every mouse pass over a subtitle. Recording is therefore a separate fire-and-forget mutation, `glosses.recordLookup({targetLanguage, selectionText})`, called on explicit engagement:
- the web reader opening the gloss sheet (tap);
- the web practice LookupSheet;
- the extension **pinning** a hover gloss (click).

Hover alone never records.

**Consumption: denormalize into `encounter_count`, don't join at queue time.**

- **Separate the demand clock from the content clock.** Today `recordEncounter` collapses on `last_encountered_at`, which `recordContentEncounter` (checkpoint collects) also bumps without touching `encounter_count`. So a checkpoint followed within the hour by a re-save or lookup silently skips the demand bump. That's a latent bug for re-saves today, and it would hit lookups constantly, since you look words up while reading. `recordEncounter` moves its collapse predicate to the new `last_demand_at` and stamps it (it keeps bumping `last_encountered_at` for freshness and decay). Content encounters never touch `last_demand_at`. Backfill `last_demand_at = last_encountered_at` in the migration.
- **At save** (`enrich_highlight` / adhoc / lesson confirm, wherever `recordEncounter` fires), in the same statement or transaction: credit the uncredited episodes, `lookup_count − credited_count`, minus 1 if the latest episode is inside the collapse window (that's the lookup that led to this save). Then advance `credited_count` to `lookup_count` atomically (`UPDATE … RETURNING` under the row lock). The watermark makes it idempotent: an enrichment retry or a re-save finds nothing uncredited and adds nothing, and a later re-save credits only episodes since. With several lemma keys, credit from the key with the most uncredited episodes and advance the watermark on every key. A word looked up on two earlier days and saved today reaches `encounter_count = 3`, which is tier 1.
- **At lookup of an already-saved, never-introduced term:** `recordLookup` calls `recordEncounter` on the matching live term (via `user_headword_lemma_keys`, shared with #476), which collapses on `last_demand_at`. It advances `credited_count` in the same transaction, so a later re-save can't count that episode a second time. A word saved once and looked up again next week reaches tier 1.
- **Why denormalize.** A queue-time join would put a lemma join inside `newTermTierSql()`, which runs in every count query and in the up_next cursor comparison. The denormalized form keeps the tier a pure column expression.
  - The cost is that lookups made before this ships aren't retroactive. There's nothing to backfill anyway, since they were never recorded.

**Interaction with A.** The floor demotes rare one-off saves, and repeated lookups lift the rare ones that keep coming back to tier 1, where they outrank everything. That's exactly the "rare words need a second piece of evidence" rule.

**Tests:**
- repository: collapse window (two bumps within an hour count as 1; after an hour, 2);
- save-time seeding: excludes the current episode; an enrichment retry and a re-save credit nothing twice (watermark); a lookup credited via `recordLookup` isn't re-credited by a later save;
- a checkpoint content encounter followed by a lookup within the hour still bumps `encounter_count` (demand clock is separate);
- first save then a demand bump within the hour is collapsed (the default clock); after the hour it counts;
- `recordLookup` on a saved never-introduced term bumps `encounter_count`, and on an introduced term it's harmless;
- router: golden path, 401, and a multi-token selection is a no-op.

### C. "Recognize only / don't queue" save

Deferred. Revisit only if A and B plus the pin don't keep intake sane.

---

## How the pieces compose (one worked day)

`daily_max = 20`, no production introductions today, a pinned Harry Potter at 40%, and a backlog of 300 unstarted terms.

1. **Book stream:** 25 terms with `ahead ≥ 3`, led by метла (ahead 38, zipf 2.1), палочка and мантия. `book_quota = 10`.
2. **Normal stream:**
   - tier 1: 2 words re-looked-up this week;
   - tier 2: 16 of 20 fresh saves. The floor demoted the other 4 (zipf < 3.5) to tier 3; метла is one of them, but it's in the book stream anyway;
   - tier 3: the backlog by zipf.
3. **Merged order:** метла, tier-1 #1, палочка, tier-1 #2, мантия, fresh #1, … 10 book and 10 normal.
4. **Unpin at noon, after 6 introductions** (3 book, 3 normal): the remaining 14 slots follow the normal stream. The 3 book words introduced keep their schedules.

## Delivery (separate PRs)

1. **#475 A**: the floor. Constants, tier SQL, tests, SRS.md §4. Small and independent; can go first.
2. **#475 B**: lookup demand. Migration (`lemma_lookups`, `user_lookups.last_demand_at` + backfill), `glosses.recordLookup` with web and extension call sites, save-time seeding, and the `user_headword_lemma_keys` SQL twin with its parity test. The twin lands here because B needs it first.
3. **#476 counts**: shared digit-hyphen predicate, `profile_version`, `book_part_lemma_counts` plus the builder, and lazy rebuild of existing book profiles.
4. **#476 pin + quota**: migration (`book_pins`, `study_facets.book_quota_source_id`), the pin/unpin/remove endpoints, the `newTermIntroductionOrderSql` wiring into the three consumers, the book page toggle, and the `Up next` badge.
5. **#476 prelearn**: endpoint, batch adhoc creation, `known_lemmas.source = 'book_prelearn'`, and the book page section.

## Open questions

1. **Decided:** book-stream membership is by occurrences ahead, not provenance (§4).
2. **Decided:** `BOOK_NEW_SHARE` is a fixed 0.5 constant. A per-pin setting (the issue's "per-book focus toggle") is added only if 0.5 feels wrong in use.
3. **Decided:** no decay exemption for book-stream terms in v1 (§4); revisit if shelved words matter in practice.
4. **`MIN_BOOK_OCCURRENCES_AHEAD` = 3** is still to be tuned on the sample books (what share of a novel's saved words clear 3 ahead at 0%, 50% and 90% read). `FRESH_SAVE_MIN_ZIPF` is settled at 3.5 (#475 A).
5. **A "words from this book" practice filter** (the issue's spin-off): out of scope here. The queue reorder covers the budget question, and a filter is a separate UI feature.
