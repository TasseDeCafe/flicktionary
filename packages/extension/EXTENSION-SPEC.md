# Flicktionary browser extension — spec

> **Source of truth** for the extension — behavior, architecture, and fork
> policy. Last full audit: 2026-06-04. Removal/migration history lives in git.

## What it is

The companion extension to the Flicktionary web app (see the root `SPEC.md`).
It overlays interactive subtitles on streaming video (YouTube, Netflix, and ~19
other platforms), lets the user hover any word for an instant backend-generated
gloss, and save words or multi-word chunks as highlights in their Flicktionary
account — the same `study_session` / `text_segment` / `highlight` model the web
app uses. Flicktionary is the system of record: the extension persists no
learning data locally; everything mined here shows up in the web app's triage
and Practice flows.

It also doubles as a general "send this to Flicktionary" capture tool: on any
non-video page, the popup can import the current article (Readability
extraction) as a new study session.

Desktop-only. Chrome (MV3, min Chrome 116) and Firefox (gecko id
`extension@flicktionary.app`).

## What it isn't (deliberately removed / non-goals)

The codebase is a vendored fork of [asbplayer](https://github.com/asbplayer/asbplayer)
(MIT, ~v1.13), stripped to only what Flicktionary uses. The following upstream
subsystems are **removed — do not reintroduce**:

- **Anki / sentence mining / cards** — the entire mining executor, AnkiConnect
  integration, card export dialogs, copy-history, mining keybinds, and the
  `AnkiSettings` grab-bag (its 4 live capture fields survive as `CaptureSettings`).
  Flicktionary has its own card system; all cards are created server-side from
  highlights.
- **Audio/screenshot recording** — audio capture, the offscreen audio service,
  mp3 encoding, `tabCapture` permission. (`cropAndResize` screenshot geometry
  survives only for the video-select thumbnail picker.)
- **The asbplayer web app + its integration** — upstream's standalone player
  (`common/app`, `client/`), the `app.asbplayer.dev` content-script bridge, and
  the side panel are gone. The popup's OPEN APP button opens the *Flicktionary*
  web app instead.
- **Dictionary / token coloring / annotations** — upstream 1.14+'s word-familiarity
  coloring, the Dexie token DB, dictionary settings UI, Yomitan hooks. Replaced
  by Flicktionary's own backend gloss + saved words.
- **Mobile / Firefox-Android support** — touch gestures, `isMobile` UA branches,
  the `gecko_android` build target. Desktop-only. (Beware: the on-pause controls
  overlay was historically named `MobileVideoOverlay` but is a desktop feature —
  it lives on as `VideoOverlay*`.)
- **Image-based (.sup/PGS) subtitles** and the rich-text cue path — text-format
  tracks only (srt/vtt/ass/nfvtt/ytsrv3…).
- **Not a player.** Like the web app, the extension doesn't host video; it
  attaches to the platform's own `<video>` element.

## Lineage

1. **Upstream asbplayer** (~v1.13) — vendored, not rebased. Upstream remains a
   read-only "parts donor" for new platform page-scripts and plumbing fixes
   (see "Donor model" below).
2. **The word-learning fork** — added word-click/hover interaction on top of
   upstream (reference copy at `~/Documents/asbplayer`).
3. **The Flicktionary integration layer** (this repo) — rewired the word features
   onto the Flicktionary backend (Supabase auth + oRPC API) and migrated the
   entire UI stack (see "Architecture").

Packages: `packages/extension` (`@flicktionary/extension`, WXT) +
`packages/asbplayer-common` (`@asbplayer-fork/common`, the shared
subtitle/settings/message layer). Upstream's `@project/*` scope became
`@asbplayer-fork/*`, so file-level diffing against the donor works but a git
merge never will.

License: asbplayer is MIT — keep `LICENSE.md` and the About attribution; the
store zip bundles the license (`zip.includeSources` in `wxt.config.ts`).

### Donor model (harvesting from upstream)

We own the fork; upstream is a parts donor, never a base. A read-only remote is
configured:

```
git remote add asbplayer https://github.com/asbplayer/asbplayer.git   # already configured
git fetch asbplayer --tags                                            # when harvesting
```

Baseline: ~v1.13. To see only upstream's later changes to a file, diff
`git show asbplayer/v1.13.0:extension/src/<path>` against our copy. Upstream's
post-1.13 velocity is mostly Anki/dictionary work we deleted, so harvest
narrowly:

- **New streaming platforms** — one page script (`src/entrypoints/<site>-page.ts`)
  + one `pages.json` row (+ maybe a shared helper from `src/pages/`). Localized;
  touches no core controllers.
- **Plumbing fixes** to video-data-sync, HLS/DASH parsing, or browser compat —
  diff the single file against the baseline, port the hunk by hand.

Porting checklist, every time a donor file comes in:

1. Rename imports `@project/*` → `@asbplayer-fork/*`.
2. Check it against the "What it isn't" list above — make sure it doesn't drag
   a removed feature (mining/recording/Anki/dictionary/mobile hooks) back in.
3. Gate: `pnpm build` + `pnpm check:types` + the verification golden path below.

## Architecture

- **Build: WXT** (Vite/Rolldown). `pnpm dev` / `pnpm build`; Firefox via
  `build:firefox`. Doppler injects `VITE_*` env (API host, Supabase keys);
  `DOPPLER_CONFIG=prd` gates dev-host permissions out of store builds.
  `check:types` (`tsc --noEmit`) is clean and gates CI; the WXT build is
  additionally validated pre-push. Tests: vitest (jsdom).
- **UI stack: React 19 + Radix + Tailwind v4** via the shared `@flicktionary/ui`
  package (same components as `apps/web`). MUI/emotion/tss-react are fully
  removed. i18n is Lingui (compiled catalogs; the macro runs through a dedicated
  `@rolldown/plugin-babel` pass).
- **All injected UI is in-realm Shadow DOM** (no iframes — the upstream
  FrameBridge transport was deleted). Shared infra in `src/ui/shadow/`:
  `shadow-host.ts` (modal + video-positioned hosts), `model-store.ts`
  (snapshot/delta state channels between controllers and React),
  `overlay-stylesheet.ts` (`applyOverlayStyles` — adopts the Tailwind sheet,
  falls back to `<style>` on Firefox Xray, re-registers `@property` rules via
  `CSS.registerProperty` so Tailwind borders/animations work in shadow roots),
  `shadow-ui-provider.tsx`. Any new shadow surface must mount through
  `applyOverlayStyles` + `ShadowUiProvider`.
- **Entrypoints** (`src/entrypoints/`):
  - `background.ts` — message-router service worker; all handlers under
    `src/handlers/` (groups: `asbplayerv2`, `video`, `popup`, `flicktionary`,
    `saved-words`, `supadata`).
  - `video.content` — the main content script: binds to `<video>` elements
    (`services/binding.ts`), runs the controllers (`subtitle-`, `video-data-sync-`,
    `video-overlay-`, `video-select-`, `notification-`, `controls-`, `drag-`).
  - 21 platform **page scripts** (`<site>-page.ts` + `src/pages.json` row each):
    Netflix, YouTube, TVer, Bandai, Amazon Prime, Hulu, iWantTFC, Disney+ (×2),
    U-NEXT, Viki, Emby/Jellyfin, Twitch, OSN+, Bilibili, NRK, Plex, Yle Areena,
    HBO Max, Stremio, CIJapanese. Each answers `asbplayer-get-synced-data` with
    the platform's subtitle track list. Adding a platform = one page script +
    one `pages.json` row (donor-harvestable).
  - `popup-ui`, `options`, `ftue-ui` — extension pages (popup, settings, tutorial).
  - `flicktionary-pair.content.ts` — URL-restricted to the web app's
    `/extension-pair` route; forwards the pairing payload to the background.
  - `flicktionary-import.content.ts` — injected on demand for article import.
  - `asbplayer-tutorial-page.ts` — serves the bundled tutorial video/SRT to the FTUE.

## Feature spec

### Pairing & auth

Sign-in is by Supabase magic link, brokered by the web app: the popup's
"Sign in with Flicktionary" mints a nonce and opens `/extension-pair`; the page
posts `{tokenHash, email, nonce}`; the pairing content script forwards it; the
background runs `verifyOtp` and persists the session in its own
`browser.storage.local` namespace (`flicktionary.auth.v1`) — deliberately
**outside** the settings provider, so it is never profile-synced or included in
settings export. The popup shows the paired email + sign-out (revokes the
session server-side via `extensionAuth.revokeSession`). Auth state changes
propagate live to open overlays via a storage subscription.

### Subtitle loading (video-data-sync)

On video detection the page script supplies available tracks; the track-selection
dialog (shadow modal) offers up to three simultaneous tracks with per-domain
"remember my choice". With `streamingAutoSync` (default **on**) the last-used
language auto-loads without a dialog. YouTube additionally offers:

- auto-translated caption languages from `streamingPages.youtube.targetLanguages`,
- **Whisper transcript generation** via an external transcript server
  (`TranscriptSettings`: `transcriptServerUrl`/`transcriptApiKey`; the
  `supadata-generate-handler` POSTs the video URL, gets SRT back), cached
  per-video-id in IndexedDB (`asbplayer-transcript-cache` — the extension's only
  IndexedDB use; cache management lives in the Misc settings tab).

Subtitle files can also be drag-and-dropped or loaded via the context menu /
`Ctrl+Shift+F` video-select. All upstream playback machinery is kept: offset
adjustment, condensed/fast-forward playback modes, per-track blur/toggle,
subtitle appearance styling, top/bottom positioning.

### Session registration (backend coupling)

When subtitles load, the binding awaits `register-flicktionary-subtitles`: the
background calls `studySessions.findOrCreateForYoutubeVideo` (deduped on video
id) or `findOrCreateForStreamingVideo` (any other platform), which creates the
`content_source`/`text_track`/`text_segments` server-side and returns a
segment-index → `text_segments.id` map, cached per `(source, contentHash)`
(`youtube-session-cache.ts`) so saves are a single round trip.

The extension sends **no language** — the backend detects it (Haiku) and uses it
as both content and target language. Failure modes are explicit: `422
UNSUPPORTED_LANGUAGE` → one-time notice, saving disabled for that video; `422
MISSING_CEFR` → surfaced at save time as the CEFR picker (below). Unpaired users
can still watch with subtitles; saving is simply unavailable (no local fallback).

### Subtitle overlay & word interaction

The subtitle renderer is a single React app in a shadow root
(`SubtitleOverlayApp.tsx`) — the sole renderer; there is no legacy DOM path and
word interaction is **always on** (the old `wordClickEnabled` setting is gone).
Each cue is tokenized (`services/word-tokenizer.ts`) into `Word` spans carrying
`data-word`/`data-sentence` plus segment-index and char-offset data so any save
resolves to an exact `text_segments` row + offsets.

- **Hover gloss** — hovering a word (300 ms debounce) calls `glosses.fastGloss`
  (selection + context line + target language) and shows a floating tooltip
  (floating-ui, in a separate non-transformed popover shadow host): word, IPA
  (GA → RP → untagged preference), one-line gloss, POS and register badges.
  Results are cached in-memory by `word::sentence`; nothing is persisted.
- **Selection** — click selects a word; press-and-drag extends to a contiguous
  multi-word (even multi-segment) chunk, highlighted in yellow.
- **Save** — right-click (word or selection) shows the Save action; success
  drops a toast and clears the selection. Signed-out → a "Sign in" action;
  registration-failed → disabled Save with the reason. The save calls
  `highlights.create({sessionId, start/endSegmentId, offsets, selectionText})`.
- **CEFR picker** — if a save bounces with `MISSING_CEFR`, an over-video A1–C2
  grid appears; picking a level calls `extensionAuth.setCefrLevel` and retries
  the save.
- **Pause-on-hover** — `pauseOnHoverMode` defaults to `inAndOut`: hovering the
  subtitle pauses, leaving resumes. The subtitle hit-rect "hover bridge" also
  counts the gloss popover as inside, and the tooltip has a 150 ms hide grace,
  so moving from word → popover doesn't auto-resume and tear the popover down.

### Controls overlay

`VideoOverlayController` (default-on via `streamingEnableOverlay`) shows a
control bar over the video on pause: load/toggle subtitles, playback-mode
switches, offset/playback-rate/subtitle-navigation scroller. Desktop feature —
despite its upstream "mobile overlay" ancestry.

### Other shadow surfaces

- **Notification** — fullscreen-aware modal for update alerts/errors; pauses the
  video and hides subtitles while open.
- **Video select** — when a page has several `<video>` elements, a thumbnail
  picker (visible-tab capture, cropped per video) chooses which one to bind.

### Popup

Two variants, switched by the active tab's URL (`PopupUi.tsx`):

- **On a supported video page:** OPEN APP header (→ Flicktionary web app),
  pairing section, the full embedded settings form, and the settings-profile
  switcher.
- **On any other page:** OPEN APP, pairing section, **"Import this article"**,
  and slim Misc (theme/language) + About tabs.

### Article import

The import button injects `flicktionary-import.content.ts`, which clones the
document and runs `@mozilla/readability` — extracting the title and
paragraph-segmented text (one line per block element, flat-text fallback) — then
the background calls `studySessions.importText({title, text, sourceUrl})`. The
backend detects language, segments, and creates a session; success opens it in
a new tab. A selection-based path imports highlighted text as a paste (no
sourceUrl). Errors show inline in the popup with retry, plus an on-page toast.

### Settings, profiles & options page

The options page and the popup share `SettingsForm`. Tabs: subtitle appearance
(with live preview), keyboard shortcuts, streaming-video behavior (display
subtitles, overlay, auto-sync, condensed-playback interval, per-site page
settings), Misc (theme, language, playback steps, pause-on-hover mode, subtitle
regex filter, transcript-server config, transcript-cache management), About.

- **Profiles** — full settings profiles, switchable from the popup; stored with
  settings in `chrome.storage.local` (`ExtensionSettingsStorage`, profiles under
  `settingsProfiles`).
- **Import/export** — settings JSON export/import with a **strict** schema
  (`validateAllKnownKeys` rejects unknown keys; the schema mirrors the live
  `AsbplayerSettings` shape — there is no legacy-export tolerance). When
  removing a settings field, prune the schema too; when adding one, add it or
  export breaks (this bit us: `wordClickEnabled`/`transcriptServerUrl`/
  `transcriptApiKey` once missing made fresh-install export throw).
- **Settings model** (`asbplayer-common/settings/settings.ts`):
  `MiscSettings` + `SubtitleSettings` + `KeyBindSettings` +
  `StreamingVideoSettings` + `CaptureSettings` (the 4 surviving capture-geometry
  fields) + `TranscriptSettings`.
- **Defaults tuned for the common case:** `streamingAutoSync` on,
  `pauseOnHoverMode: inAndOut`, overlay on.

### Keyboard shortcuts

One Chrome-level command: `toggle-video-select` (`Ctrl+Shift+F`). Everything
else is the in-page `KeyBindSet`: play/pause, auto-pause, condensed and
fast-forward modes, subtitle toggle (global and per-track ×3), blur toggle ×3,
seeking (±, previous/next/current subtitle), subtitle offset (to
previous/next, ±, reset), playback rate ±, repeat, and top/bottom subtitle
position nudges. All editable in the shortcuts tab. The mining-era binds
(copy/export/screenshot/record, token marking, side panel) are gone.

### FTUE

First install opens the tutorial page: a bundled video + SRT
(`asbplayer-tutorial-page.ts` answers the synced-data event like a platform page
script), walking through pin-the-extension → load subtitles (advances when a
track actually loads) → the controls overlay → the overlay's scroll control.

## Backend API surface (preserve or stub)

All via the oRPC client (`@flicktionary/api-client`) against `VITE_API_HOST`:

| Procedure | Used for |
|---|---|
| `extensionAuth.bootstrapPrefs` | primary target language after pairing |
| `extensionAuth.revokeSession` | sign-out |
| `extensionAuth.setCefrLevel` | CEFR picker |
| `glosses.fastGloss` | hover gloss `{gloss, pos, register, ipa}` |
| `studySessions.findOrCreateForYoutubeVideo` | session registration (YouTube, deduped on video id) |
| `studySessions.findOrCreateForStreamingVideo` | session registration (all other platforms) |
| `studySessions.importText` | article/selection import |
| `highlights.create` | saving a word/chunk |

Plus Supabase auth (`verifyOtp`, publishable key in `flicktionary-config.ts`),
the web app's `/extension-pair` route, and the external Whisper transcript
server. Contract edits require rebuilding `@flicktionary/api-client` before the
extension typecheck sees them.

## Persistence summary

| Store | Contents |
|---|---|
| `chrome.storage.local` | settings + profiles (`ExtensionSettingsStorage`), global state (FTUE flags), `flicktionary.auth.v1` session, cached target language, pairing nonces |
| IndexedDB `asbplayer-transcript-cache` | generated Whisper SRTs per video id |
| In-memory only | gloss cache, session/segment-id cache |

No learning data is stored locally; highlights live in the backend.

## Verification golden path

`pnpm build` (or `pnpm dev`) → load on a YouTube video with subs:

1. Subtitles load (auto-sync or dialog) and the registration call succeeds.
2. Hover a word → gloss popover shows **and dismisses**; moving onto the
   popover doesn't resume playback.
3. Right-click save creates a highlight (verify in the backend / web app).
4. An unsupported-language video shows the one-time notice; saving disabled.
5. Pause → controls overlay appears; toggle-subtitles works.
6. Popup: pairing status, settings tabs, profile switching/deletion.
7. On a news article: popup import creates a session.
8. **Firefox build** (`build:firefox`, `web-ext run`) — smoke-test manually;
   Firefox-only failure modes (Xray wrappers, promise-only `sendMessage`) are
   invisible to CI.

## Known engineering traps

Hard-won; check these before "fixing" related symptoms.

- `video.css` uses `!important` everywhere; JS show/hide must use
  `style.setProperty(prop, value, 'important')` or it silently loses.
- Firefox content scripts: `adoptedStyleSheets` assignment throws through Xray
  wrappers — always go through `applyOverlayStyles`; `browser.runtime.sendMessage`
  is promise-only (no callback arg).
- Chromium ignores `@property` rules from shadow-root sheets — Tailwind borders
  and animations die silently; `overlay-stylesheet.ts` re-registers them
  document-globally. Self-built shadow sheets must repeat this.
- MUI is gone, but the lesson generalizes: anything portalled must portal into
  the shadow root, and rem-based sizing resolves against the host page's
  `<html>` (10 px on YouTube) — avoid bare-rem values in shared components.
- Don't trust "mobile" in inherited names — check the actual gating before
  removing anything.
- Settings schema is strict both ways (see "Settings" above).
- Never call `i18n.activate()` in a render body (use an effect).
