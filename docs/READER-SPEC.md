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
- **Session creation is find-or-create** (both wizards). The final `studySessions.create` call is idempotent on `(user, text_track, target_language)` — the same DB partial unique index the extension ingest flows serialize on. Re-adding the same content with byte-identical subtitles/text resolves to the same track, so create returns the existing session (`alreadyExisted: true`) instead of erroring; the wizard navigates into it — highlights intact — with an informational "picking up where you left off" toast. The existing session's stored native language and CEFR level win over freshly picked values.
- **Telegram bot.** Send/forward a text message to the bot; it replies with a deep link to a ready reading session (`/sessions/<id>?auth=<nonce>`). The `auth` nonce makes the link **self-signing**: Telegram opens links in its in-app browser, which shares no cookies with the user's real browser, so a bare link would dead-end on the login screen. The nonce is single-use, bound to the paired user, 10 min TTL (`telegram_auth_nonces`); the web app's `_authenticated` guard, when it loads signed-out with an `auth` query param (read from the raw query string — route `validateSearch` schemas strip unknown params), exchanges it via the unauthenticated, per-IP-throttled `telegramAuth.exchangeNonce` (POST-only, so link-preview crawlers can't burn it; previews are disabled bot-wide anyway) for a Supabase magic-link `token_hash` redeemed with `verifyOtp`, then re-enters the URL minus the burnt param. A used/expired nonce falls back to the normal login redirect. One message = one session, via the same one-shot import the extension text path uses (`importTextForUser`, `apps/backend/src/service/study-sessions/import-text.ts`): language auto-detected server-side (Haiku, no manual pick), one segment per non-empty line, idempotent by sha256 of the parsed lines (re-sending a message resolves to the existing session), `content_source(type='text')`. Title = the forwarded channel's title when present, else the paste wizard's first-~60-chars suggestion. Two transports feed one handler: a secret-token-verified webhook (`POST /api/v1/telegram/webhook`) in production, `getUpdates` long-polling against a separate dev bot in development.
  - **Pairing.** A chat maps to one account (`users.telegram_chat_id`, stealable on re-pair; `/unpair` clears it). Unknown chats get a `/telegram-pair?nonce=<uuid>` web link (server-minted nonce bound to the chat, 60 min TTL, single-use transactional claim); the page sits behind the auth guard so the existing signup + `?redirect` machinery carries a brand-new user through Google/magic-link signup, and embeds `OnboardingView` when native language isn't set. The triggering message is stashed (`telegram_pending_imports`, one per chat, 24 h) and resumes only after onboarding completes (`telegramPair.completePending`, deliberately split from `claim`). Pairing links can NOT self-sign (there is no paired account to mint a nonce for yet), and Google OAuth / passkeys cannot complete inside Telegram's in-app browser — so both pairing messages append a tip telling the user to open the link in their usual browser (email magic-link sign-in escapes the webview on its own: the emailed link opens in the real browser and `?redirect` carries the pairing nonce through).
  - **Missing CEFR.** When the detected language has no CEFR pref, the bot asks in-chat with an A1–C2 inline keyboard, saves the answer via the normal `upsertCefr` path, and resumes the stashed import. `NEEDS_ONBOARDING` / `UNSUPPORTED_LANGUAGE` / empty-text map to plain-language replies; onboarding itself is never replicated in chat.
- **Lesson-notes import.** (`+` overlay → `Import lesson notes`, `/lessons/import`.) Teacher lesson notes — pasted text, a Google-Docs `.md` export, or an `.xlsx` — become **proposed cards on a confirm screen**, then a lesson session. Unlike every other source, the content is not read as prose: an LLM extraction pass turns each note row into a typed candidate (`vocab` / `grammar` / `pronunciation` / `win` / `noise`). Grammar **and pronunciation** rows carry a `target_form` when a specific inflected form is the point (a case correction, a stress mark on a non-citation form — `мно́гими`): the headword stays the lemma, and confirm form-scopes the study intent so the facets attach to that exact form, not the lemma.
  - **Normalize (client).** `.xlsx` is converted to markdown tables client-side (`normalize-lesson-file.ts`, SheetJS), preserving intra-cell bold as `**…**` (teachers mark corrections and stressed vowels with it) and dropping broken formula cells; `.md`/paste pass through. Packed-date sheet names (`07102022`, `9122021`, `300922`, same-day counters like `24052021(2)`) are rewritten to `DD/MM/YYYY` headings so the server-side section splitter recognizes them; non-date names pass through untouched. A **multi-sheet workbook opens a sheet picker** instead of filling the textarea: one checkbox row per non-empty sheet (rewritten date as the title, raw sheet name beside it when different), nothing pre-selected — day-to-day only one sheet is new, and every selected sheet costs an extraction call — with a selected count + select-all toggle; the selection is composed into date-headed markdown on submit, and a selection past the contract's 500k-char `rawText` cap is refused client-side with a hint. Because SheetJS parses synchronously (seconds of blocked main thread on a big workbook), the upload button flips to a spinning `Reading file…` state that is painted before the parse starts. The wizard suggests a title, auto-detects the language from the composed text (manual pick wins), and offers the user's stored **teacher profiles** for the language. A first import in a language with no stored CEFR level inserts a **CEFR step** (2/2, same `CefrStep` as the session wizard) between `Extract cards` and batch creation — the level is saved via the normal `setCefrForLanguage` path, so the language appears in settings and later flows don't re-ask.
  - **Batch (draft).** `lessonImport.createBatch` stores the normalized text as an `import_batches` draft, idempotent by sha256 per (user, target language) — re-uploading the same text resumes the draft; if it was already confirmed the client routes straight to its session. A background `extract_lesson` job (standard `processing_jobs` worker; one Opus call per `### **DD/MM/YYYY**` section, regex-split) fills `import_batch_rows` and flips the batch `ready`; terminal failure marks it `failed` so the confirm screen's poll (2s) always terminates. Drafts expire after 30 days (worker sweep); confirmed batches are kept as provenance.
  - **Duplicate resolution.** Each extracted headword is matched (case-insensitive) against the user's vocabulary: no match → `create`; known term → `add_facet`; known term whose production citation facet sits in steady-state `review` → `lapse_and_add_facet` (a lesson error IS a lapse signal). Win/noise rows are always emitted (never silently dropped) but never imported.
  - **Confirm screen** (`/lessons/import/$batchId`, mobile-first): rows grouped by consequence (new / already-in-vocabulary / pronunciation / couldn't-parse / wins) with sticky headers + select-all toggles; two-line rows expanding to the verbatim source text, the learner's attempt, and per-row skill chips; a `⚠ lapse` badge on rows that will reschedule an existing card. Default-checked = extractor confidence ≥ 0.8 (validated calibration: every real extraction error scored ≤ 0.8). Sticky CTA `Add N cards · update M`.
  - **Confirm (LLM-free).** `confirmBatch` requires a stored CEFR pref for the batch's language — the session stamps it, so a missing pref is rejected with `cefr_not_set` (412) instead of guessing a level; the throw happens inside the transaction, so the status claim rolls back and the batch stays `ready`. The confirm screen recovers inline (a batch can reach it without the wizard — pre-existing drafts, non-wizard entry points): it swaps to the CEFR picker, saves the level, and retries automatically. Otherwise it runs in one guarded transaction (`ready → confirmed` claim makes it idempotent): creates the per-batch `content_source(type='lesson')` + track + session, appends one segment (`form — context`) + highlight (with the chips' `studyIntent`) + `enrich_highlight` job per accepted new row — cards then materialize progressively through the NORMAL pipeline below, so the session-vocabulary view's `EnrichingRow` polling works unchanged. Duplicates get `applyStudyIntent` + `recordEncounter`; lapse rows additionally get an implicit `again` rating stamped with `import_batch_id` (excluded from the daily review budget — see `docs/SRS.md`). The batch's inferred `format_profile` can be saved as a named teacher profile at confirm for future runs (descriptive context only — the system prompt owns the extraction rules).
- **Ad-hoc vocab entries.** Source-less captures from the "Add a word" flow (`+` overlay → `Add a word`). The user types a single word/expression plus optional context; one card is generated by a single basic-data pass call. Each `(user, target_language)` pair gets one synthetic `content_source(type='adhoc', title='Personal vocabulary')` lazily on first entry; each subsequent entry appends a `text_segment` (the user's context, prefixed with the headword for safe offset math) and a `card`. The synthetic session carries a hardcoded non-empty `context_blob` so per-card chat and `Generate full exploration` work unchanged. Hidden from the Sessions list — these live exclusively in the Vocabulary tab. CEFR for the target language is required (prompted inline if missing). The picker defaults to the user's `lastTargetLanguage` MRU (then the first CEFR-set language alphabetically). Language is **not** auto-applied here — single-word input is too ambiguous (homographs like `importar` ES/PT) — but a prominent, easily-tappable advisory banner (`Looks like German` text + an explicit `Switch` action with an icon, sized for a large touch target) appears below the picker when Haiku detects a different language in the typed headword + context. One tap applies the switch and dismisses the hint for the rest of the session.
- All user content is RLS-scoped. Don't expose subtitle or paste text publicly.

## During a session

- No in-movie sync. The app is for triage and lookup, not playback.
- The mid-source screen is a search bar over the track plus a scrollable list of segments. Movie segments show a timestamp; text segments don't. That is the entire mid-source UI.
- Tap-to-select on plain segment text opens a small **floating gloss sheet** anchored to the selection, in PREVIEW mode — looking is free; nothing persists until the explicit **Save** (desktop popover, capped to the viewport's available height with internal scroll so an expanded sheet never clips; its main action footer is sticky below the scrollable body, and wheel/touch overscroll is contained so the page behind it does not scroll; mobile bottom drawer with a transparent overlay so the source line stays visible — the drawer always docks at the bottom and opens collapsed, showing the header (term, gloss, IPA, register chips) pinned in full plus a short peek of the detail region below it; the action footer is a distinct pinned bar (top border, plus a soft upward shadow only while collapsed so the peeking content reads as tucking under it). Dragging from the handle **or** the header follows the finger continuously — the sheet grows/shrinks between the collapsed and expanded detents (rubber-banding past the expanded cap) and snaps to the nearest one on release by final position + flick velocity; a downward drag past the collapsed edge dismisses. The detail region scrolls internally only once expanded). A single click/tap selects one `Intl.Segmenter` word in the session's target language; press-and-drag extends to a contiguous word range, including multi-line / multi-segment ranges. Selectable words show a subtle accent-tint hover affordance (hover-capable fine pointers only — touch browsers emulate `:hover` from the last tap point and re-resolve it on DOM changes, which painted phantom "preselected" words); the selection paints a sky wash (outer corners rounded) that PERSISTS while the sheet is open — it shows what the sheet refers to — and clears on sheet close or the next press. Tapping another word while the sheet is open swaps its content in place (no close/reopen flash) — the sheet's `ignoreOutsidePointerDownSelector` keeps the tap on a word/highlight span from dismissing it. Native browser text selection is disabled in the segment list so the gesture vocabulary stays consistent. Clicking an existing yellow highlight opens the existing-highlight sheet instead. The sheet fetches a fast one-line gloss + POS + register tag; on Save, that already-shown preview gloss is sent to `highlights.create` and persisted on the new highlight so saved mode does not run a second first-gloss LLM pass. A re-tap on the same span is instant. There is no backdrop tint and no separate tap-to-translate opt-out (the old setting was retired when the sheet became unobtrusive enough to be always-on). **Right-click is the save/remove toggle** (extension parity): on a bare word it saves immediately — no selection, no sheet — and on a saved highlight it removes it; with the sheet open it saves in preview mode and removes in saved mode, so repeated right-clicks cycle save → remove. The open sheet SURVIVES the toggle and morphs in place (right-button pointerdown is never a dismiss gesture for the floating sheet): preview → saved on save, and saved → preview on remove when the sheet holds a live selection (a sheet opened from a highlight click has no selection to preview, so a remove closes it). Saving and removing show **no success toast** — the span's yellow wash appearing/disappearing is the feedback (a toast per word gets noisy at volume and overlapped controls on mobile); failures still toast. **Saves paint optimistically** (extension parity): `useCreateHighlight` inserts a temp row (`optimistic-` id prefix) into the highlights cache in `onMutate`, so the yellow wash appears the moment the user saves; the create response swaps in the real row, errors roll back, and the settle-time invalidate keeps the server's view the truth. Interactions keyed on a highlight id (the right-click remove, clicking a highlight span, the sheet's saved-row dedup) skip optimistic rows until the real id lands. The sheet's IPA line renders the **server-picked `ipaDisplay`** from the fastGloss responses (the backend resolves the user's per-language IPA dialect pref — English GA/RP, Spanish Castilian/Latin American, Portuguese Brazilian/European), so web and extension show the same dialect for the same word; the `ipa` bag stays in the contract for older clients. IPA is Wiktionary-only: the surface form's own pronunciation is used when it exists, otherwise the lookup falls back to the form's lemma (via form-of resolution; the `wiktionary_forms` index carries no per-form IPA, and English inflected forms deliberately do **not** inherit the lemma's). On that fallback the response also carries `ipaLemma` (the lemma the IPA belongs to), and the sheet labels the line with it — `beheben /bəˈheːbən/` under a `behoben` selection — so an inflected surface form is never implied to be pronounced like its lemma; `ipaLemma` is null when the IPA is the surface's own (and never shown next to the "No Wiktionary IPA" fallback).
- The sheet shows an always-visible **study-target picker** (shared `StudySkillCards`, wrapped by `StudyOptionsSection`, also used by the practice lookup sheet and the extension's in-video popover): three monochrome, pressable icon-cards — Recognition (eye) / Production (pencil) / Pronunciation (mic), selected = dark border + filled-check badge, desktop tooltip = a shared Radix Tooltip opened on hover and positioned above the card — its `onFocusCapture` swallows the focus the popover fires when it autofocuses a card on mount, so the tooltip never self-opens just because the popover appeared (radix-ui/primitives#2248); in the extension it portals into the in-shadow popover container, which is marked `dark` and at the popover's max z-index so the tooltip is styled, dark-themed, and stacks above the popover instead of under it — plus a **Base form | Exact form** segmented control (Exact form shows the highlighted surface as its subtitle). The control is **exclusive**, not additive: it chooses WHICH target the selected skills attach to — *Base form* studies the lemma (citation facets), *Exact form* studies the encountered inflection (form facets), leaving the lemma a skill-less base anchor (it still exists as the term + vocab row + the focus view's citation chip; the form is shown beside it). `formScope: 'lemma' | 'form'`; `'form'` collapses to `'lemma'` server-side when the surface IS the headword. The cards are mono semantic tokens so they invert cleanly on the extension's dark video overlay. FULL-SET semantics — an untouched draft sends no `studyIntent` (the backend keep-time default applies); a touched draft sends exactly the checked set, riding `highlights.create` and applied by the enrichment job. **Nothing is pre-checked and 0 selected is allowed** in the popover (an empty set sends no intent → a `needs_data` card with no pre-configured facet; the keep-time default then enables recognition). The Base/Exact control locks until at least one skill is selected (skills need a target to attach to); Pronunciation is ALWAYS offerable (the preview's IPA is a Wiktionary-only lookup — enrichment generates IPA for every saved selection, and IPA-less facets are defended backend-side; see `docs/SRS.md`). On Save the sheet morphs in place into saved mode, where the **same study-target picker stays visible but is locked read-only** — it keeps its preview layout, uniformly dimmed + non-interactive (`pointer-events-none`, no per-control disabling so there's no half-greyed mismatch), with a lock caption pointing at the term view. It *displays* the saved skills + scope: from the highlight's stored `study_intent` pre-enrich, then from the term's live facets once the enrich job materializes it and a `chunkId` resolves (`chunks.getStudyTargets`, read-only — the sheet still polls `highlights.listBySession` only to switch that display source). The study-target choice is a SAVE-TIME decision: the only places to change it are the preview picker (before saving) and the focus / term view afterwards (or deleting the highlight). This is deliberate — switching scope post-enrich means creating/deleting durable form facets, which the compact sheet can't represent, so editing lives in the focus view alone.
- **Two commit lanes + the inner note view (preview footer).** The pre-save footer shows **Save** plus an **Add note** affordance — looking is free; nothing persists until a commit. Tapping `Add note` navigates the WHOLE sheet content (header/body/footer) to an inner **note view** — back chevron + "Add note" title with the word as a subtitle, the note editor (textarea + preset chips), and ONE commit button — instead of expanding the editor inline below the study options (the same inner-navigation pattern as the focus view's "Set up form" step). **Save** (main lane, the main view's primary button) creates the highlight and runs the normal `enrich_highlight` → full card pipeline; a note drafted in the note view and kept via Back **rides along** and seeds the card chat once — the main view signals the pending draft by morphing `Add note` into `Edit note` with a dot. **Save note** (the note view's single button) is the **note-only** lane ("ask a question, don't make a card"): it sends `highlights.create` with `noteOnly: true`, which synchronously creates an **empty stub card** (no basic-data pass, no Wiktionary grounding, no study facets) and seeds the card chat from the composed note/presets. A note-only save is still a real highlight (yellow span, session-vocabulary row, removable) — only the card body is empty. Skill selection is ignored in the note-only lane. **`Save note` is disabled until a note or preset is entered** — an empty note-only save would create a data-less stub whose chat never gets seeded (nothing to ask), so it is not allowed. Both main-view footer buttons keep the same size and split the width 50/50; the note view resets to the main view when the selection swaps. On mobile, focusing the note textarea pops the keyboard, whose scroll-to-reveal targets the document — the sheet's scroll-away dismissal ignores outside scrolls while focus is inside the sheet, so the keyboard never dismisses it.
- **Note-only stub state ("note saved, word not saved").** After `Save note` (and on reopening such a highlight) the sheet morphs into a state that is deliberately DISTINCT from saved mode: the study-target picker stays **editable** (the study choice is still open), the committed note shows locked inline, and the footer is primary **Save** + a green cyclable **Note saved** control. `Save` **upgrades the stub into a full study card** via `highlights.saveWord`: it persists the chosen study intent on the highlight and enqueues the normal `enrich_highlight` job (no debounce — the choice is explicit). The enrich run **re-points the stub's still-`needs_data` card** to the enriched lemma+sense lookup (`insertCardForHighlightIdempotent`'s conflict-update; the stub card was pinned to a raw-selection lookup at save time) — same card row, so the note and its seeded chat survive — then auto-keeps it exactly like a full save. Kept cards are never rebound. `Note saved` cycles to `Remove` on hover and discards the stub (highlight + card + chat), morphing back to preview. Stub-ness is the DTO's `noteOnly` flag, derived server-side as "the highlight's card is parked in `needs_data`" (full-lane cards auto-keep within their enrich run) — which also surfaces the Save upgrade as a natural retry for a full save whose enrichment failed. The client pins the upgraded sheet to the normal saved display through the enrich window (the server keeps reporting `needs_data` for a few seconds). The alternative upgrade path — generating the card's data from the session vocabulary list or through the card's chat — still exists (see `docs/REVIEW-SPEC.md`).
- **Cyclable Save ⇄ Saved.** Once fully saved, the green **Saved** state is itself the remove control — clicking it removes the highlight and morphs the sheet back to preview (the on-screen counterpart of the right-click save→remove toggle), replacing the old standalone trash button.
- In saved mode the floating sheet bundles every action that used to live in a second-tap menu: optional free-text note, preset chips (`Explain`, `3 examples`, `Synonyms`, `Etymology`, `Why this form?`), and the cyclable **Saved** remove control. Composing/editing an uncommitted note happens in the same inner **note view** as preview (footer: `Saved` + `Add note`/`Edit note`-with-dot; the note view's single `Save note` patches the note/tags via `updateNoteAndTags`); the mobile sheet can be flicked down by its drag handle to dismiss. The note and tags are passed to the LLM at processing time. **The note/presets seed the card chat exactly once and lock on save** (like the study-target picker): a committed note/preset set renders read-only inline on the MAIN view — the saved note + selected chips, uniformly dimmed + non-interactive, with a lock caption — and the footer collapses to the cyclable **Saved** control (no `Edit note` / `Save note`). Re-saving would post a duplicate seeded chat turn (the seed is keyed per highlight, not per save), so the only way to change a committed note is to delete the highlight and start over; the card's own chat input handles genuine follow-ups. An empty save (no note, no chips) seeds nothing and stays editable, so a word saved without a note can still get one — once.
- **Reading position.** The reader tracks the deepest segment the user reaches by
  segment index (not scroll pixels), so it survives search filtering and a future
  virtualized reader. The value is persisted (throttled, monotonic) on
  `study_session.furthest_read_segment_index`. Reopening the session lands back
  at that line with no visible scroll (positioned in a pre-paint layout effect),
  and a floating `Last read` pill appears when that furthest-read segment has
  scrolled *below* the viewport AND the reader actually scrolled up (a
  ~120px-above-the-deepest-point gate; programmatic scrolls — the restore, the
  welcome-card reveal, deep-link jumps, search enter/exit clamps, placement
  confirm/cancel — re-baseline the gate, so a container resize or list swap can
  never pop the pill in on its own). Tapping
  it returns to the same saved line, aligned at the bottom of the viewport.
  Restore and the pill are suppressed while searching, and resume-tracking is
  also suppressed under a deep-link open (the `Open source` jump from a card /
  Vocabulary carries `?segment=`), so peeking at a term's source never moves the
  saved position. An explicit `?segment=` target also wins over resume on open.
  - **Manual bookmark ("read up to here").** The auto-tracker stays the
    default writer, but the pointer is user-correctable: a bookmark button in
    the reader header (which also carries a ⋮ options menu — the shared
    session actions overlay whose `Remove session` opens the confirmation
    and, on success, navigates back to the list) enters a **placement mode** — word-gloss taps,
    right-click saves, and the gloss sheet are suspended; pressing any line
    moves a sky-tinted preview divider below it (word presses place via the
    selection callback, since the gesture pointer-captures them and desktop
    Chrome then retargets the ensuing click to the container; non-word taps
    place via the click path — and placement works in the search-filtered
    list too, indices being track-relative); a sticky footer replaces the
    vocabulary footer with Cancel / **Set reading position**. Confirming
    calls `setReadingPosition` — a plain SET, deliberately non-monotonic:
    backwards corrects scroll inflation, forwards asserts previously-read
    content — and drops any queued throttled advance first (the server's
    GREATEST on the advance path would immediately re-raise the pointer over
    the correction). The client's monotonic merge guard stands down for that
    session until the next advance write re-arms it. Collected checkpoints
    are never clawed back by a pull-back — the checkpoint span just reads
    empty until the reader passes `reviewed_until` again.
  - **Auto-advance suspension.** After a manual set (or cancelling placement —
    browsing for a line isn't reading), auto-tracking suspends until the
    viewport scrolls back up to the pin — the natural "re-read from here"
    gesture — else the still-visible deeper lines would re-advance the
    pointer on the next scroll tick. The pin is client-session state only: a
    remount resumes at the pointer, so tracking re-engages next sitting.
  - **The divider rests for the whole sitting.** A hairline divider row
    renders below the position the sitting opened with (labeled `Resumed
    here`) or a manual set placed (`Read up to here` — nothing was resumed
    there), and STAYS mounted there for the entire sitting even after the
    reader passes it — WhatsApp's unread-messages bar; unmounting or chasing
    the live edge would shift content under the thumb. The next mount rests
    it at the new frontier. Hidden while searching.
- **Checkpoint reviews ("I understood up to here").** The scheduling
  semantics live in `docs/SRS.md` §6b/§6c; this is the reader surface. Only for
  sessions whose target language has wiktionary data (`KAIKKI_LANGUAGES`) —
  unsupported languages show none of these affordances.
  - **Declaration pill** (footer): the sticky footer is one fixed-height row —
    the pill on the left, the sole primary `Session vocabulary` on the right;
    nothing in it ever expands in place (the reading surface must never
    shift). The pill is the single ambient entry to the merged declaration
    sheet, and its face is a priority ladder (pure derivation in
    `declaration-pill-state.ts`, unit-tested): the sweep's markable word
    count (an animated digit roll on each ~6s debounced preview update, no
    floor — it's a passive meter); else **checkpoint mode** (`BookmarkCheck`
    + the pending review count) whenever `pendingCount + backlogCount > 0` on
    a non-empty span, so review collection stays reachable when the word
    count is 0 or the sweep is unsupported (profile pending/failed,
    adhoc/lesson sources); else a quiet `All known` label (span fully swept
    with session marks); else a dimmed non-interactive `0`. Hidden only when
    both systems are unsupported. The pill always shows the REAL cumulative
    count so it agrees with whatever inline offer is on screen (welcome-back
    card, close-out rider) — at reached-end it switches to the whole-text
    preview so it matches the close-out card's number. Anchored to the
    **furthest-read pointer, never the viewport**.
  - **Declaration sheet** (`checkpoint-sweep-sheet.tsx`, ResponsiveOverlay;
    step machine in `checkpoint-sweep-sheet-state.ts`, unit-tested): pressing
    the pill opens the merged checkpoint + sweep flow as an overlay (mobile
    drawer / desktop dialog — the transcript never moves), remounted per run.
    One **frontier snapshot** per run — the live pointer at open — feeds both
    writes, and the sweep step's count comes from a dedicated exact-span
    preview for that snapshot (the pill's debounced count can lag). Steps are
    included only when applicable, with a "Step X of Y" kicker when both are:
    **checkpoint** (`I understood up to here` — the old (i)-popover copy
    folded into the body, the pending count, the user-guide
    `#checkpoint-reviews` link; Confirm collects) → **sweep** ("Mark N words
    as known?" with Skip; a count that resolves to 0 skips itself) → **done**
    ("Checkpoint saved" + credited/marked counts, a secondary combined
    **Undo**, auto-close ~4s). No success toast — the done step IS the
    confirmation. The combined Undo reverts sweep then checkpoint
    sequentially and never silently swallows a partial failure: an
    `undoError` state names what wasn't reverted (a stale checkpoint —
    `undone: false`, a newer checkpoint exists — is explained, not
    retryable; network-failed parts get Retry). Dismissal is blocked while a
    mutation is in flight; before the first write it's a plain cancel; after
    a successful collect it means "skip the rest" (the checkpoint stays).
    CONFLICT renders an inline retry that re-snapshots the frontier first.
    Backlog candidates from a sheet collect are **queued**: the claims sheet
    opens only after the declaration sheet closes (never stacked on top),
    and a successful in-sheet checkpoint undo clears the queue.
  - **Preview counts** come from `getCheckpointPreview`, queried against a
    **debounced** furthest-read index (the raw index would mint a query key
    per scrolled segment). The preview cannot see the client's previewed-gloss
    spans and counts multi-sense headwords optimistically, so the pill may
    slightly overcount — the collect result shows the real number.
  - **Collect** posts the client-tracked `previewedSpans` (every span the
    preview gloss sheet opened on this mount — the stateless gloss endpoint
    persists nothing, so the client is the only source; the list is NOT
    cleared on checkpoint undo, so a re-collection stays suppressed; each
    span's text is truncated to the contract's 200 chars so one over-long
    selection can't fail validation on every later collect). The two
    surfaces share the mutation but present it differently: the **close-out
    card** keeps the original toast presentation — success → sonner toast
    (`# reviews collected`) with an **Undo** action, CONFLICT → error toast
    with Retry (session + preview refetch automatically), backlog candidates
    open the claims sheet immediately; the **declaration sheet** presents
    success as its done step and handles CONFLICT/undo inline as above. A
    successful undo on either path clears that checkpoint's claims re-entry
    (sheet + close-out card), since a reverted checkpoint no longer accepts
    assertions.
  - **Claims sheet** (`checkpoint-claims-sheet.tsx`, ResponsiveOverlay): "N
    words you saved but never practiced" with the candidate list
    (server-capped at 200 — see `docs/SRS.md` §6b — and collapsed behind a
    disclosure past 8), one confirm CTA for the whole group, and its own undo
    toast (`undoKnownAssertions`). Never automatic — the sheet is the opt-in
    second step, always dismissible. A confirm clears the client's claims
    batch (re-asserting the same batch would just skip), but an assertion
    undo that actually reverted something restores it — undo means
    reconsider — unless a newer collect replaced the batch or the checkpoint
    itself was reverted in the meantime (a dead checkpoint rejects
    re-asserts).
  - **Close-out card** (`checkpoint-closeout-card.tsx`): rendered after the
    last segment once the reader reaches the end of the track — keyed on the
    LIVE viewport (deepest visible segment) while tracking is on, not on the
    persisted pointer, so the card is already mounted when the scroll arrives
    instead of appearing below the fold after the throttled write lands;
    reaching the last line also flushes the progress write immediately
    (bypassing the 3s throttle) so the pointer the collect uses catches up.
    Hidden while searching; deep-link opens don't count as reaching the end.
    Offers the same collect action with a
    fuller presentation (keeping the (i) info popover), and is available even at pendingCount 0 — a
    zero-review close-out can still surface backlog claims, the discovery path
    the count-gated footer button can't provide. After everything is
    collected it flips to a passive "Reviews collected" state, keeping a
    claims re-entry whenever candidates remain — the batch from this mount's
    collect, or, when no local collect/assert has happened yet (reload,
    navigation back), the server-rehydrated copy from `getCheckpointClaims`
    (see `docs/SRS.md` §6c), so a reload can't strand unclaimed candidates.
- When `LLM-suggested terms` is enabled, the reader also shows **ghost candidates**: passive underlined spans nominated by the LLM for the reading window around the user's current scroll position. Ghosts never use `data-highlight-id`, never intercept pointer events, and have no click handler; the user still selects text normally. If a fresh selection overlaps a ghost, the floating gloss sheet shows an understated **lightbulb icon button** in the sheet header (a `Use suggested term` tooltip on desktop hover). Tapping it atomically swaps the provisional user-selected highlight for the ghost's exact segment/offset span, expands the sky-wash paint to cover the full suggested span, dismisses the ghost, and sends the adopted span through the same background enrichment path as any manual highlight. Because nomination is an LLM call that can take several seconds, the reader's sticky footer shows a `Finding suggestions…` loader (left of `Session vocabulary`; the footer carries no highlight-count hint — that stat lives in the reader header as a tappable `· N highlights` segment that opens the session vocabulary) whenever a nomination request is in flight or a window's job is still `pending`, so the delay does not read as broken. Turning the pref off disables nomination, ghost fetching/rendering, the adoption action, and the loader.

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
   untouched. English, German, Spanish **and Portuguese** skip Wiktionary
   `display_form` because head-template expansions are noisy whole head lines
   (`dictionary (plural dictionaries)`; German `Haus n (strong, genitive
   Hauses, …)`; es/pt have no ` • ` separator so the entire expansion would
   leak). IPA is bucketed per dialect-split language: English into GA/RP when
   tags allow it, Portuguese into BR/EU from bare `Brazil`/`Portugal` tags
   (narrower regions like Rio-de-Janeiro dropped), Spanish into
   Castilian/LatAm via the θ-twin rule over untagged variants (a θ-variant
   whose θ→s twin — exact, or fuzzy after stress-strip + s-degemination — is
   present splits into `cas`/`lam`; unpaired variants stay shared). Other
   languages use the untagged
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
   In local dev-tunnel, the reference tables survive `pnpm db:reset` via the
   snapshot/restore in `db--dev-tunnel--reset.sh`; if they end up empty
   anyway, grounding will still run but every lookup will miss and no field
   will earn a Wiktionary indicator. Reload with
   `pnpm --filter @flicktionary/backend load:kaikki` (uses the cached raw
   dump when present) and confirm non-zero per-language counts before testing
   Wiktionary indicators (the full local pipeline is in
   `docs/DATA-MODEL.md` § Populating the reference tables locally).
   See `.claude/skills/add-wiktionary-language/SKILL.md` for the operational
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
     writes (dialect-split languages (en/es/pt) → the user's IPA dialect
     bucket, others → `untagged`, delimiters included) — which is merged ONLY when the
     stored bag has nothing displayable, isn't Wiktionary-grounded, and
     the grammar wasn't user-edited. Per-chunk L1 notes (e.g. an
     English speaker's confusion between `près de moi` and `chez moi`)
     are generated by the model from its own training knowledge of L1→L2
     interference patterns, anchored to the specific chunk and source
     context — there is no separate global L1-notes pass.

## Personalized difficulty (expected vocabulary coverage)

One principled number per session: **expected coverage = Σ over the track's
matched word tokens of P(known), divided by the matched-token count** — "you'll
understand ~93% of this text's vocabulary". Served by the batched
`studySessions.getDifficulties` endpoint (POST, ≤100 unique session ids,
missing/foreign ids silently omitted; sessions sharing a (track, language)
cost one profile read, and the per-user side loads once per language). The
stat is always a live query — never pre-aggregated or snapshotted.

- **P(known) per lemma** (read-time precedence, strongest signal wins):
  - Any **live saved lookup** beats a `known_lemmas` mark. A scheduled
    (enabled, ready, SRS-state) citation recognition facet contributes its
    **FSRS retrievability** (same card conversion + recognition scheduler
    instance as rating — `recognitionRetrievabilityAt`); multiple saved
    senses of one lemma take the max. Leech-parked facets keep their
    retrievability as-is (accepted noise).
  - A saved term with **no schedule** (never introduced, disabled, or
    pending data) is **0** — and is counted in the "in your vocabulary, not
    started" bucket, never as "unknown". Saving a marked-known word is the
    correction signal that the user does NOT know it.
  - A `known_lemmas` mark (with no live saved lookup) is **1** — unless the
    marked lemma is UNRANKED while its token group has a ranked candidate:
    such marks are pre-candidate-filtering junk-homograph credits ("musth"
    next to "must") and are ignored so they can't count a token fully
    covered while its real lemma is still being studied.
  - Everything else is 0.
- **Ambiguity conserves mass**: the track profile stores token-level
  candidate groups, and each token contributes `token_count ×
  max(P(candidate))` exactly once — coverage can never exceed 100%.
- **Denominator = matched word tokens** (resolution failure is the
  proper-noun/number/typo filter). An empty profile (no matched tokens)
  reports `available` with a null percent/label.
- **Counts are distinct representative lemmas**, never token types: unknown =
  token groups where every candidate is unknown, represented by the
  highest-`freq_mass` candidate; "frequent" = representative rank ≤ 5000 in
  `lemma_ranks` (tuning constant); saved-not-started and known counts are the
  distinct lemmas of their buckets.
- **Labels** on the raw fraction — ≥0.98 comfortable, ≥0.95 challenging, else
  frustrating — while the displayed percent is **floored**, so a shown "98%"
  never carries a sub-0.98 label. Copy scopes honestly to *vocabulary*
  coverage (syntax, speech rate, abstractness are excluded).
- **Statuses**: `unsupported` (ad-hoc/lesson sessions — synthetic,
  non-narrative content — and languages without both kaikki data and a
  `lemma_rank_builds` manifest row), `pending` (profile build enqueued /
  in flight / stale-and-rebuilding; clients refetch), `failed` (build job
  terminally failed; clients stop polling), `available`. Builds never run
  synchronously inside the request. The lifecycle lives in ONE shared
  resolver (`service/lemma-profiles/profile-readiness.ts`) used by every
  stored-profile read path — the difficulty batch and the whole-text
  mark-known preview/sweep alike (the preview status enum carries `failed`
  too, and the sweep refuses with 422 `PROFILE_FAILED`) — and it always
  checks the latest job status before enqueueing: a failed job row is not
  "live", so the coalescing unique index no longer guards, and an
  unconditional enqueue on a polling path would mint a fresh job per poll
  forever. A stale profile whose rebuild terminally failed likewise reads
  `failed` rather than requeue-looping. Only ingestion-time ensure (an
  explicit re-import event) retries after a terminal failure.

### Web surfaces

- **Session cards** (Sessions list) show the compact stat on the meta line
  ("~93% comfortable", label colored by band); a small skeleton while
  `pending`, nothing for `unsupported`/`failed`. TV **episode rows** on the
  show detail screen carry the same stat (they don't render through
  SessionCard); the show-group card itself has no aggregate. The list makes
  one batched `getDifficulties` read keyed by the **full** session list — not
  the filtered view, so filter/search changes reuse the cached chunks
  (chunked at the 100-id cap) — and polls gently while any profile is still
  building.
- **Session header**: the stat sits next to the `LANG · CEFR` subtitle; tapping
  it opens the **difficulty detail sheet** — headline percent + label, the
  breakdown (unknown words with the frequent split, "in your vocabulary, not
  started", "marked as known"), the honest vocabulary-only scoping line, and
  the mark-known sweep CTAs (deliberate taps inside a sheet, consistent with
  phase 1's claims-lane posture; the exact counts come from
  `getMarkKnownPreview` and sit on the buttons themselves). While the
  previews are on their first in-flight load, the explainer/text-action
  block and the footer's primary slot hold their space with skeletons so
  the Close button doesn't reflow around the late CTA (first open only —
  reopens render instantly from the query cache). **The sweep has
  two scopes**: mid-text (furthest-read < track end) the primary CTA marks
  the span `[0, furthest-read]` — the progressive multi-sitting flow: mark
  what you've read, come back after the next sitting, mark further (repeat
  sweeps accumulate; overlap is free via `ON CONFLICT DO NOTHING` + the
  already-known exclusion) — with the whole-text sweep as a secondary text
  action; read-to-the-end (or never scrolled) shows the whole-text CTA
  alone. While partially read, the primary slot belongs to the span sweep
  ALONE: when the read span is fully swept (span count 0) the primary stays
  absent rather than falling through to the whole-text button — promoting
  "assert words I have NOT read" right after a successful span sweep would
  defeat the safeguard. Span sweeps tokenize the segments live server-side
  through the checkpoint matcher (profile rows carry no positions), so they
  work — and never report `pending` — even while the profile build runs;
  the whole-text preview can report `failed` (terminal build failure), which
  stops the polling and leaves the whole-text CTA absent. The sweep success
  toasts the marked count with an **Undo** action that reverts exactly that
  press: every press stamps its rows with a fresh `sweep_batch_id`
  (`markRemainingKnown` returns it; `unmarkKnownBySession` deletes by it), so
  undoing sweep 2 never takes sweep 1's marks. The sheet also carries a
  demoted **"Un-mark the N words marked known from this session"** text
  action (session-wide `unmarkKnownBySession` without a batch id, deleting
  all `source_id = session` sweep rows); its count is
  `getMarkKnownPreview.sessionMarkedCount`, computed for EVERY preview status
  — a span sweep can create marks while the whole-text profile is
  pending/failed, and the correction surface must not vanish then. Coverage
  refreshes via invalidation.
- **Reader sweep surfaces** (beyond the sheet — same sweep endpoints and
  batch-scoped undo; their counts only ever cover words actually READ: the
  read span mid-text via the checkpoint preview's debounced pointer with a
  raw fallback for the first fetch, the whole text at reached-end, nothing on
  a never-scrolled session; all gated on an `available` profile so a passive
  offer never polls a pending build; the previews hold the previous span's
  data across debounce re-keys — `keepPreviousData` — so count-driven UI
  doesn't blink out while a new key loads):
  - **Coverage meter**: a thin solid bar under the reader header (fill =
    expected coverage percent), animating on sweeps as the payoff. The
    read-but-unclaimed striped tail needs a projected-coverage number the
    preview doesn't return — shelved, see
    `docs/proposals/mark-known-projected-coverage.md`.
  - **Footer pill**: the declaration pill (see the checkpoint section) is
    the sweep's ambient surface — the live markable count with no floor,
    deliberately NOT standing down while the welcome-back or close-out cards
    are on screen (the numbers agree; a zeroed pill next to a card's real
    count reads as a contradiction). Mid-text it shows the span count; at
    reached-end it switches to the whole-text preview. The sweep action
    itself lives in the declaration sheet's sweep step.
  - **Close-out rider**: the checkpoint close-out card carries an "Already
    know the N remaining words?" section with an outline mark-as-known
    button. Any non-zero count shows — a surface the reader deliberately
    reached needs no floor.
  - **Welcome-back card**: once per mount, on returning to a partially-read
    session with at least the floor's worth (20) of unswept read words: an
    inline card below the divider — "N words from last time (up to
    <timestamp>) aren't marked as known yet." with secondary-weight **Mark
    as known** / **Not yet** (the footer CTA stays the only primary on
    screen). Its anchor and
    count are snapshotted from the pointer the mount OPENED with (last
    sitting's span, never the live pointer). The resume scroll extends once
    to include the card when its preview lands — but only while the reader
    is still parked at the restore frame, so a late preview never yanks
    someone already reading. "Not yet" dismisses for the sitting only;
    deep-link opens suppress the card entirely.
  - **Post-sweep confirmation**: welcome-back and close-out sweeps don't
    toast — a footer strip takes the pill's slot ("N words marked as known"
    + the batch-scoped **Undo**) for ~8 seconds, then the footer returns to
    resting. Declaration-sheet sweeps confirm in the sheet's done step
    instead (with the combined Undo). The difficulty sheet's own sweeps keep
    their toast.
- **Gloss-sheet chip**: when a selection's candidate lemmas intersect the
  user's `known_lemmas` (the fastGloss responses' `knownLemmaCandidates`),
  both the reader gloss sheet and the practice lookup sheet show a "Marked as
  known ×" chip; tapping it un-marks ALL candidates the token represents (no
  success toast — the chip disappearing is the feedback).
- **Freshness**: every SRS-writing mutation (ratings + undos, checkpoint
  collect/undo/assertions, facet enable/disable/delete, vocabulary
  delete/restore, card remove, highlight delete, adhoc/lesson imports,
  headword rename — the blend keys saved vocab by folded headword —
  and mark-known/un-mark) composes the shared `difficultyInvalidates()` key list
  (exported next to `practiceSummaryKeys()`); background highlight enrichment
  has no client mutation to hook, so the session-vocabulary view refetches
  difficulty when its enrichment polling transitions to idle.

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

