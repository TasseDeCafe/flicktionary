# Resume prompt — Flicktionary MVP build

---

I'm building the Flicktionary web app described in `/Users/sebastien/Documents/flicktionary/SPEC.md` on top of the existing template in this repo.

The full implementation plan is at `/Users/sebastien/.claude/plans/i-would-like-to-wild-codd.md` — please read both `SPEC.md` and that plan file in full before doing anything else. Follow `AGENTS.md` conventions (no `function` keyword, no semicolons, single quotes, never import React, ESM, Lingui for all user-facing text, oRPC for API contracts, raw `postgres.js` SQL — no ORM).

## Decisions already locked in

- **Stack**: existing template — Vite + React 19 + TanStack Router (web), Express + oRPC + Postgres.js (backend), Supabase auth.
- **Scope**: web only. Do not touch `apps/native`.
- **LLM**: Anthropic via `@anthropic-ai/sdk`. `claude-opus-4-7` (`MODEL_OPUS`) for all heavy passes (context blob, L1, difficult-words, full-exploration, per-card chat); `claude-haiku-4-5-20251001` (`MODEL_HAIKU`) for tap-to-translate. Aggressive prompt caching with `cache_control: { type: 'ephemeral' }` on the stable methodology + language-instructions + L1 + context-blob prefix.
- **Demo content**: home / dashboard / premium-demo tabs replaced with Flicktionary navigation (mobile bottom tab bar + desktop sidebar — Sessions / Practice / `+` / Vocabulary / More; settings + profile consolidated under `/more` since 2026-05-02). Stripe billing, danger-zone, login flows kept untouched.
- **Async pipeline**: fire-and-forget in-process. The `process` route flips status to `processing`, kicks off async work without `await`, returns 202. Frontend polls `getStatus`. No queue.
- **TMDB / OpenSubtitles**: real APIs via Doppler-managed env vars (`TMDB_API_KEY`, `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USER_AGENT`, `ANTHROPIC_API_KEY`). Local Doppler config is `dev_personal`.

## Status of the build (as of last session)

**Done:**
- **Phase 0** — demo tabs deleted; `_authenticated/_app.tsx` pathless layout + `AppShellLayout` sidebar; placeholder `_app/sessions/index.tsx`, `_app/profile.tsx`, `_app/settings.tsx`; redirects in `index.tsx` + `from-landing.tsx` repointed to `/sessions`; all 7 callers of the old `dashboardRoute`/`profileRoute` updated. Web type-check + lint clean.
- **Phase 1** — migration `apps/backend/supabase/supabase-dev/supabase/migrations/20260427120000_create_flicktionary_tables.sql` with all Flicktionary tables (`content_sources`, `text_tracks`, `text_segments` with tsv trigger, `study_sessions`, `highlights`, `cards`, `card_chat_messages`, `user_lookups`, `l1_interference_notes`, `user_target_language_prefs`), `users` extended with `native_language` + `tap_to_translate_enabled`. Migration also copied to `supabase-dev-tunnel/`. Applied via `supabase migration up --local`. `database.public.types.ts` regenerated. Backend type-check clean.
- **Phase 2** — `@anthropic-ai/sdk` added; env config schema + dev/prod/test variants extended with `anthropicApiKey`, `tmdbApiKey`, `openSubtitlesApiKey`, `openSubtitlesUserAgent`. Anthropic singleton + methodology prompt builder + 5 pass modules (`generate-context-blob`, `generate-l1-interference-notes`, `difficult-words-pass` and `full-exploration-pass` using tool_use, `fast-gloss-pass`). TMDB + OpenSubtitles clients. SRT parser at `apps/backend/src/utils/srt-parser.ts` with 5 passing vitest unit tests. Backend type-check clean.

- **Phase 3** — All 8 contracts registered in `root-contract.ts`. Repositories built under `apps/backend/src/transport/database/`: `content-sources/`, `text-tracks/`, `text-segments/` (with `searchInTrack` using `tsv @@ plainto_tsquery(<regconfig>, ...)`), `study-sessions/` (with `findByIdForUser`, status mutations, `appendProcessingWarning`, `markProcessed`, `markFailed`), `highlights/`, `cards/` (with `findByIdForUser` join through study_sessions), `card-chat-messages/`, `user-lookups/` (with `upsertOnExport` + `listHeadwordsForLanguage`), `l1-interference-notes/`, `user-target-language-prefs/`. `users-repository.ts` extended with native_language + tap_to_translate accessors. Routers built under `apps/backend/src/router/` (`content-sources-router`, `text-tracks-router`, `text-segments-router`, `study-sessions-router`, `highlights-router`, `cards-router`, `card-chat-router`, `user-prefs-router`); all mounted in `app.ts` after `tokenAuthenticationMiddleware`. Endpoints needing services from later phases (`textTracks.importFromOpenSubtitles`, `textTracks.uploadSrt`, `highlights.fastGloss`, `cards.exportCsv`, `cardChat.sendMessage`) currently throw `INTERNAL_SERVER_ERROR` with "Not yet implemented (Phase N)" — replace as those phases land. `studySessions.process` flips status to `processing` but does NOT yet kick off the async pipeline (Phase 6 wires that). `pnpm check:types` and `pnpm lint` clean from repo root.

- **Phase 4** — Backend services `apps/backend/src/service/text-tracks/import-srt.ts` (parses SRT → sha256 of normalized cues for dedup → bulk-insert via repos) and `import-from-opensubtitles.ts` (downloads then delegates to importSrt). `text-tracks-router` wired with these services (no longer stubs for `importFromOpenSubtitles` and `uploadSrt`). Web routes: `apps/web/src/app/routes/_authenticated/_app/sessions/new.tsx` (3-step wizard) and `sessions/$sessionId/index.tsx` (placeholder, Phase 5 fills in). Web components under `apps/web/src/features/sessions/`: `api/sessions-hooks.ts`, `hooks/use-debounced-value.ts`, `components/{tmdb-search,subtitle-source-picker,srt-upload-input,cefr-prompt-dialog,session-card,sessions-list-view,session-placeholder-view,new-session-wizard}.tsx`. `pnpm check:types` clean. `pnpm lint` shows only the four pre-existing template warnings (no new ones).

- **Phase 5** — Mid-watch UI shipped. New web components under `apps/web/src/features/sessions/components/`: `segment-row.tsx` (timestamp + selectable span carrying `data-segment-id`), `segment-list.tsx`, `track-search-bar.tsx`, `highlight-sheet.tsx` (Radix dialog with note + 5 preset chips: explain / 3 examples / synonyms / etymology / why this form), `process-button.tsx` (sticky footer, disabled when status !== active or no highlights), `session-view.tsx` composing all of the above. New hook `apps/web/src/features/sessions/hooks/use-text-selection.ts` exporting `readCurrentSelection()` (called on demand by the Highlight button — does not auto-track selection state). `sessions/$sessionId/index.tsx` now mounts `SessionView`. Highlights paint yellow on rows whose start/end segment ID matches. After Process click the user is routed back to `/sessions` (Phase 7 replaces this with `/sessions/$id/processing` polling). `pnpm check:types` clean. `pnpm lint` clean (only the four pre-existing template warnings remain). Note: `studySessions.process` route flips status to `processing` but Phase 6 still needs to wire the actual orchestrator that runs the pipeline.

