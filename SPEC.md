# Flicktionary — MVP spec

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
buttons, placeholders, toasts, error messages) uses **"term"** instead. So
`Practice these chunks` reads "Practice these terms" on screen; the
`LLM-suggested chunks` toggle is labeled "LLM-suggested terms"; deleting a row
shows "Term deleted"; etc. Where this spec quotes a user-facing string in
backticks, it uses the on-screen word ("term"); where it describes the
internal model, it uses "chunk".

## Core decisions

### Source content

Three source kinds in the MVP, all feeding the same `text_segment` table. (A fourth ingestion path — **YouTube via the companion browser extension** — also lands in `text_segment` but is not a web-app flow; see "Browser extension (companion)".)

- **Movie & TV subtitles.** Movies and TV episodes share one wizard flow; the user picks `Movie` or `TV show` after choosing the study language. TV adds a season → episode selection (TMDB `/search/tv` → `/tv/{id}` seasons, season 0 / Specials hidden → `/tv/{id}/season/{n}` episodes). Each episode is its own `content_source(type='tv')` titled `"<show> · S0xE0y · <episode>"`, deduped globally on `(tmdbShowId, seasonNumber, episodeNumber)` (a DB partial unique index backs the app-level check); movies stay `type='movie'`.
  - **Continuing a show (fewer clicks).** Two shortcuts cut the wizard down for shows already being watched. (1) The TV-show search step lists the user's **recently-added shows** (MRU) under the search bar; picking one skips the TMDB search. (2) The show detail screen's `Add episode` button deep-links straight into the **episode picker** with the show + season pre-seeded (language and CEFR are already known for an existing show, so those steps are skipped). In the episode picker, episodes already added for that show+season are marked `Added` and the first not-yet-added episode is highlighted as `Next`. From there it's the normal subtitle-source → subtitle-pick path, so continuing a show is roughly "Add episode → confirm episode → pick subtitle".
  - **OpenSubtitles search.** Search by title; results filtered to the user's target language. The track's `language` must match the chosen study language — never inferred. TV episodes search OpenSubtitles `/subtitles` with `parent_tmdb_id` + `season_number` + `episode_number` + `type=episode`; movies search by `tmdb_id`.
  - **Manual `.srt` upload.** First-class, not a fallback (available in both the movie and TV branches). Language is auto-detected from the SRT contents server-side (Haiku call) on upload and applied to the picker; the user can override before the upload completes.
  - On import, SRTs are normalized into per-line `text_segment` records (with `start_ms`/`end_ms`) and indexed for full-text search. The raw SRT is not preserved as a single blob.
- **Pasted text.** First-class, not a fallback. The user pastes raw text (50–20,000 chars), provides a short title (auto-suggested from the first ~60 chars), and picks the language (auto-detected from the paste via a Haiku call as the user pauses typing; the manual override always wins).
  - Segmented one row per non-empty line (`\n`-split, trimmed). `start_ms`/`end_ms` are null.
  - Same FTS / dedup-hash plumbing as subtitles.
