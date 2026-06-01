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

## The headline goal — REACHED (Phase 2c done)

The React + Shadow-DOM overlay is now the **only** subtitle renderer. The legacy
direct-DOM path is deleted: `WordInteractionController` (~814 lines), the gate
(`react-mode-flag.ts`), `tokenizeToHtml`/`_buildTextHtml`, and every legacy
render branch in `subtitle-controller.ts` are gone; `ensureReactOverlays` just
keeps the hosts in sync with the current alignment (no eligibility latch). The
**word-click setting was dropped** (word interaction is always on; the toggle +
`wordClickEnabled` setting were removed, with `wordClickEnabled` kept in
`ignoreKeys` for old-export back-compat). `richText` is no longer special-cased
(no parser produces it). Image/PGS was deleted earlier.

Remaining follow-up (not gating): a handful of now-dead light-DOM CSS rules in
`video.content/video.css` (`.asbplayer-word`, `.asbplayer-save-notification`,
`.asbplayer-subtitle-rich`/`.asbplayer-subtitle-text`, `.asbplayer-subtitles-blurred`)
that styled the deleted legacy DOM — produced by no code now; safe to remove in
a focused CSS pass with a visual check (CSS isn't covered by the build gate).

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

## ✅ Phase 2b — complete (all three items resolved)

Each was independently shippable. Data flows via `SubtitleLineModel`
(`subtitle-store.ts`) → `_pushReactSubtitles` → `SubtitleOverlayApp.tsx`. The
three items below are now done — 1 by deletion, 2 by porting, 3 was already
working (stale premise) + a small 2c-decoupling.

1. **~~Image/PGS (`textImage`) + rich-text (`richText`) cues~~ — resolved by
   deletion, not by porting.** Image/PGS (`.sup`) was dormant upstream
   machinery (manual file-load only; never served by any site) and was
   **dropped entirely** — the `.sup` accept entry, PGS parser worker,
   `textImage` model field/render branches, `imageBasedSubtitleScaleFactor`
   setting (kept in `ignoreKeys` for back-compat), and the `pgs-parser` dep are
   gone. `richText` is never populated by any parser, so nothing renders it; the
   gate keeps a cheap `richText` guard as a safety net. **No image/rich-text
   rendering work remains for the gate — this no longer blocks 2c.**
2. **~~Subtitle blur + unblur keybind~~ — DONE.** `SubtitleLineModel` carries a
   `blurred` flag; `_pushReactSubtitles` sets it from `_trackBlurEnabled(track)`
   minus the per-cue `unblurredSubtitleTracks` map. The overlay renders
   `blur-[10px] hover:blur-none` on the line (hover reveals, matching legacy
   `.asbplayer-subtitles-blurred:hover`). `unblur(track)` re-pushes with the
   track revealed under React mode; a new cue re-blurs (mirrors legacy
   `_resetUnblurState`). NB: blur was never a gate predicate, so blurred cues
   were silently rendering *unblurred* under React mode before this — a real
   parity bug, now fixed. No gate change.
3. **~~Notification overlay / auto-copy / auto-pause under React mode~~ — DONE
   (the doc's premise was stale).** A prior refactor already hoisted these out
   of the legacy render path, so all three work under React mode with no new
   wiring:
   - **Auto-copy** — `_autoCopyToClipboard` runs in the shared loop prologue
     (before the React/legacy branch) and just posts a `copy-to-clipboard`
     message; no DOM, no mode guard.
   - **Auto-pause** — `autoPauseContext` is fed at the loop prologue
     (`willStopShowing`/`startedShowing`); binding's `setPlayMode` callbacks have
     no `_reactMode` guard.
   - **Notifications** ("Auto-pause: On", etc.) — render via the separate
     `notificationElementOverlay`, which `_enter/_exitReactMode` never touch.
   The only real work: `notification()` used to build HTML via the legacy
   `_buildTextHtml`/`tokenizeToHtml` (pointlessly tokenizing status text), which
   2c deletes. Gave it a standalone `_buildNotificationHtml` (escaped text +
   track-0 subtitle styling, no track class so never blurred). **This removes a
   2c blocker — see below.**

## ✅ Phase 2c — legacy deleted (the payoff) — DONE

- Deleted `controllers/word-interaction-controller.ts` (~814 lines),
  `tokenizeToHtml`/`escapeHtml` (`services/word-tokenizer.ts`), and `_buildTextHtml`.
- Removed every legacy `ElementOverlay` HTML render branch from
  `subtitle-controller.ts` (`_buildSubtitlesHtml`, `_renderSubtitles`,
  `_resetUnblurState`, `_setSubtitlesHtml`, `_appendSubtitlesHtml`, `cacheHtml`,
  `_subtitleClasses`) and the `_reactMode` latch. `evaluateReactMode` →
  `ensureReactOverlays` (mount/remount to match alignment; no eligibility check).
  Removed `_syncWordInteractionController` (`binding.ts`) + the
  `WordInteractionController` field/construction. Deleted `react-mode-flag.ts`.
- Word-click is always on: dropped the `wordClickEnabled` setting (interface,
  default, schema → `ignoreKeys`, and the MiscSettingsTab toggle).
- The unsupported-language load notice now routes through the kept notification
  overlay (`subtitleController.showTextNotification`) instead of the deleted
  controller's `showNotice`.
- Kept the `ElementOverlay` persistent-host/fullscreen machinery React relies on.
- Gate green (check:types / vitest both packages / build). **Pending: user
  cross-platform manual verification**, then the dead-CSS follow-up above.

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
