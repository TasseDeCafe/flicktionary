# Reader & enrichment pipeline (web)

> **Status: authoritative-spec.** Source ingestion (movie/TV subtitles, pasted text,
> ad-hoc vocab entries), the in-session reader (gloss sheet, highlights, ghost
> suggestions), the background enrichment pipeline, and the fast-gloss pass. Split out of
> `SPEC.md`, which keeps the product overview and user flows.

Terminology note: this doc uses "chunk" for the internal domain concept and "term" when
quoting user-facing strings — see `SPEC.md` → Terminology.

## Source content

Three source kinds in the MVP, all feeding the same `text_segment` table. (Two further ingestion paths — **YouTube via the companion browser extension** (see `SPEC.md` → "Browser extension (companion)") and the **Telegram bot** (below) — also land in `text_segment` but are not web-app flows.)

- **Movie & TV subtitles.** Movies and TV episodes share one wizard flow; the user picks `Movie` or `TV show` after choosing the study language. TV adds a season → episode selection (TMDB `/search/tv` → `/tv/{id}` seasons, season 0 / Specials hidden → `/tv/{id}/season/{n}` episodes). Each episode is its own `content_source(type='tv')` titled `"<show> · S0xE0y · <episode>"`, deduped globally on `(tmdbShowId, seasonNumber, episodeNumber)` (a DB partial unique index backs the app-level check); movies stay `type='movie'`.
  - **Continuing a show (fewer clicks).** Two shortcuts cut the wizard down for shows already being watched. (1) The TV-show search step lists the user's **recently-added shows** (MRU) under the search bar; picking one skips the TMDB search. (2) The show detail screen's `Add episode` button deep-links straight into the **episode picker** with the show + season pre-seeded (language and CEFR are already known for an existing show, so those steps are skipped). In the episode picker, episodes already added for that show+season are marked `Added` and the first not-yet-added episode is highlighted as `Next`. From there it's the normal subtitle-source → subtitle-pick path, so continuing a show is roughly "Add episode → confirm episode → pick subtitle".
  - **OpenSubtitles search.** Search by title; results filtered to the user's target language. The track's `language` must match the chosen study language — never inferred. TV episodes search OpenSubtitles `/subtitles` with `parent_tmdb_id` + `season_number` + `episode_number` + `type=episode`; movies search by `tmdb_id`.
  - **Manual `.srt` upload.** First-class, not a fallback (available in both the movie and TV branches). Language is auto-detected from the SRT contents server-side (Haiku call) on upload and applied to the picker; the user can override before the upload completes.
  - On import, SRTs are normalized into per-line `text_segment` records (with `start_ms`/`end_ms`) and indexed for full-text search. The raw SRT is not preserved as a single blob.
- **Pasted text.** First-class, not a fallback. The user pastes raw text (50–20,000 chars), provides a short title (auto-suggested from the first ~60 chars), and picks the language (auto-detected from the paste via a Haiku call as the user pauses typing; the manual override always wins).
  - Segmented one row per non-empty line (`\n`-split, trimmed). `start_ms`/`end_ms` are null.
  - Same FTS / dedup-hash plumbing as subtitles.
- **Telegram bot.** Send/forward a text message to the bot; it replies with a deep link to a ready reading session (`/sessions/<id>`). One message = one session, via the same one-shot import the extension text path uses (`importTextForUser`, `apps/backend/src/service/study-sessions/import-text.ts`): language auto-detected server-side (Haiku, no manual pick), one segment per non-empty line, idempotent by sha256 of the parsed lines (re-sending a message resolves to the existing session), `content_source(type='text')`. Title = the forwarded channel's title when present, else the paste wizard's first-~60-chars suggestion. Two transports feed one handler: a secret-token-verified webhook (`POST /api/v1/telegram/webhook`) in production, `getUpdates` long-polling against a separate dev bot in development.
  - **Pairing.** A chat maps to one account (`users.telegram_chat_id`, stealable on re-pair; `/unpair` clears it). Unknown chats get a `/telegram-pair?nonce=<uuid>` web link (server-minted nonce bound to the chat, 60 min TTL, single-use transactional claim); the page sits behind the auth guard so the existing signup + `?redirect` machinery carries a brand-new user through Google/magic-link signup, and embeds `OnboardingView` when native language isn't set. The triggering message is stashed (`telegram_pending_imports`, one per chat, 24 h) and resumes only after onboarding completes (`telegramPair.completePending`, deliberately split from `claim`).
  - **Missing CEFR.** When the detected language has no CEFR pref, the bot asks in-chat with an A1–C2 inline keyboard, saves the answer via the normal `upsertCefr` path, and resumes the stashed import. `NEEDS_ONBOARDING` / `UNSUPPORTED_LANGUAGE` / empty-text map to plain-language replies; onboarding itself is never replicated in chat.