- **Phase 6** — Processing orchestrator wired. Files: `apps/backend/src/service/processing/select-surrounding-segments.ts` (gets ±10 segments around a center, plus a `formatSurroundingSegments` helper that prefixes the focus row with `>`), `build-prompt-context.ts` (loads context blob + L1 notes for a session, returns the methodology system blocks for chat reuse — returns null if processing hasn't run), and `process-session.ts` (the orchestrator: ensures context blob → ensures L1 interference notes → difficult-words pass with excluded headwords from `userLookups.listHeadwordsForLanguage` → per-highlight full-exploration with ±10 surrounding → `markProcessed`. Per-pass and per-highlight failures append to `processing_warnings` and are non-fatal. Outer try/catch → `markFailed` + Sentry. Card status from difficult-words pass: `auto_rejected` if `belowCefr === true`, else `pending`. Difficult-words results with hallucinated segment IDs are silently skipped to avoid FK violations). `study-sessions-router` now takes `ProcessingDependencies` and fires `processSession(sessionId, userId).catch(logWithSentry)` without await after the status flip; returns 202. `app.ts` wires the new repos (`L1InterferenceNotesRepository`, `UserLookupsRepository`) and the deps bag.

- **Phase 7** — Polling + triage + focus shipped. New routes under `apps/web/src/app/routes/_authenticated/_app/sessions/$sessionId/`: `processing.tsx`, `review/index.tsx`, `review/$cardId.tsx`. New feature `apps/web/src/features/review/` with `api/review-hooks.ts` (optimistic updateCardStatus via onMutate snapshot/restore on error, debounced overrides via component-level effect not the hook itself), `hooks/use-card-list-cursor.ts` + `focus-keyboard-nav.ts` (j/k + ←/→, ignored when typing in input/textarea/contenteditable). Components: `processing-view.tsx` (polls `getStatus` every 2s, redirects on `processed`/`exported`, shows error+retry on `failed`, lists `processingWarnings`), `triage-list-view.tsx` (two sections — Your highlights / LLM-suggested — search + sticky export footer), `triage-row.tsx`, `auto-rejected-collapsible.tsx`, `focus-view.tsx` (header with prev/next, keep/reject, back-to-triage; body has editable front/back, full exploration renderer, chat), `full-exploration-renderer.tsx` (each schema field as a labeled section, nullables collapsed), `editable-front-back.tsx` (debounced 600ms PUT to `cards.updateOverrides`, empty/equal-to-default values map to null overrides). `session-view.tsx` now navigates to `processing` after Process click.

- **Phase 8** — Per-card chat + CSV export shipped. **Backend services:** `apps/backend/src/service/chat/run-card-chat.ts` (loads `buildPromptContext` for system blocks, seeds with card + ±10 surrounding segments + already-shown structured exploration; older turns summarized to one line each, last 4 turns verbatim; persists both user + assistant turns; `MODEL_SONNET`, no tool_use). `apps/backend/src/service/export/build-csv.ts` (pulls kept cards via `cardsRepository.listKeptForSession`, computes `front`/`back` matching `focus-view.tsx::computeDefaults`, columns `front,back,context,tags,headword,surface_form,note`, hand-rolled escaper). `apps/backend/src/service/export/export-session.ts` (wraps buildCsv → `userLookups.upsertOnExport` per kept card → marks session `exported` via `studySessions.updateStatus`). **Routers:** `card-chat-router.sendMessage` and `cards-router.exportCsv` now call the services; deps wired in `app.ts` (`chatDependencies`, `exportDependencies`). **Frontend:** `useListChatForCard`, `useSendChatMessage`, `useExportSessionCsv` in `review-hooks.ts`. `per-card-chat.tsx` (message list with optimistic user-turn insert + "Thinking…" indicator, Cmd/Ctrl+Enter to send) mounted in focus-view Chat section. `csv-export-button.tsx` (calls `cards.exportCsv`, builds Blob via `URL.createObjectURL`, downloads as `<sessionId>.csv`) replaces the disabled button in the triage sticky footer.

- **Phase 9** — Settings + tap-to-translate shipped. **Backend:** `highlights-router.fastGloss` is no longer a stub — verifies session ownership, loads the highlight, returns the cached gloss if `fast_gloss` is set, otherwise loads the start segment text and calls `fastGlossPass` (Haiku), then persists. Persistence format mirrors the Haiku output: `gloss\n[POS]\n[register]`, parsed back via small helpers in `highlights-router.ts`. `app.ts` now passes `textSegmentsRepository` to `HighlightsRouter`. **Frontend hooks** (in `apps/web/src/features/sessions/api/sessions-hooks.ts`): `useSetTapToTranslateEnabled`, `useFastGloss`. **Settings UI** under `apps/web/src/features/settings/components/`: `native-language-selector.tsx` (ISO-code input + Save), `cefr-per-language-list.tsx` (one row per existing target-language pref with A1–C2 chips that PUT `userPrefs.setCefrForLanguage`), `tap-to-translate-toggle.tsx` (On/Off button), and `settings-view.tsx` composes them in cards. **Tap-to-translate runtime:** `apps/web/src/features/sessions/hooks/use-tap-to-translate.ts` reads the `highlights.listBySession` query cache to find a matching highlight (by selection text + segment IDs + offsets) so warm-cache repeats reuse the existing row. `apps/web/src/features/sessions/components/tap-to-translate-sheet.tsx` opens, returns the cached gloss instantly when present, otherwise creates the highlight silently (no note/tags) then fires `fastGloss`. `session-view.tsx` reads `prefs.tapToTranslateEnabled` and branches `handleHighlightClick` between the existing `HighlightSheet` (off) and the new `TapToTranslateSheet` (on).

- **UX touchups after Phase 9** (don't re-introduce earlier behavior):
  - **Sessions list & in-session header now show movie poster + title + year.** Storage is unchanged — `content_sources.metadata.posterUrl/year/title` were already populated by the wizard. The repo got `listByUserIdWithSource` + `findByIdForUserWithSource` (LEFT JOIN content_sources); `StudySessionSchema` was extended with `contentSourceTitle`, `contentSourcePosterUrl`, `contentSourceYear`; the router's `list`/`get` use the joined methods, and `create` re-fetches via the joined method so the wizard navigates straight to a populated view. No migration change; no Supabase Storage — TMDB poster URLs are CDN-hosted and stored verbatim.
  - **Subtitles view stays browsable on `processed`/`exported`.** `session-view.tsx` only auto-redirects on `processing`/`failed` now. Header gains a `View triage` button for processed/exported. The triage header gains a `← Subtitles` button (in `triage-list-view.tsx`).
  - **`Process new highlights` re-run.** Same `ProcessButton` is rendered on `processed`/`exported`, with reworded copy. Backend orchestrator (`apps/backend/src/service/processing/process-session.ts`) is now idempotent: it loads existing cards, derives `hasLlmSuggestedCards` (any card with `highlight_id IS NULL`) to gate the difficult-words pass, and `processedHighlightIds` to skip per-highlight passes that already ran. `study-sessions-router.process` only rejects status `processing`; `active`/`processed`/`exported`/`failed` all enter the orchestrator.

- **Bug fixes from manual testing of Phases 7–8** (don't re-introduce):
  - `CardSchema.fullExploration` is now `z.record(z.string(), z.unknown())` instead of `FullExplorationSchema.partial().passthrough()` — the LLM occasionally serializes one field oddly (e.g. `examples` as a JSON-encoded string), and the renderer/CSV are already per-field defensive. One bad row must not brick the whole list.
  - `use-card-list-cursor.ts` navigable set is now `cards where status !== 'auto_rejected'` (was `kept ∪ {currentCard}`). The old logic produced unstable totals (5/5 → 4/4 → 5/5 oscillation) and ignored the bulk of the triageable list.
  - `<EditableFrontBack>` and `<PerCardChat>` are mounted with `key={card.id}` in `focus-view.tsx`. Without it, `useState` initializers carried the previous card's text across prev/next nav, and the debounced save wrote the old text as the new card's `frontOverride` (the "random card data" symptom).

- **Post-Phase 9 quality pass (2026-04-30)** — UX polish, prompt tuning, and the sense-aware dedup foundation. Don't re-introduce the prior behavior:
  - **SRT markup stripped end-to-end.** Cues with inline tags (`<i>...</i>`, `<b>`, `<font>`, etc.) used to render verbatim. New shared helper `packages/core/src/utils/srt-markup.ts` exports `stripSrtMarkup` (regex) and `stripSrtMarkupWithMap` (returns a position map for safe range remapping). `apps/backend/src/utils/srt-parser.ts` strips at parse time + collapses leftover whitespace, so storage / FTS tsvector / LLM passes never see markup. `apps/web/src/features/sessions/components/segment-row.tsx` strips defensively at render time for already-imported tracks; highlight ranges are remapped via the position map so existing offsets stay aligned. New parser unit test covers `<i>`, `<b>`, and `<font color>`.
  - **Subtitle picker UI fixes.** `subtitle-source-picker.tsx`: `min-w-0 flex-1` + `break-all` on the release title and `shrink-0` on the `Use` button so long unspaced filenames (`EuroTrip.2004.Unrated.1080p.BluRay`) wrap instead of pushing the button off the row on mobile. `Use`-button loading state is now per-row via local `importingFileId` state; previously the single mutation's `isPending` flipped `Importing…` on every row simultaneously.
  - **Process is allowed with zero highlights.** `process-button.tsx` `canTrigger = status === 'active' || (isReprocess && highlightCount > 0)`. First-pass with no highlights still fires the difficult-words pass; the LLM's CEFR-level chunks fill the triage list. Re-process still requires at least one new highlight (would noop otherwise — orchestrator skips difficult-words pass once LLM-suggested cards exist). Hint text reworded for the zero-highlight case.
  - **Card front prefers the dictionary form.** `focus-view.tsx::computeDefaults` and `build-csv.ts::computeDefaults` now do `front = headword || surface_form` (was `surface_form || headword`). Existing `front_override` still wins.
  - **Difficult-words pass: hard CEFR floor + regional bias + level-scaled target count.** `difficult-words-pass.ts` user message now says "Only include chunks AT OR ABOVE {cefrLevel}", explicitly names the kind of B-level filler to skip (`durante el resto de su vida`, `nunca más`, `según su costumbre`), and tells the LLM to read the cached movie context blob and prioritize regional/dialectal/colloquial chunks when the source is dense in them (rioplatense voseo, lunfardo, etc.). Tool description spells out lemmatized headword form (infinitive verbs, pronominal `se` included, never inflected). `targetForLevel(cefrLevel)`: A1/A2=20, B1/B2=25, C1=35, C2=40 (was a flat 25).
  - **Per-target-language instructions.** New `apps/backend/src/transport/third-party/anthropic/language-instructions.ts` with hardcoded Spanish guidance (rioplatense / peninsular / Mexican variant handling, headword form rules, voseo flagging). `methodology-prompt.ts` injects it as a system block right after the methodology preamble — inside the cacheable prefix, no per-call cost. Falls through silently when no instructions exist for a language. v2 path: editable from the settings UI.
  - **Four-column flashcard output.** `full-exploration-pass.ts` tool schema gained two required fields: `sense` (1-5 word disambiguator) and `context_example: { target, native }` (a self-contained example sentence in target lang plus a native-lang translation, "inspired by but not equal to the source line"). Card defaults: `back = translation + context_example.target + context_example.native` (separated by blank lines) in both the focus view and CSV. Backward-compat: when `context_example` is missing on older cards, falls back to `examples[0]` for the target sentence so existing exports keep working. `full-exploration-renderer.tsx` got a `Sense` section and a renamed `Example` section (target on top, native muted) above the existing `More examples` list.
  - **Sense-aware dedup foundation.** New migration `apps/backend/supabase/supabase-dev/supabase/migrations/20260430120000_sense_aware_dedup.sql` (mirrored to `supabase-dev-tunnel/`) adds `sense TEXT NOT NULL DEFAULT ''` to both `cards` and `user_lookups`, drops the old `user_lookups_pkey`, recreates as `(user_id, target_language, headword, sense)`. Existing rows get `sense=''` and continue to behave as a single bucket. The migration **needs to be applied locally** before the next test run — local supabase shadow had remote-history pollution and I left applying it to you. `database.public.types.ts` was hand-edited to match what `supabase gen types` will produce; regenerating after applying the migration should be a no-op diff. `cards-repository.insertCard` persists `sense`; `user-lookups-repository`'s `listHeadwordsForLanguage` is now `listHeadwordSensesForLanguage` returning `{headword, sense}[]`, and `upsertOnExport` takes `sense` and uses it in both VALUES and `ON CONFLICT`. Difficult-words exclusion list format is now `headword | sense` per line, with prompt instruction "same headword + clearly distinct sense should still be included as a new entry" (`correr | to run a race` vs `correr | to spread, of news` is the worked example). Filtering itself is **LLM-judged**, not programmatic — the only programmatic gate is the user_lookups composite PK at write time. `CardSchema` and `FullExplorationSchema` (in `packages/api-client/.../flicktionary-schemas.ts`) gained `sense` and `context_example` accordingly.
  - **`sense` prompt tuning.** First pass had the LLM writing 11+ word definitions in `sense` for monosemous terms ("medical device that delivers an electric shock to restore heart rhythm"). Tightened in both passes to "1-5 words, NOT a definition, the definition belongs in `definition`" with a worked monosemous example (`desfibrilador` → `medical device`). Output is short paraphrases now. Cosmetically still looks gloss-like for monosemous terms but works fine for dedup.
  - **Model swap.** `MODEL_SONNET` was renamed to `MODEL_OPUS = 'claude-opus-4-7'` in `anthropic-client.ts` and all heavy-pass call sites. Haiku reserved for tap-to-translate. ~66¢/movie was observed (one full-SRT difficult-words pass + context-blob + L1 + per-highlight full-exploration calls). Token-cost diagnostic logger was added during this session and removed after measurement; the prompt-cache breakpoint on the methodology + language-instructions + L1 + context-blob prefix is working as designed (per-highlight full-exploration calls reuse the cached prefix within a session).

- **Defer-full-exploration refactor (2026-05-01)** — Big architectural shift.
  The previous pipeline ran a heavy per-highlight `full_exploration_pass` for
  every card during processing, populating a single `full_exploration` JSONB
  blob. We split that: cards now arrive from processing with **basic data
  only** (`headword`, `sense`, `surface_form`, `translation`, `definition`,
  `target_example`, `native_example`), and the deep enrichment is opt-in
  per card via `Generate full exploration`. Don't re-introduce any of the
  prior behavior.
  - **Migration consolidation.** Both prior Flicktionary migrations
    (`20260427120000_create_flicktionary_tables.sql` and
    `20260430120000_sense_aware_dedup.sql`) collapsed into a single migration
    with the final shape. Pre-launch, no production data — applied via
    `supabase db reset` once, then later schema deltas applied as targeted
    `ALTER`s on the running local DB (db reset is denied because it would
    nuke local Flicktionary work).
  - **`cards` shape.** `full_exploration jsonb` removed. Basic columns
    promoted: `translation`, `definition`, `target_example`, `native_example`
    (all nullable so L1 = L2 sessions can leave translation/native blank).
    Optional enrichment lives in `exploration_extras jsonb DEFAULT '{}'`.
    `front_override` / `back_override` columns dropped — see "Drop card
    overrides" below.
  - **Basic-data pass replaces difficult-words pass.**
    `apps/backend/src/transport/third-party/anthropic/passes/basic-data-pass.ts`
    is one Anthropic call that does both LLM chunk discovery AND emits one
    row per user highlight. Each row has `source: 'llm' | 'highlight'` plus
    the basic data populated. Streaming is mandatory (Anthropic SDK enforces
    streaming for any request whose worst-case duration > 10 minutes — the
    32k-token output ceiling on long English tracks crosses that). Uses
    `messages.stream(...).finalMessage()`. The `llmDiscoveryEnabled` arg
    flips the prompt to highlight-only mode when the user has the
    LLM-suggested chunks pref off. `parseBasicDataChunks` is exported and
    fixture-tested.
  - **Enrichment pass** (renamed from `full-exploration-pass`):
    `apps/backend/src/transport/third-party/anthropic/passes/enrichment-pass.ts`.
    Required output keys are the basic columns (the model may refine them);
    optional keys all live in an `extras` object that maps 1:1 onto
    `cards.exploration_extras`. Triggered manually via
    `cards.explore` from the focus view's `Generate full exploration`
    button — no longer fires during processing.
  - **`cards` repository: typed basic-data inserts + `updateFields`.**
    `insertCard` takes the typed basic columns. `updateExploration` removed.
    New `updateFields(cardId, patch)` uses `COALESCE` semantics — `null` on
    a key means "leave column unchanged", explicit `''` clears, and
    `extrasPatch` shallow-merges into `exploration_extras` via JSONB `||`.
  - **Orchestrator:** `process-session.ts` now does the single combined pass
    in step 3. Idempotent re-process: skips when LLM-suggested cards exist
    AND every highlight has a card. When `llm_highlights_enabled = false`
    and there are no new highlights, the call is skipped entirely. Falls
    back to a minimal stub card if the model fails to emit a row for a
    highlight (so the highlight is never silently dropped).
  - **Card chat tool calls.** `run-card-chat.ts` got an `update_card_fields`
    tool. When the LLM emits it, the server applies the patch via
    `cardsRepository.updateFields` and appends `_Updated: <fields>_` italic
    footer to the persisted assistant message. Chat seed prompt instructs
    the model: "When the learner asks you to change something, call the
    tool with only the fields that should change; confirm briefly." The
    frontend `useSendChatMessage.onSuccess` invalidates `cards.get` so the
    focus view's field inputs pick up the new values inline. (Prior version
    cleared overrides on touched-side fields; that logic was removed when
    overrides were dropped.)

- **Drop card front/back overrides (2026-05-01).** The textarea-based front/back
  with debounced override-save proved buggy (stale state autosave would
  shadow chat-driven updates indefinitely). Refactored to **field-level
  editing**: `EditableFrontBack` removed; new `EditableCardFields` renders
  a labeled input per basic column with a 600ms debounced PATCH to
  `cards.updateFields`. The basic columns are the single source of truth.
  `front_override` / `back_override` columns dropped from the schema; the
  `cards.updateOverrides` contract endpoint, repo method, hook, and
  build-csv override fallback all removed. `EditableCardFields` is mounted
  with `key={`${card.id}:${card.updatedAt}`}` so server-side mutations
  (chat tool) remount it fresh — race-free.

- **`llm_highlights_enabled` user pref (2026-05-01).** New boolean column on
  `users`, default `true`. Toggle in Settings → Processing card. When off,
  `basicDataPass` is told to emit only highlight rows; if there are zero
  highlights the call is skipped entirely. `process-button.tsx` reads the
  pref and disables the button (with explanatory copy) when both
  `llm_highlights_enabled = false` AND `highlightCount === 0`. Backend
  plumbing: `usersRepository.{get,set}LlmHighlightsEnabled`,
  `userPrefs.setLlmHighlightsEnabled` contract, surfaced on `getPrefs`.
  Frontend: `useSetLlmHighlightsEnabled`, `LlmHighlightsToggle` component
  mirroring `TapToTranslateToggle`.

- **Misc UX improvements (2026-05-01):**
  - **Surrounding-context block** above the Full Exploration heading,
    collapsed by default. Fetches ±2 segments from the new
    `textSegments.getWindow({ trackId, segmentId, radius })` endpoint;
    focus line marked with `>` and `font-medium`. Card section sits at the
    top of the focus view so basic data is editable before scrolling.
  - **`Open in subtitles` deep-link** in focus view header. Navigates to
    `/sessions/$id?segment=<id>`; `session-view.tsx` reads the search param
    via TanStack Router `validateSearch`, scrolls the segment row into view
    on the next rAF, and applies a 1.5s yellow flash via a `flash` prop on
    `SegmentRow`.
  - **Triage row preview** uses `translation || definition` (no line-clamp).
  - **Per-card chat no longer auto-scrolls** the focus view to the bottom
    on mount or after each turn; the user keeps the card visible.
  - **CSV export button disables** while any explore/chat mutation is in
    flight, via `useIsMutating({ mutationKey: orpcQuery.cards.explore.key() })`.
  - **`textSegments.getWindow.input.radius`** uses `z.coerce.number()`
    because GET query params arrive as strings.
  - **Process button retry path.** Allows re-process when the previous run
    produced zero cards (silent failure case) or status is `failed`. Hint
    + label switch to "Retry processing" / "Previous run produced no cards.
    Click to retry." Reads `cardCount` from `useListCardsBySession`.
  - **Processing warnings surfaced** in `triage-list-view.tsx` as an amber
    banner above the list, so silent pass failures are visible to the user
    instead of producing an unexplained empty triage.
  - **`basic-data-pass` max_tokens** bumped to 32k (Opus 4.x native ceiling).
    Error path emits `stop_reason` so future truncations show as
    "output truncated at max_tokens" rather than an opaque parse error.

- **Native-style chrome refactor (2026-05-02).** Web shell rebuilt around the
  React-Navigation mental model — *root stack + tab navigator, modals
  presented above tabs* — so the eventual native port is a translation, not
  a redesign. Don't re-introduce the old burger / sidebar / Settings + Profile
  separation.
  - **Routing flag.** `apps/web/src/app/router.tsx` augments
    `StaticDataRouteOption` with `hideAppChrome?: boolean`. New hook
    `apps/web/src/features/navigation/hooks/use-is-modal-route.ts` reads
    `useMatches()` and returns true when any matched leaf set the flag.
    `AppShellLayout` early-returns `<Outlet />` when true (no sidebar, no
    tab bar). Per-leaf granularity matters here: `/sessions` is a tab page
    but `/sessions/$id` is a modal — both share the `_app` parent.
  - **New navigation feature** under `apps/web/src/features/navigation/`:
    `bottom-tab-bar.tsx` (mobile-only `md:hidden`, fixed bottom, three slots
    with the central `+` as a 56×56 raised button), `sidebar-nav.tsx`
    (desktop sidebar with `+ New` primary button at the top opening the
    same overlay as the mobile `+`), `main-action-overlay.tsx` (built on
    `ResponsiveOverlay`; one row "Start a movie session" → `/sessions/new`,
    trivially extensible), and `modal-screen.tsx`
    (`{ onClose, closeIcon: 'x' | 'chevron', title?, rightSlot?, children }`
    wrapper — sticky `h-14` header on top of a `flex-1 overflow-hidden`
    body, outer is `flex h-dvh flex-col`).
  - **AppShellLayout rebuilt.** Burger button, mobile top header, and left
    `Drawer` are gone. Mobile: bottom tab bar over the main column. Desktop:
    left sidebar. The main column gets
    `pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0` so content clears
    the bottom bar.
  - **Modal-flagged routes** (`staticData: { hideAppChrome: true }`):
    `/sessions/new`, `/sessions/$sessionId`, `/sessions/$sessionId/processing`,
    `/sessions/$sessionId/review`, `/sessions/$sessionId/review/$cardId`,
    `/more/account`, `/more/languages`. The five session views were
    rewrapped in `<ModalScreen>`. **Triage's chevron now closes to
    `/sessions`** (closes the modal stack) — the previous `← Subtitles`
    chevron was misleading (Subtitles is a sibling, not a parent); the
    Subtitles cross-jump moved to the modal's right slot. **Focus view's**
    keep/reject moved into the modal-header right slot; the previous
    in-page header bar shrank to a compact body toolbar holding prev/next
    arrows + `Open in subtitles`. **SessionView's** in-page poster row was
    dropped — the movie title (with year + lang/CEFR/status subtitle) lives
    in the modal header, `Triage` button in the right slot when
    `processed`/`exported`. ALL modal close handlers call
    `navigate({ to: parentPath })` rather than `history.back()` so deep
    links (no history) close to a known parent.
  - **`More` tab replaces `/settings` + `/profile`.** New feature
    `apps/web/src/features/more/components/`: `more-tab-view.tsx` (sectioned
    list — General → Account; Settings → Languages, Tap-to-translate,
    LLM-suggested chunks; About → Contact us, Admin settings, Danger zone,
    Sign out), reusable `more-list-section.tsx` + `more-list-row.tsx`
    primitives (label + description + trailing slot + optional press
    handler). Toggle rows mount the existing `Switch` directly in `trailing`
    and call the same hooks (`useSetTapToTranslateEnabled`,
    `useSetLlmHighlightsEnabled`) so settings persist identically. Sub-pages:
    `account-page.tsx` (avatar/name/email + Manage Subscription via the
    existing billing hooks; `chevron` close to `/more`), `languages-page.tsx`
    (composes the existing `NativeLanguageSelector` +
    `CefrPerLanguageList`; `chevron` close).
  - **Deletions.** `_app/settings.tsx`, `_app/profile.tsx`,
    `features/settings/components/settings-view.tsx`,
    `features/profile/components/profile-view.tsx`,
    `features/contact/components/contact-us-button.tsx` (orphan after the
    More tab inlined the overlay-trigger logic). The `OverlayController`
    URL-driven contact-us overlay is unchanged — the More row just toggles
    the `overlay=contact-us` search param itself.
  - **DangerZone + AdminSettings** wrapped in `<ModalScreen closeIcon='chevron'>`
    so their headers match the new chrome. Both back buttons now navigate
    to `/more`. DangerZone keeps its red-themed body but uses the standard
    white modal header.
  - **Drawer bottom inset.** `apps/web/src/components/ui/drawer.tsx` inner
    container now has `pb-[max(1rem,env(safe-area-inset-bottom))]` so the
    contact-us sheet, the `+` action sheet, and any future bottom drawer
    respect the home-indicator on mobile.

- **Practice tab — SRS through generated texts (2026-05-05 / 06).** New top-level
  destination at `/practice`. Full plan at
  `/Users/sebastien/.claude/plans/we-are-working-on-shimmering-turtle.md`.
  See SPEC.md §Practice for the user-facing model. Don't re-introduce any of
  the prior behavior — especially not the char-offset annotation transport.
  - **Schema additions** in the consolidated migration
    (`apps/backend/supabase/migrations/20260425215345_initial_schema.sql`):
    new enums `practice_session_status`, `practice_text_status`,
    `practice_rating`, `srs_state`. `user_lookups` extended with FSRS state
    (`srs_state`, `srs_due`, `srs_stability`, `srs_difficulty`,
    `srs_last_review`, `srs_reps`, `srs_lapses`, `added_to_practice_at`)
    plus `idx_user_lookups_due` partial index. New tables
    `practice_sessions`, `practice_texts` (with `annotations jsonb`),
    `practice_ratings` (composite FK to `user_lookups`). The five
    `supabase/migrations/20260425215345_initial_schema.sql` paths share
    one inode (hard-linked across `migrations/` + `supabase-dev/` +
    `supabase-dev-tunnel/` + `supabase-test/` + `supabase-prod/`) so
    editing one updates them all. Apply via `supabase db reset --local`
    in `apps/backend/supabase/supabase-dev/supabase`.
  - **Repos under `apps/backend/src/transport/database/`:** new
    `practice-sessions/`, `practice-texts/`, `practice-ratings/`. Extended
    `user-lookups/` with `upsertOnKeep` (called from the new
    `set-card-status` service when a card transitions to `'kept'`),
    `listDueSummary`, `listEligibleForLanguage`, `findByKey`,
    `initializeSrsState`, `applyFsrsResult`, `listVocabularyForLanguage`.
  - **`set-card-status` service** at `apps/backend/src/service/cards/`
    wraps `cardsRepository.updateStatus` so flipping a card to `'kept'`
    upserts `user_lookups` with `first_card_id`. Both
    `cards-router.updateStatus` and `updateStatusBatch` route through it.
    Un-keep does NOT remove the row — `user_lookups` is durable history
    and SRS state stays put. v2 adds an explicit "remove from practice"
    affordance.
  - **LLM pass:**
    `apps/backend/src/transport/third-party/anthropic/passes/generate-practice-text.ts`
    streams via `messages.stream(...).finalMessage()` with `MODEL_OPUS`,
    4k max_tokens. Tool schema deliberately omits character offsets:
    `used_chunks: [{ headword, sense, surface_form }]`. The server
    locates each `surface_form` in `body` and computes offsets itself
    (`locateAnnotations`), claiming non-overlapping positions when a
    surface form repeats. Don't re-introduce char_start/char_end on the
    tool — LLMs are unreliable at character arithmetic; the symptom was
    "Dropped 6 bad annotation(s): offset mismatch ..." with only 1 of 7
    chunks visible in the rendered text. Length target is ~80–120 words
    in both the tool description and user message; the prompt asks for
    dense chunk packing rather than narrative. New
    `buildPracticeMethodologySystem` in `methodology-prompt.ts` strips
    the source-context block (Practice has no per-source context) and
    moves the `cache_control: ephemeral` breakpoint onto the L1
    interference notes block.
  - **FSRS adapter** at `apps/backend/src/service/practice/fsrs.ts` uses
    `ts-fsrs` (catalog `5.3.2`, default `generatorParameters` with
    `enable_fuzz: true`). Imports `Grade` from ts-fsrs because the
    `next` signature wants `Grade` not `Rating` (Grade excludes
    `Rating.Manual`).
  - **Practice services** under `apps/backend/src/service/practice/`:
    `start-practice-session.ts` (validates ≥1 kept card + native_language
    pref; warms L1 notes; inserts session row), `generate-next-practice-text.ts`
    (eligible MINUS covered, init SRS state on null-state rows, picks 7,
    inserts pending → markGenerating → LLM call → markReady; returns
    `{ done: true }` when remaining is empty and marks session
    `'completed'`), `rate-chunk.ts` (validates the chunk is in the
    practice_text's annotations; applies FSRS; writes `practice_ratings`
    with `was_explicit=true`), `finalize-practice-text.ts` (implicit-good
    every annotation not yet rated, then `markDone`),
    `ensure-l1-interference-notes.ts` (deduped helper used by
    `start-practice-session`).
  - **Contracts & router.** New
    `packages/api-client/src/orpc-contracts/practice-contract.ts` with 6
    endpoints: `dueSummary`, `startSession`, `getSession`,
    `generateNextText`, `rateChunk`, `finalizeText`. Practice-specific
    schemas (`PracticeRatingSchema`, `PracticeSessionSchema`,
    `PracticeTextSchema`, `PracticeAnnotationSchema`,
    `PracticeDueSummaryEntrySchema`) appended to
    `common/flicktionary-schemas.ts`. Registered in `root-contract.ts`.
    Backend router at
    `apps/backend/src/router/practice-router/practice-router.ts`,
    mounted in `app.ts` after the auth middleware.
  - **Vitest unit tests:**
    `passes/generate-practice-text.unit.test.ts` (5 cases — happy path,
    not-in-body, unrequested, repeated surface form, skipped_chunks
    preserved); `service/practice/fsrs.unit.test.ts` (3 cases — new row
    transitions out of `new`, `again` decreases stability + increments
    lapses, `easy` schedules longer than `good`).
  - **Frontend nav.** `bottom-tab-bar.tsx` and `sidebar-nav.tsx` grew a
    third tab (`Practice`, `Brain` icon). Mobile layout was
    `[Sessions] [Practice] [+] [More]` after this change — the central `+`
    stays a raised floating button. (The Vocabulary-tab work later
    inserted a fourth flat tab; current layout is documented in that
    block.)
  - **Frontend feature** `apps/web/src/features/practice/`:
    - `api/practice-hooks.ts` — `useDueSummary`, `useStartPracticeSession`,
      `useGetPracticeSession`, `useGenerateNextPracticeText`,
      `useRatePracticeChunk`, `useFinalizePracticeText`. Mutation success
      handlers use `setQueryData` to atomically swap `currentText` in
      the `getSession` cache rather than `invalidateQueries` (avoids the
      stale-flash on Next while a refetch is in flight).
    - `components/practice-landing-view.tsx` — per-language summary
      list; one-language case shows a single "Start practice" button.
    - `components/practice-session-view.tsx` — `<ModalScreen>` host;
      state machine: auto-trigger first generation on mount, click
      annotation → `RateSheet`, Next → finalize then generate. Local
      `isAdvancing` flag hides the previous text + sticky footer the
      moment Next is clicked, preventing both the stale-text flash and
      a double-fire of `generateNextText` from the auto-trigger effect.
    - `components/annotated-text.tsx` — renders `body` with annotations
      as clickable spans (yellow → unrated; gray → rated). Drops
      overlapping annotations defensively even though the server side
      claims non-overlapping positions.
    - `components/rate-sheet.tsx` — `ResponsiveOverlay` wrapper hosting
      a new `RateButtons` UI primitive at
      `apps/web/src/components/ui/rate-buttons.tsx` (Again / Hard / Good
      / Easy quartet, Good as default selection).
  - **Routes:** `/practice/index.tsx` (regular route, app chrome) and
    `/practice/$practiceSessionId.tsx` (`hideAppChrome: true`).
  - **AGENTS.md update.** New `## oRPC + TanStack Query` section
    documenting the `.key()` (prefix, for invalidate / cancel) vs
    `.queryKey({ input })` (exact, for setQueryData / getQueryData)
    distinction. The symptom of mixing them up is silent no-op writes —
    we hit this during Phase 6 testing when `setQueryData` was passing
    a `.key()` result and the practice-text cache appeared frozen on
    the same text after every Next click.

- **Vocabulary tab — manage kept chunks (2026-05-06).** New top-level
  destination at `/vocabulary`. Full plan at
  `/Users/sebastien/Documents/flicktionary/MANAGE_CHUNKS_PLAN.md`. See SPEC.md
  §Vocabulary for the user-facing model. Don't re-introduce the prior
  behavior — especially not a separate `is_deleted` boolean; the soft-delete
  is `deleted_at TIMESTAMPTZ`.
  - **Schema delta** on the consolidated migration. `user_lookups` got
    `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `deleted_at
    TIMESTAMPTZ NULL`. Existing indexes (`idx_user_lookups_user_target`,
    `idx_user_lookups_due`) recreated as `WHERE deleted_at IS NULL` partial
    variants. Two new partial indexes for cursor-paginated sorts:
    `idx_user_lookups_recent (user_id, target_language, created_at DESC, id)`
    and `idx_user_lookups_due_sort (user_id, target_language, srs_due ASC
    NULLS LAST, id)`. Applied as targeted ALTERs on the running local DB
    (preserved in-progress data); types regenerated.
  - **Repo extensions** in `user-lookups-repository.ts`: every read path now
    filters `deleted_at IS NULL`. `findOrCreate`, `upsertOnKeep`, and
    `upsertOnExport` clear `deleted_at` on conflict — re-keeping a deleted
    chunk revives it. New methods: `listChunksForLanguage` (cursor-paginated,
    two-phase cursor for `due` to handle NULLS LAST cleanly: phase
    `'scheduled'` walks `srs_due NOT NULL` rows, phase `'unscheduled'` walks
    the tail), `softDeleteChunk`, `listLanguagesForUser`. `ChunkRow`
    denormalizes `firstCardId` and originating `studySessionId` via LEFT
    JOIN cards on `first_card_id`.
  - **Contracts.** `chunks-contract.ts` gained `listChunks` (GET, base64-JSON
    cursor on the wire), `listLanguages` (GET), `deleteChunk` (POST). New
    `ChunkRowSchema` in `common/flicktionary-schemas.ts` extends `ChunkSchema`
    with SRS state + `createdAt` + `firstCardId` + `studySessionId`.
  - **Router.** `chunks-router.ts` now also handles list/delete/languages.
    Cursor encode/decode helpers live alongside the handlers.
    **Date normalization gotcha:** postgres.js returns timestamptz as JS
    `Date` objects, but the wire schema declares them as `z.string()`.
    `toChunkRowDto` ISO-stringifies `createdAt` and `srsDue`. Don't
    re-introduce the version that returned raw `Date` objects (Zod rejects
    them with "Output validation failed").
  - **Boundary middleware diagnostics.** `error-boundary-middleware.ts` now
    detects oRPC `ValidationError` (input or output) inside an `ORPCError`
    and logs procedure path + Zod issues to stdout (and Sentry) before
    rethrowing. The wire response still says "validation failed" but the
    backend terminal shows the actual offending field. Use this when a 500
    surfaces from an oRPC call.
  - **Frontend.** New feature `apps/web/src/features/vocabulary/` with
    `api/vocabulary-hooks.ts` (`useListLanguages`, `useListChunksInfinite`
    via oRPC `infiniteOptions`, `useDeleteChunk` with optimistic page
    patching across the entire `chunks.listChunks` family + invalidation of
    `practice.dueSummary` on settle). Components: `vocabulary-list-view.tsx`
    (orchestrator with `@tanstack/react-virtual` and a sentinel item that
    triggers `fetchNextPage` when scrolled into view), `vocabulary-row.tsx`
    (headword + sense + 1-line `translation || definition` preview + Due/New
    chip + count badge), `vocabulary-action-drawer.tsx` (Edit | Open source |
    Delete via `ResponsiveOverlay`; Delete shows inline confirm).
    `vocabulary-language-switcher.tsx` (pills, hidden when only one lang).
    `@tanstack/react-virtual` added to the workspace catalog.
  - **Routes & nav.** New `/_authenticated/_app/vocabulary/index.tsx`. The
    bottom tab bar widened from 4 slots (Sessions / Practice / FAB / More)
    to 5 (Sessions / Practice / FAB / Vocabulary / More); sidebar got a
    matching entry. Don't re-introduce the duplicate-`tabs[3]` render that
    briefly showed two More tabs on mobile.
  - **Focus view origin tracking.** `/sessions/$id/review/$cardId` now
    `validateSearch`-es a `from` enum (`'triage' | 'vocabulary'`). The
    Vocabulary action drawer's Edit handler navigates with
    `search: { from: 'vocabulary' }`; `focus-view.tsx::closeToTriage` reads
    the param and sends the user back to `/vocabulary` instead of the
    triage list. Prev/next preserve the param. Default is unchanged for the
    normal triage → focus flow.
  - **Drawer reset bug.** Earlier draft had `confirmingDelete` state
    sticking across drawer opens because the parent imperatively closed the
    drawer (`setDrawerOpen(false)` in the delete success handler) without
    going through the wrapper `onOpenChange`. Fix is a `useEffect(() => {
    if (!open) setConfirmingDelete(false) }, [open, chunkId])` so any
    open→closed transition (or chunk swap) resets the confirm state.

- **Drop global L1 interference notes (2026-05-07).** The `l1_interference_notes`
  table + the global per-`(L1, target)` generation pass were dead weight. Modern
  Opus already knows L1→L2 interference from training; the global blob was just
  paraphrasing that back into the prompt. The genuinely valuable per-chunk L1
  notes (e.g. "English speakers want to say *près de moi* to mean 'near my
  home' but that means 'near me'") are still produced by the enrichment pass
  and live in `cards.exploration_extras.l1_notes` — anchored to a specific
  chunk and source. Don't re-introduce the global blob.
  - **Migration:** `l1_interference_notes` table removed from
    `20260425215345_initial_schema.sql` in place; `db:dev` reset applied;
    `database.public.types.ts` regenerated.
  - **Deletions:** `transport/database/l1-interference-notes/`,
    `service/practice/ensure-l1-interference-notes.ts`,
    `transport/third-party/anthropic/passes/generate-l1-interference-notes.ts`.
  - **Methodology prompt.** `buildMethodologySystem` /
    `buildPracticeMethodologySystem` no longer take `l1InterferenceNotes`.
    Preamble bullet rephrased from "See the L1 interference notes below" to
    "Apply your knowledge of typical interference patterns from the user's
    native language to the target language" — implicit instruction. The
    practice variant's `cache_control: ephemeral` breakpoint moved from the
    L1 block onto the user-profile block.
  - **Anthropic passes.** `basic-data-pass`, `enrichment-pass`,
    `generate-practice-text` no longer take or inject `l1InterferenceNotes`.
    The enrichment-pass tool schema still has optional `extras.l1_notes` —
    that's the per-chunk L1 note generated from training knowledge.
  - **Service callers.** `process-session`, `build-prompt-context`,
    `run-card-chat`, `explore-card-if-missing`, `generate-next-practice-text`,
    `start-practice-session` all no longer fetch L1 notes. `app.ts` no longer
    wires the deleted repo into five dep bags.
  - **SPEC.md updates.** Processing pipeline step 2 removed; full-exploration
    step now states per-chunk L1 notes come from training knowledge. Data
    model entry removed. Methodology prompt template L1 block removed.

- **Triage → Practice CTA + cross-session vocab export (2026-05-07).**
  The triage footer was rebuilt around the Practice tab and the per-session
  CSV export was relocated to a Vocabulary-wide entry point. Don't
  re-introduce the old "Export N kept cards" sticky footer or the
  per-session CSV download path.
  - **Triage footer.** `csv-export-button.tsx` deleted. The "X card(s) kept"
    counter is gone. Footer is now a single `Practice these chunks` button
    (Brain icon) — `w-full` on mobile, `w-auto` on `md:`+, container is
    `md:justify-end`. Disabled when keptCount === 0 or session not loaded.
    Click navigates to `/practice/start?lang=<session.targetLanguage>` which
    reuses the existing `PracticeStartView` loader (mutation fires on mount,
    URL replaces with `/practice/$id` on success).
  - **Vocabulary 3-dots menu.** New `vocabulary-options-overlay.tsx`
    (`ResponsiveOverlay`, drawer on mobile / dialog on desktop) titled
    "Vocabulary options" with a single `Export vocabulary` action row.
    Trigger: `MoreVertical` ghost icon button right-aligned in the
    `vocabulary-list-view.tsx` header (disabled until a language is
    selected). Action description renders the full language name via
    `getLanguageName('en') = 'English'` from
    `@flicktionary/core/constants/supported-languages` rather than the
    bare ISO code.
  - **Backend export endpoint.** `chunks-contract.ts` gained `exportCsv`
    (POST `/chunks/export`, input `{ targetLanguage }`, output `{ csv,
    chunkCount }`). `chunks-router.ts` dispatches to the new
    `service/export/build-vocabulary-csv.ts`, which calls
    `userLookupsRepository.listKeptChunksForExport` (LEFT JOIN cards +
    text_segments via `first_card_id`) and renders the same
    `front,back,context,tags,headword,surface_form,note` columns the
    per-session export produced. Tags are `flicktionary <target_language>`.
    Filename downloaded as `flicktionary-vocabulary-<lang>.csv`. The
    `cards.exportCsv` route is left intact but is no longer reachable from
    the UI.
  - **Keep/unkeep is now transition-aware.**
    `service/cards/set-card-status.ts` reads the previous card status before
    flipping. `pending|rejected|auto_rejected → kept` calls
    `userLookupsRepository.applyKeepTransition` (count +1, clear
    `deleted_at`, backfill `first_card_id`). `kept → anything-else` calls
    `applyUnkeepTransition` (count -1, floored at 0). Same-state click is
    a no-op (idempotent re-clicks no longer inflate `count`). The batch
    variant partitions cards into entering-kept / leaving-kept / unchanged
    before doing one bulk `updateStatusBatch` and the matching ±1s. SRS
    state is **not** touched on un-keep so re-keeping later resumes the
    schedule. Don't re-introduce the old `upsertOnKeep` (always +1, no
    decrement path) — toggling keep/reject N times used to leave a chunk
    at `count=N` with `×N` in the Vocabulary badge.
  - **`user_lookups` repo deltas.** `upsertOnKeep` removed; replaced by
    `applyKeepTransition({ userLookupId, cardId })` and
    `applyUnkeepTransition({ userLookupId })`. `upsertOnExport` no longer
    bumps `count` (export is not a keep event; only stamps `exported_at`
    + backfills `first_card_id`). `listChunksForLanguage` (both sort modes,
    both phases) and `listLanguagesForUser` now filter `count > 0` so a
    fully-rejected chunk drops out of the Vocabulary list AND the language
    switcher. New `listKeptChunksForExport` returns the joined export rows.
  - **SPEC.md updates.** Triage Layer 1 footer description, Vocabulary
    "Header options" bullet, Export section (entry point + tag format +
    surface_form/context fallback), `user_lookups.count` comment
    (transition-driven, default 0, gate semantics), and the user-flows
    section ("Review and practice" + a new "Export vocabulary" flow).

- **Practice landing → session loading UX (2026-05-07).** Clicking a language
  in `/practice` used to grey out the buttons while `startSession` resolved,
  then jump to `/practice/$id` where a small "Loading…" briefly flashed before
  "Preparing the session…" — three loaders in three positions. Refactored to
  one continuous spinner from click to text. Don't re-introduce the
  await-mutation-then-navigate flow.
  - **New route `/practice/start?lang=xx`** (`practice-start-view.tsx`):
    renders `<ModalScreen>` immediately with the centered "Preparing the
    session…" loader, fires `startSession` on mount, and `replace`s the URL
    with `/practice/$realSessionId` on success. The landing view's
    `handleStart` just navigates here — no mutation, no awaiting.
  - **`getSession` cache pre-population.** `useStartPracticeSession.onSuccess`
    writes a synthetic `{ session: <stub>, currentText: null }` into the
    `getSession` query cache before the URL replace. When the session view
    mounts, `useGetPracticeSession` returns immediately (no `isLoading`
    flash) and the auto-trigger effect fires `generateNextText` straight
    away — saves the previously-wasted ~200-500ms round-trip.
  - **Unified `<PracticeLoader>`** at `components/practice-loader.tsx`
    (centered Sparkles + label, fills the modal). Used in both the start view
    and the session view's loading branch. The session view's loader is now
    mounted at the modal top level (outside the `flex-col overflow-hidden`
    article frame) so position is pixel-identical across the URL replace.
    Combined gate: `!done && (isLoading || isAdvancing || !currentText)`.
    The previous "Loading…" div is gone.

- **Per-language grammar enrichment (2026-05-07).** New typed JSONB bag on
  `user_lookups` for sparse, language-agnostic morphology / grammar facts —
  surfaced as compact chips near the headword and an editable panel in the
  focus view. Russian, English, and (lightly) Spanish each got dedicated
  guidance in the per-target-language instructions block. Don't re-introduce
  the prior "annotations live inline in the headword" pattern — the
  headword stays clean for matching, all morphology lives in `grammar`.
  - **Schema delta** in the consolidated migration: `user_lookups.grammar
    JSONB NOT NULL DEFAULT '{}'::jsonb` next to `exploration_extras`.
    Modified in place + `supabase db reset --local`.
    `database.public.types.ts` hand-extended.
  - **`GrammarSchema`** in `packages/api-client/src/orpc-contracts/common/flicktionary-schemas.ts`
    is a Zod object with `.passthrough()` and every field
    `.nullable().optional()` because both the LLM and the JSONB `||`
    merge can leave explicit nulls on disk (the editable panel's "clear"
    path stamps `null`; the model occasionally emits `notable_forms: null`
    despite the tool schema saying "array"). The renderer treats null
    and absent identically. Don't re-introduce the strict variant — it
    500s the triage view on otherwise-valid rows.
  - **Both LLM passes emit grammar.** `basic-data-pass.ts` tool schema
    gained an optional `grammar` object per chunk; emitted inline (no
    extra round trip, ~tens of tokens per row). `enrichment-pass.ts`
    mirrors the schema so the on-demand pass can refine. Persistence in
    `process-session.ts` additively merges new grammar facts even into
    rows that already had content from earlier sessions (a chunk seen
    in a Russian session before this shipped will pick up its grammar
    on the next time it surfaces, without overwriting any user edits to
    translation/definition).
  - **`updateContent` accepts `grammarPatch`** end-to-end:
    `chunks-contract.ts` → `chunks-router.ts` →
    `userLookupsRepository.updateContent` (JSONB `||` merge mirroring
    extras). The chat tool's `update_card_fields` gained `grammar_patch`
    so the assistant can correct gender / aspect pair / government
    when asked. `renderCardForChat` prints the grammar bag so the model
    sees its current state.
  - **Russian instructions block** (`ru` / `rus` / `russian`) codifies
    the rules from `skills-previous-project/flashcard-data-guidelines.md`
    and the four `clean-russian-*` / `clean-language-reactor` /
    `clean-kindle-vocab` skills: clean headword, soft-sign masculine
    flagging only when surprising, aspect + aspect_pair_headword on
    every verb, government format (`от + gen`, `+ acc`, `с + instr`),
    plurale tantum (`деньги` / `ножницы` / `часы`), stress-marked
    `display_form` (skip monosyllables and ё-words), 1–3 notable_forms
    max for irregular paradigm cells.
  - **English instructions block** (`en` / `eng` / `english`) sets the
    marked-infinitive convention for verbs (`to practice`,
    `to look forward to`) — `to` goes only in the headword, never in
    example sentences. Defines `government` for prepositional verbs
    (`+ on (gerund)`), `notable_forms` for irregular pasts /
    past participles / plurals / comparatives (skip regular `-ed`
    paradigms), `number_only` for `scissors` / `news` / `mathematics`.
    Explicit "leave unset" for `gender` / `aspect` / `animacy` /
    `display_form` / `is_reflexive`.
  - **Spanish instructions block** got brief grammar-field guidance
    appended (gender for unpredictable nouns like `el problema` /
    `la mano`, `is_reflexive` for intrinsically pronominal verbs,
    `government` for fixed-preposition verbs like `depender de`).
  - **Frontend.** New
    `apps/web/src/features/review/components/grammar-chips.tsx`
    (compact pills near the headword: gender / aspect / `↔ <pair>` /
    government / pl. tantum / indecl. / refl.) and
    `editable-grammar-panel.tsx` (collapsible section below the basic
    fields; native `<select>` for enums, text inputs for headword
    pointers and government and display_form, checkboxes for booleans,
    add/remove list editor for `notable_forms`). 600ms-debounced PATCH
    via `useUpdateChunkContent`; `lastSavedRef` pattern guards against
    chat-tool clobber. Wired into `focus-view.tsx`'s Card section
    (chips above the inputs, panel below).
  - **Backend unit tests.** `basic-data-pass.unit.test.ts` got 3 new
    cases: round-trips a Russian grammar bag (gender, aspect,
    aspect_pair_headword, government, plurale_tantum, notable_forms);
    preserves unknown keys via passthrough (forward-compat for
    languages we haven't tuned yet — e.g. `tone` for Mandarin); treats
    a missing or non-object `grammar` as `undefined`.

- **Exclusion-list scaling fix (2026-05-08).** Two-stage dedup for the
  basic-data pass plus a lightweight telemetry table. Problem framing in
  `EXCLUSION_LIST_SCALING.md`; mechanism + per-language quality tiers in
  `EXCLUSION_PREFILTER.md`. Don't re-introduce the unbounded
  `listHeadwordSensesForLanguage` call from process-session — it returns
  the user's entire vocab and bloats the basic-data prompt linearly with
  every kept chunk (breaks somewhere between 5–10k entries on cost / cache
  invalidation / LLM judgment quality).
  - **Pre-filter (heuristic guidance, Option A).** New repo method
    `userLookupsRepository.listHeadwordSensesRelevantToTrack({ userId,
    targetLanguage, textTrackId })` aggregates the track's text into one
    tsvector via `to_tsvector(${cfg}, string_agg(text, ' '))` then keeps
    `user_lookups` rows where `plainto_tsquery(headword)` matches.
    Returns `{ headwordSenses, totalVocabSize }` so the call site can log
    the prune ratio without a second round-trip. `cfg` comes from the
    now-exported `resolveRegconfig` in `text-segments-repository.ts:37`.
    `process-session.ts:115-118` swapped to call this instead of
    `listHeadwordSensesForLanguage` (the old method stays for any future
    caller that needs the unfiltered list). Real LOTR English session
    pruned 69 → 24.
  - **Haiku tiebreaker (correctness gate, Option C).** New pass file
    `apps/backend/src/transport/third-party/anthropic/passes/sense-disambiguation-pass.ts`
    — `MODEL_HAIKU`, `messages.create` (no streaming), forced tool use
    `submit_disambiguations`. Batches all colliding candidates into a
    single call. New repo method
    `userLookupsRepository.findExistingSensesByHeadwords({ userId,
    targetLanguage, headwords })` does the case-insensitive collision
    detection (`LOWER(headword) = ANY(${lowered}::text[])`), returns a
    `Map<lowercasedHeadword, [{sense, definition}, ...]>`. Orchestrator
    helper `applySenseDisambiguationTiebreaker` in `process-session.ts`
    filters chunks to `source === 'llm' && !belowCefr` (highlights
    bypass per spec; below-CEFR rows are auto_rejected anyway), looks up
    collisions, builds `CandidateForDisambiguation` payloads only for
    the colliding subset, calls Haiku with one retry on failure, drops
    `isDuplicate: true` candidates from the chunk list. Skips Haiku
    entirely when there are zero collisions. On unrecoverable failure:
    log + `appendProcessingWarning` + fall through keeping all candidates
    (matches the existing pattern at `process-session.ts:134-141`).
    Parser `parseDisambiguationResults` exported and unit-tested
    (`sense-disambiguation-pass.unit.test.ts`, 6 cases — happy path,
    empty, missing candidate_id, defensive non-bool coercion, clears
    matched_existing_sense when not duplicate, coerces non-string
    matched value to null).
  - **Why both A and C.** A reduces collisions before they happen and
    keeps the basic-data prompt small; C is the correctness gate for
    sense disambiguation that A's heuristic can't perform. Sense strings
    are LLM-generated on both sides, so a deterministic
    `(headword, sense)` exact-match post-filter would miss obvious
    duplicates (`"abandon"` vs `"to abandon"`, `"grow worse / corrupt"`
    vs `"grow worse over time"` — both cases observed in real LOTR
    testing where Haiku correctly flagged them).
  - **Telemetry table.** New `processing_telemetry` table on the
    consolidated migration (`20260425215345_initial_schema.sql`):
    `id`, `study_session_id` (FK to study_sessions, ON DELETE CASCADE),
    `pass_name` text (`'disambiguation' | 'exclusion_prefilter'`),
    `payload` jsonb, `duration_ms` int, `created_at` timestamptz, plus
    `idx_processing_telemetry_session (study_session_id, created_at
    DESC)`. RLS enabled, no policies (backend-only writes). New repo
    `transport/database/processing-telemetry/processing-telemetry-repository.ts`
    with one method `record(...)`. New helper
    `service/processing/telemetry.ts` exporting `recordPassTelemetry`
    that (a) `console.log`s a structured `[telemetry]` JSON line for
    live tailing AND (b) writes to the DB; the DB write is wrapped in
    try/catch so telemetry failures can NEVER break the pipeline. Both
    pre-filter and tiebreaker measure `duration_ms` with `Date.now()`
    deltas around their work. Disambiguation payload includes the full
    candidate list, decisions, attempts (1 or 2 if retried), and
    `droppedCount`. Exclusion-prefilter payload includes `totalVocabSize`,
    `filteredSize`, `regconfig`, `headwordSampleKept` (capped at 20).
  - **No target-count bump.** Pre-filter shrinks what the LLM sees as
    "already studied" so it honors the `targetForLevel` chunk count on
    novel chunks; tiebreaker drops should be a small minority. Revisit
    if telemetry shows >15% drop rate on real sessions.
  - **Plumbing.** `processingTelemetryRepository` added to
    `ProcessingDependencies` in `process-session.ts:25-35`; instantiated
    + threaded in `app.ts` (new import + new line in
    `processingDependencies` bag). The `database.public.types.ts`
    `processing_telemetry` Row/Insert/Update/Relationships entries were
    hand-added between `practice_texts` and `removals` (the typegen
    file is hand-maintained — regen on next `db:dev` reset will be a
    no-op diff).

**Remaining:**
- Phase 10 — **Shelved as of 2026-05-06.** Integration tests + the formal
  end-to-end verification pass are paused while the feature surface is still
  churning. Writing tests against a moving target produces churn, not safety:
  every feature tweak rewrites the suite and the false-positive noise erodes
  trust in it. Manual golden-path testing continues to fill the gap.
  Unshelve when: feature churn slows AND/OR a short list of "things I keep
  accidentally breaking" accumulates — those become the first integration
  tests. The Phase 10 todo list (vitest units for `select-surrounding-segments`,
  csv-builder escaping, `buildPromptContext` snapshot; manual golden-path
  matrix below) stays parked here so it can be picked up wholesale when the
  trigger hits.
- Pricing/limits decision (the LLM passes are not free; ~66¢ per movie for the
  basic-data + enrichment passes; Practice adds ongoing per-text generation cost
  on Opus).

## Known cosmetic issues (defer to verification cleanup unless raised earlier)

- (None outstanding as of 2026-05-01.)

## How to continue

1. Read `SPEC.md` (now includes the Practice section + extended data model), the
   original build plan at
   `/Users/sebastien/.claude/plans/i-would-like-to-wild-codd.md`, and the
   Practice tab plan at
   `/Users/sebastien/.claude/plans/we-are-working-on-shimmering-turtle.md`.
2. Run `pnpm check:types` and `pnpm lint` from the repo root to confirm we're starting clean.
3. Phase 10 (verification + integration tests) is **shelved** — see Remaining
   above. Continue with feature work; rely on manual testing of the golden
   paths below until the unshelve trigger hits. The schema is consolidated
   into the single `20260427120000_create_flicktionary_tables.sql` migration.
   Pre-launch, so a fresh `supabase db reset` is safe in principle — but if
   you have in-progress local cards you care about, prefer applying targeted
   `ALTER`s and regenerating types with
   `doppler run -- supabase gen types typescript --local > database.public.types.ts`
   from `supabase-dev-tunnel/`.
   - **Parked vitest unit tests** (write when Phase 10 unshelves):
     `select-surrounding-segments`, csv builder escaping, `buildPromptContext`
     snapshot. (`parseBasicDataChunks` and `srt-parser` already have passing
     tests.)
   - **Manual golden-path checklist** — the canonical regression matrix.
     Run through it before any non-trivial release / large refactor:
     - Tap-to-translate (Settings → toggle on → mid-watch selection → `TapToTranslateSheet` shows the gloss; second tap of the same selection should be instant from cache).
     - Re-process flow (process a session, return to subtitles via `← Subtitles` or by clicking the session card again, add more highlights, click `Process new highlights`, confirm only the new highlights produced cards and the difficult-words section did not duplicate); CSV export still includes the freshly-processed cards.
     - **Process with zero highlights** — first-pass should be allowed and surface LLM-suggested chunks only.
     - **Spanish session at C1** — pick a film with strong regional flavor (e.g. *El secreto de sus ojos* for rioplatense). Confirm the difficult-words pass biases toward voseo / lunfardo / regional collocations, that headwords are in dictionary form (`fundirse con`, not `se fundía con`), and that B-level filler (`nunca más`, `según su costumbre`) is excluded.
     - **Card front/back** — front = `headword` + blank line + `target_example`; back = `translation || definition` + blank line + `native_example`. Edits in the focus view's per-field inputs flow into the basic columns directly (no overrides). Verify CSV columns match.
     - **LLM-highlights toggle** — Settings → Processing → On/Off. With it off and zero highlights, the Process button is disabled with explanatory copy. With it off and ≥1 highlight, processing produces only highlight-source cards.
     - **Generate full exploration** — kept card → focus view → click `Generate full exploration`. The `exploration_extras` populates and the renderer shows the optional sections (etymology, register, IPA, …).
     - **Chat tool calls** — ask the assistant in chat to "rewrite the example sentence" or "use a different translation". The basic columns update server-side, the field inputs remount with the new values, and the assistant body shows `_Updated: <fields>_`.
     - **Cross-session dedup** — process a session that includes a polysemous word (`correr` with one sense). Start a second session containing `correr` in a different sense and process. The new sense should appear as a new card; the same sense should be excluded. Inspect `user_lookups` to confirm the composite PK `(user, lang, headword, sense)` lets both rows coexist. After processing, query `processing_telemetry` for `pass_name='exclusion_prefilter'` (payload's `filteredSize` should be << `totalVocabSize`) and `pass_name='disambiguation'` (when present, `decisions[]` should mark same-sense duplicates as `isDuplicate: true` and distinct senses as `false`). See `EXCLUSION_PREFILTER.md` for the full mechanism + per-language quality tiers.
     - **SRT markup** — import a track with `<i>...</i>` cues. Confirm rendered segments show plain text (not raw tags), that highlighting still aligns to the right characters, and that the LLM passes do not see markup.
     - **Per-language grammar enrichment** — process a Russian session with at least one of each kind: a soft-sign masculine noun (`день` / `гость`), an imperfective verb with a paired perfective (`видеть` / `увидеть`), a verb with case government (`зависеть от`, `издеваться над`), a plurale-tantum noun (`деньги` / `калоши`), a stress-marked common word. Open the focus view: chips render `m.` next to `день`, `несов.` + `↔ увидеть` next to `видеть`, `+ gen` next to `зависеть`, `pl. tantum` next to `деньги`. Open the Grammar panel; flip the gender on one row to confirm the debounced PATCH lands and survives a refetch. Then process an English session and confirm verb headwords come back as `to <verb>` (e.g. `to practice`, `to look forward to`), example sentences use the conjugated form, and `notable_forms` is populated for irregulars (`went`/`gone`, `children`, `better`/`best`). Triage list must load without a 500 (regression test for the original `notable_forms: null` bug).
     - **Practice golden path** — keep ≥10 cards in a single target language → tap the `Practice` tab → confirm the landing shows the language with `due / new / total` counts that match `SELECT COUNT(*) FROM user_lookups WHERE user_id=… AND target_language=…` → start session → first text generates within ~10s with all 7 chunks visibly highlighted (no offset-mismatch warning) → tap a chunk → `RateSheet` opens with headword + sense → rate `Hard` → spinner → text 2 generates and reuses the cache update path (NO stale flash, NO double LLM call). Repeat until `done: true`. Inspect `practice_ratings` (should have 1 explicit Hard + 6 implicit Goods per advanced text), `user_lookups.srs_state` (now non-null), and `practice_sessions.status` (should be `'completed'` once `done: true` returned).
4. The TanStack Router route tree (`apps/web/src/app/routeTree.gen.ts`) regenerates on Vite startup — if you delete or add route files and need it regen'd without running dev, run `pnpm exec vite build --mode development` in `apps/web` for ~3 seconds in the background, then kill it.
5. After backend schema changes, regenerate types from `apps/backend/supabase/supabase-dev-tunnel/`: `doppler run -- supabase gen types typescript --local > /Users/sebastien/Documents/flicktionary/apps/backend/src/transport/database/database.public.types.ts`.
6. Auto mode is fine — make reasonable assumptions and proceed; only stop for genuinely destructive ops (rm -rf, dropping prod data, force pushing main, etc.).

---
