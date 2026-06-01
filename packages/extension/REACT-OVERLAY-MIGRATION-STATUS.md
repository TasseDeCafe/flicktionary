# React-everywhere subtitle overlay — migration status

Living status doc for the staged migration that makes the React + Shadow-DOM
subtitle overlay the **only** render/word-interaction path and deletes the
legacy direct-DOM path. Update this as phases land.

- **Original plan:** `~/.claude/plans/okay-great-let-s-turn-jolly-sundae.md`
  (full phase breakdown + rationale + per-phase verification). Read it first.
- **Companion dead-code list:** `packages/extension/SHADOW-MIGRATION-DEAD-CODE.md`
  (separate iframe→Shadow leftovers; overlaps Phase 0).
- **Branch:** `feat/react-overlay-everywhere`.
- **Per-phase gate (from `packages/extension/`):**
  `pnpm run check:types && npx vitest run && pnpm run build` (build is the real
  gate; CI gates on `tsc`). Backend changes also need
  `pnpm --filter @flicktionary/api-client build` (project refs) before backend
  `check:types`, and `pnpm --filter backend db:dev:tunnel:gen-types` after a
  migration. Manual: regress YouTube; test Netflix/Prime (user-driven).

## The headline goal (not reached yet)

Legacy is still load-bearing: rich-text cues, subtitle blur,
notifications/auto-copy/auto-pause, and any ineligible case still run on the
legacy `WordInteractionController` + `ElementOverlay` HTML path. React is now the
**default for the common case on every site** plus dual subtitles, but nothing
legacy is deleted. Deleting it (Phase 2c) is gated on finishing Phase 2b.

## ✅ Landed on this branch

- **Phase 2a — gate decoupled from YouTube.** `react-mode-flag.ts` no longer
  checks the host; React renders + hover-gloss on any site for the
  text/word-click happy path. (commit `15f24cf`)
- **Phase 2b (1 of 4) — multi-track + dual top/bottom.** `subtitle-controller.ts`
  drives one React host per active overlay (`_reactOverlays` keyed by
  `'bottom'|'top'`), routing cues by per-track alignment; `evaluateReactMode`
  remounts when alignment changes mid-video. Gate now allows multi-track + dual.
  (commit `15f24cf`)
- **Deferred follow-up pulled forward — per-site word-saving.** Saving works on
  Netflix/Prime/etc., not just YouTube. Identity = subtitle **contentHash**
  (no per-site URL parsing), chosen with the user. (commit `359a4e7`)
  - Backend: `'streaming'` content_source type + partial unique index on
    `(user, metadata->>'contentHash')`; `findOrCreateForStreamingVideo`
    contract/handler sharing language-detection + ingest with the YouTube flow
    (`completeExtensionIngest` / `resolveExtensionIngestPrefs`).
  - Extension: `source: 'youtube'|'streaming'` discriminator on register/save
    messages; session cache keyed by `(source, contentHash)`; `binding.ts`
    builds a context on any site.
  - Web: `Streaming` filter chip + clapperboard card treatment.
  - **Migrations applied to dev-tunnel.** Two: `…150000` (enum), `…150100`
    (index). Append-only — don't edit.
- **Streaming title source.** Netflix's `document.title` is just "Netflix"; the
  save title is resolved by `pickStreamingTitle()` from layered candidates:
  the page-script's clean `basename` (`VideoDataSyncController.videoBasename`),
  then the loaded subtitle's "Video Name" (`binding.subtitleFileName(0)` — the
  string shown in the Select Subtitles dialog, always set at register time),
  then the scrubbed page title. The subtitle-name fallback is what actually
  fires today (`videoBasename` was empty at register time in testing).
- Incidental: gate truth-table test (`react-mode-flag.test.ts`); fixed one stale
  `GlossTooltip` comment.

## ⏳ Phase 2b remaining (unblocks the 2c deletion)