- **Ad-hoc vocab entries.** Source-less captures from the "Add a word" flow (`+` overlay → `Add a word`). The user types a single word/expression plus optional context; one card is generated by a single basic-data pass call. Each `(user, target_language)` pair gets one synthetic `content_source(type='adhoc', title='Personal vocabulary')` lazily on first entry; each subsequent entry appends a `text_segment` (the user's context, prefixed with the headword for safe offset math) and a `card`. The synthetic session carries a hardcoded non-empty `context_blob` so per-card chat and `Generate full exploration` work unchanged. Hidden from the Sessions list — these live exclusively in the Vocabulary tab. CEFR for the target language is required (prompted inline if missing). The picker defaults to the user's `lastTargetLanguage` MRU (then the first CEFR-set language alphabetically). Language is **not** auto-applied here — single-word input is too ambiguous (homographs like `importar` ES/PT) — but a prominent, easily-tappable advisory banner (`Looks like German` text + an explicit `Switch` action with an icon, sized for a large touch target) appears below the picker when Haiku detects a different language in the typed headword + context. One tap applies the switch and dismisses the hint for the rest of the session.
- All user content is RLS-scoped. Don't expose subtitle or paste text publicly.

## During a session

- No in-movie sync. The app is for triage and lookup, not playback.
- The mid-source screen is a search bar over the track plus a scrollable list of segments. Movie segments show a timestamp; text segments don't. That is the entire mid-source UI.
- Tap-to-select on plain segment text opens a small **floating gloss sheet** anchored to the selection, in PREVIEW mode — looking is free; nothing persists until the explicit **Save** (desktop popover, capped to the viewport's available height with internal scroll so an expanded sheet never clips; its main action footer is sticky below the scrollable body, and wheel/touch overscroll is contained so the page behind it does not scroll; mobile bottom drawer with a transparent overlay so the source line stays visible — the drawer always docks at the bottom and opens collapsed, showing the header (term, gloss, IPA, register chips) pinned in full plus a short peek of the detail region below it; the action footer is a distinct pinned bar (top border, plus a soft upward shadow only while collapsed so the peeking content reads as tucking under it). Dragging from the handle **or** the header follows the finger continuously — the sheet grows/shrinks between the collapsed and expanded detents (rubber-banding past the expanded cap) and snaps to the nearest one on release by final position + flick velocity; a downward drag past the collapsed edge dismisses. The detail region scrolls internally only once expanded). A single click/tap selects one `Intl.Segmenter` word in the session's target language; press-and-drag extends to a contiguous word range, including multi-line / multi-segment ranges. Selectable words show a subtle accent-tint hover affordance; the selection paints a sky wash (outer corners rounded) that PERSISTS while the sheet is open — it shows what the sheet refers to — and clears on sheet close or the next press. Tapping another word while the sheet is open swaps its content in place (no close/reopen flash) — the sheet's `ignoreOutsidePointerDownSelector` keeps the tap on a word/highlight span from dismissing it. Native browser text selection is disabled in the segment list so the gesture vocabulary stays consistent. Clicking an existing yellow highlight opens the existing-highlight sheet instead. The sheet fetches a fast one-line gloss + POS + register tag; on Save, that already-shown preview gloss is sent to `highlights.create` and persisted on the new highlight so saved mode does not run a second first-gloss LLM pass. A re-tap on the same span is instant. There is no backdrop tint and no separate tap-to-translate opt-out (the old setting was retired when the sheet became unobtrusive enough to be always-on). **Right-click is the save/remove toggle** (extension parity): on a bare word it saves immediately — no selection, no sheet — and on a saved highlight it removes it; with the sheet open it saves in preview mode and removes in saved mode, so repeated right-clicks cycle save → remove. The open sheet SURVIVES the toggle and morphs in place (right-button pointerdown is never a dismiss gesture for the floating sheet): preview → saved on save, and saved → preview on remove when the sheet holds a live selection (a sheet opened from a highlight click has no selection to preview, so a remove closes it). Saving and removing show **no success toast** — the span's yellow wash appearing/disappearing is the feedback (a toast per word gets noisy at volume and overlapped controls on mobile); failures still toast. **Saves paint optimistically** (extension parity): `useCreateHighlight` inserts a temp row (`optimistic-` id prefix) into the highlights cache in `onMutate`, so the yellow wash appears the moment the user saves; the create response swaps in the real row, errors roll back, and the settle-time invalidate keeps the server's view the truth. Interactions keyed on a highlight id (the right-click remove, clicking a highlight span, the sheet's saved-row dedup) skip optimistic rows until the real id lands. The sheet's IPA line renders the **server-picked `ipaDisplay`** from the fastGloss responses (the backend resolves the user's `english_ipa_dialect` pref), so web and extension show the same dialect for the same word; the `ipa` bag stays in the contract for older clients. IPA is Wiktionary-only: the surface form's own pronunciation is used when it exists, otherwise the lookup falls back to the form's lemma (via form-of resolution; the `wiktionary_forms` index carries no per-form IPA, and English inflected forms deliberately do **not** inherit the lemma's). On that fallback the response also carries `ipaLemma` (the lemma the IPA belongs to), and the sheet labels the line with it — `beheben /bəˈheːbən/` under a `behoben` selection — so an inflected surface form is never implied to be pronounced like its lemma; `ipaLemma` is null when the IPA is the surface's own (and never shown next to the "No Wiktionary IPA" fallback).
- The sheet shows an always-visible **study-target picker** (shared `StudySkillCards`, wrapped by `StudyOptionsSection`, also used by the practice lookup sheet and the extension's in-video popover): three monochrome, pressable icon-cards — Recognition (eye) / Production (pencil) / Pronunciation (mic), selected = dark border + filled-check badge, desktop tooltip = a shared Radix Tooltip opened on hover and positioned above the card — its `onFocusCapture` swallows the focus the popover fires when it autofocuses a card on mount, so the tooltip never self-opens just because the popover appeared (radix-ui/primitives#2248); in the extension it portals into the in-shadow popover container, which is marked `dark` and at the popover's max z-index so the tooltip is styled, dark-themed, and stacks above the popover instead of under it — plus a **Base form | Exact form** segmented control (Exact form shows the highlighted surface as its subtitle). The control is **exclusive**, not additive: it chooses WHICH target the selected skills attach to — *Base form* studies the lemma (citation facets), *Exact form* studies the encountered inflection (form facets), leaving the lemma a skill-less base anchor (it still exists as the term + vocab row + the focus view's citation chip; the form is shown beside it). `formScope: 'lemma' | 'form'`; `'form'` collapses to `'lemma'` server-side when the surface IS the headword. The cards are mono semantic tokens so they invert cleanly on the extension's dark video overlay. FULL-SET semantics — an untouched draft sends no `studyIntent` (the backend keep-time default applies); a touched draft sends exactly the checked set, riding `highlights.create` and applied by the enrichment job. **Nothing is pre-checked and 0 selected is allowed** in the popover (an empty set sends no intent → a `needs_data` card with no pre-configured facet; the keep-time default then enables recognition). The Base/Exact control locks until at least one skill is selected (skills need a target to attach to); Pronunciation is ALWAYS offerable (the preview's IPA is a Wiktionary-only lookup — enrichment generates IPA for every saved selection, and IPA-less facets are defended backend-side; see `docs/SRS.md`). On Save the sheet morphs in place into saved mode, where the **same study-target picker stays visible but is locked read-only** — it keeps its preview layout, uniformly dimmed + non-interactive (`pointer-events-none`, no per-control disabling so there's no half-greyed mismatch), with a lock caption pointing at the term view. It *displays* the saved skills + scope: from the highlight's stored `study_intent` pre-enrich, then from the term's live facets once the enrich job materializes it and a `chunkId` resolves (`chunks.getStudyTargets`, read-only — the sheet still polls `highlights.listBySession` only to switch that display source). The study-target choice is a SAVE-TIME decision: the only places to change it are the preview picker (before saving) and the focus / term view afterwards (or deleting the highlight). This is deliberate — switching scope post-enrich means creating/deleting durable form facets, which the compact sheet can't represent, so editing lives in the focus view alone.
- **Two commit lanes (preview footer).** The pre-save footer exposes both an **Add note** affordance and the main **Save** button — looking is free; nothing persists until one of the two commits. **Save** (main lane) creates the highlight and runs the normal `enrich_highlight` → full card pipeline; a note typed before saving rides along and seeds the card chat once. **Save note** (the note editor's own commit, shown once the editor is open) is the **note-only** lane ("ask a question, don't make a card"): it sends `highlights.create` with `noteOnly: true`, which synchronously creates an **empty stub card** (no basic-data pass, no Wiktionary grounding, no study facets) and seeds the card chat from the composed note/presets. A note-only save is still a real highlight (yellow span, session-vocabulary row, removable) — only the card body is empty until the user generates it later (see `docs/REVIEW-SPEC.md` → session vocabulary list). Skill selection is ignored in the note-only lane. When the note editor is open in preview, the footer shows **both** `Save` and `Save note`; collapsed, it shows `Save` + `Add note`. Both footer buttons keep the same size and split the width 50/50 in every state. **`Save note` is disabled until a note or preset is entered** — an empty note-only save would create a data-less stub whose chat never gets seeded (nothing to ask), so it is not allowed.
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

## Processing pipeline

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
  `MODEL_ENRICHMENT` (Opus by default; the `ENRICHMENT_MODEL` env var flips it
  to a cheaper model in one line). The pass output is bound to the job's
  highlight deterministically server-side — the model's echoed
  `highlight_id`/`segment_id` are never trusted for attribution, so an
  omitted or wrong echo can no longer orphan the data on a highlight-less
  card. Highlights are independent. The worker re-checks the highlight
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

