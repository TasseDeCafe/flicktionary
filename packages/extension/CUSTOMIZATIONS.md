# Flicktionary extension — maintenance playbook

`packages/extension` (+ `packages/asbplayer-common`) is an **owned, vendored fork**
of [asbplayer](https://github.com/asbplayer/asbplayer) (MIT). We do **not** re-base
onto upstream. We own this code and harvest from upstream selectively (the "donor
model", §3). This file is the maintenance playbook: what we changed, what we
removed, and how to pull useful bits from upstream without dragging the removed
features back in.

> Companion docs: `MAINTENANCE-PLAN.md` (the strategy + execution log for the
> 2026-05 lean strip). This file is the living reference; that one is history.

## Lineage

1. **Upstream asbplayer** (MIT, github.com/asbplayer/asbplayer). We vendored
   **~v1.13**; upstream is now ahead (1.17+). The donor remote is configured as
   `asbplayer` (see §3).
2. **The "word-learning" fork** — added Russian/YouTube word-learning features on
   top of upstream (a copy lives at `~/Documents/asbplayer`, `HANDOFF.md`).
3. **The Flicktionary integration layer** (this repo) — rewires the word-learning
   features to talk to the Flicktionary backend (Supabase auth + oRPC API). This
   is where most custom surface lives (§5).

## Build / structural deltas (vs. upstream)

- **Monorepo.** Upstream is `extension/` + `common/` + `client/` at repo root.
  Here: `packages/extension` + `packages/asbplayer-common` in a pnpm + turbo
  monorepo. There is **no `client/`** (the standalone web app) — but the asbplayer
  **web-app *integration*** (the content script bridge to `app.asbplayer.dev`) is
  still present; see §4 "Kept".
- **Package scope.** `@project/*` → `@asbplayer-fork/*`. **Every import differs**
  from upstream — so a naive `git merge` is impossible; harvest file-by-file (§3).
- **Build tool: WXT** — same as upstream (`pnpm dev` / `pnpm build` → `wxt` /
  `wxt build`). Dev bundle `.output/chrome-mv3-dev`; prod `.output/chrome-mv3`.
- **Vite env prefix.** `wxt.config.ts` adds `VITE_` to `envPrefix` for the
  Flicktionary Doppler config (`VITE_API_HOST`, `VITE_SUPABASE_*`).
- **Gate = the WXT build (`pnpm build`), not tsc.** `tsc --noEmit` has **9
  pre-existing errors** (down from ~18; the 2026-05 strip introduced none — see
  §6). esbuild does not type-check, so always run `pnpm build` after edits, and
  run `pnpm exec tsc --noEmit` to catch dangling property/type refs the build
  silently tolerates (this is how the mobile-overlay regression was caught).

## §3. Donor model — harvesting from upstream

We own the fork; upstream is a **parts donor**, not a base. The remote:

```
git remote add asbplayer https://github.com/asbplayer/asbplayer.git   # already configured
git fetch asbplayer --tags                                            # when you want to harvest
```

**Baseline:** we vendored ~v1.13. Diff a donor file against that tag to see only
upstream's later changes:
`git show asbplayer/v1.13.0:extension/src/entrypoints/<file>` vs. our copy.

**What's worth harvesting** (upstream's post-1.13 work is mostly Anki/dictionary —
which we deleted — so harvest narrowly):
- **New streaming platforms.** Each site = one WXT page-script entrypoint
  (`src/entrypoints/<site>-page.ts`) + one row in `pages.json` + maybe a shared
  helper from `src/pages/` (`m3u8-util`, `mpd-util`). Localized; touches no core
  controllers. (e.g. Netflix is already vendored but **not** wired to the backend.)
- **Plumbing fixes** to `video-data-sync`, HLS/DASH parsing, or browser-compat.
  Diff the single file against the baseline, port the hunk by hand.

**Porting checklist** (apply every time you pull a donor file):
1. Rename imports `@project/*` → `@asbplayer-fork/*`.
2. Run the **"do not reintroduce"** list below — make sure the donor file doesn't
   drag back a removed feature (mining/recording/anki/dictionary/coloring hooks).
3. `pnpm build` + `pnpm exec tsc --noEmit` (compare error count to baseline 9) +
   the manual golden path (§7).

## §4. Removed in the 2026-05 "full lean" strip — do NOT reintroduce

The fork was stripped to only what Flicktionary uses. **Removed** (8 commits +
a 2026-05 settings-UI follow-up; bundle 8.57 MB → 7.22 MB):

- **Mining / Anki / cards** — card export, bulk export, copy-history *handlers*,
  the Anki UI (`anki-ui` entrypoint, `AnkiUi`, anki-ui controllers), `PostMineAction`
  flows in `binding.ts`, the `mine-subtitle` context menu, and the mining keyboard
  commands (`copy-subtitle`, `update-last-card`, `export-card`, `take-screenshot`,
  `toggle-recording`).
- **Recording** — audio capture, screenshot capture, the offscreen audio service,
  `card-publisher`, `ImageCapturer`, `audio-recorder*`, the mp3 worker. (Kept:
  `cropAndResize` + `maxImage*` in `binding.ts` — used by **video-select**, not
  mining.)
- **Side-panel web-client app** — the `sidepanel` entrypoint, the `SidePanel*`
  React components (built on `common/app`), the toggle wiring, the popup "Open side
  panel" button, and the `sidePanel`/`offscreen` manifest permissions.
- **Subtitle annotation / coloring (upstream 1.14)** — `subtitle-controller` was
  reverted off `SubtitleColoring` back onto a plain `SubtitleCollection`; the
  rich-text/`hoverOnly` render branch, the `HoveredToken` mouse wiring, the
  mark/ignore-token keybindings, and `save-token-local` are gone. **`subtitle-coloring`
  is orphaned in the extension** (the common dir still exists — see §6).
- **Dictionary settings UI** — the dictionary/annotation tab in `SettingsForm`,
  `DictionarySettingsTab`, and `DictionaryClipboardImport`.
- **Anki / Mining settings UI + safe schema fields (2026-05 follow-up)** — the
  ANKI and MINING `SettingsForm` tabs (`AnkiSettingsTab`, `MiningSettingsTab`,
  `AnkiSelect`, `AnkiConnectTutorialBubble` deleted; the `anki`/`testCard` props
  dropped), the mining sections in Streaming Video + Misc, the mining keyboard
  rows (the 3 chrome-bound binds that survive are `hide:true`), and the mobile
  overlay mine button. **Schema fields removed** (no reachable reader): the
  `streaming*Screenshot`/`streamingRecordMedia` fields, keybinds `copySubtitle`/
  `ankiExport`/`toggleRecording` (+ their dead `key-binder` methods), and
  `clickToMineDefaultAction`. Removed fields are **left in the import/export
  `settingsSchema`** so old exports still validate (`validateAllKnownKeys` throws
  on unknown keys); `ensureConsistencyOnRead` drops stale keybinds on read.
- **`tabCapture` manifest permission** — dropped (recording gone; no
  `chrome.tabCapture` usage).

### Kept deliberately (NOT removed)
- **All ~21 video platforms** + their `pages.json` entries + the video-data-sync /
  subtitle-loading / HLS-DASH plumbing. Only YouTube is wired to the backend; the
  rest work at the extension layer but have no Flicktionary session model yet.
- ~~**The asbplayer web-app *integration***~~ — **REMOVED in the web-app teardown
  (2026-05, see §6 "landed").** `asbplayer.content.ts`, `common/app`
  (`ChromeExtension` etc.), the dead `use-video-element-count` hook, and the
  `extensionSupportsAppIntegration` settings surface are gone. OPEN APP now opens
  the Flicktionary web app (`getFlicktionaryConfig().webUrl`).
- **The `dictionary-db` / `DictionaryProvider` data layer** — load-bearing for
  **profile management** (`use-settings-profile-context`). The dictionary *feature*
  (coloring + settings UI) and the web-app dictionary bridge are gone, but the data
  layer survives as profile plumbing.
- **The live capture geometry + the import/export schema's tolerance.** The
  `AnkiSettings` grab-bag was removed (see §6 "landed"); only its four
  reachable-reader fields survive, now in a focused `CaptureSettings` interface:
  `maxImageWidth`/`maxImageHeight` (`binding.ts` screenshot cropping) +
  `surroundingSubtitles{Count,Time}Radius` (`binding.ts` / `subtitle-controller.ts`).
  The `settings-import-export` JSON schema **deliberately keeps** its dead Anki
  property + keybind entries (ankiConnectUrl, *Field, ankiFieldSettings,
  lastSelectedAnkiExportMode, updateLastCard/exportCard/takeScreenshot/ankiExport,
  …) so **old settings exports still import cleanly** — the schema is
  import-tolerance only; new exports simply don't carry those keys.
- **Whisper transcript generation** (`supadata-generate-handler`, `transcript-cache`,
  the external transcript server).

## §5. Flicktionary integration layer (carry forward)

- **Pairing** (Supabase magic-link): `/extension-pair` posts `{tokenHash, email,
  nonce}`; a URL-restricted content script forwards it to the background, which runs
  `verifyOtp` and persists the session in its own `browser.storage.local`
  namespace (`flicktionary.auth.v1`), **outside** `SettingsProvider` (never synced /
  exported).
- **Hover gloss via backend** — hovering a word calls `glosses.fastGloss`
  (selection + context + target language → `{gloss, pos, register, ipa}`). Nothing
  persisted; in-memory cache. Tooltip GOTCHA: `display: flex !important` in
  `video.css`; JS show/hide must use `style.setProperty('display', …, 'important')`.
- **Save → Flicktionary highlight** — right-click / drag-select → save. First save
  per video calls `studySessions.findOrCreateForYoutubeVideo` (creates
  `content_source`/`text_track`/`text_segments`), caches the segment map, then
  `highlights.create`. Flicktionary is the system of record.
- **Server-side language detection** — the extension sends **no** language; the
  backend detects it (Haiku `languageDetectionPass`) and uses it as content +
  target language. `register-flicktionary-subtitles` is awaited at load:
  `UNSUPPORTED_LANGUAGE` → one-time notice + save disabled; `MISSING_CEFR` → backend
  message.
- **Word-click mode** (`wordClickEnabled`) — `word-tokenizer.ts` stamps
  `data-word/data-sentence/data-segment-index/data-char-start/data-char-end` so a
  save resolves to an exact `text_segments` row + offsets. Hover/click/drag/save +
  tooltip live in `word-interaction-controller.ts`.

### New Flicktionary files
`src/entrypoints/flicktionary-pair.content.ts`, `src/handlers/flicktionary/*`,
`src/handlers/saved-words/save-word-handler.ts`, `src/services/flicktionary/*`,
`src/services/word-tokenizer.ts`, `src/controllers/word-interaction-controller.ts`.

### Modified upstream files (Flicktionary)
`binding.ts` (WordInteractionController wiring; register-subtitles at load + await;
`setFlicktionarySubtitleLanguageHint`; pause-on-hover), `subtitle-controller.ts`
(tokenize when `wordClickEnabled`; now on plain `SubtitleCollection`),
`video-data-sync-controller.ts` (language hint), `background.ts` (Flicktionary +
transcript handlers), `video.css`, `asbplayer-common/src/message.ts` (Flicktionary
messages), `settings.ts` (`wordClickEnabled`, `TranscriptSettings`; removed
`LLMSettings`), `MiscSettingsTab.tsx`, `Popup.tsx` (highlight counter).

## §6. Deferred follow-ups (not done in the 2026-05 strip)

These were intentionally left — pursue if/when worthwhile.

**Landed since (2026-05, dead-code cleanup — see `DEADCODE-CLEANUP-PLAN.md`):** the
orphaned standalone web-app UI under `common/app/` (Cluster 1, ~50 files; only the 8
integration-bridge files remain), the orphaned Anki/card UI components in
`common/components/` (Cluster 2, 17 files incl. `AnkiDialog`), the `subtitle-coloring`
dir + assorted stray orphans — `yomitan/index.ts`, `audio-clip/mp3-encoder-worker.ts`,
`device-detection/mac.ts`, `hooks/use-i18n.ts`, `hooks/use-image-data.ts`,
`decs.d.ts`, `vite-env.d.ts` (Cluster 3), and the now-unused `lamejs` dep (Cluster 4).
`common/asbplayer-common` dropped from 170 → 96 on-disk TS files; build stayed at
7.22 MB and the tsc 9-error baseline held throughout.

**Landed since (2026-05, web-app teardown — see `WEBAPP-TEARDOWN-PLAN.md`):**
- **OPEN APP repointed** to the Flicktionary web app via
  `getFlicktionaryConfig().webUrl` (was the asbplayer `streamingAppUrl`). The
  asbplayer "App integration" settings section (the "open subtitle list via app"
  toggle + asbplayer URL field) and the `extensionSupportsAppIntegration` prop are
  gone; the Streaming Video settings tab is now rendered unconditionally (its live
  contents — display-subtitles / overlay / auto-load-Whisper / condensed playback /
  page settings — are untouched).
- **`asbplayer.content.ts`, `common/app/`, `use-video-element-count.ts` deleted**
  (the latter was the only — itself dead — importer of `ChromeExtension`).
- **Dead mining/app-bridge message + model types removed** from
  `asbplayer-common/src/message.ts` / `model.ts`: the copy/mine/screenshot/rerecord
  messages, card-dialog messages, the get/set-settings·profiles·global-state·
  copy-history app-bridge messages, `PostMineAction`, `AnkiUiSavedState`. Bundle
  7.04 → 6.97 MB; tsc baseline 9 → 8 (one fewer error).
- **Anki settings teardown done** (Part C/D, after the user confirmed no regression):
  the `AnkiSettings` grab-bag was replaced by a focused `CaptureSettings` (the 4
  live fields), and `lastSelectedAnkiExportMode` / `AnkiExportMode`, the Anki-field
  UI helpers + `SettingsProvider` customAnkiFields/ankiFieldSettings logic, the dead
  `updateLastCard`/`exportCard`/`takeScreenshot` keybinds + `key-binder.ts` handlers
  + `ChromeBoundKeyBindName`, and the orphaned `copy-history/` dir + `CopyHistoryItem`
  are gone. The import/export JSON schema keeps the dead Anki/keybind property entries
  for old-export tolerance (new exports don't carry them). Removed one pre-existing
  failing jest suite (copy-history-repository).

Still deferred:

- **Deep `dictionary-db` removal** — requires rewiring profile management off
  `dictionary-db`. `dictionary-db` is the only reachable importer of `anki/anki.ts`;
  cutting that dependency would unlock deleting `anki/`, the rest of `audio-clip/`,
  and `@types/dom-mediacapture-record`. (Investigation, not mechanical.)
- **TS/ESLint** — `lint` is still a no-op stub (`echo`); aligning the monorepo's
  shared ESLint config is a large first-run-error task. tsc has 9 pre-existing
  errors (the WXT build is the gate).
- **Dead i18n keys** (Cluster 5, low value) — the Anki/mining translation keys
  (`settings.anki`, `settings.mining`,
  `binds.copySubtitle`/`ankiExport`/`extensionToggleRecording`, the
  `extension.settings.*Screenshot`/`recordAudio` labels, plus the now-dead
  `ankiDialog.*` / anki-field-label keys after Cluster 2) are still in
  `common/locales/*.json` (12 languages). They're harmless dead weight; deletion
  was skipped because these files don't survive a `json.dump` round-trip cleanly,
  so a bulk rewrite would produce noisy 12-file diffs for negligible gain. If
  pursued, delete the specific leaf keys line-by-line (not a reserialize) and grep
  each for 0 `t('…')` refs first — keep `settings.recordingBind` (still used by the
  keybind-editing placeholder).

## §7. Verification (golden path)

`pnpm build` (or `pnpm dev` for the dev bundle) → load on a YouTube video with subs:
word-click tokenization renders → hover gloss popover shows **and dismisses** →
right-click save creates a highlight (check the backend) → an unsupported-language
video shows the one-time notice → the popup settings tabs open and **profile
switching/deletion** works. Auth lives in `flicktionary.auth.v1`; re-pair via
`/extension-pair` after background/settings changes.

## §8. Backend / web coupling (preserve or stub)

- `glosses.fastGloss` — stateless gloss (`apps/backend` glosses-router).
- `studySessions.findOrCreateForYoutubeVideo` — `content_source.type = 'youtube'`,
  deduped on `youtubeVideoId`; detects language server-side; `422
  UNSUPPORTED_LANGUAGE` / `422 MISSING_CEFR`.
- `highlights.create`.
- Supabase auth (publishable key in `flicktionary-config.ts`) + the web
  `/extension-pair` route.