Each is independently shippable; legacy stays the fallback until the matching
gate predicate is relaxed. Data flows via `SubtitleLineModel` (`subtitle-store.ts`)
→ `_pushReactSubtitles` → `SubtitleOverlayApp.tsx`.

1. **~~Image/PGS (`textImage`) + rich-text (`richText`) cues~~ — resolved by
   deletion, not by porting.** Image/PGS (`.sup`) was dormant upstream
   machinery (manual file-load only; never served by any site) and was
   **dropped entirely** — the `.sup` accept entry, PGS parser worker,
   `textImage` model field/render branches, `imageBasedSubtitleScaleFactor`
   setting (kept in `ignoreKeys` for back-compat), and the `pgs-parser` dep are
   gone. `richText` is never populated by any parser, so nothing renders it; the
   gate keeps a cheap `richText` guard as a safety net. **No image/rich-text
   rendering work remains for the gate — this no longer blocks 2c.**
2. **Subtitle blur + unblur keybind** — add `blurred`/`classes` to
   `SubtitleLineModel`, apply blur class in the Shadow-DOM overlay CSS, wire the
   existing unblur keybind to the store.
3. **Notification overlay / auto-copy / auto-pause under React mode** — these
   only run on the legacy render path today; make them work when React is the
   renderer.

## 🔒 Phase 2c — delete legacy (the payoff)

Once 2b reaches parity + cross-platform tested:

- Delete `controllers/word-interaction-controller.ts` (~814 lines),
  `tokenizeToHtml` (`services/word-tokenizer.ts`) + its only caller.
- Remove legacy `ElementOverlay` HTML branches from `subtitle-controller.ts` and
  the `_reactMode`/`evaluateReactMode`/`_enter`/`_exitReactMode` latch — React
  becomes the unconditional renderer. Remove `_syncWordInteractionController`
  (`binding.ts`). Delete `react-mode-flag.ts` (no longer a gate).
- Keep the `ElementOverlay` persistent-host/fullscreen machinery React relies on.

## 🧹 Untouched cleanup backlog (independent, ship anytime)

- **Phase 0 — confirmed-dead deletions:** Anki `http-post-handler` +
  registration; `VideoDataUiOpenReason.miningCommand` plumbing; vestigial
  `ftueHasSeenAnkiDialogQuickSelectV2`; `_pickIpa` dedup (import the exported
  `pickIpa`); the "begin mining" string + a couple stale comments. **Do NOT
  touch** `DictionaryTokenSource.ANKI_*` migrations or `settingsSchema`/
  `ignoreKeys` retention (unknown-key import trap).
- **Phase 1 — clarity + tests:** z-index constant (4× `2147483647`); type the
  popup `commands: any`; verify+remove vestigial v1 `handlers/asbplayer/`; doc
  comments; remaining targeted tests (`rangeFor`, Flicktionary auth refresh —
  the gate test is already done).
- **`SHADOW-MIGRATION-DEAD-CODE.md`** — its 4 items, still untouched.
- Deferred: deep `asbplayer-common` vestigial-package audit; optional
  `SubtitleOverlayApp` hook/reducer extraction (only if 2b makes it unwieldy).

## Key implementation notes for whoever picks this up

- **The gate** (`services/flicktionary/react-mode-flag.ts`) is the SOLE latch:
  evaluated at subtitle-load and on settings-update, never per-render. Relaxing
  a predicate is how you migrate a capability; legacy auto-handles whatever the
  gate rejects.
- **Two React hosts** now exist when dual subtitles are on. `_reactOverlays` maps
  alignment → `{ store, mount }`. The gloss popover hover-bridge and visibility
  iterate all mounted hosts.
- **Saving is still effectively YouTube-shaped under the hood** only in that the
  YouTube flow carries `youtubeVideoId`; streaming reuses everything else. The
  deferred backend generalization (per-site stable IDs, richer metadata) is NOT
  needed for saving to work — contentHash identity is sufficient.