- **Ad-hoc vocab entries.** Source-less captures from the "Add a word" flow (`+` overlay → `Add a word`). The user types a single word/expression plus optional context; one card is generated by a single basic-data pass call. Each `(user, target_language)` pair gets one synthetic `content_source(type='adhoc', title='Personal vocabulary')` lazily on first entry; each subsequent entry appends a `text_segment` (the user's context, prefixed with the headword for safe offset math) and a `card`. The synthetic session carries a hardcoded non-empty `context_blob` so per-card chat and `Generate full exploration` work unchanged. Hidden from the Sessions list — these live exclusively in the Vocabulary tab. CEFR for the target language is required (prompted inline if missing). The picker defaults to the user's `lastTargetLanguage` MRU (then the first CEFR-set language alphabetically). Language is **not** auto-applied here — single-word input is too ambiguous (homographs like `importar` ES/PT) — but a prominent, easily-tappable advisory banner (`Looks like German` text + an explicit `Switch` action with an icon, sized for a large touch target) appears below the picker when Haiku detects a different language in the typed headword + context. One tap applies the switch and dismisses the hint for the rest of the session.
- All user content is RLS-scoped. Don't expose subtitle or paste text publicly.

### During a session

- No in-movie sync. The app is for triage and lookup, not playback.
- The mid-source screen is a search bar over the track plus a scrollable list of segments. Movie segments show a timestamp; text segments don't. That is the entire mid-source UI.
- Tap-to-select on plain segment text opens a small **floating gloss sheet** anchored to the selection, in PREVIEW mode — looking is free; nothing persists until the explicit **Save** (desktop popover, capped to the viewport's available height with internal scroll so an expanded sheet never clips; its main action footer is sticky below the scrollable body, and wheel/touch overscroll is contained so the page behind it does not scroll; mobile bottom drawer with a transparent overlay so the source line stays visible — the drawer always docks at the bottom and opens collapsed, showing the header (term, gloss, IPA, register chips) pinned in full plus a short peek of the detail region below it; the action footer is a distinct pinned bar (top border, plus a soft upward shadow only while collapsed so the peeking content reads as tucking under it). Dragging from the handle **or** the header follows the finger continuously — the sheet grows/shrinks between the collapsed and expanded detents (rubber-banding past the expanded cap) and snaps to the nearest one on release by final position + flick velocity; a downward drag past the collapsed edge dismisses. The detail region scrolls internally only once expanded). A single click/tap selects one `Intl.Segmenter` word in the session's target language; press-and-drag extends to a contiguous word range, including multi-line / multi-segment ranges. Selectable words show a subtle accent-tint hover affordance; the selection paints a sky wash (outer corners rounded) that PERSISTS while the sheet is open — it shows what the sheet refers to — and clears on sheet close or the next press. Tapping another word while the sheet is open swaps its content in place (no close/reopen flash) — the sheet's `ignoreOutsidePointerDownSelector` keeps the tap on a word/highlight span from dismissing it. Native browser text selection is disabled in the segment list so the gesture vocabulary stays consistent. Clicking an existing yellow highlight opens the existing-highlight sheet instead. The sheet fetches a fast one-line gloss + POS + register tag; on Save, that already-shown preview gloss is sent to `highlights.create` and persisted on the new highlight so saved mode does not run a second first-gloss LLM pass. A re-tap on the same span is instant. There is no backdrop tint and no separate tap-to-translate opt-out (the old setting was retired when the sheet became unobtrusive enough to be always-on). **Right-click is the save/remove toggle** (extension parity): on a bare word it saves immediately — no selection, no sheet — and on a saved highlight it removes it; with the sheet open it saves in preview mode and removes in saved mode, so repeated right-clicks cycle save → remove. The open sheet SURVIVES the toggle and morphs in place (right-button pointerdown is never a dismiss gesture for the floating sheet): preview → saved on save, and saved → preview on remove when the sheet holds a live selection (a sheet opened from a highlight click has no selection to preview, so a remove closes it). Saving and removing show **no success toast** — the span's yellow wash appearing/disappearing is the feedback (a toast per word gets noisy at volume and overlapped controls on mobile); failures still toast. **Saves paint optimistically** (extension parity): `useCreateHighlight` inserts a temp row (`optimistic-` id prefix) into the highlights cache in `onMutate`, so the yellow wash appears the moment the user saves; the create response swaps in the real row, errors roll back, and the settle-time invalidate keeps the server's view the truth. Interactions keyed on a highlight id (the right-click remove, clicking a highlight span, the sheet's saved-row dedup) skip optimistic rows until the real id lands. The sheet's IPA line renders the **server-picked `ipaDisplay`** from the fastGloss responses (the backend resolves the user's `english_ipa_dialect` pref), so web and extension show the same dialect for the same word; the `ipa` bag stays in the contract for older clients. IPA is Wiktionary-only: the surface form's own pronunciation is used when it exists, otherwise the lookup falls back to the form's lemma (via form-of resolution; the `wiktionary_forms` index carries no per-form IPA, and English inflected forms deliberately do **not** inherit the lemma's). On that fallback the response also carries `ipaLemma` (the lemma the IPA belongs to), and the sheet labels the line with it — `beheben /bəˈheːbən/` under a `behoben` selection — so an inflected surface form is never implied to be pronounced like its lemma; `ipaLemma` is null when the IPA is the surface's own (and never shown next to the "No Wiktionary IPA" fallback).
- The sheet shows an always-visible **study-target picker** (shared `StudySkillCards`, wrapped by `StudyOptionsSection`, also used by the practice lookup sheet and the extension's in-video popover): three monochrome, pressable icon-cards — Recognition (eye) / Production (pencil) / Pronunciation (mic), selected = dark border + filled-check badge, desktop tooltip = a shared Radix Tooltip opened on hover and positioned above the card — its `onFocusCapture` swallows the focus the popover fires when it autofocuses a card on mount, so the tooltip never self-opens just because the popover appeared (radix-ui/primitives#2248); in the extension it portals into the in-shadow popover container, which is marked `dark` and at the popover's max z-index so the tooltip is styled, dark-themed, and stacks above the popover instead of under it — plus a **Base form | Exact form** segmented control (Exact form shows the highlighted surface as its subtitle). The control is **exclusive**, not additive: it chooses WHICH target the selected skills attach to — *Base form* studies the lemma (citation facets), *Exact form* studies the encountered inflection (form facets), leaving the lemma a skill-less base anchor (it still exists as the term + vocab row + the focus view's citation chip; the form is shown beside it). `formScope: 'lemma' | 'form'`; `'form'` collapses to `'lemma'` server-side when the surface IS the headword. The cards are mono semantic tokens so they invert cleanly on the extension's dark video overlay. FULL-SET semantics — an untouched draft sends no `studyIntent` (the backend keep-time default applies); a touched draft sends exactly the checked set, riding `highlights.create` and applied by the enrichment job. **Nothing is pre-checked and 0 selected is allowed** in the popover (an empty set sends no intent → a `needs_data` card with no pre-configured facet; the keep-time default then enables recognition). The Base/Exact control locks until at least one skill is selected (skills need a target to attach to); Pronunciation is ALWAYS offerable (the preview's IPA is a Wiktionary-only lookup — enrichment generates IPA for every saved selection, and IPA-less facets are defended backend-side; see `docs/SRS.md`). On Save the sheet morphs in place into saved mode, where the **same study-target picker stays visible but is locked read-only** — it keeps its preview layout, uniformly dimmed + non-interactive (`pointer-events-none`, no per-control disabling so there's no half-greyed mismatch), with a lock caption pointing at the term view. It *displays* the saved skills + scope: from the highlight's stored `study_intent` pre-enrich, then from the term's live facets once the enrich job materializes it and a `chunkId` resolves (`chunks.getStudyTargets`, read-only — the sheet still polls `highlights.listBySession` only to switch that display source). The study-target choice is a SAVE-TIME decision: the only places to change it are the preview picker (before saving) and the focus / term view afterwards (or deleting the highlight). This is deliberate — switching scope post-enrich means creating/deleting durable form facets, which the compact sheet can't represent, so editing lives in the focus view alone.
- **Two commit lanes (preview footer).** The pre-save footer exposes both an **Add note** affordance and the main **Save** button — looking is free; nothing persists until one of the two commits. **Save** (main lane) creates the highlight and runs the normal `enrich_highlight` → full card pipeline; a note typed before saving rides along and seeds the card chat once. **Save note** (the note editor's own commit, shown once the editor is open) is the **note-only** lane ("ask a question, don't make a card"): it sends `highlights.create` with `noteOnly: true`, which synchronously creates an **empty stub card** (no basic-data pass, no Wiktionary grounding, no study facets) and seeds the card chat from the composed note/presets. A note-only save is still a real highlight (yellow span, session-vocabulary row, removable) — only the card body is empty until the user generates it later (see the session vocabulary list). Skill selection is ignored in the note-only lane. When the note editor is open in preview, the footer shows **both** `Save` and `Save note`; collapsed, it shows `Save` + `Add note`. Both footer buttons keep the same size and split the width 50/50 in every state. **`Save note` is disabled until a note or preset is entered** — an empty note-only save would create a data-less stub whose chat never gets seeded (nothing to ask), so it is not allowed.
- **Cyclable Save ⇄ Saved.** Once saved, the green **Saved** state is itself the remove control — clicking it removes the highlight and morphs the sheet back to preview (the on-screen counterpart of the right-click save→remove toggle), replacing the old standalone trash button. While composing a brand-new, not-yet-committed note it shows **Save note** instead.
- In saved mode the floating sheet bundles every action that used to live in a second-tap menu: optional free-text note, preset chips (`Explain`, `3 examples`, `Synonyms`, `Etymology`, `Why this form?`), and the cyclable **Saved** remove control. The note editor and chips live behind an accordion chevron in the header on both mobile and desktop; the mobile sheet can be flicked down by its drag handle to dismiss. The note and tags are passed to the LLM at processing time. **The note/presets seed the card chat exactly once and lock on save** (like the study-target picker): a committed note/preset set renders the editor read-only — the saved note + selected chips, uniformly dimmed + non-interactive, with a lock caption — and the footer collapses to the cyclable **Saved** control (no `Edit note` / `Save note`). Re-saving would post a duplicate seeded chat turn (the seed is keyed per highlight, not per save), so the only way to change a committed note is to delete the highlight and start over; the card's own chat input handles genuine follow-ups. An empty save (no note, no chips) seeds nothing and stays editable, so a word saved without a note can still get one — once.
- **Reading position.** The reader tracks the deepest segment the user reaches by
  segment index (not scroll pixels), so it survives search filtering and a future
  virtualized reader. The value is persisted (throttled, monotonic) on
  `study_session.furthest_read_segment_index`. Reopening the session lands back
  at that line with no visible scroll (positioned in a pre-paint layout effect),
  and a floating `Last read` pill appears when that furthest-read segment has
  scrolled *below* the viewport (the reader scrolled back up to re-read). Tapping
  it returns to the same saved line, aligned at the bottom of the viewport.
  Restore and the pill are suppressed while searching, and resume-tracking is
  also suppressed under a deep-link open (the `Open source` jump from a card /
  Vocabulary carries `?segment=`), so peeking at a term's source never moves the
  saved position. An explicit `?segment=` target also wins over resume on open.
- When `LLM-suggested terms` is enabled, the reader also shows **ghost candidates**: passive underlined spans nominated by the LLM for the reading window around the user's current scroll position. Ghosts never use `data-highlight-id`, never intercept pointer events, and have no click handler; the user still selects text normally. If a fresh selection overlaps a ghost, the floating gloss sheet shows an understated **lightbulb icon button** in the sheet header (a `Use suggested term` tooltip on desktop hover). Tapping it atomically swaps the provisional user-selected highlight for the ghost's exact segment/offset span, expands the sky-wash paint to cover the full suggested span, dismisses the ghost, and sends the adopted span through the same background enrichment path as any manual highlight. Because nomination is an LLM call that can take several seconds, the reader's sticky footer shows a `Finding suggestions…` loader (beside the highlight-count hint, left of `Session vocabulary`) whenever a nomination request is in flight or a window's job is still `pending`, so the delay does not read as broken. Turning the pref off disables nomination, ghost fetching/rendering, the adoption action, and the loader.

### Processing pipeline

Two background job families power the reader: per-highlight enrichment produces
cards, and reading-window ghost nomination produces passive suggestions that can
later be adopted into highlights. Both run server-side as durable background jobs
off a Postgres-backed queue (`processing_jobs`), drained by an in-process polling
worker with **leases** (a crashed claim is reclaimed once its lease goes stale)
and bounded concurrency. The worker is dependency-injected and a no-op in
test/mock runs. Anthropic calls stream so long highlight-enrichment responses do
not hit SDK duration limits.

- **Per-highlight enrichment** (`enrich_highlight` job) — enqueued the moment a
  highlight is committed during reading (debounced ~5s to absorb mis-selections),
  so cards are mostly ready by the time the user reaches the session vocabulary
  list. One job enriches
  exactly one highlight: a highlight-only basic-data pass over a DB-windowed
  slice of surrounding segments (not the whole track), on
  `MODEL_ENRICHMENT` (Sonnet by default; the `ENRICHMENT_MODEL` env var flips it
  back to Opus). Highlights are independent. The worker re-checks the highlight
  still exists immediately before writing, so deleting a highlight mid-flight
  cancels cleanly (no card, non-retryable). Card creation is idempotent (partial
  unique index on `cards(highlight_id)`), so a retry never double-creates.
  - **Auto-keep.** Saving a highlight is already an explicit commit, so the card
    auto-keeps the moment it has basic flashcard data — there is no separate
    Keep step. The shared helper `autoKeepNeedsDataIfEligible` re-fetches the
    card and keeps it **only if** its status is still `needs_data` **and** it has
    basic data (`cardHasBasicData`): the `needs_data` gate means a `removed`
    card is never resurrected by a later
    retry/chat/exploration write, and the data gate skips note-only stubs. It runs
    at every basic-data write path — `enrich_highlight` (after `applyStudyIntent`),
    on-demand `Generate full exploration`, and the chat tool's content write — and
    **always after `applyStudyIntent`** so the intent's facets exist before the
    keep-time recognition default fires (otherwise a production-only / exact-form
    intent would gain a stray recognition facet). The adhoc Add-a-word flow has
    always auto-kept; this generalizes that pattern. Adopted ghost suggestions
    flow through `enrich_highlight` like any manual highlight, so they auto-keep
    too.
- **Ghost nomination** (`nominate_window` job) — enqueued as the reader settles
  on a scroll position, windowed by segment index rather than client array
  position. A nominated window is recorded in `nominated_windows` even when it
  yields no candidates, so reloads and back-scrolls do not re-request work.
  Coverage-row creation and job enqueue are one transaction: a window cannot be
  marked covered without a worker job. On terminal job failure the window is
  marked `failed` so the client does not poll forever. The nomination pass returns
  candidate spans as `segment_id` + raw segment `char_start` / `char_end` +
  `surface_form`; offsets are trusted only when the slice matches the surface,
  otherwise the candidate is recovered only if the surface occurs exactly once.
  Candidates persist in `ghost_candidates` until adopted, at which point
  `dismissed_at` hides them.

There is no synchronous processing step in the reader anymore — highlights are
enriched one at a time by the background queue as they are committed. The reader's
footer carries a single `Session vocabulary` button that is pure navigation: it
runs no pass (the backend `process` endpoint it still calls is a
backward-compatible no-op for old clients). Sessions have no lifecycle status
column at all — enrichment progress lives in `processing_jobs`, surfaced to the
session vocabulary list via a status endpoint (which highlights are still
enriching, which failed); the list renders a placeholder row per
not-yet-materialized highlight and a retry affordance for failed jobs, polling
until enrichment drains.

The enrichment path uses these shared steps:

1. **Source context blob** — one call per `study_session`, persisted on the row by whichever job runs first; later jobs read the cached value.
   - Output ~300 tokens: topic (genre + plot sketch for narrative material; subject matter for non-narrative), register, tone, recurring vocabulary themes, named entities or recurring referents the learner will encounter.
   - Source-type-aware: prompt is the same but the user message labels the excerpts (`Subtitle excerpts` / `Article excerpts` / `Text excerpts` / `Book excerpts`) so the model knows what it's looking at.
   - Acts as a cacheable prompt prefix for every subsequent call related to this session.
2. **Basic-data pass** — the highlight-only LLM call. Enrichment invokes it over
   a surrounding-segment window with one highlight. It never discovers new chunks.
   - Input: the surrounding segment window, the one user highlight, source context
     blob, CEFR level, and language-mode prefs.
   - Output: one row for the highlight with `source='highlight'`, normalized
     `headword`, `sense` (1-5 word disambiguator), `surface_form`, `segment_id`,
     the **basic flashcard data** (`translation`, `definition`,
     `target_example`, `native_example`), and an optional sparse `grammar` bag of
     typed morphology / grammar facts (pos, gender, aspect, aspect_pair_headword,
     government, number_only, is_indeclinable, is_reflexive, animacy,
     display_form, notable_forms) — populated only for keys that matter in the
     target language (per the per-language instructions block).
   - Highlights bypass the CEFR floor — they always produce a card because the
     user explicitly selected the text.
   - The LLM **normalizes the chunk**: it produces a `headword` that may
     differ from `selection_text`. Example: user highlights `out` inside
     `ran out of milk` → `headword = "run out of"`.
3. **Wiktionary grounding (post-basic-data, per-language).** For target
   languages loaded from the raw Kaikki/Wiktextract dump into our
   `wiktionary_entries` / `wiktionary_forms` tables (currently `ru`,
   `en`, and `de` — gated by `KAIKKI_LANGUAGES`), each newly-touched
   `user_lookups` row is looked up via a four-path chain: real-lemma direct
   hit → real-lemma POS-agnostic → form-of pseudo-entry resolved to its
   underlying lemma → `wiktionary_forms` paradigm-cell match. For English
   verbs, direct lookup also tries the headword without a leading `to `
   under the same verb POS (`to stink` → `stink`) before falling back to
   broader paths. When something matches, the structured grammar fields the
   extractor knows about (e.g. POS, Russian gender/animacy/aspect fields,
   German gender/plural/genitive/weak-noun + separable/auxiliary fields,
   display_form where appropriate, and Wiktionary IPA) are shallow-merged
   into the row's `grammar` JSONB with **kaikki winning where both sides
   have a value**; LLM-only keys (e.g. `government`, `notes`,
   `notable_forms` — German keeps principal parts LLM-owned) are preserved
   untouched. English **and German** skip Wiktionary `display_form` because
   head-template expansions are noisy (`dictionary (plural dictionaries)`;
   German `Haus n (strong, genitive Hauses, …)`); English IPA is bucketed
   into GA/RP when tags allow it, while non-English IPA uses the untagged
   bucket — for German, sounds tagged only `standard` / `Germany` count as
   untagged too, and any regional tag (Austria / Switzerland /
   Southern-Germany) is dropped so a learner never gets a regional
   pronunciation. `grounded_at` is stamped on success, and the exact merged patch is
   snapshotted into `grounding_patch` — the focus view's per-field provenance
   indicators compare live grammar values against it. Idempotent across
   re-process: rows already grounded short-circuit, EXCEPT rows grounded
   before the snapshot column existed (`grounded_at` set, `grounding_patch`
   null), which re-ground once to backfill the snapshot. Automatic basic-data
   grammar patches must not overwrite Wiktionary-owned keys on already
   grounded rows; after a user manually edits grammar provenance, automatic
   grammar patches and re-grounding (including the backfill) skip that row so
   manual changes stay authoritative.
   Languages outside the set are pure-LLM and `grounded_at` stays null.
   In local dev-tunnel, the reference tables are not part of ordinary user
   data; if a reset leaves `public.wiktionary_entries` empty, grounding will
   still run but every lookup will miss and no field will earn a Wiktionary
   indicator. Reload with `pnpm --filter @flicktionary/backend load:kaikki`
   (uses the cached raw dump when present) and confirm non-zero per-language
   counts before testing Wiktionary indicators.
   See `WIKTIONARY_GROUNDING.md` and
   `.claude/skills/add-wiktionary-language/SKILL.md` for the operational
   workflow and per-language extraction guidance.
4. **Per-chunk Full exploration (deferred, on-demand)** — one call per card,
   triggered manually by clicking `Generate full exploration` in the focus
   view. Cards arrive from step 2 with only the basic data populated; this
   pass adds the optional enrichment fields. NOT run automatically during
   processing.
   - Input: chunk + 10 surrounding segments + source context blob + user's
     note + preset tags + methodology prompt.
   - Output: refined basic columns (the model may revise them based on
     deeper analysis) plus an `extras` bag in two tiers — always-include
     fields the model must fill with an explicit verdict/negative rather
     than omit (frequency band + `frequency_detail` prose, `more_frequent_synonym`
     with explicit null when none is needed, `more_examples` (2 extra
     sentences, 3 total with `target_example`), regionalism verdict even
     when "No — universal", register, register alternatives with explicit
     negatives like "none — already the everyday word", collocations) and
     when-relevant fields (etymology — omitted rather than invented for
     function words / fragments with no documented origin, per-chunk L1
     notes, free-form notes, bolded context segment), AND a refined
     `grammar` bag (same
     shape as the basic-data pass; the deeper analysis can correct or
     fill keys the basic pass left empty). Pronunciation lives in the
     grammar bag, not extras: `extras.ipa` is no longer in the schema
     (legacy rows keep theirs as dead-but-rendered data) and
     the pass instead emits `grammar.ipa` — a dialect bag like grounding
     writes (English → the user's `english_ipa_dialect` bucket, others →
     `untagged`, delimiters included) — which is merged ONLY when the
     stored bag has nothing displayable, isn't Wiktionary-grounded, and
     the grammar wasn't user-edited. Per-chunk L1 notes (e.g. an
     English speaker's confusion between `près de moi` and `chez moi`)
     are generated by the model from its own training knowledge of L1→L2
     interference patterns, anchored to the specific chunk and source
     context — there is no separate global L1-notes pass.

### Review screen

Two-layer UI.

**Layer 1 — Session vocabulary list (default landing).**

Saving a highlight while reading is already an explicit commit, so there is no
separate Keep step: a card **auto-keeps** the moment it has basic flashcard data
(see "Auto-keep" under the processing pipeline). This screen is therefore a
review-and-prune list of the session's kept terms, not a keep/reject queue.

- One list of the session's terms: literal manual selections and adopted ghost
  suggestions (adopting a ghost creates a real highlight before enrichment). The
  list client-filters to `status ∈ {kept, needs_data}`; `removed` rows never
  show. Legacy `highlight_id = null` rows are no longer produced, so there is no
  separate "LLM-suggested" section.
- Each row: chunk surface form, a 1-line gloss preview, a tap target (opens the
  focus view), and a single **Remove** (trash) control. **Remove = unkeep this
  card** (`cards.removeFromSession` → `removed`): non-destructive — it survives in
  Vocabulary if kept elsewhere, the "added N×" badge decrements, and the last
  keep takes `count` to 0 so it leaves Vocabulary naturally. No `deleted_at`, no
  cross-session nuking, no warning. Because the optimistic cache flips status in
  place, a Remove drops the row from the list immediately (no refetch).
- **Note-only "needs data" rows.** A note-only card (created via **Save note**)
  has no `translation` / `definition` / `target_example`, so it stays `needs_data`
  and shows here as a "needs data — open to generate" row (it still has a
  Remove). Opening it and running **Generate full exploration** (or generating
  data via chat) fills its basic data and **auto-keeps it** — the on-demand
  exploration mints the session context blob lazily on first use even though the
  note-only session never ran an `enrich_highlight` job.
- Filter and search across the single list. There is no bulk Keep all / Reject
  all and no generic card-status mutation: cards keep themselves once they gain
  basic data, so the only user-driven transition is `cards.removeFromSession`.
- Reader-saved highlights materialize as `needs_data` cards (the enrichment job
  inserts cards in `needs_data`; user highlights bypass the CEFR floor) and then
  auto-keep once basic data lands. Vocabulary membership and the recognition
  floor happen on the keep transition, which is now automatic.
- **Floor guard:** a **kept** term (`count > 0`, not deleted) must always keep ≥1 enabled facet — `chunks.setFacetEnabled` rejects (409) a disable that would zero out its last enabled facet (delete the term instead). Pre-keep terms keep their freedom to drop to zero. The focus view's per-target last-skill lock is the friendly UI front for this invariant; the backend guard is the authoritative safety net.
- The enriching/failed **placeholder rows** + status polling stay (a highlight
  still being enriched has no card yet), and a **retry** affordance for failed
  enrichment.
- Sticky footer: `Practice these terms` button (full-width on mobile,
  right-aligned on desktop) that starts a Practice session in the session's
  target language. Disabled when no cards are kept (effectively always enabled
  once any term has data). Per-session CSV export is gone from this screen —
  exports happen from the Vocabulary tab instead.
- No chat here. This layer is for fast review.

**Layer 2 — Focus view (modal screen pushed above the tab navigator).**

- Modal header: chevron-back to the session-vocabulary list, position counter
  (`Card N of M`), and a chat toggle button carrying the unread indicator (see
  the per-card chat bullet below). There is **no keep/reject bottom bar** — cards
  auto-keep on basic data; removal is a single scope-aware affordance inline in
  the card body (see the next-to-last bullet in this section).
- Prev/next navigation uses two fixed, viewport-mid-height circular buttons
  pinned to the left and right edges so they stay reachable on long cards;
  the `Open in subtitles` deep-link still lives inside the collapsible
  `Context` block.
- Card section: each basic column gets its own labeled input — `Headword`,
  `Target example`, plus `Translation` + `Native example` (and optional
  `Definition`) when L1 ≠ L2 and the Show-translations pref is on, or just
  `Definition` when L1 = L2 or that pref is off. Every input
  debounces a partial PATCH to `cards.updateFields`; the basic columns are
  the single source of truth (no more `front_override` / `back_override`).
  Above the inputs: compact grammar chips (`m.` / `f.` / `c.`, `impf.` /
  `perf.`, `↔ <pair>`, `+ acc`, `pl. tantum`, `indecl.`, `refl.`) for the
  high-signal keys, glanceable. Below the inputs: a collapsible `Grammar`
  panel (selects for enums, text inputs for headword pointers / government /
  display_form where the target language supports it, checkboxes for
  booleans, an add/remove list editor for `notable_forms`, plus read-only
  Wiktionary IPA when `grammar.ipa` has a displayable bucket). Both chips and
  panel filter the visible keys by the
  session's `target_language` — the per-language allowlist + label /
  placeholder hints live in
  `packages/core/src/constants/language-grammar.ts` (explicit configs for
  `en`, `es`, `ru`, `fr`, `pt`; other supported languages fall through to a
  conservative default of `pos` / `display_form` / `government` /
  `number_only` / `notable_forms` / `notes`; English intentionally omits
  editable `display_form`). Same debounced-PATCH path, with `grammarPatch`
  shallow-merged into the JSONB column server-side; hidden fields' stored
  values are preserved untouched. Provenance is **per field**, not per card
  (the old card-level grounding badge is gone; the external Wiktionary link
  chip stays): each grammar field whose value matches the stored
  `grounding_patch` snapshot shows a small check icon ("Verified by
  Wiktionary"), a field edited away from its snapshot shows a pencil whose
  popover (desktop) / bottom sheet (mobile) reveals the original value and a
  one-tap **Revert** (revert writes through the same local-state +
  debounced-save path as typing — never a direct mutation), and the IPA field
  alone shows an amber "Unverified" warning when it has a displayed value
  that isn't grounded (hallucinated IPA is the one silently-harmful case; for
  other ungrounded/LLM fields the absence of an icon is the default state).
  Form-facet fields get the same treatment against the facet's
  `generated_payload` snapshot (pencil + revert when edited away from what
  the Opus pass generated; no Wiktionary/unverified states). Indicators only
  appear for kaikki-enabled languages (citation grammar) or facets with a
  generation snapshot; legacy grounded rows without a `grounding_patch`
  snapshot claim nothing until the backfill re-grounds them. Content fields
  on the citation card (translation/examples/definition) are always
  LLM-or-user-authored and carry no indicator.
- Below the card: a collapsed `Context` block showing ±2 surrounding source
  segments. Open it with the chevron when needed.
- Full exploration: rendered when `exploration_extras` has data. Otherwise
  shows a `Generate full exploration` button that triggers the on-demand
  enrichment pass.
- Per-card chat thread, scoped to that chunk, opened on demand from the
  header chat icon (not inline in the card scroll). On mobile it's a
  full-screen slide-up sheet; on desktop a right-side panel laid out beside
  the card column (non-modal — the card stays scrollable and prev/next stay
  reachable while it's open). The header icon carries an unread indicator with
  three states: amber pulse while a seeded answer is generating, solid green
  when an unread assistant answer is ready, red when seed generation failed;
  opening the panel marks the chat read. Read-state is persisted server-side
  (`card_chat_read_state`, keyed by card) so the indicator survives reload and
  is cross-device; the `cards.*` read paths return a derived `hasUnreadChat`
  (true when the newest assistant turn is newer than `last_read_at`). The chat
  tool can call `update_card_fields` to patch any basic column or merge into
  `exploration_extras` / `grammar` server-side; the assistant body gets a
  `_Updated: …_` italic line and the focus view re-fetches the card. An
  unqualified request to fill / create / generate the card's data populates
  only the basic fields (translation, definition, target/native example) plus
  core grammar — `extras_patch` (the full-exploration bag: frequency, register,
  collocations, etymology, l1_notes, …) is reserved for an explicit
  full / deep-exploration request or a named extra, so casual "make this card"
  asks no longer dump a whole exploration.
- **Scope-aware Remove (no keep/reject bar).** There is no bottom action bar.
  Removal is a single inline affordance in the card body, chosen by entry scope:
  - **From a session** (session-vocabulary list / focus-view-from-session):
    **Remove from session** → `cards.removeFromSession` (status `removed`,
    unkeep). Non-destructive (survives in Vocabulary if kept elsewhere; no
    `deleted_at`, no confirm). After removing, it advances to the next card via
    the cursor, or closes back to the session-vocabulary list if it was the last.
  - **From vocabulary / practice** (`?from=vocabulary` / `?from=practice` over
    already-kept chunks, i.e. `isLanguageWideEntry`): **Delete term** →
    `chunks.deleteChunk` (term-level soft-delete, behind a confirm). Unchanged.
  - A data-less `needs_data` note-only stub opened from a session has no keep
    button — generating its data auto-keeps it, and **Remove from session**
    discards the stub.
- The card section always shows the **study-target selector + unified editor**
  (the editor lets the learner set up forms/skills and edit content; keeping a
  card just enables recognition, which now happens automatically on basic data).
  The prev/next pager is gated on having a session cursor, so session entries
  page through their cards and language-wide entries (which don't load the
  session card list) don't.
  - **Form selector** (`form-selector.tsx`): a chip-per-target row at the top —
    one **Citation** chip (the headword), one chip per **form** target, and a
    **"+ Add a form"** chip. Selecting a chip sets which target the editor below
    edits (local navigation, no popover). A chip is accented (★) when Production
    is on, dashed/Sparkles when a form is `pending_data`, and muted when the
    target is **dormant** (zero enabled skills — in vocabulary but queued
    nowhere).
  - **Skills** for the selected target render inline beneath the chips on desktop
    and behind a pencil→sheet on mobile (`useIsMobile`): **Recognition** and
    **Production** toggle `(skill, '<targetForm>')` via `chunks.setFacetEnabled`;
    **Pronunciation** toggles `(pronunciation, '')` for citation (greyed "No
    pronunciation data yet" without displayable IPA — `hasDisplayableIpa`) and is
    greyed "coming soon" for forms. **Recognition is deselectable** — unchecking
    every skill leaves the target dormant (disable ≠ delete; SRS history kept).
    Removal is explicit: **Remove form** (`chunks.deleteFacet` for the target's
    facets) on a form, **Delete term** (`chunks.deleteChunk`) for the citation.
  - **Unified editor** (`per-form-card-editor.tsx`): Citation edits the lemma's
    canonical content (translation / examples / definition / grammar on
    `user_lookups`, via `chunks.updateContent` + `chunks.rename`); a form edits
    that form facet's own full content in its `study_facets.payload`
    (`chunks.setFacetPayload`). Both reuse `editable-card-fields.tsx` +
    `editable-grammar-panel.tsx` through injected save adapters; the form payload
    `grammar` is always written **complete** (the JSONB merge replaces the whole
    sub-object). A form added from **"+ Add a form"** (encountered surface forms
    from `getStudyTargets.candidateForms`) is born `pending_data`; the editor body
    offers **Generate** (an Opus pass, `chunks.generateFacetData`, which seeds the
    example from the encountered sentence and runs under the per-language
    instructions block, so the form's `grammar` carries a stress-marked
    `display_form` like the lemma's — Russian stressed, English unset) or **Enter
    manually** — either fills the payload, flips the facet to `ready`, and swaps
    in the full editable field set (a skeleton shows while generation is in
    flight). The form-target chips themselves render the form **without** the
    stress mark (matching the unstressed citation chip); the stressed spelling
    still shows in the FORM heading + editor.
  - **Context** block per target: the most-recent kept occurrence backing the
    selected target (`getStudyTargets` `facet.source` — the form's own inflection,
    the lemma's for citation), with an "Open source" deep-link; hidden when the
    target has no kept occurrence / source. The selector + editor read facet
    state + readiness + source lazily via `chunks.getStudyTargets`. Edits keep the
    user on the focus view; the chevron closes back to the originating surface
    (`?from=practice` carries `practiceLang` + `practicePool` + `practiceMode` —
    `read` (default) for a reading text, `flashcards` for the flashcard reviewer's
    actions menu — so close lands on the right review screen, scope reset to
    `mixed`).
- Keyboard `j`/`k` and `←`/`→` still drive prev/next.

Per-card chat seed prompt = methodology + `(L1, target, CEFR)` + source context blob (cached) + chunk + 10 surrounding segments + the card's current basic data + grammar (if populated) + extras (if populated, including any per-chunk L1 notes). The user's question is the only dynamic turn.

### Practice (in-app review through generated texts and flashcards)

A separate top-level destination from the per-session review flow. Practice is **cross-session** — its review pool is every kept card the user has accumulated, regardless of which study session it came from.

- **Pool source.** Every card with `status='kept'` flows into `user_lookup` automatically (the keep transition writes the row). `user_lookup` is the canonical "user vocabulary" record; it carries FSRS state per `(user_id, target_language, headword, sense)`.
- **Passive vs active pools (now facets).** SRS state lives in `public.study_facets` rows ("facets"), each keyed by `(user_lookup_id, skill, target_form)` and owning its own FSRS + leech state — no longer on `user_lookups`. A kept term's passive (recognition) card is its `(meaning_recognition, '')` facet; promoting to the **active** pool (production) enables its `(meaning_production, '')` facet. A term is "active / in production" IFF it has an enabled (`disabled_at IS NULL`) citation `(meaning_production, '')` facet — there is no stored `learning_mode` column; the wire still exposes a **derived** `learningMode` ('active'/'passive') for read-only display. `pool` (`passive`/`active`) stays on the wire and route params but is **derived** — the review mode of the skill, mapped at the service boundary (`skillForPool`), not a stored column. Active membership is additive — an active term still appears in the passive queue when its recognition facet is due. The two are independent: a passive rating advances the recognition facet, an active rating the production facet. `practice_session.pool` carries the routing decision per generated-text session and selects which facet `rate-chunk` writes; flashcard ratings apply FSRS directly to the recognition facet. (See `docs/SRS.md` §1 for the full data model.)
- **Landing.** `/practice` is a per-language selector. Each row shows the full language name plus a compact status summary (follow-up timing / unseen / total) and opens `/practice/language/$targetLanguage`. When the language has any active-pool terms the summary line appends `· N active`; when any terms are leech-parked it appends `· N parked` (passive + active parked combined).
- **Language action screen.** `/practice/language/$targetLanguage` shows one card per pool — **Active vocabulary** first (rendered only when `activeTotal > 0`), then **Passive vocabulary**. The system makes the strategic decision, not the user: each pool has a single primary **Practice** button that enters the unified review screen in **flashcards mode over the `mixed` scope** (due first, then new under the daily allowance; `{ pool, scope: 'mixed', mode: 'flashcards' }` is passed explicitly because the review route's Zod default is `mode: 'read'`). The Active primary button is always tappable — an empty queue lands on the flashcard view's existing "No terms are due right now" screen. Per-pool secondary actions: **History**, and a **More** disclosure (local per-pool boolean) exposing `Read` (`mixed` + reading mode), `Review only` (`review_due` + flashcards), `Learn new` (`learn_new` + flashcards). When a pool has leech-parked terms the card also shows an `N word(s) parked — strengthen them` affordance that opens the Strengthen route for that pool (see "Strengthen exercises + leech rehab"). The passive stat cards (Follow-ups / New today / Unseen / Total) render below the pool sections.
- **Stale session URLs.** Reloading or deep-linking to `/practice/$sessionId` for a completed/abandoned session silently redirects back to that language's action screen. Background pre-generation is opportunistic and must not show user-facing errors for inactive sessions.
- **Session modes.** A practice session is scoped to one target language, one start mode, and one pool: `review_due` snapshots only already-introduced due terms in the passive pool; `learn_new` snapshots unseen passive terms up to the remaining per-day new-term allowance; `learn_extra` intentionally bypasses the daily new-term cap for users who choose to keep going; `mixed` snapshots due terms plus unseen passive terms up to the remaining daily new-term allowance — used by source/session-vocabulary entry points and by the default **Practice** action on the language screen so a single session clears follow-ups and then introduces the day's new terms; `active_drill` snapshots only terms with an enabled `(meaning_production, '')` facet — all currently-due active terms and all unseen active terms with **no daily new-term cap** (the cap is a passive-pool concept, intentionally not inherited so active drills never eat the passive new-term allowance). The one-active-session-per-(language, pool) rule still wins: starting while an active session exists for the same pool resumes that session.
- **Session.** Generates one short text on demand at a time (~80–120 words, B1–B2 surrounding grammar regardless of chunk level). The schema's `practice_text.status` + `ord` columns are designed for v2 pre-generation — multiple texts queued ahead — but MVP walks one at a time.
- **Generation prompt.** Methodology preamble + language instructions + user profile + the chunk list (`headword`, `sense`, `translation`, `definition`, `target_example`, `native_example`). Tool-use output: `body` + `used_chunks: [{ headword, sense, surface_form }]` + `skipped_chunks`. **No char offsets in the tool schema** — LLMs are unreliable at character arithmetic; the server locates each `surface_form` in `body` and computes offsets itself, claiming non-overlapping positions when a surface form repeats.
- **Reading UX.** Body renders with each annotation as a clickable yellow span (rated → muted gray; soft-deleted → strikethrough). Tapping an annotated chunk opens a `RateSheet` (`Again / Hard / Good / Easy`) on `ResponsiveOverlay`. A 3-dots overflow on the sheet opens `Edit term` (navigates to the focus view of the chunk's representative card with `?from=practice` so chevron-back returns to the same practice text), `Switch to active vocabulary` / `Switch to passive vocabulary` (label flips based on the term's derived `learningMode`; calls `chunks.setFacetEnabled` with `skill=meaning_production`, `targetForm=''`, `enabled` = switching-to-active, and dismisses the sheet on success; hidden when the annotation has no canonical `user_lookup` row), and `Delete from vocabulary` (soft-deletes the chunk via `chunks.deleteChunk` and shows a Sonner toast with a `Restore` action backed by `chunks.restoreChunk`). Tapping a soft-deleted annotation opens a slim Restore-only variant of the RateSheet. The "Next text" button advances; **every annotation not explicitly rated is auto-rated `good`** (`was_explicit=false`) so passive reading still informs the SRS.
- **Peek + save unannotated spans.** Tap-to-select on plain text in the body (text not covered by an annotation) opens a `LookupSheet` with a fast one-line gloss + optional POS / register chips. A single click/tap selects one `Intl.Segmenter` word in the practice session's target language; press-and-drag extends to a word range. Annotation buttons remain reserved for `RateSheet`, and ranges that cross an annotation are rejected rather than snapped. The gloss reuses the same Haiku-powered `fastGlossPass` as tap-to-select in the session view, exposed as `practice.fastGloss` keyed to the practice text body (no highlight row needed, no server-side cache). `Save to vocabulary` routes the selection into the existing `cards.createAdhoc` adhoc flow (passing the practice text body as the LLM context, truncated to 2000 chars), then navigates to the new card's focus view with `?from=practice`.
- **Flashcard reviewer.** The no-LLM flashcard route fetches a fresh capped batch from `user_lookups` through `practice.listReviewTerms` (shared with the reading-text generator's candidate set): due rows first, then never-reviewed rows up to the remaining daily new-term allowance. There is no `practice_session` row and no `practice_text` for flashcards; ratings call `practice.rateTerm` with the card's **facet identity** (`skill`, `targetForm` — the queue item carries them), which applies FSRS to that facet and logs a `practice_rating_events` row (carrying `skill`/`target_form` alongside the session `pool`) in the same transaction (the event's id comes back as `eventId`, the undo handle — null when nothing applied; undo is keyed on the facet, not pool). The review budget counts **distinct facets** (`COUNT(DISTINCT (user_lookup_id, skill, target_form))`) per review mode (recognition / production), and production has an optional review cap (`practice_max_review_terms_active`, NULL = uncapped). The queue serves the pool's skill set and **spaces a term's sibling facets** apart (rank-1 of every term before rank-2); opt-in (non-citation) new facets bypass the daily-new cap but are served only in an explicit learn-new session, never the mixed Practice button. The queue is a one-shot client-side slice: the view seeds its local queue from the first fetch and ignores later refetches, and the query cache is dropped on unmount (`gcTime: 0`) so every (re)entry — including returning from the focus-view editor — loads a fresh slice (already-rated cards drop out naturally, edits are live). `Again` optimistically appends a redrill copy at the end of the local queue in the same render as the index advance, rolled back by object identity on cap-rejection / leech-parking / error; mutation failures reappend the card for a capped retry instead of silently losing it, and daily-cap refusals drop the card with a one-time note. The sticky bottom control area shows compact colored counts for cards left in the local queue: new (`srs_state IS NULL`), learning/redrill (`new` / `learning` / `relearning` plus accepted `Again` requeues), and review.
- **Flashcard re-rate from history.** The back-chevron peeks at previous cards (front + back). A peeked card whose rating durably applied (a rating record keyed by queue-item identity holds the response's `eventId`) re-shows the rating buttons with the previous rating highlighted — unless its `Again`-redrill copy was itself already rated (the original's event is no longer the latest; no dead buttons). Re-rating calls `practice.undoRating` (restores the event's `prev_srs_*` snapshot, clears `added_to_practice_at` for an undone introduction, un-parks a leech the rating parked, tombstones the event via `reverted_at` — which auto-refunds the daily budgets since every budget query filters live events) then a fresh `practice.rateTerm` through the full cap/introduction/leech machinery, reconciling the redrill copy and the session's again/hard set. Only the latest live event per (lookup, pool) is undoable; a stale `eventId` (a later rating landed from another tab / reading mode) returns `undone: false` — never an error — and the client re-appends the card for a clean rating.
- **Flashcard mid-session edit.** A three-dot kebab in the flashcard header opens a `ResponsiveOverlay` actions menu (same pattern as the vocabulary rows) for the displayed card; its `Edit term` row deep-links to the focus view via the chunk's representative-card pointer (`chunks.get` returns `firstCardId` / `firstCardSessionId` through the `first_card_id` back-pointer, fetched lazily on menu open so the queue payload stays lean) with `?from=practice&practiceMode=flashcards`. Navigating away drops the client-side session (rating records and the Strengthen again/hard set don't survive); the return trip lands on a fresh `mixed` flashcard queue where `again`-rated cards resurface as due learning-state follow-ups.
- **Flashcard faces.** Card face composition is declarative in `packages/core/src/constants/card-face-config.ts`. `DEFAULT_CARD_FACE_CONFIG` shows `headword` + `targetExample` on the front and `translation` / `definition` / `nativeExample` / `grammar` on the back; `ru` and `en` (the Kaikki-grounded languages with Wiktionary IPA today) defer `ipa` to the back on recognition cards, since pronunciation is part of the answer. The resolver filters abstract slots by runtime conditions: translations/native examples hide when L1=L2 or Show translations is off, definition shows in that hidden-translation mode and also falls back when translations are enabled but no translation exists, IPA shows only when `pickIpa` returns a displayable bucket, and grammar shows only when chips can render. Headwords use `grammar.display_form || headword` so Russian stress-marked forms carry through.
- **End condition.** When the eligible pool minus chunks already covered in this session is empty, `generateNextText` returns `done: true` and the session view shows an "All caught up" view. Eligibility is the frozen mode-aware snapshot in `practice_session_chunks`; live rows do not enter mid-session. New rows enter as `state='new'` lazily on first surfacing/rating and count against the per-day new-term allowance via the recognition facet's `introduced_at`.
- **Daily new-term budget.** Passive generated-text sessions and flashcards share the same daily new-term cap. Both count introductions by `introduced_at` on the citation `meaning_recognition` facet (joined back to non-deleted kept `user_lookups` rows). Generated-text sessions reserve a capped snapshot when the session starts and stamp new rows when they are first surfaced. Flashcards compute the remaining allowance at list time for the returned batch and also guard at rating time with an advisory transaction lock keyed by `(user, target_language)`, so concurrent tabs/devices cannot introduce two different new flashcards past the cap.
- **FSRS.** `ts-fsrs` package, default parameters with `enable_fuzz: true`. The adapter at `apps/backend/src/service/practice/fsrs.ts` round-trips `study_facets` rows ↔ `ts-fsrs` Card objects. Recognition-facet ratings other than `again` are floored to `now + 24h` (`MIN_PASSIVE_INTERVAL_MS`) so finishing a generated-text or flashcard sitting leaves no immediately-due straggler follow-ups; `again` keeps FSRS's native intraday interval (generated-text in-session redrill is rating-driven via the stubborn path; flashcards requeue one local copy after an accepted `again`; and an abandoned miss should stay due soon), and production facets are never clamped.

### Strengthen exercises + leech rehab

Post-session reinforcement layered on top of Practice. Two populations, one surface: **parked leeches** (gated rehab — the only way back into rotation) and **this-session again/hard terms** (ungated bonus practice). All constants live in `apps/backend/src/service/practice/leech-config.ts`.

**Leech parking.**

- A term whose FSRS lapses reach `LEECH_LAPSE_THRESHOLD = 4` is **parked** out of every practice queue. Detection lives in the shared `applyTermRating` path, so a lapse parks the term whether it came from a flashcard rating or a reading-text advance.
- The park condition is a **new-lapse delta**, not an absolute check (`result.lapses > prevLapses && result.lapses >= threshold && !alreadyParked`, the pure `shouldParkLeech` helper). After graduation `lapses` stays ≥ the threshold forever, so only a rating that itself caused a fresh lapse can (re-)park; `good`/`easy` on a high-lapse graduated term never does. Parked state is an explicit `study_facets.leech_parked_at` timestamp on the facet, and recognition/production facets park independently.
- Parked terms leave **both render modes at once**: flashcards and the reading-text generator's candidate set both feed from `listReviewTerms`, which filters on the pool's parked column. This is intentional — reading mode implicitly rates untapped annotations `good` on advance, which must never mutate a parked term's FSRS. The due-summary aggregates also exclude parked rows (the landing never claims terms the queue refuses to serve) and expose `parkedCount` / `activeParkedCount` per language.
- The flashcard client reacts to `rateTerm`'s `parked: true` output with a toast ("… keeps tripping you up — it's parked for rehab exercises") and skips the usual in-session `again` requeue for that card.
- **Pool move resets production rehab.** A real enable/disable flip keeps the production facet in sync inside the repo's `setFacetEnabled` transaction (guarded by `disabled_at IS DISTINCT FROM` the target): promote ensures the facet and clears its `disabled_at` (history-bearing re-enable); demote sets `disabled_at` (history preserved — disable ≠ delete). Either way it resets that facet's parked/rehab columns, so both pool-move surfaces — the term view's Study targets control and the Vocabulary tab — get it, while idempotent re-enable re-stamps don't wipe progress. Only the production facet resets: the recognition facet never changes. Soft-deleting a parked term hides it everywhere via the existing `deleted_at` filters; restoring resumes with parked state intact (correct — it still needs rehab).

**Exercise bank (`practice_exercise` table).**

- Durable pre-generated exercises per `(user_lookup, pool, exercise_type)`, mirroring the `practice_texts` fencing lifecycle: `pending → generating` (mints a `generation_token`) `→ ready → used | failed`; stale pending/generating slots (> 300s) are fenced off and replaced; an advisory lock per `(term, pool)` makes concurrent ensure calls race-safe.
- **Consume-on-answer.** Serving is read-only (deterministic lowest-`created_at` ready row), so refresh/abandon before answering re-serves the same exercise — no bank drain, no in-progress state machine. Submitting an answer consumes the row (`used`), which doubles as the stale-answer fence; the next attempt always gets a fresh exercise (anti-gaming for gates). **Skipping consumes nothing.**
- Bank warm-up triggers, all fire-and-forget: an `again`/`hard` rating in either render mode (via an optional hook on `applyTermRating`), parking itself (gate exercises must exist before the user reaches Strengthen), and each consumed slot (refill, skipped on graduation).
- **Pool-dependent exercise ladders.** Passive (recognition): `mc_cloze` + `mc_comprehension`. Active (production): `mc_cloze` + `production_cloze` (typed). `use_in_sentence` generates for both pools but is **ungated bonus only** (`gate_eligible = false`) — an LLM grading error must never block a graduation.
- **Accuracy-first generation pipeline** (cost explicitly not a constraint): Opus GENERATE → independent-context Opus adversarial VERIFY, up to `MAX_GEN_ATTEMPTS = 3` full cycles before the slot fails. The verifier substitutes each distractor into the blank and fails the exercise if any substitution is grammatically valid AND semantically defensible; distractors must match the answer's POS and inflection/agreement (so grammar alone can't eliminate them) while being semantically wrong in that sentence; production-cloze blanks must be inflection-unambiguous from the sentence's cues. Blank offsets are computed server-side by substring search over the emitted `surface_form` (never LLM char arithmetic); options are shuffled server-side. Generation prompts work from headword + sense (+ definition/translation when present) — no dependency on stored examples. `use_in_sentence` payloads are built deterministically (no LLM at generation time).
- **Grading is server-side only.** Served payloads are stripped of `answer` / `answerIndex` / `acceptedForms`; the truth (`correctIndex` / `correctAnswer`) is revealed only in the answer response, after the exercise is consumed. MC = index equality. Production cloze: NFD-normalize + strip diacritics + lowercase + trim, then exact match against accepted forms or Damerau-Levenshtein ≤ `PRODUCTION_CLOZE_MAX_EDIT_DISTANCE = 1` (local helper, no dependency) — a missing accent plus one typo still passes. Use-in-sentence: Sonnet-graded; a correct sentence in **any legitimate sense** passes (real production is the point; it's bonus-only), but when the sense differs from the stored one the feedback must say so and give an example in the stored sense; grading failures degrade to attempt-only ("feedback unavailable"), never an error.

**Rehab graduation (the way back).**

- Gate = a correct answer on a deterministic (`gate_eligible`) exercise for a parked term, applied by `submitExerciseAnswer` after consumption. Graduation requires correct gate answers on `LEECH_GRADUATION_DAYS = 3` **distinct server calendar days** (spaced, not massed): `advanceRehabDay` is guarded by `rehab_last_correct_on IS DISTINCT FROM CURRENT_DATE`, so massed same-day corrects count once. An incorrect answer consumes the exercise but never advances; a later same-day correct (on a fresh exercise) can still earn that day's credit.
- **Escalating tiers**, derived from `rehab_correct_days` (no extra column): passive `mc_cloze → mc_comprehension → mc_cloze` (fresh); active `mc_cloze → production_cloze → production_cloze` (fresh). The Strengthen session serves the tier-typed gate exercise per parked term.
- **Soft re-entry.** At the threshold, one UPDATE unparks and re-enters FSRS on a softened schedule: `state='review'`, `due = now + 24h`, `stability = SOFT_REENTRY_STABILITY (1)`, `difficulty = SOFT_REENTRY_DIFFICULTY (5)`, `last_review = now`; **reps/lapses unchanged** (history preserved — the explicit parked flag, not the lapse count, is the re-park gate). Direct facet write (`unparkAndSoftReentryFacet`), deliberately not routed through `applyRating`, so the `MIN_PASSIVE_INTERVAL_MS` floor doesn't interfere; the facet's `introduced_at` is untouched, so the daily-new cap is unaffected. Re-parking after graduation fires only on the next fresh lapse.

**Strengthen session (UI).**

- Route: `/practice/strengthen/$targetLanguage` (Zod search: `pool`, optional `sessionHard` userLookupId array — carried in the URL so the list survives refresh). Entry points: the post-flashcard-session CTA (primary `Strengthen` button on the completion screen when the session produced again/hard terms; the back button is the skip path — v1 is flashcards-only, reading completion is unchanged though its ratings still warm bonus banks) and the per-pool parked affordance on the language screen.
- `startStrengthenSession` re-validates the client-supplied hard ids server-side (ownership, language, `count > 0`, not deleted, an enabled `(meaning_production, '')` facet — `disabled_at IS NULL`, enforced by the queue join — when `pool='active'`; silently drops the rest) and returns one tier-typed gate exercise per parked term plus one bonus exercise per validated hard term. A term with nothing ready gets a **`generating` placeholder** (skippable) and a background bank top-up — the session never blocks on LLM work.
- Exercise screens share an `ExerciseLayout`: scrollable content + a pinned bottom action bar (the flashcard-view pattern). Every unanswered exercise has a secondary **Skip** (non-consuming — it re-serves next session, so "I don't know" on a gate doesn't burn the fresh exercise or the day; to *see* the answer, submit a guess — that consumes and reveals). Cloze blanks render as literal underscores. MC answers highlight the correct option from the response's `correctIndex`; production cloze reveals `correctAnswer` on a miss; use-in-sentence is labelled **Bonus** and shows the LLM feedback. Gate answers render a "Day N of 3" rehab progress note from the response's `rehabCorrectDays`, and `graduated: true` renders a graduation celebration ("back in your practice rotation"); the dueSummary invalidation drops the parked counts.

### Vocabulary (browse + manage kept chunks)

A separate top-level destination at `/vocabulary` for cross-session browsing of the user's kept chunks. The same `user_lookups` rows feed Practice and this view.

- **Landing.** Per-target-language list of every non-deleted chunk for the user. Language pills switch between languages when more than one exists. Each row shows headword + sense + 1-line preview (`translation || definition`) + a count badge when the chunk has been kept multiple times — no per-row study/due chips (they read poorly at scale and the filter control covers the same questions).
- **Sort & filter control.** Search input plus a single `Sort & filter` button (a Radix popover on desktop, a bottom sheet on mobile; the popover caps to the viewport and scrolls internally; the trigger carries a dot when any filter is active). All sort/filter state persists in the URL so reload/deep-link survives (`?sort=&status=&skills=&forms=`; stale tokens — including the retired `?mode=` — degrade to defaults via `.catch`). Contents:
  - **Sort:** "Recently added" (default) or "Due soonest".
  - **Status** (single-select, on the citation recognition facet — the same state the old per-row Due chip read): `All` / `Due` (a review is waiting now) / `Unseen` (never reviewed, or no recognition facet).
  - **Skills** (multi-select, OR within the set): `Recognition` / `Production` / `Pronunciation` — matches terms with an **enabled facet of any selected skill on the citation OR any form** (so a term studied for production only on a form still matches "Production").
  - **Forms:** `Has multiple forms` — terms studied in at least one inflected form (an enabled facet with a non-empty `target_form`).
  - The list query (`chunks.listChunks`) takes the skill set as a comma-separated `skills` string (server splits + validates, ignoring unknown tokens), `status`, and `hasMultipleForms`; the repository composes one filter clause from `EXISTS` predicates over `study_facets`, injected into every sort/phase branch.
- **Pagination.** Cursor-based with `@tanstack/react-virtual`. The `due` sort is two-phase to keep the cursor stable across NULLS LAST: scheduled rows first (ordered `srs_due ASC, id`), then the unscheduled tail (ordered by `id`).
- **Row actions.** Tapping a row jumps straight to the focus view of `first_card_id` with `?from=vocabulary` so close returns here. A 3-dots button on the right opens a bottom drawer with the secondary actions: **`Edit term`** (opens that focus view, where the study-target selector + unified editor live — the drawer itself hosts no skill/form editing), `Open source` (jumps to `/sessions/$id` for the originating session; the row is omitted when no source is available — e.g. adhoc chunks or sessions whose source was removed), and `Delete` (with inline confirm). Rows whose source card has been deleted fall back to opening the drawer when tapped, so the secondary actions remain reachable.
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
  grammar bag's dialect-tagged object (rendered `GA …; RP …` when untagged is
  absent).
- Tags: `flicktionary <target_language>`, plus `active` when the term has an
  enabled `(meaning_production, '')` facet and `leech` when either pool is leech-parked
  (Anki treats a `leech` tag natively).
- No `.apkg` for MVP.
- **Entry point** is the Vocabulary tab's 3-dots menu → `Export vocabulary`.
  Output is one CSV per target language covering every kept (non-deleted)
  chunk, regardless of which session it came from. Per-session CSV is no
  longer surfaced in the UI; the session vocabulary footer is now a `Practice these
chunks` CTA. The `cards.exportCsv` backend endpoint still exists (and still
  stamps `exported_at` on `user_lookups` if hit directly) but is unreachable
  from the UI.
- The vocabulary export pulls a representative `surface_form` and `context`
  per chunk via the `first_card_id` back-pointer (LEFT JOIN cards +
  text_segments); rows whose origin card or segment have been deleted fall
  back to empty cells.

### Navigation chrome

Native-style shell so the eventual React Native port is a translation, not a redesign.

- **Mobile** (`< 768px`): bottom tab bar with five slots — `Sessions` / `Practice` / central `+` button / `Vocabulary` / `More`. The `+` opens an action sheet with three options: `Start a movie or TV session`, `Practice with a text`, `Add a word` (designed to grow as more `content_source.type`s land). `Start a movie or TV session` covers both movies and TV shows via one wizard (an in-wizard `Movie` / `TV show` choice); it fetches subtitles for something the user is watching elsewhere and does **not** play video (in-video capture is the browser extension's job). Note the naming overlap: "Practice" the tab is the SRS reading flow over kept vocabulary; "Practice with a text" inside `+` is a content-source flow that creates a study session from a pasted text. "Add a word" creates a single card without any source (see Source content → Ad-hoc vocab entries). "Vocabulary" the tab is the browseable cross-session list of kept chunks (see Vocabulary section).
- **Desktop** (`≥ 768px`): left sidebar with the same item set, with a prominent `+ New` button at the top opening the same action overlay. The Sessions list itself has no `+` — it would be redundant.
- **Sessions list** offers `All / Movies / TV / Texts / Articles / YouTube / Streaming` filter chips with counts so the unified list stays scannable as content types diversify. Synthetic adhoc sessions (the per-(user, language) "Personal vocabulary" pseudo-sessions backing the Add-a-word flow) are filtered out at the query layer — they never appear under any chip. Each row has a **Remove** action (trash icon) that soft-deletes the session via `study_session.deleted_at` — the session disappears from the list, but the kept cards stay in the user's vocabulary and the source text is retained so future "my vocabulary" views can back-link to it. The confirmation overlay is explicit about this and points users at account deletion for full erasure.
  - **TV sessions group by show.** Episodes are one `study_session` each, but the list collapses every TV episode of the same show into a single tappable **show row** (poster + show title + `<lang> · N episodes`), derived client-side from the session list (`deriveTvShows`, keyed on the `tmdbShowId` now carried on the session DTO from `content_source.metadata`) — no per-episode rows clutter the list. Movies and every other source type stay individual rows; show rows and loose rows interleave by recency. The filter-chip counts stay episode-based. Tapping a show row opens the **show detail screen** (a modal drill-in): a scrollable list of its added episodes (`S0xE0y · <episode>`, each linking to its session, each with the same soft-delete trash control) under a **sticky-footer `Add episode`** button. `Add episode` deep-links into the new-session wizard pre-seeded for this show (see "Start a movie or TV session"). The detail screen reads the cached session list, so it opens with no extra fetch; removing the last episode collapses the show and falls back to the Sessions list.
- **Modal screens** hide the chrome (no tab bar, no sidebar) and fill the viewport. They are: subtitles / mid-watch, session vocabulary list, focus view, new-session wizard, TV show detail (episode list), and the `More` sub-pages (Account, Languages). (A standalone processing-poller screen still exists in the route tree but is no longer in the main flow — `Session vocabulary` jumps straight to the list, which shows per-highlight enrichment progress inline.) Top of a modal stack uses an **X** close in the top-left; in-stack pushes use a **chevron-back**. This mirrors React Navigation's `presentation: 'modal'` / `'fullScreenModal'` semantics.
- **More tab** consolidates user prefs and account pages: a sectioned list (General / Settings / About) with sub-pages for Account and Languages, plus an inline `Switch` row for `LLM-suggested terms`.
- **Onboarding gate.** A user with `is_onboarded = false` is held in the onboarding wizard (native language → welcome) — every `_app` surface (Sessions, Practice, Vocabulary, +New) redirects there so the mandatory values can't be skipped. The wizard's top-left **X is an escape hatch**, not a skip: it lands on the **More** tab, the one in-app destination a not-yet-onboarded user may reach (sign out, delete the account via Danger zone, change appearance). More shows a `Finish setup` banner that re-enters the wizard. The gate lives only on the `_app` layout and keys off the committed matched routes, so leaving `_app` for a sibling route (e.g. Danger zone at `/profile/danger-zone`) is never bounced. Completing onboarding (`completeOnboarding`) flips `is_onboarded` and releases the gate.

### Cross-source dedup

- `user_lookup(user_id, target_language, headword, sense)` is the canonical "user has already studied this" table. The composite PK lets the same headword be studied in multiple distinct senses (polysemy on bare lemmas — `correr | race` and `correr | spread (news)` are two rows).
- Whole-text LLM discovery and its source-relevant prefilter / Haiku tiebreaker
  are retired. Manual highlights and adopted ghost suggestions always produce a
  card; if the resulting `(user_id, target_language, headword, sense)` already
  exists, `user_lookup` is reused/incremented rather than duplicated.
- The old `EXCLUSION_PREFILTER.md` design is historical context for a future
  suggestion-ranking pass, not part of the active reader pipeline.
- Designed so future content sources (books, articles) feed the same dedup table — a chunk learned from a movie won't resurface in a book.

## Browser extension (companion)

A separate product surface — a **fork of [asbplayer](https://github.com/killergerbah/asbplayer)** (`apps/extension`, built with WXT) — that does the one thing the web app deliberately isn't: in-video subtitle interaction. It watches streaming video (YouTube first-class, plus Netflix and ~19 other platforms), tokenizes the active subtitle line into clickable words, and feeds captures back into the **same** Flicktionary backend the web app uses, so a word grabbed while watching shows up in the same Vocabulary / Practice pools. It is optional; the web app is fully usable without it.

The extension has its own spec — behavior, architecture, fork lineage, and the donor-model policy for harvesting from upstream: **`apps/extension/EXTENSION-SPEC.md`** (the source of truth for the extension; what follows here is the backend-coupling summary).

- **Pairing.** The extension authenticates as the user via Supabase. The web app exposes an `/extension-pair` route that hands the extension a magic-link `token_hash`; the extension's background runs `verifyOtp({ type: 'magiclink' })` and stores the resulting session in its own `browser.storage.local` namespace — intentionally **outside** the synced settings store, so auth tokens are never exported with settings.
- **Hover gloss.** Hovering an unsaved subtitle word (while paused) shows a tooltip with a one-line gloss + POS/register + IPA — the same shape as the web reader's fast-gloss popover (the IPA is the same server-picked, dialect-correct `ipaDisplay` string the web sheet renders). Hovering an already-saved span opens the saved-mode popover instead (no second Save button over a saved word — see below). It calls the stateless backend endpoint **`glosses.fastGloss`** (`selectionText` + `contextLine` + `targetLanguage` → `{ gloss, pos, register, ipa, ipaDisplay, ipaLemma }`, where `ipaLemma` labels the IPA with its lemma when the surface form falls back to the lemma's pronunciation). Native language and hide-translation mode are resolved server-side from the user's prefs; **nothing is persisted** (the extension caches in memory). This replaced an earlier design where the user pasted their own Anthropic API key into the extension — there is no per-user key anymore; the gloss always goes through Flicktionary's authenticated backend. The in-video popovers are composed from the same shared `@flicktionary/ui` components as the web gloss sheet (web dark theme hardcoded — they always float over video), and the selection/highlight/hover paints use the same color semantics as the web reader.
- **Save → highlight.** The gloss popover's explicit **Save** button (carrying the same always-visible `StudySkillCards` study-target picker as the web sheet, so a `studyIntent` rides along; the saved-mode popover shows the same picker but **locked read-only** — it displays the stored intent pre-enrich, then the term's live facets post-enrich (`chunks.getStudyTargets`), mirroring the web saved sheet; editing study targets happens in the web app's term view, not the popover), or the right-click toggle (word or drag-selected chunk; always default options — and on an already-saved span it REMOVES the highlight instead, so right-clicks cycle save → remove rather than stacking duplicates), saves the selection as a real Flicktionary `highlight`. An open popover survives the toggle and morphs in place (gloss → saved-mode popover on save; saved-mode popover → preview gloss on remove); with no popover open the toggle is silent. If the preview gloss is loaded, Save passes its compact `{gloss, pos, register}` result into **`highlights.create`**, so the new row's cached gloss matches what the user just saw and saved mode does not do a second first-gloss generation. Like the web reader, success shows no toast (the yellow wash is the feedback; failures toast). On a YouTube video the first save fires **`studySessions.findOrCreateForYoutubeVideo`**, which creates a `content_source` of type **`youtube`** (deduped per user on `metadata->>'youtubeVideoId'`), its `text_track`, and `text_segments`, and returns the segment list — plus the detected `targetLanguage`, which the overlay threads into its `Intl.Segmenter` tokenizer so word boundaries (and saved offsets) match the web reader's locale-aware tokenization — so the extension can map a clicked word to an exact `(segment_id, char_start, char_end)`. On the other supported platforms it fires **`studySessions.findOrCreateForStreamingVideo`** instead — same shape, without a YouTube video id (the extension caches the resulting session per subtitle content hash). Subsequent saves call **`highlights.create`** directly. From there the highlight flows through the normal enrichment pipeline into a card — identical to a highlight made in the web reader. Flicktionary is the system of record; there is no local word store.
- **Persistent saved highlights + saved-mode popover.** Saved spans paint persistently on the subtitles (same yellow treatment as the web reader). On mount / sign-in / track change the overlay loads them via the background, which resolves the video's session from its cache or — cache cold — via the **lookup-only `studySessions.lookupForVideo`** (NEVER find-or-create: merely watching a video must not mint sessions; `null` = no session) and lists with **`highlights.listBySession`**. Clicking a saved span — or completing a save from the gloss popover, which swaps it in place — opens a sticky saved-mode popover: direct/older saved opens parse the cached gloss and refresh via **`highlights.fastGloss`** for IPA, while a just-saved handoff keeps the richer preview gloss already on screen; **`highlights.delete`** (Remove — also reachable by right-clicking the span), and the same note + preset-tags editor as the web sheet via **`highlights.updateNoteAndTags`**. Hovering a saved span opens the same popover in a hover variant (hover-gloss dismissal until the pointer enters it, then sticky), so a saved word never shows the preview's Save button.
- **Subtitle language is detected server-side, never sent by the extension.** Both find-or-create registrations run the same Haiku **`languageDetectionPass`** used by SRT-upload / paste on the actual segment text; the detected supported language becomes both the `content_source`/`text_track` language **and** the session `target_language` (a Russian-subtitle video → a Russian session). This mirrors the web text-session rule (`targetLanguage = track.language`) and means YouTube's own caption `languageCode` is never trusted for storage — the extension passes no language at all (it keeps the YouTube BCP-47 code only to *name* an unsupported language in a notice). If the text isn't one of the supported languages the backend returns `422 UNSUPPORTED_LANGUAGE`; the extension shows a one-time notice naming the language and **disables saving** for that video (hover gloss stays available).
- **Prereqs.** Saving requires the user's native language (set during web onboarding, lives in `user_prefs`) **and** CEFR for the *detected* language. If the CEFR is missing the backend returns `422 MISSING_CEFR`; the extension shows an in-overlay A1–C2 picker that calls **`extensionAuth.setCefrLevel`** and retries the pending save — no round trip to the web app.
- **Also carried from the upstream fork:** word-click tokenization, chunk drag-select, and optional Whisper-based subtitle generation (an external transcript server — URL/API key configurable in settings — plus an IndexedDB transcript cache). The Whisper transcript cache is the *only* remaining client-side store — the old saved-words IndexedDB was removed in the Flicktionary migration.

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

## Data model

Generic source shape so non-movie content can plug in later without migration.

```
content_source
  id                  uuid pk
  type                'movie' | 'tv' | 'youtube' | 'book' | 'article' | 'text' | 'adhoc'
                                   -- 'tv' rows are one content_source per
                                   -- episode (metadata: tmdbShowId, showTitle,
                                   -- seasonNumber, episodeNumber, episodeTitle,
                                   -- year, posterUrl); deduped globally on
                                   -- (tmdbShowId, seasonNumber, episodeNumber)
                                   -- via a partial unique index, like movies.
                                   -- 'youtube' rows are created by the browser
                                   -- extension; deduped per user on
                                   -- metadata->>'youtubeVideoId'.
  title               text
  language            text
  metadata            jsonb        -- tmdb_id, year, isbn, url, etc.
  created_by_user_id  uuid?        -- null for shared/OS-sourced rows
  created_at          timestamptz

text_track
  id                  uuid pk
  content_source_id   uuid -> content_source.id
  source              'opensubtitles' | 'upload' | 'paste' | 'url'
  language            text
  external_id         text?        -- e.g. opensubtitles file id
  hash                text         -- sha256 of normalized text, dedup helper
  created_at          timestamptz

text_segment
  id                  uuid pk      -- stable; foreign key target for highlights
  text_track_id       uuid -> text_track.id
  index               int          -- ordering within track
  text                text
  start_ms            int?         -- null for non-timed sources (books)
  end_ms              int?
  tsv                 tsvector     -- for full-text search

study_session
  id                  uuid pk
  user_id             uuid
  content_source_id   uuid -> content_source.id
  text_track_id       uuid -> text_track.id
  native_language     text         -- snapshotted from user pref
  target_language     text
  cefr_level          text         -- snapshotted from user pref
  context_blob        text?        -- source context, populated by the first background job
                                   -- (no session-level status/processed_at: terms are
                                   -- enriched immediately on selection, so there is no
                                   -- processing lifecycle to track. Live job state lives
                                   -- in processing_jobs.)
  processing_warnings text[]       -- per-pass / per-highlight non-fatal failures
  furthest_read_segment_index int? -- resume-reading position: deepest segment index the
                                   -- reader has reached (track-relative, monotonic).
                                   -- NULL until they scroll a normal session view.
  created_at          timestamptz
  deleted_at          timestamptz? -- soft-delete; "Remove" hides the session from
                                   -- the list. Cards / segments / content_source
                                   -- stay so kept vocabulary keeps its source
                                   -- back-link. Hard erasure happens via account
                                   -- deletion (auth.users CASCADE).

highlight
  id                  uuid pk
  study_session_id    uuid
  start_segment_id    uuid -> text_segment.id
  end_segment_id      uuid -> text_segment.id     -- equal to start for single-line
  start_offset        int           -- char offset within start segment
  end_offset          int           -- char offset within end segment
  selection_text      text          -- literal user selection
  note                text?
  preset_tags         text[]        -- 'explain', '3_examples', etc.
  fast_gloss          text?         -- cached from tap-to-translate
  created_at          timestamptz

card
  id                  uuid pk
  study_session_id    uuid
  highlight_id        uuid?         -- normally set; null only for legacy/direct non-highlight cards
  segment_id          uuid -> text_segment.id    -- where it appears in source
  headword            text          -- LLM-normalized, dictionary citation form
  sense               text          -- 1-5 word sense disambiguator
  surface_form        text
  -- basic data (populated by step-3 basic-data pass)
  translation         text?         -- null when real L1 = target language, or when
                                    -- show_translations_enabled is off for this
                                    -- target language
  definition          text?         -- target-lang paraphrase; back-of-card when
                                    -- L1 = L2 or show-translations is off
  target_example      text?
  native_example      text?         -- null when real L1 = target language, or when
                                    -- show_translations_enabled is off for this
                                    -- target language
  -- enrichment (populated only on demand by Generate full exploration)
  exploration_extras  jsonb         -- partial bag: ipa, frequency, frequency_detail, register,
                                    -- register_alternatives, collocations, etymology, l1_notes, notes,
                                    -- more_frequent_synonym, more_examples, regionalism,
                                    -- context_segment. Default '{}'.
  grammar             jsonb         -- typed sparse bag of language-agnostic morphology / grammar
                                    -- facts: pos, gender (m/f/n/c), aspect (impf/perf/biaspectual),
                                    -- aspect_pair_headword, government (e.g. "от + gen"), number_only
                                    -- (plurale_tantum/singulare_tantum), is_indeclinable, is_reflexive,
                                    -- animacy, display_form (e.g. stress-marked Russian "ви́деть"),
                                    -- notable_forms (irregular paradigm cells), ipa
                                    -- ({ga?, rp?, untagged?}). Default '{}'.
                                    -- Populated by basic-data pass; refinable by enrichment pass.
                                    -- Per-language instructions block dictates which keys to fill.
                                    -- Wiktionary grounding for enabled languages overrides high-confidence
                                    -- structured fields and IPA via kaikki data after the basic-data pass.
  grounded_at         timestamptz?  -- stamped when wiktionary grounding merged kaikki data into
                                    -- `grammar`. Null = pure LLM (no dump for this language, or
                                    -- nothing matched). Historical provenance: does not get cleared
                                    -- by user edits.
  grounding_patch     jsonb?        -- the exact kaikki patch merged at grounding time. Per-field
                                    -- provenance compares grammar values against it (equal =
                                    -- Wiktionary-verified, diverged = edited). Null = never grounded
                                    -- or grounded before the column existed; such legacy rows claim
                                    -- nothing and re-ground once (backfill) when next touched.
  grammar_user_edited_at timestamptz?
                                    -- stamped when the user manually edits grammar-provenance-
                                    -- sensitive data (grammar fields, headword, or sense). Guards
                                    -- reprocessing: automatic grammar patches and re-grounding skip
                                    -- edited rows. (The UI no longer reads it — per-field provenance
                                    -- is value-comparison against grounding_patch.) Automatic
                                    -- processing, grounding, enrichment, and chat tool patches do
                                    -- not stamp this.
  status              'needs_data' | 'kept' | 'removed'
                                    -- auto-transitions 'needs_data' -> 'kept' the
                                    -- moment the card gains basic data (after
                                    -- applyStudyIntent, so intent facets exist
                                    -- before the keep-time recognition default).
                                    -- 'needs_data' is therefore transient (a card
                                    -- between materialization and its first
                                    -- basic-data write) or a note-only stub with
                                    -- no data yet. 'removed' = unkept via
                                    -- Remove-from-session; auto-keep never
                                    -- resurrects a 'removed' row. (NOT a
                                    -- soft-delete of the term — chunks.deleteChunk
                                    -- is that, via user_lookups.deleted_at.)
  created_at          timestamptz
  updated_at          timestamptz

card_chat_message
  id                  uuid pk
  card_id             uuid
  role                'user' | 'assistant'
  content             text
  created_at          timestamptz

card_chat_read_state                 -- per-card chat read marker (server-side, cross-device)
  card_id             uuid pk -> card.id (ON DELETE CASCADE)
  last_read_at        timestamptz  -- bumped to NOW() when the chat panel opens or
                                   -- observes a fresh assistant turn. cards.* read paths
                                   -- derive hasUnreadChat = newest card_chat_message
                                   -- with role='assistant' has created_at > last_read_at.
                                   -- card_id alone is the PK (a card has exactly one owner).

processing_jobs                      -- durable background-job queue (enrichment + ghost nomination)
  id                  uuid pk
  kind                'enrich_highlight' | 'nominate_window'
                                   -- legacy enum may still include discover_session; worker treats it as no-op
  study_session_id    uuid -> study_session.id  (ON DELETE CASCADE)
  highlight_id        uuid? -> highlight.id      (ON DELETE CASCADE; required for
                                    -- enrich_highlight, null for nominate_window)
  window_start_index  int?          -- required for nominate_window
  window_end_index    int?          -- required for nominate_window
  user_id             uuid
  status              'pending' | 'processing' | 'done' | 'failed'
  attempts            int          -- bumped at claim; gates retry vs fail
  last_error          text?
  run_after           timestamptz  -- debounce (enqueue) + exponential backoff (retry)
  locked_at           timestamptz? -- lease: stamped on claim, reclaimed when stale
  locked_by           text?        -- claiming worker id
  created_at          timestamptz
  updated_at          timestamptz
  -- Partial unique indexes over LIVE (pending/processing) rows make enqueue
  -- idempotent: one in-flight enrich job per highlight. Nominate-window
  -- idempotency lives in nominated_windows and is inserted atomically with the job.

nominated_windows                   -- coverage set for reading-window ghost nomination
  id                  uuid pk
  study_session_id    uuid -> study_session.id  (ON DELETE CASCADE)
  start_index         int          -- track-relative segment index, inclusive
  end_index           int          -- track-relative segment index, inclusive
  status              'pending' | 'done' | 'failed'
  created_at          timestamptz
  updated_at          timestamptz
  -- unique (study_session_id, start_index, end_index)

ghost_candidates                    -- passive LLM-nominated spans in the reader
  id                  uuid pk
  study_session_id    uuid -> study_session.id  (ON DELETE CASCADE)
  segment_id          uuid -> text_segment.id
  char_start          int          -- raw segment text offset, same coordinate space as highlights
  char_end            int
  surface_form        text
  dismissed_at        timestamptz? -- set when adopted into a real highlight
  created_at          timestamptz

user_lookup                          -- cross-source dedup + canonical user vocabulary record + SRS state
  user_id             uuid
  target_language     text
  headword            text
  sense               text          -- 1-5 word disambiguator; '' for legacy rows
  first_card_id       uuid?         -- representative card for content lookup (Practice generation prompt)
  exported_at         timestamptz?  -- last CSV export (legacy; the vocab-wide
                                    -- export does not stamp this)
  count               int default 0 -- transition-driven: how many cards across
                                    -- all sessions currently have status='kept'
                                    -- pointing at this lookup. count > 0 is the
                                    -- visibility gate for both Vocabulary and
                                    -- Practice (alongside deleted_at IS NULL).
                                    -- needs_data/removed → kept
                                    -- bumps +1 (and clears deleted_at);
                                    -- kept → anything-else decrements -1
                                    -- (floored at 0). SRS state is preserved
                                    -- across un-keep so re-keeping resumes the
                                    -- schedule.
  -- SRS/FSRS scheduling, leech-rehab, and first-introduction state do NOT
  -- live on user_lookups. They live in public.study_facets — one row per
  -- (user_lookup_id, skill, target_form), each owning its own srs_* columns,
  -- leech_* columns, and introduced_at (the daily-new stamp). There is no
  -- per-term learning_mode column: "in production" is an enabled
  -- (disabled_at IS NULL) (meaning_production,'') facet, surfaced on the
  -- wire as a DERIVED `learningMode` for read-only display.
  -- See the "Passive vs active pools (now facets)" bullet above and
  -- docs/SRS.md §1 for the study_facets schema + the full data model.
  created_at          timestamptz   -- powers Vocabulary "Recently added" sort
  deleted_at          timestamptz?  -- soft-delete from Vocabulary tab; also hides from Practice queue
  primary key (id)
  unique (user_id, target_language, headword, sense)

practice_session                       -- generated-text practice only. The no-LLM
                                      -- flashcard reviewer is sessionless and reads
                                      -- live due/new rows directly from user_lookup.
  id                  uuid pk
  user_id             uuid
  target_language     text
  pool                'passive' | 'active' default 'passive'
                                    -- which SRS column family this session
                                    -- reads/writes. The (user, target_language,
                                    -- pool) tuple is unique among status='active'
                                    -- rows, so a passive session and an active
                                    -- drill can coexist for the same language.
  status              'active' | 'completed' | 'abandoned'
  started_at          timestamptz
  ended_at            timestamptz?

practice_text                        -- one LLM-generated passage within a session
  id                  uuid pk
  practice_session_id uuid -> practice_session.id
  ord                 int           -- order within session
  status              'pending' | 'generating' | 'ready' | 'reading' | 'done' | 'failed'
  body                text?
  annotations         jsonb         -- [{ headword, sense, surface_form, char_start, char_end }]
                                    -- char_start/end computed server-side from surface_form (LLMs
                                    -- are unreliable at counting characters; the tool only emits
                                    -- surface_form and the server locates each occurrence).
  generation_warning  text?         -- e.g. dropped annotations summary
  created_at          timestamptz
  ready_at            timestamptz?
  read_at             timestamptz?

practice_rating                      -- audit log of generated-text rating events
                                     -- (explicit + implicit). Flashcard ratings do
                                     -- not insert here because practice_text_id is
                                     -- required; their durable record is the updated
                                     -- user_lookup.srs_* counters/timestamps.
  id                  uuid pk
  practice_text_id    uuid -> practice_text.id
  user_id             uuid
  target_language     text
  headword            text
  sense               text          -- composite FK to user_lookup
  pool                'passive' | 'active' default 'passive'
                                    -- mirrors practice_session.pool so the
                                    -- audit log identifies which SRS column
                                    -- family this rating advanced.
  rating              'again' | 'hard' | 'good' | 'easy'
  was_explicit        bool          -- false = implicit-good applied on Next-text advance
  rated_at            timestamptz

practice_exercise                    -- durable pre-generated exercise bank for the
                                     -- Strengthen surface (leech rehab gates +
                                     -- post-session bonus). Fencing lifecycle
                                     -- mirrors practice_text.
  id                  uuid pk
  user_id             uuid -> auth.users (ON DELETE CASCADE)
  user_lookup_id      uuid -> user_lookup (ON DELETE CASCADE)
  target_language     text
  pool                'passive' | 'active'
  exercise_type       'mc_cloze' | 'mc_comprehension' | 'production_cloze' | 'use_in_sentence'
  status              'pending' | 'generating' | 'ready' | 'used' | 'failed'
  generation_token    uuid?         -- fencing token minted at claim; markReady /
                                    -- markFailed verify it so crashed/raced
                                    -- workers' late writes are fenced out
  payload             jsonb         -- per-type shape; answer fields (answer /
                                    -- answerIndex / acceptedForms) are stripped
                                    -- server-side before serving
  gate_eligible       bool          -- deterministic grading only (MC + production
                                    -- cloze). LLM-graded use_in_sentence is false:
                                    -- bonus-only, never gates a graduation
  seen_at             timestamptz?
  used_at             timestamptz?  -- consume-on-answer: stamped when an answer is
                                    -- SUBMITTED, never when served. Refresh/abandon
                                    -- re-serves the same row; skip consumes nothing
  generation_warning  text?
  created_at          timestamptz
  ready_at            timestamptz?

-- users (template table, extended with global Flicktionary prefs)
users
  id                       uuid pk
  ...
  native_language          text?
  tap_to_translate_enabled boolean default false
  llm_highlights_enabled   boolean default true

user_target_language_pref
  user_id                   uuid
  target_language           text
  cefr_level                text
  show_translations_enabled boolean default true
```

Notes:

- `highlight` uses `start_segment_id` + `end_segment_id` so multi-line selections work cleanly. Single-line is the case where they're equal.
- `card` is split from `highlight` because LLM-suggested chunks have no highlight, and because regenerating a card shouldn't churn the original highlight metadata.
- Foreign keys point to `text_segment.id` — the stable id, not `index`. We don't re-fetch SRTs in v1.
- Card content is fully captured by the basic columns + `exploration_extras`.
  There is no separate `front_override` / `back_override` — the front/back used
  at export are computed from the basic columns and edits go directly into
  those columns.

## LLM methodology prompt

Used as the system prompt for every heavy pass (context blob, basic-data, full-exploration, practice-text-generation) and per-card chat. Runtime variables: `{native_language}`, `{target_language}`, `{cefr_level}`, `{source_context_blob}`, plus a per-target-language instruction block (hardcoded in `language-instructions.ts`). Four blocks ship today: Spanish (rioplatense / peninsular / Mexican variant rules, pronominal-verb headword rules, plus grammar-field guidance for unpredictable gender + reflexive verbs + fixed-preposition verbs); Russian (clean-headword convention, soft-sign-masculine flagging, aspect + aspect_pair_headword + government rules, plurale tantum, stress-marked `display_form`); English (marked-infinitive headword convention `to <verb>`, prepositional-verb government, irregular-form `notable_forms` for irregular pasts / plurals / comparatives, plurale tantum); German (bare-capitalized-noun / article-derived-from-gender convention — the article is never in the headword — required gender + plural + genitive forms + weak-noun flag for nouns, joined-prefix infinitive + separable flag + perfect auxiliary (`haben` / `sein` / `haben_or_sein`) for verbs, principal parts in `notable_forms`). The German citation line is composed at render time by a shared helper (`packages/core/src/utils/german-noun-forms.ts`): `der/die/das` from gender, the plural as a `pl -e` suffix or full `die Häuser` form, and the genitive only when it deviates from the predictable masc/neut `-(e)s`. The English block is parameterized on the user's `english_ipa_dialect` pref (GA vs RP): it sets the default variety for usage, spelling, and IPA, and flips which variety gets flagged as regional — each dialect is its own stable cache-prefix variant; the dialect is threaded into the full-exploration pass and per-card chat (other passes default to GA). The block is injected right after the methodology preamble, inside the cacheable prefix; sessions in a target language with no entry fall through silently.

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

## Card output template

Cards have two tiers of data:

### Basic data (populated by step 3 — basic-data pass)

Promoted to typed columns on `cards`. Every card has these populated after
processing — user highlights bypass the CEFR floor (the basic-data pass forces
`below_cefr=false` for them), so they always get full basic data and a card that
auto-keeps. (`below_cefr` is still parsed for telemetry but never maps to a card
status.)

- `headword` — LLM-normalized dictionary citation form
- `sense` — 1-5 word disambiguator (NOT a definition; used for cross-session dedup)
- `surface_form` — literal form as it appears in the segment
- `translation` — into native_language (null when real L1 = target language or the per-target Show-translations pref is off)
- `definition` — contextual paraphrase in target_language (back-of-card when translation fields are hidden; optional otherwise)
- `target_example` — self-contained example sentence in target_language, inspired by but not equal to the source line
- `native_example` — natural translation of `target_example` into native_language (null when real L1 = target language or the per-target Show-translations pref is off)

### Grammar (populated by basic-data pass; refinable by enrichment)

Stored in `card.grammar` as a typed sparse JSONB bag. Keys are
language-agnostic; the per-target-language instructions block decides which
keys are filled when. Every key is optional. The renderer treats `null` and
absent identically (LLMs and JSONB-merge writes both occasionally leave
explicit nulls behind, so consumers must be defensive).

```json
{
  "pos": "noun | verb | adjective | adverb | preposition | pronoun | particle | conjunction | numeral | phrase | idiom | other",
  "display_form": "string",
  "gender": "m | f | n | c",
  "number_only": "plurale_tantum | singulare_tantum",
  "is_indeclinable": true,
  "animacy": "animate | inanimate",
  "aspect": "impf | perf | biaspectual",
  "aspect_pair_headword": "string",
  "is_reflexive": true,
  "government": "string (e.g. '+ acc', 'от + gen', '+ on (gerund)')",
  "ipa": { "ga": "string | null", "rp": "string | null", "untagged": "string | null" },
  "notable_forms": [{ "label": "string", "form": "string" }],
  "notes": "string"
}
```

`ipa` is generated by default: the basic-data pass fills it
for every chunk (English → the user's `english_ipa_dialect` bucket, others →
`untagged`; dictionary delimiters kept in the string, omit-when-unconfident),
and Wiktionary grounding overwrites it where kaikki has data. The flashcard
renders a blue verified badge when the IPA is dictionary-grounded
(`ReviewTerm.ipaSource = 'wiktionary'`, computed server-side as grounded +
`grammar.ipa` still matching `grounding_patch.ipa`); LLM IPA carries the amber
"unverified" marker in the focus view via the existing per-field provenance.

### Exploration extras (populated only by `Generate full exploration`)

Stored in `card.exploration_extras` as a partial JSONB bag. The renderer
iterates known keys; missing keys collapse silently.

```json
{
  "ipa": "string (legacy only — no longer in the schema; new explorations write grammar.ipa instead, old rows keep it)",
  "frequency": "high | medium | low",
  "more_frequent_synonym": "string | null",
  "regionalism": "string | null",
  "register": "informal | neutral | formal | literary | ...",
  "register_alternatives": {
    "more_formal": "string | null",
    "less_formal": "string | null"
  },
  "collocations": ["string", "string", "string"],
  "etymology": "brief origin or idiom story",
  "l1_notes": "false-friend / interference flags for this user's L1, or null",
  "notes": "anything else needed to master usage, or null",
  "context_segment": "string with the chunk wrapped in **double asterisks**"
}
```

The enrichment pass is also allowed to refine the basic columns when its
deeper analysis improves on the shallow basic-data pass.

### Default card front/back at export time

Computed from the basic columns. There are no overrides — the user edits the
basic columns directly via the focus view's per-field inputs (or via chat
through the `update_card_fields` tool), and those edits are what flow into
the CSV.

- `front` = `[headword, target_example]` joined by a blank line (skipping empty values)
- `back` = `[translation || definition, native_example]` joined by a blank line (skipping empty values)

In the CSV the blank line is rendered as `<br><br>` (the export imports with
`#html:true`).

## Tap-to-translate (fast path)

Separate, fast LLM call. Not the methodology prompt — just a gloss.

```
Target: {target_language}
Native: {native_language}
Context line: {segment_text}
Selection: {selection_text}

Return a one-line gloss in {native_language} when translation fields are
enabled. Return a one-line definition/gloss in {target_language} when
translation fields are hidden. Optionally a single POS tag and a single
register tag. No examples, no etymology, no formatting.
```

Result cached on `highlight.fast_gloss`. Re-tapping the same highlight shows the
cached result instantly.

## User flows

**Start a movie or TV session**

1. From the `+` overlay, pick `Start a movie or TV session`.
2. Pick the study language. If first session in this target language: prompt for CEFR level.
3. Choose `Movie` or `TV show`.
4. Pick the content (TMDB-backed metadata): a movie, or a TV show → season → episode.
5. Pick a subtitle track: OpenSubtitles search filtered to target language (movie by `tmdb_id`, episode by `parent_tmdb_id` + season + episode), or upload `.srt`.
6. App verifies the chosen track's language matches target language; can't proceed otherwise.
7. Session created.

For a show already in the Sessions list, the `Add episode` button on its show detail screen enters this flow at step 4's episode picker (show + season pre-seeded, language/CEFR skipped), and step 3's TV-show search offers recently-added shows as quick-picks — see "Movie & TV subtitles" above.

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
6. Frontend lands on the focus view of the new card with `?from=vocabulary`, so chevron-back returns to `/vocabulary`.

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
3. Sticky-footer `Practice these chunks` button starts a Practice session in the session's target language (language-wide pool — kept chunks from this session feed into it via the user-lookups upsert that fires on the auto-keep transition).

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
