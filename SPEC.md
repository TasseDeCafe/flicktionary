# Flicktionary — MVP spec

> **Status: authoritative-spec.** The product overview: what the app is/isn't,
> terminology, per-area summaries, navigation, settings, the LLM methodology prompt, and
> user flows. The deep per-area specs are split out — `docs/READER-SPEC.md` (sources,
> reader, enrichment pipeline), `docs/REVIEW-SPEC.md` (session vocabulary + focus view),
> `docs/SRS.md` (practice/SRS), `docs/DATA-MODEL.md` (schema + card content tiers),
> `apps/extension/EXTENSION-SPEC.md` (browser extension). Read the relevant one before
> working in its area; each section below says which.

## What it is

A language-learning companion app. Pick a movie (fetch or upload its subtitles in a target language) or paste a chunk of text in a target language — Reddit comment, news excerpt, Telegram post. Highlight chunks you don't understand inside the app; each is turned into a structured, deep-dive card informed by the lexical approach as you read. Export the kept cards to CSV for Anki import.

The app's value is **not** flashcard generation per se — it's the structured exploration of each chunk in the context of the source, the user's L1, and the user's level. Card export is a side-effect of having explored well.

## What it isn't (non-goals for MVP)

- Not a video player. The app does not host or sync to movie playback. (A companion **browser extension** — a fork of asbplayer — does in-video subtitle capture on YouTube and feeds highlights back to the same backend; see "Browser extension (companion)" below. The web app itself remains a triage/lookup surface, not a player.)
- Not a real-time companion. No auto-scroll, no audio fingerprinting, no clock sync.
- Not primarily a flashcard generator. Cards still export to CSV for Anki users; **in-app review happens through the Practice tab** with shared FSRS scheduling. The default passive-review surface is still short LLM-generated texts that weave in due chunks, but the Practice tab also offers a no-LLM Anki-style flashcard reviewer for quick front/back self-grading over the same passive SRS pool.
- Not a free-form chatbot. Per-card chat is scoped to refining understanding of one chunk.
- Not a books/articles reader. MVP handles movie subtitles and pasted text; books and articles are designed for in the data model but not yet implemented.

## Terminology: "chunk" vs "term"

This spec uses "chunk" throughout — it's the internal domain word, borrowed
from the lexical-approach methodology (a multi-word language unit stored as
one item: `run out of`, `по-русски`, `to put up with`). Code identifiers
(`Chunk`, `ChunkRow`, `useDeleteChunk`), API contracts (`chunks-contract`,
`chunks.listChunks`), database columns, comments, internal services, and
backend prompts all keep "chunk".

In the **web UI**, every user-facing surface (Lingui-wrapped strings — labels,
buttons, placeholders, toasts, error messages) uses **"term"** instead. So a
quiz over the session's chunks is labeled "Quiz your terms" on screen; the
`LLM-suggested chunks` toggle is labeled "LLM-suggested terms"; deleting a row
shows "Term deleted"; etc. Where this spec quotes a user-facing string in
backticks, it uses the on-screen word ("term"); where it describes the
internal model, it uses "chunk".

## Core decisions

### Sources, reader & enrichment — spec lives in `docs/READER-SPEC.md`

Four source kinds feed the same `text_segment` table — movie & TV subtitles (TMDB +
OpenSubtitles search or manual `.srt` upload), pasted text, lesson-notes imports
("Import lesson notes": teacher notes → LLM extraction → confirm screen → lesson
session; see `docs/READER-SPEC.md` → Source content), and source-less ad-hoc vocab
entries ("Add a word") — plus YouTube/streaming via the companion extension and text
messages forwarded to the Telegram bot (which replies with a session deep link). The
mid-source screen is a search bar over the track and a scrollable segment list; that is
the entire mid-source UI. Tap-to-select opens a floating gloss sheet in PREVIEW mode
(looking is free; nothing persists until an explicit commit): fast one-line gloss +
Wiktionary-only IPA, an always-visible study-target picker
(Recognition / Production / Pronunciation × Base form / Exact form), and two commit
lanes — **Save** (highlight → background enrichment → auto-kept card) and **Save note**
(note-only stub card; "ask a question, don't make a card"). Right-click toggles
save ⇄ remove; saves paint optimistically and show no success toast. The reader persists
a resume-reading position, and when `LLM-suggested terms` is on it shows passive **ghost
candidates** nominated per reading window, adoptable into real highlights from the sheet.

Enrichment runs server-side on a Postgres-backed job queue (`processing_jobs`: leases,
bounded concurrency, idempotent enqueue): one `enrich_highlight` job per committed
highlight — session context blob → highlight-only basic-data pass → Wiktionary grounding
for kaikki-enabled languages → auto-keep — plus `nominate_window` jobs for ghosts. The
full-exploration pass is on-demand from the focus view, never automatic.

**`docs/READER-SPEC.md` is the authoritative spec** for the source wizards, the reader
and gloss sheet, highlight commit semantics, the processing pipeline, and the
tap-to-translate fast path. Read it before touching any of that; update it — not this
summary — when behavior changes.

### Review screen — spec lives in `docs/REVIEW-SPEC.md`

Two layers. **Layer 1 — session-vocabulary list**: a review-and-prune list of the
session's terms (saving a highlight is already the commit, so cards **auto-keep** the
moment basic data lands — there is no Keep step), with placeholder rows + retry while
enrichment drains, note-only "needs data" rows, a single Remove (unkeep) control per row,
and a sticky `Quiz your terms` footer launching the zero-LLM, zero-FSRS **session recap**
quiz. **Layer 2 — focus view**: a modal card editor — per-field basic-data inputs,
grammar chips + collapsible panel with per-field provenance (Wiktionary-verified /
edited-with-revert / unverified-IPA), collapsible source context, on-demand
`Generate full exploration`, per-card chat (own read-state, an `update_card_fields`
tool), the study-target selector + unified per-form editor (form facets,
generate-and-confirm), scope-aware removal (Remove from session vs Delete term), and
keyboard nav.

**`docs/REVIEW-SPEC.md` is the authoritative spec** for both layers. Read it before
touching the session-vocabulary list, the focus view, card editing, provenance, or card
chat; update it — not this summary — when behavior changes.

### Practice (in-app review) — spec lives in `docs/SRS.md`

A separate top-level destination from the per-session review flow. Practice is
**cross-session**: every kept card flows into `user_lookups` (the canonical user-vocabulary
record), and each studied skill × form of a term is an independently-scheduled FSRS
**facet** (`study_facets`). The surfaces, in one breath:

- **`/practice`** — per-language landing → a language action screen whose primary
  **Practice** button serves the **composed queue**: gate exercises for parked terms
  (warm-up + leech rehab) interleaved with due flashcards across both pools,
  production-first. A **session-plan card** shows what that button will serve (same four
  buckets as the in-session chips, server-computed from the compose's own plan) plus the
  daily introduction budget, and a **stage funnel** (proportion bar + tappable rows) maps
  the deck's pipeline, deep-linking each stage into the Vocabulary tab's filters.
  **Custom practice** holds the focused presets, a build-your-own filter
  panel, and the `Read` mode.
- **Reading mode** — short LLM-generated texts (~80–120 words) weaving in due terms as
  tappable annotations; anything not explicitly rated auto-rates `good` on advance.
  Sessionless; lives under Custom practice.
- **Warm-up + leech rehab** — one parked-term mechanic with two entry triggers: brand-new
  terms onboard exercise-first (planned by the composed queue and atomically parked only
  when their gate is reached, under the daily-new
  cap), and terms you keep failing are parked for rehab. Both graduate back into FSRS
  after correct gate answers on 3 distinct days, served from a durable,
  adversarially-verified exercise bank (`practice_exercise`).
- **Flashcards** — declarative card faces, hints backed by the exercise bank, peek +
  re-rate (undo), mid-session term editing via the header kebab, full desktop keyboard
  support.

Scheduling is `ts-fsrs` with per-pool desired retention (recognition 0.8, production 0.9),
a 24h interval floor on correct recognition answers, and per-language daily new/review
budgets counted off the append-only `practice_rating_events` log.

**`docs/SRS.md` is the authoritative spec for all of this** — data model (terms/facets),
scheduler, daily budgets, queue composition, rating/undo flow, reading mode, parking +
exercise bank + graduation, and the practice UI surfaces (landing, composed queue, status
row, keyboard shortcuts, card faces, dedicated exercise sessions). Read it before touching
practice behavior; update it — not this summary — when behavior changes.

### Vocabulary coverage (dashboard)

The dashboard (the home screen — see Navigation chrome) hosts the
**coverage card** as one carousel slide / grid cell — one card, with
bottom-centered chips to flip between
practiced languages (default: last-used), hidden for languages without a
`lemma_rank_builds` row or with zero studied+known lemmas (the shared
`useQualifyingCoverage` filter). When no language qualifies the card and its
carousel slide are absent entirely — the dashboard never shows a blank slide. The viz is a
"pixel wall": one dot per lemma of the language, ordered by frequency rank,
three states (studied / marked known / unknown — a teal ramp where lightness
encodes strength). The dashboard card always renders the **top 5,000**
(subtitle "Top 5,000 words"; the wider ranges live on `/stats` and
`/coverage/$lang`), its legend counts are scoped to that wall (with "Not
yet" unnumbered), and on mobile the card chrome drops so the wall spans the
page width. Headline: "~N% of typical text" — **binary**
blended token-mass coverage (studied ∪ known count as P=1; deliberately not
FSRS retrievability, so the number is stable and only moves when vocabulary
changes). The honesty valve is a secondary line on the detail view: "M%
verified · rest
claimed". Verified = the lemma has a live successful explicit-or-checkpoint
meaning review, never a known-assertion (`docs/SRS.md` §6c); known-only
lemmas stay claimed forever. On the detail view, "+ N expressions" beside
the legend counts multi-word headwords (they can't be dots). Pressing the card opens
`/coverage/$lang`: the full wall (top-10k / whole-denominator toggle, hover
tooltips naming the top-5k lemmas), per-frequency-band waffles with each
band's own coverage %, and a 100-lemma-bucket skyline strip. Data:
`coverage.getCoverage` (batched, all practiced languages) riding on
`lemma_ranks` + `known_lemmas` + the user's vocab through the shared
checkpoint fold; each compute lazily upserts a daily `coverage_snapshots`
row (history for a future progress chart — no chart UI yet). Schema in
`docs/DATA-MODEL.md`; sweep un-mark surfaces in `docs/READER-SPEC.md`. The
detail route is a full-viewport modal drill-in (no app chrome), with its own
scroll container and an inline retry state when coverage cannot load; its X
(and the stale-deep-link fallback) lands on `/dashboard`. The dashboard's
`More stats` header link (above the carousel) opens `/stats`.

### Vocabulary (browse + manage kept chunks)

A separate top-level destination at `/vocabulary` for cross-session browsing of the user's kept chunks. The same `user_lookups` rows feed Practice and this view.

- **Landing.** Per-target-language list of every non-deleted chunk for the user. The language selector lives in the `Sort & filter` panel (a `Language` pill section, mirroring the Sessions filter design) — but as a required scope, not a filter: single-select with no `All`, never counted toward the trigger's active-filter dot, untouched by `Clear filters`. Each row shows headword + sense + 1-line preview (`translation || definition`) + a count badge when the chunk has been kept multiple times — no per-row study/due chips (they read poorly at scale and the filter control covers the same questions) — with a trailing ⋮ options button (same compact ghost treatment as the session cards) opening the per-chunk action drawer.
- **Sort & filter control.** Search input plus a single `Sort & filter` button (a Radix popover on desktop, a bottom sheet on mobile; the popover caps to the viewport and scrolls internally; the trigger carries a dot when any filter is active). When the user studies more than one language the trigger is a pill naming the selected language (localized, truncated) next to the sliders icon — the list is always scoped to one language and the trigger label is the only on-page indicator of which; with a single language it stays icon-only. All sort/filter state persists in the URL so reload/deep-link survives (`?lang=&sort=&status=&skills=&forms=`; stale tokens — including the retired `?mode=` — degrade to defaults via `.catch`). `lang` selects the target language (the practice landing deep-links here); it is validated against the user's actual languages (a stale code falls back to the saved/first language) and preserved by every filter write. Contents:
  - **Sort:** "Recently added" (default) or "Due soonest".
  - **Status** (single-select wrapping pill grid, on the citation recognition facet): `All` / `Due` (a review is waiting now) / the six **SRS stages**: `Up next` / `Warming up` / `Learning` / `Review` / `Strengthen` / `Unseen`. The stages are disjoint and partition the language's kept terms; `vocabStageClauseSql` (user-lookups repository) is the single predicate source, shared with the practice landing's stage counts so the two surfaces agree by construction. Stage semantics: `up_next` = introducible now (mirrors `listEligibleNewCitationFacets` exactly, deliberately including `pending_data` facets); `warming_up` = parked before first review; `learning` = `srs_state IN (new, learning, relearning)`, not parked; `review` = graduated; `strengthen` = leech-parked; `unseen` = facet missing/disabled, or never-studied and decayed off the new-term shelf. (This redefined the old `Unseen` = "srs_state IS NULL", which used to include warm-ups and up-next terms.) A one-line stage description renders above the list while a stage filter is active.
  - **Skills** (multi-select, OR within the set): `Recognition` / `Production` / `Pronunciation` — matches terms with an **enabled facet of any selected skill on the citation OR any form** (so a term studied for production only on a form still matches "Production").
  - **Forms:** `Has multiple forms` — terms studied in at least one inflected form (an enabled facet with a non-empty `target_form`).
  - The list query (`chunks.listChunks`) takes the skill set as a comma-separated `skills` string (server splits + validates, ignoring unknown tokens), `status`, and `hasMultipleForms`; the repository composes one filter clause from `EXISTS` predicates over `study_facets`, injected into every sort/phase branch.
- **Pagination.** Cursor-based with `@tanstack/react-virtual`. The `due` sort is two-phase to keep the cursor stable across NULLS LAST: scheduled rows first (ordered `srs_due ASC, id`), then the unscheduled tail (ordered by `id`). `status=up_next` overrides `sort` and pages in introduction order (`newTermOrderSql`: tier, zipf DESC NULLS LAST, created_at, headword, sense, id — the list IS the order practice will introduce) via a `queue` cursor carrying every ordering key; the row comparison negates zipf on both sides so all keys ascend, with `COALESCE(zipf, -1)` reproducing DESC NULLS LAST.
- **Row actions.** Tapping a row jumps straight to the focus view of `first_card_id` with `?scope=language` (rendering it as a language-wide entry); close pops history back here. A 3-dots button on the right opens a bottom drawer with the secondary actions: **`Edit term`** (opens that focus view, where the study-target selector + unified editor live — the drawer itself hosts no skill/form editing), `Open source` (jumps to `/sessions/$id` for the originating session; the row is omitted when no source is available — e.g. adhoc chunks or sessions whose source was removed), and `Delete` (with inline confirm). Rows whose source card has been deleted fall back to opening the drawer when tapped, so the secondary actions remain reachable.
- **Soft-delete semantics.** Delete sets `user_lookups.deleted_at` and hides the chunk from the Vocabulary list AND from the Practice queue (`listEligibleForLanguage` filters on `deleted_at IS NULL`). The card row stays untouched (so the source session still renders the card normally). Two restore paths: (a) re-keeping the same `(headword, sense)` in any session — the keep-transition clears `deleted_at`; (b) the explicit `Restore` action the Practice reading view surfaces (toast immediately after a delete; slim Restore-only RateSheet when tapping a soft-deleted annotation), backed by the dedicated `chunks.restoreChunk` endpoint. The Vocabulary tab itself has no Trash bin in v1.
- **Header options (3-dots).** Top-right of the Vocabulary tab opens a `ResponsiveOverlay` (sheet on mobile, dialog on desktop) titled "Vocabulary options". Single action in v1: `Export vocabulary` — downloads a CSV of every kept chunk in the currently-selected language (Anki `#` directives + one column per datum; see Export below). Filename: `flicktionary-vocabulary-<lang>.csv`. The button is disabled until a language is selected.

### Export

- CSV designed as an **Anki feed** (full data export is a separate,
  out-of-scope feature; SRS state is deliberately not included — Anki cannot
  import scheduling from CSV anyway).
- The file opens with Anki `#` directives instead of a bare header row (which
  Anki would import as a junk note): `#separator:Comma`, `#html:true`,
  `#tags column:4`, `#columns:<names>`. `front`/`back` join their parts with
  `<br><br>` (matching `#html:true`; literal newlines would collapse on the
  rendered card).
- Columns: `front`, `back`, `context`, `tags` first (ready-made defaults),
  then the basic columns individually (`headword`, `sense`, `surface_form`,
  `translation`, `definition`, `target_example`, `native_example`), then the
  grammar bag (`pos`, `display_form`, `gender`, `aspect`,
  `aspect_pair_headword`, `government`, `morphology` — packed
  plurale/singulare-tantum + indeclinable + animacy + reflexive flags —
  `ipa`, `notable_forms`, `grammar_notes`), then exploration extras
  (`frequency`, `register`, `register_alternatives`, `more_frequent_synonym`,
  `regionalism`, `collocations`, `etymology`, `l1_notes`, `extra_notes`).
  Arrays/objects are rendered human-readable (`; `-joined, `label: form`);
  sparse keys leave empty cells. `ipa` prefers the extras string over the
  grammar bag's dialect-tagged object (dialect buckets rendered with labels —
  `GA …; RP …`, `BR …; EU …`, `LatAm …; Cast. …` — when untagged is absent).
- Tags: `flicktionary <target_language>`, plus `active` when the term has an
  enabled `(meaning_production, '')` facet and `leech` when either pool is leech-parked
  (Anki treats a `leech` tag natively).
- No `.apkg` for MVP.
- **Entry point** is the Vocabulary tab's 3-dots menu → `Export vocabulary`.
  Output is one CSV per target language covering every kept (non-deleted)
  chunk, regardless of which session it came from. Per-session CSV is no
  longer surfaced in the UI; the session vocabulary footer is now a `Quiz your
terms` CTA (the session recap). The `cards.exportCsv` backend endpoint still exists (and still
  stamps `exported_at` on `user_lookups` if hit directly) but is unreachable
  from the UI.
- The vocabulary export pulls a representative `surface_form` and `context`
  per chunk via the `first_card_id` back-pointer (LEFT JOIN cards +
  text_segments); rows whose origin card or segment have been deleted fall
  back to empty cells.

### Navigation chrome

Native-style shell so the eventual React Native port is a translation, not a redesign.

- **Mobile** (`< 768px`): bottom tab bar with five slots — `Dashboard` / `Practice` / central `+` button / `Vocabulary` / `More`. Sessions and Stats have no tab of their own; they are **overflow tab views** (the iOS More-tab convention): the owning tab stays highlighted (`Dashboard` for Sessions, `More` for Stats) and the view renders a mobile-only sticky chevron header (`OverflowTabHeader`, reusing the modal-screen header bar so both drill-in patterns look identical) whose chevron returns to the actual opener via router history, falling back to that fixed parent on deep links, with the in-page `h1` desktop-only. Sessions is reached through the dashboard's `All sessions` link / Recent section; Stats through its More row and the dashboard's `More stats` header link. The `+` opens an action sheet with four options: `Start a movie or TV session`, `Practice with a text`, `Add a word`, `Import lesson notes` (designed to grow as more `content_source.type`s land). `Start a movie or TV session` covers both movies and TV shows via one wizard (an in-wizard `Movie` / `TV show` choice); it fetches subtitles for something the user is watching elsewhere and does **not** play video (in-video capture is the browser extension's job). Note the naming overlap: "Practice" the tab is the SRS reading flow over kept vocabulary; "Practice with a text" inside `+` is a content-source flow that creates a study session from a pasted text. "Add a word" creates a single card without any source (see `docs/READER-SPEC.md` → Source content → Ad-hoc vocab entries). "Vocabulary" the tab is the browseable cross-session list of kept chunks (see Vocabulary section).
- **Desktop** (`≥ 768px`): left sidebar with the same item set plus dedicated `Sessions`, `Explore`, and `Stats` entries (Dashboard / Sessions / Explore / Practice / Vocabulary / Stats / More), with a prominent `+ New` button at the top opening the same action overlay, and a `User guide` link pinned at the sidebar bottom (mobile reaches the guide through More → About). The Sessions list itself has no `+` — it would be redundant. Tab pages use one of two shared column widths (`PageContainer`): wide for the data/browse tabs (Dashboard, Sessions, Stats), narrow for the single-column tabs (Practice, Vocabulary, More).
- **Dashboard** (`/dashboard`) is the app's home surface — `/` and `/from-landing` redirect there, and every no-explicit-redirect landing defaults there too (login/OAuth, magic-link verify, account-removed re-entry, post-onboarding, checkout success, pricing's "practice now"). Top to bottom: an uppercase date line + `Dashboard` heading; the **getting-started checklist** (Install the browser extension / Start a movie or TV session / Save your first terms / Do your first practice) — items check off from real account data (`userPrefs.gettingStartedStatus` + the `extension_installed` account flag) and deep-link to the action or the relevant `/user-guide` anchor; the card is dismissable forever via the X (records `getting_started_dismissed` on `users.account_flags`) and self-retires by recording `getting_started_completed` once all four items are done — after either, the status endpoint is never queried again, and it renders nothing until prefs + status resolve, so established users never see it flash; the **"Start with shared content" section** (featured Explore-catalog entries with language chips, for guests/users with fewer than 3 sessions — the immediate "here is something to try" answer to an empty dashboard; see `docs/READER-SPEC.md` "Shared content (Explore)"); the **Daily Mix banner** (one Start that chains every language's practice queue — `docs/SRS.md` § Daily Mix); a right-aligned `More stats` link (the stats counterpart of Recent's `All sessions` header row) above a snap **carousel** (page dots; desktop: two-column grid, both cards stretched to equal height; on mobile both cards drop their border/padding so content spans the page width) holding the coverage card and the **activity card** — each slide exists only when its data qualifies: the coverage slide when a language qualifies (see Vocabulary coverage), the activity slide when the account has **any all-time activity** (`stats.getActivity`'s `activeDays` non-empty — a brand-new account shows no empty calendar; the getting-started checklist owns new-user coaching). One qualifying slide gets a single-slide carousel (no dots, scroller inert, and on desktop the lone card capped near one column width and centered — full width would scatter the calendar's fixed-size day circles); zero qualifying slides hide the `More stats` header row and the carousel entirely; and **Recent** — the top 12 session rows (same TV-show grouping as the Sessions list, via the shared `buildSessionListItems`; desktop: a two-column grid) under an `All sessions` link, with the first-run empty-state block when no sessions exist. On the Daily Mix banner, the per-language chip chain sits inline beside the Start button on desktop and wraps to its own line on mobile. The activity card is a Strava-style monthly **streak calendar**: one circle per server-UTC day (the same `CURRENT_DATE` boundary the daily budgets use), filled iff that day had any streak-qualifying activity (`stats.getActivity`'s `activeDays` — the same source the streak pill counts, so calendar and pill can never disagree). Today stays an open outlined ring until it's earned; inactive past days are hollow rings; future days and days before the effective start — `min(joinedDay, earliest active day)`, where `joinedDay` comes from `auth.users.created_at` and the min keeps time-shifted (`db:advance-day`) activity reachable — render as bare faint numerals. Month chevrons page between the effective-start month and the current month; the displayed month is stored as an offset from the current month, so the UTC-midnight refetch scheduled by `useActivity` rolls an un-navigated card over. Weeks start on Monday with localized narrow initials. The header carries a user-level **streak** pill (consecutive active days — introduction, live rating incl. checkpoint credits, answered exercise, or known-mark; session opens don't count; a not-yet-active today doesn't break the run until the day is over; hidden at zero); a zero-history account gets an amber "Today's circle is open" nudge under the grid instead — reachable only on `/stats`, since the dashboard hides the card until activity exists. The card is user-level across all languages (no language chips); `More stats` lives in the section header above the carousel, not in the card.
- **Stats** (`/stats`, app chrome kept; on mobile an overflow tab view under `More` — see Mobile above): page-level language chips (the union of coverage + activity languages) drive the **Daily activity** card — three per-metric bar charts, each with its **own y-scale** and a `peak N/day` label so a bulk marking sweep can't flatten the few-terms-a-day series: new terms (`study_facets.introduced_at`, counted per facet — a term studied in both pools counts once per pool, matching the daily-new budget arithmetic), marked known (`known_lemmas.marked_at`, sweep bulk-marks included), and practiced (live ratings + answered exercises; lesson-import lapses and implicit checkpoint reading credits excluded, explicit known-assertions and introductions included — introductions deliberately overlap with new terms since the charts never stack). A 14/30/90-day window selector (full-width segmented control on mobile, inline pill on desktop) slices the single 90-day `stats.getActivity` fetch; Monday/month-start gridlines run through all three charts as one time axis, and each chart carries an sr-only per-day data list. A selected language with no activity renders zero-filled charts, never the all-languages aggregate. Beside the charts sits the same streak calendar as the dashboard (titled `Streak`, captioned that any activity counts and that it ignores the language filter), plus per-language coverage blocks (dot grid + coverage % + link to `/coverage/$lang`). Coverage has no cross-language merge (ranks are per-language), so the `All` chip lists one block per qualifying language. The empty state distinguishes why it is empty: practiced languages without a `lemma_ranks` build get "Vocabulary coverage isn't available for {languages} yet" (saving more terms will never produce a wall there), while a supported-but-empty account keeps the save-a-few-terms nudge. Entry points: the desktop sidebar, a `More` tab row (mobile), and the dashboard's `More stats` header link.
- **Sessions list** (`/sessions`, its own desktop sidebar entry; on mobile an overflow tab view under `Dashboard` — see Mobile above) is the full library. Once any session exists, a search input (250 ms-debounced title match, transient local state — not in the URL) and a filter panel (`SlidersHorizontal` trigger; popover on desktop, drawer on mobile) with language pills + newest/oldest sort sit above the list; language/sort/type persist in the URL (`?lang=` / `?sort=` / `?type=`, defaults dropped so URLs stay clean; a stale `?lang=` degrades to all), filters apply **before** TV-show grouping so groups reflect them, and an `N sessions` count line sits above the rows. The zero-sessions **empty state** is a first-run block (what a session is + the primary `+ New` actions + an extension pointer) instead of a bare "no sessions" line. Sessions list offers `All / Movies / TV / Texts / Articles / YouTube / Streaming / Lessons` filter chips (label-only — no counts) so the unified list stays scannable as content types diversify. Row meta shows year + language + the difficulty stat — the session's stored CEFR level was dropped (it's the user's level, which read as content difficulty; the difficulty stat is the honest signal) — with a relative date on the row's right edge (`Today` / `Yesterday` / short date, year only when it differs). Rows without a poster get a per-type icon placeholder (file-text=text, tv=TV, newspaper=article, monitor-play=YouTube, clapperboard=streaming, graduation-cap=lesson), each on its own hue. Synthetic adhoc sessions (the per-(user, language) "Personal vocabulary" pseudo-sessions backing the Add-a-word flow) are filtered out at the query layer — they never appear under any chip. Each row carries a **⋮ options menu** opening a session actions overlay (sheet on mobile, dialog on desktop; `session-actions-overlay.tsx`) with the owner's Share-to-Explore/Unshare toggle when the track is shareable (see `docs/READER-SPEC.md` "Shared content (Explore)") and whose destructive `Remove session` row opens the confirmation dialog; confirming soft-deletes the session via `study_session.deleted_at` — the session disappears from the list, but the kept cards stay in the user's vocabulary and the source text is retained so future "my vocabulary" views can back-link to it. The confirmation overlay is explicit about this and points users at account deletion for full erasure. The same ⋮ menu sits in the reader header; removing from there navigates back to the list.
- **Explore** (`/explore`, its own desktop sidebar entry; on mobile an overflow tab view under `Dashboard`) is the community shared-content catalog: language chips over one-tap-addable entry cards. Deep behavior — share modes, moderation gating, publish lifecycle, the add flow — lives in `docs/READER-SPEC.md` "Shared content (Explore)".
  - **TV sessions group by show.** Episodes are one `study_session` each, but the list collapses every TV episode of the same show into a single tappable **show row** (poster + show title + `<lang> · N episodes`), derived client-side from the session list (`deriveTvShows`, keyed on the `tmdbShowId` now carried on the session DTO from `content_source.metadata`) — no per-episode rows clutter the list. Movies and every other source type stay individual rows; show rows and loose rows interleave by recency. Tapping a show row opens the **show detail screen** (a modal drill-in): a scrollable list of its added episodes (`S0xE0y · <episode>`, each linking to its session, each with the same soft-delete trash control) under a **sticky-footer `Add episode`** button. `Add episode` deep-links into the new-session wizard pre-seeded for this show (see "Start a movie or TV session"). The detail screen reads the cached session list, so it opens with no extra fetch; removing the last episode collapses the show and falls back to the Sessions list.
- **Modal screens** hide the chrome (no tab bar, no sidebar) and fill the viewport. They are: subtitles / mid-watch, session vocabulary list, focus view, new-session wizard, TV show detail (episode list), vocabulary coverage detail, and the `More` sub-pages (Account, Languages). (A standalone processing-poller screen still exists in the route tree but is no longer in the main flow — `Session vocabulary` jumps straight to the list, which shows per-highlight enrichment progress inline.) Top of a modal stack uses an **X** close in the top-left; in-stack pushes use a **chevron-back**. This mirrors React Navigation's `presentation: 'modal'` / `'fullScreenModal'` semantics.
- **More tab** consolidates user prefs and account pages: a sectioned list (General / Settings / About) with sub-pages for Account and Languages, plus an inline `Switch` row for `LLM-suggested terms`. About opens with a `User guide` row linking to `/user-guide`. Below the sections sits the TMDB attribution notice ("This product uses the TMDB API but is not endorsed or certified by TMDB", linking to themoviedb.org) — required verbatim by TMDB's API terms. The guide is a public route (the extension links to it): signed-in visitors get it wrapped in a chevron modal-screen header back to `More`, signed-out visitors get the bare page — no back affordance into the sign-in wall.
- **Onboarding gate.** A user with `is_onboarded = false` is held in the onboarding wizard (native language → welcome) — every `_app` surface (Sessions, Practice, Vocabulary, +New) redirects there so the mandatory values can't be skipped. The wizard's top-left **X is an escape hatch**, not a skip: it lands on the **More** tab, the one in-app destination a not-yet-onboarded user may reach (sign out, delete the account via Danger zone, change appearance). More shows a `Finish setup` banner that re-enters the wizard. The gate lives only on the `_app` layout and keys off the committed matched routes, so leaving `_app` for a sibling route (e.g. Danger zone at `/profile/danger-zone`) is never bounced. Completing onboarding (`completeOnboarding`) flips `is_onboarded` and releases the gate. Guest (anonymous) accounts never hit it: guest provisioning seeds `native_language` from the browser locale and `is_onboarded = true` up front (see User flows → First visit — guest mode). The **same `OnboardingView`** also runs inside the extension pairing tab (an `extensionPair` variant) so a not-onboarded extension-first user completes the one onboarding flow rather than a parallel one — see `apps/extension/EXTENSION-SPEC.md` → "Pairing & auth".

### Cross-source dedup

- `user_lookup(user_id, target_language, headword, sense)` is the canonical "user has already studied this" table. The composite PK lets the same headword be studied in multiple distinct senses (polysemy on bare lemmas — `correr | race` and `correr | spread (news)` are two rows).
- Whole-text LLM discovery and its source-relevant prefilter / Haiku tiebreaker
  are retired. Manual highlights and adopted ghost suggestions always produce a
  card; if the resulting `(user_id, target_language, headword, sense)` already
  exists, `user_lookup` is reused/incremented rather than duplicated.
- The old `EXCLUSION_PREFILTER.md` design is historical context for a future
  suggestion-ranking pass, not part of the active reader pipeline.
- Designed so future content sources (books, articles) feed the same dedup table — a chunk learned from a movie won't resurface in a book.

## Browser extension (companion) — spec lives in `apps/extension/EXTENSION-SPEC.md`

A separate product surface — a **fork of [asbplayer](https://github.com/killergerbah/asbplayer)**
(`apps/extension`, built with WXT) — that does the one thing the web app deliberately
isn't: in-video subtitle interaction. It watches streaming video (YouTube first-class,
plus Netflix and ~19 other platforms), tokenizes the active subtitle line into clickable
words, and feeds captures into the **same** Flicktionary backend, so a word grabbed while
watching shows up in the same Vocabulary / Practice pools. Optional; the web app is fully
usable without it.

The backend coupling in one breath: pairing is a web-brokered Supabase magic link (a
not-onboarded account runs the single web onboarding inside the pairing tab); hover gloss
is the stateless `glosses.fastGloss` (same shape and dialect-correct IPA as the web
reader's fast-gloss sheet); the first save on a video registers a session via
`studySessions.findOrCreateForYoutubeVideo` / `findOrCreateForStreamingVideo` — the
subtitle language is detected **server-side** by the same Haiku pass as SRT-upload/paste
and becomes both the track language and the session `target_language` (the extension
sends no language); saves are ordinary `highlights.create` rows flowing through the
normal enrichment pipeline into cards; saved spans reload via the lookup-only
`studySessions.lookupForVideo` + `highlights.listBySession`; missing prefs come back as
distinct 422s (`NEEDS_ONBOARDING` → finish-setup toast, `MISSING_CEFR` → in-overlay A1–C2
picker + retry, `UNSUPPORTED_LANGUAGE` → one-time notice, saving disabled). Flicktionary
is the system of record — the extension keeps no local word store.

**`apps/extension/EXTENSION-SPEC.md` is the authoritative spec** — behavior,
architecture, fork lineage, the removed-subsystem / donor-model policy, and the full
backend API surface. Read it before any extension work; update it — not this summary —
when behavior changes.

## Settings (per user)

- Native language (single).
- CEFR level per `target_language`. Asked once when starting a session in a new target language.
- Per-language practice caps. The practice-limits row (alongside the CEFR-per-language settings) renders TWO groups — **Recognition** {New, Review} and **Production** {Review only}. The Production review cap maps to `practice_max_review_terms_active` (nullable; an EMPTY input = uncapped = NULL = hard ceiling, the historical active default). Production has NO new cap by design.
- LLM-suggested chunks toggle (default on). When off, ghost nomination is inert:
  no windows are requested, no ghost outlines render, and no `Use suggested`
  adoption action appears. Manual highlights are still enriched into cards. The
  `Session vocabulary` button remains available even with zero highlights.
- Show translations toggle per target language (default on). This means
  "show/generate native-language translation fields for this target language",
  not "pretend the learner has no native language." Backend call sites use the
  shared language-mode helper: `nativeLanguage` stays the user's real L1
  (falling back to the session snapshot only when live prefs are missing),
  `targetLanguage` stays the session/lookup target, `sameLanguage` is true only
  when real L1 and target match, `hideTranslationFields =
sameLanguage || !showTranslationsEnabled`, and `allowL1Notes` is true when a
  real, distinct native language exists. When translation fields are hidden,
  prompts tell the model to leave `translation` / `native_example` empty and
  keep definitions, examples, glosses, and general explanations in the target
  language. `extras.l1_notes` remains allowed when `allowL1Notes` is true, even
  if translation fields are hidden, so false friends / transfer traps still
  work for users who do not want translation cards. Server-side write guards
  clear `translation` and `native_example` before persistence whenever
  `hideTranslationFields` is true, and clear `l1_notes` whenever
  `allowL1Notes` is false. The frontend separately gates translation/native
  example display and L1-note display; full exploration hides only
  translation/native-example fields when translations are disabled.

## Data model — spec lives in `docs/DATA-MODEL.md`

Generic source shape so non-movie content plugs in without migration:
`content_source` → `text_track` → `text_segment`; `study_session` + `highlight` +
`card` (with chat + read-state tables); the background-job tables (`processing_jobs`,
`nominated_windows`, `ghost_candidates`); the canonical vocabulary record `user_lookup`
(SRS state lives in `study_facets` — `docs/SRS.md` §1); and the practice tables
(`practice_text`, `practice_rating_events`, `practice_exercise`).

**`docs/DATA-MODEL.md` holds the full annotated schema** plus the card content tiers
(basic data, `grammar` bag, `exploration_extras`, and the computed export front/back).
Read it before schema or card-shape work; update it — not this summary — when the model
changes.

## LLM methodology prompt

Used as the system prompt for every heavy pass (context blob, basic-data, full-exploration, practice-text-generation) and per-card chat. Runtime variables: `{native_language}`, `{target_language}`, `{cefr_level}`, `{source_context_blob}`, plus a per-target-language instruction block (hardcoded in `language-instructions.ts`). Five blocks ship today: Spanish (rioplatense / peninsular / Mexican variant rules, pronominal-verb headword rules, plus grammar-field guidance for unpredictable gender + reflexive verbs + fixed-preposition verbs); Russian (clean-headword convention, soft-sign-masculine flagging, aspect + aspect_pair_headword + government rules, plurale tantum, stress-marked `display_form`); English (marked-infinitive headword convention `to <verb>`, prepositional-verb government, irregular-form `notable_forms` for irregular pasts / plurals / comparatives, plurale tantum); German (bare-capitalized-noun / article-derived-from-gender convention — the article is never in the headword — required gender + plural + genitive forms + weak-noun flag for nouns, joined-prefix infinitive + separable flag + perfect auxiliary (`haben` / `sein` / `haben_or_sein`) for verbs, principal parts in `notable_forms`). The German citation line is composed at render time by a shared helper (`packages/core/src/utils/german-noun-forms.ts`): `der/die/das` from gender, the plural as a `pl -e` suffix or full `die Häuser` form, and the genitive only when it deviates from the predictable masc/neut `-(e)s`. Portuguese ships a fifth block (Brazilian/European dialect defaults, hyphenated pronominal headword convention `queixar-se`, unpredictable-gender + fixed-preposition guidance). The English, Spanish, and Portuguese blocks are parameterized on the user's per-language IPA dialect pref (en `ga`/`rp`, es `cas`/`lam`, pt `br`/`eu`): the pref sets the default variety for usage and IPA, names the `grammar.ipa` bucket to fill, and flips which variety gets flagged as regional — each dialect value is its own stable cache-prefix variant; the dialect is threaded through every pass that renders the methodology prompt (passes without a resolved pref default to `ga`/`lam`/`br`). The block is injected right after the methodology preamble, inside the cacheable prefix; sessions in a target language with no entry fall through silently.

```
You are a linguistic co-pilot for a language learner. Methodology: lexical approach.

Core principles — apply to everything you do:

- Chunks over single words. Always present language in its natural environment.
  Not 'suggest' but 'suggest doing something' / 'suggest that someone do something'.
- Register and frequency awareness. Flag whether something is frequent in speech
  vs writing. A word can dominate written prose but sound alien in conversation.
- Functional load. Many unnatural learner productions are fixed by common verbs
  + preposition, not fancier vocabulary. Flag these patterns when relevant.
- Connotation and prosody. Synonyms can share a denotation but differ in emotional
  weight or rhythm. Always flag this.
- L1 interference. Apply your knowledge of typical interference patterns from the
  user's native language to the target language: false friends, structural transfer,
  missing or extra grammatical features, register mismatches.
- Discourse markers and pragmatics. Words like 'well', 'I mean', 'the thing is'
  carry no lexical meaning but are essential for natural speech. Don't ignore them.
- Collocational range. Some words are promiscuous (big, great, nice), some are
  highly restricted. This affects teachability.
- Default to standard educated {target_language}. Flag regional or dialectal usage.

User profile:
- Native language: {native_language}
- Target language: {target_language}
- CEFR level: {cefr_level}
- The user is a serious self-directed learner. Be efficient and direct. No praise,
  no pedagogical fluff. Skimmable formatting.

Source context for this session:
{source_context_blob}

When asked to explore a chunk, output the Full exploration template (defined by
the caller) and stop. For follow-up chat about an already-explored chunk, answer
directly and concisely. Never ask 'want me to explore X?' or suggest further
lookups. Never offer multiple follow-up options at the end. If a clarifying
question is needed, ask exactly one.
```

## User flows

**First visit — guest mode**

1. A browser with no session hitting any `_authenticated` route is signed in anonymously (`signInAnonymously()`) and continues straight to its destination — no login page, no onboarding. Gated on the backend's `GUEST_MODE_ENABLED` kill switch, served pre-auth via `config.getConfig` so flipping the Doppler var needs no web redeploy; when off (or Supabase rejects the sign-in), the visitor gets the normal `/login` redirect. When off, the backend also rejects existing anonymous JWTs with the distinct `GUEST_ACCESS_DISABLED` code, and the web app silently signs those guests out to `/login`. A second, softer lever sits alongside the kill switch: when the same config response carries a non-null `captchaSiteKey` (`CAPTCHA_ENABLED` + `TURNSTILE_SITE_KEY` in Doppler, mirroring the GoTrue-side `[auth.captcha]` block in `supabase-prod/supabase/config.toml`, applied with `db:prod:config:push` — flip both together, the Doppler flag first; the Turnstile secret is stored once on the hosted project and never lives in the file), the guard first runs an **invisible Cloudflare Turnstile** challenge (`getCaptchaToken` in `apps/web/src/features/auth/api/turnstile.ts`, 10 s cap) and passes the token to `signInAnonymously`. Any failure — blocked script, failed challenge, timeout, or a GoTrue rejection — silently downgrades the visitor to the `/login` redirect (captured as `guest_captcha_failed` with the reason, plus the GoTrue error code on rejections): a first-time visitor doesn't know guest mode exists, so a login wall reads as normal while an error would read as broken. Existing guest sessions are never affected — only creating a new guest gains friction. Every other auth flow rides captcha-exempt endpoints (service-role magic link, `/verify`, `/user`, OAuth `/authorize`, token refresh), so enabling captcha on the Supabase side changes nothing else. In dev the lever is permanently on with Cloudflare's always-pass test keys (sitekey hardcoded in the backend dev config, secret in the local stacks' `[auth.captcha]`) so the emergency path can't rot untested; enabled-with-missing-sitekey fails the backend at startup rather than silently serving null.
2. The guard provisions the guest before the route tree renders: `putUser` seeds tracking params, `native_language` from the browser locale (fallback `en`, changeable later in More → Languages), and `is_onboarded = true` — guests never see the onboarding wizard.
3. A `flick.returning-user` localStorage marker is set whenever a non-anonymous session is observed and survives sign-out's storage wipe; browsers with the marker (returning real users, expired sessions) get `/login`, never a silently created guest account. Guest auto sign-in is also skipped on the pairing routes (`/extension-pair`, `/telegram-pair` — minting their credentials requires an email) and when a Telegram `?auth=` nonce is present, so a failed nonce can't be hijacked by a fresh guest. An *existing* guest session landing on either pairing route gets a "create a free account" card linking to `/save-progress` instead of a doomed pairing attempt, with backend backstops (`mintSession` rejects email-less users; `telegramPair.claim` rejects anonymous users before burning the nonce, so the same link works after converting).
4. Analytics: guests are identified as usual with an `is_guest` person property so drive-by accounts can be filtered from funnels. The abuse-volume signal is server-side: the backend captures `guest_provisioned` (once per guest, in `putUser`'s first-provisioning branch) because a scripted attacker POSTing `/signup` directly never runs the client JS, while extracting anything of value requires calling the backend with the guest JWT.
5. **Guest → account conversion.** A persistent (non-dismissible) "Save your progress" banner on the dashboard and the More tab, plus an Account-page row, lead to `/save-progress`, which converts the anonymous account **keeping the same user id** — all sessions, vocabulary, and SRS state carry over. Email path: `updateUser({ email })` sends a confirmation link (the `email_change` template) to `/login/email/verify?type=email_change`; if the server runs with email confirmations disabled, the change applies instantly and the UI goes straight to the success state. Google path: `linkIdentity` (requires Supabase's manual-linking setting), returning to `/save-progress?linked=google`. Either way the session is refreshed afterwards so the `is_anonymous` JWT claim drops and guest restrictions lift; the backend reads the converted user's email from the verified top-level claim (`user_metadata` is never written by conversion). If the email or Google identity already belongs to another account, Supabase refuses and the screen offers "log in instead" — accounts are never merged. The normal login flow is never offered to a guest: signing in there mints a different user and would orphan everything the guest saved. Sign-out is confirm-gated for guests for the same reason — the session is the only credential, so both sign-out affordances (More tab row, pricing screen) open a confirmation overlay (`GuestSignOutConfirmOverlay`) spelling out the permanent loss, with "Create account first" (→ `/save-progress`) as the primary action and a destructive "Sign out anyway"; non-anonymous users keep the immediate one-tap sign-out.
6. **Guest source cap.** A guest's library — the distinct non-adhoc content sources they hold a live session on — is capped at `MAX_SOURCES_PER_GUEST` (default 3; a malformed value falls back to 3 rather than silently disabling the cap). Enforced server-side inside the creating transactions (`assertGuestSourceQuota` / `assertGuestSessionQuota` in `apps/backend/src/transport/database/guests/guest-source-quota.ts`), serialized per user on an advisory lock so concurrent requests can't race past the cap: at every source-creating path (web wizards, extension ingest, lesson import, Telegram) and at session creation, where globally-deduped movie/TV sources actually enter a guest's library. Lesson imports are additionally bounded to the same number of live unconfirmed drafts (`assertGuestLessonBatchQuota` in `createBatch`, before moderation/extraction), since drafts run LLM extraction before any source exists. The guards read the live `auth.users.is_anonymous` column rather than the JWT claim, so JWT-less surfaces (Telegram bot) are covered and conversion un-caps immediately, before the token refreshes. Never blocked: re-attaching a source with a live session, idempotent re-ingests, resuming an existing lesson draft, and adhoc word saves. Because only live sessions count, an abandoned wizard can't burn a slot, and deleting any session frees its slot. Over-cap requests answer `403` with code `GUEST_SOURCE_LIMIT_REACHED`; the web app maps it to a create-account overlay leading to `/save-progress` (and captures `guest_source_limit_reached`), the Telegram bot replies with the same create-account pitch.
7. Everything else email-shaped degrades gracefully for guests: account deletion works (the `removals` audit row records a NULL email), the contact form simply starts with an empty (editable) email field, and admin/test-user gating never matches an empty email.
8. **Retention.** Guest accounts that never convert are deleted by a periodic backend sweep (`anonymous-cleanup-worker`, next to the enrichment worker) once older than the retention window — `ANON_CLEANUP_INTERVAL_DAYS` / `ANON_RETENTION_DAYS` in Doppler, defaults 7 / 30 days. The sweep also runs at every backend boot (deploys restart the process more often than the interval elapses), converted accounts flip `is_anonymous` off and are never touched, and deletion cascades all app data with the auth row — Supabase itself never cleans anonymous users up.
9. **Extension guests.** The browser extension mints its own anonymous session on the first hover-gloss (same `signInAnonymously` + `putUser` provisioning, counted by `guest_provisioned`) for **gloss-only** access — saving and every other backend feature stay gated behind a real account, with an in-video "create a free account" dialog whose CTA is the normal pairing flow. Armed captcha (real sitekey) disables extension guest minting entirely — Turnstile can't run in a service worker. Details in `apps/extension/EXTENSION-SPEC.md` ("Pairing & auth").

**Start a movie or TV session**

1. From the `+` overlay, pick `Start a movie or TV session`.
2. Pick the study language. If first session in this target language: prompt for CEFR level.
3. Choose `Movie` or `TV show`.
4. Pick the content (TMDB-backed metadata): a movie, or a TV show → season → episode.
5. Pick a subtitle track: OpenSubtitles search filtered to target language (movie by `tmdb_id`, episode by `parent_tmdb_id` + season + episode), or upload `.srt`.
6. App verifies the chosen track's language matches target language; can't proceed otherwise.
7. Session created.

For a show already in the Sessions list, the `Add episode` button on its show detail screen enters this flow at step 4's episode picker (show + season pre-seeded, language/CEFR skipped), and step 3's TV-show search offers recently-added shows as quick-picks — see `docs/READER-SPEC.md` → "Movie & TV subtitles".

**Start a text session**

1. From the `+` overlay, pick `Practice with a text`.
2. Paste the source text (50–20,000 chars). Title field auto-fills with the first ~60 chars (truncated at a word boundary); user can override.
3. Pick the language of the text (auto-detected from the paste; manual override always wins).
4. If first session in this target language: prompt for CEFR level.
5. Session created. Same mid-session UI as movies, minus the timestamps.

**Add a word (no source)**

1. From the `+` overlay, pick `Add a word`.
2. Pick the target language (any supported language; defaults to the user's `lastTargetLanguage` MRU, then the first CEFR-set language alphabetically). An advisory amber hint suggests switching if the typed headword + context look like a different language.
3. Enter the headword and an optional context sentence.
4. If CEFR is not set for the picked language: inline CEFR prompt opens; on save the original submit replays.
5. Server lazily creates (or reuses) the synthetic `(user, target_language)` adhoc session, appends a segment + highlight, runs a one-shot highlight-only basic-data pass, runs Wiktionary grounding when applicable, returns `{ cardId, sessionId }`.
6. Frontend lands on the focus view of the new card with `?scope=language`, so chevron-back pops history to `/vocabulary`.

**Import lesson notes**

1. From the `+` overlay, pick `Import lesson notes`.
2. Paste the teacher's notes or upload the exported file (`.md` / `.xlsx`, normalized to
   markdown client-side with intra-cell bold preserved). Title auto-suggested; language
   auto-detected (manual pick wins); optionally attach a stored teacher profile.
3. Background extraction runs (~1 min); the confirm screen shows the proposed rows
   grouped by consequence (new / already-in-vocabulary / pronunciation / couldn't-parse /
   wins), pre-checked at extractor confidence ≥ 0.8, with per-row skill chips and a
   `⚠ lapse` badge where a known card will be rescheduled.
4. Confirm (LLM-free) creates the lesson session + one highlight per accepted new row;
   cards materialize through the normal background enrichment; duplicates get facets
   added and (if in review state) an implicit `again` lapse excluded from the daily
   review budget. The user lands on the session-vocabulary view.

**Mid-watch**

1. Open the session.
2. Search the track or scroll. Optionally tap-to-translate (sheet) for quick checks.
3. Select text in a line (or across lines) → highlight sheet → optional note/presets → save.

**Reading → session vocabulary**

1. As the user highlights while reading, each highlight is enqueued for
   background enrichment (debounced ~5s) and the worker materializes its card and
   **auto-keeps it** once basic data lands — so most terms are kept and ready
   before the user finishes reading.
2. As the user scrolls, settled reading windows can enqueue ghost nomination
   jobs. Ghosts render as passive suggestions in the reader; adopting one swaps
   the provisional selection for the suggested span and then enriches it as a
   normal highlight (so it auto-keeps too).
3. User taps `Session vocabulary` (or opens the session-vocabulary list). This
   navigates straight there — no synchronous pass, no status flip, no polling page.
4. The session-vocabulary list shows kept terms immediately, a placeholder row
   per highlight still enriching, and a retry affordance for any failed
   enrichment; it polls the `processing_jobs`-backed status until everything
   drains.

**Review and practice**

1. Session-vocabulary list — review the kept terms, Remove (unkeep) any you don't want. The modal-header chevron closes back to the sessions list; a `Source` button in the right slot cross-jumps to the mid-watch view.
2. Drill into focus view for any card. Edit fields, chat to refine, optionally `Generate full exploration`; **Remove from session** unkeeps.
3. Sticky-footer `Quiz your terms` button launches the session recap — a client-side quiz over all the session's kept terms with no SRS effects. SRS onboarding happens separately: the composed Practice queue plans daily-new-capped gate exercises and atomically introduces each term only when its gate is reached; after graduation they enter the flashcard queue. General flashcard practice over the language-wide pool stays on the Practice tab — kept chunks feed into it via the user-lookups upsert that fires on the auto-keep transition.

**Export vocabulary**

1. Open the Vocabulary tab.
2. Pick the language pill (skipped if you only have one language).
3. Header 3-dots → `Export vocabulary` → download CSV.

**Add more highlights later**

1. From the session-vocabulary list, tap the `Source` button (or open the session card again).
2. The mid-watch UI is always browsable while the session is `active` — the session-vocabulary list jumps back; highlighting still works.
3. Each new highlight is enriched in the background on commit (no explicit "process" step needed); its card shows up — auto-kept — in the session-vocabulary list when the worker finishes. Ghost nomination continues window-by-window as the user reads.

## Future work

Post-MVP ideas and undecided design questions are kept out of this spec — it
describes what ships today. See `docs/proposals/web-future-ideas-and-open-questions.md`.
