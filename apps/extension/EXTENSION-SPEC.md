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

Package: `apps/extension` (`@flicktionary/extension`, WXT). Upstream's
`common/` tree is vendored intact at `apps/extension/common/` (the shared
subtitle/settings/message layer) and imported as `@asbplayer-fork/common` — a
local alias (tsconfig `paths` + a Vite alias in `wxt.config.ts`), not a
workspace package. Upstream's `@project/*` scope became `@asbplayer-fork/*`,
and `common/X` maps 1:1 to `apps/extension/common/X`, so file-level diffing
against the donor works but a git merge never will.

The `common/` folder is purely a **provenance boundary** — there is no build or
package reason for it. Upstream needed `common` because it had a second
consumer (the asbplayer web app, which upstream keeps at `common/app`); we
deleted that consumer, so the folder survives only to mark "donor code, shaped
like upstream — diff before you touch it". Its `src/` subfolder is upstream's
own quirk: `common` is a multi-entry package whose root entry (`index.ts`)
re-exports `src/*` (the core model/message/command types), while `settings/`,
`key-binder/` etc. are sub-path entries. Don't "fix" the layout — the mapping
is the point (see the divergence map below for when that stops being true).

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

#### Divergence map of `common/` (measured 2026-06)

Raw `diff` against the donor lies: the fork's prettier (`semi: false`,
`printWidth: 120`) differs from upstream's, so every line "changes". Normalize
the donor file through our config first:

```
pnpm exec prettier --config .prettierrc.cjs --stdin-filepath <file>.ts \
  < $DONOR/common/<file>.ts | diff common/<file>.ts -
```

Measured that way against the reference copy (`~/Documents/asbplayer`),
`common/` splits into two populations — this decides whether a donor diff is
worth reading at all:

| Area | Divergence | Harvest stance |
| --- | --- | --- |
| `base64/`, `blob-url/`, `browser-detection/`, `subtitle-collection/`, `pages/` | **0 lines** | still pristine donor code — take upstream fixes near-verbatim |
| `util/` (~10%), `subtitle-reader/` (~14%) | light | the harvest sweet spot (subtitle-parsing fixes) — diff and port hunks |
| `key-binder/` (~40%), `src/model.ts` (~50%) | heavy | port by hand only, hunk by hunk |
| `settings/`, `src/message.ts` | rewritten | fork-owned (Anki strip + Flicktionary rewiring) — donor diffs rarely useful |
| `components/`, `hooks/`, `global-state/` | fork-native | MUI→Radix/Tailwind rewrite; several files have no upstream counterpart — do not harvest |

If the first two rows ever stop mattering (we'd no longer take an upstream
subtitle-reader/pages fix), the reason to keep `common/` mirroring upstream
disappears — at that point distributing it into `src/` by domain is the right
cleanup.

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
  `shadow-host.ts` (modal + video-positioned hosts),
  `overlay-stylesheet.ts` (`applyOverlayStyles` — adopts the Tailwind sheet,
  falls back to `<style>` on Firefox Xray, re-registers `@property` rules via
  `CSS.registerProperty` so Tailwind borders/animations work in shadow roots),
  `shadow-ui-provider.tsx`. Any new shadow surface must mount through
  `applyOverlayStyles` + `ShadowUiProvider`.
- **State: zustand + TanStack Query** (same stack as `apps/web`; the hand-rolled
  `model-store.ts` snapshot/delta channels are gone). Controller→React models
  are **per-controller zustand vanilla stores** — never module singletons, so
  multiple videos/dialogs on a page stay independent: `video-data-sync-store.ts`
  and `video-select-store.ts` expose a channel-compatible `updateState(partial)`
  action (video-data-sync prunes stale track selections on `subtitles` deltas;
  video-select resets `selectedIndex` on `videoElements` deltas), while the
  notification and controls-overlay controllers push snapshots with `setState`.
  The subtitle overlay's pointer state (`selection`/`selecting`/`hovered`/
  `signedIn`) is a per-mount store (`overlay-interaction-store.ts`): imperative
  handlers read `getState()` (no stale closures), rendering subscribes only to
  `selection`/`signedIn`. Server state is TanStack Query, one client per realm:
  popup and options each create a `makeExtensionQueryClient()`
  (`ui/query/query-client.ts` — meta-driven sonner error toasts, shared
  `queryRetryHandler`; both page roots mount their own `<Toaster />`), and the
  content-script realm has the module-level `glossQueryClient`
  (`ui/video-overlay/gloss-query-client.ts`). **Exceptions, on purpose:**
  `subtitle-store.ts` (`SubtitleStore`) stays a hand-rolled
  `useSyncExternalStore` store — it's fed by the subtitle controller's 100 ms
  tick behind a controller-side `linesEqual` equality guard, and migrating it
  risks re-render storms for zero payoff; the overlay's `saveWord`/`setCefr`
  flows stay plain async (discriminated-union outcomes, never throw — not
  mutations).
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
  - `popup-ui`, `options`, `ftue-ui` — extension pages (popup, settings, welcome).
  - `flicktionary-pair.content.ts` — URL-restricted to the web app's
    `/extension-pair` route; forwards the pairing payload to the background.
    Runs at `document_start` — the pair page posts its one-shot message within
    a few hundred ms of booting, so a listener registered at `document_idle`
    loses the race and pairing silently times out.
  - `flicktionary-import.content.ts` — injected on demand for article import.

## Feature spec

### Pairing & auth

Sign-in is by Supabase magic link, brokered by the web app: the popup's
"Sign in with Flicktionary" mints a nonce and opens `/extension-pair`; the page
posts `{tokenHash, email, nonce}`; the pairing content script forwards it (a
stale/expired nonce — 2min TTL — is acked back `ok: false` so the page errors
instead of hanging); the
background runs `verifyOtp` and persists the session in its own
`browser.storage.local` namespace (`flicktionary.auth.v1`) — deliberately
**outside** the settings provider, so it is never profile-synced or included in
settings export. The popup shows the paired email + sign-out (revokes the
session server-side via `extensionAuth.revokeSession`). Auth state changes
propagate live to open overlays via a storage subscription.

Right after the session persists, the background handler reconciles the
server-synced UI prefs (`ui-prefs-sync.ts`): for each of theme/interface
language, a server `NULL` ("never explicitly set" — distinct from an explicit
`'system'`) pushes the local value up; a server value pulls down into local
settings. Sign-out keeps the last local values; the server value re-applies on
next pairing.

### Subtitle loading (video-data-sync)

On video detection the page script supplies available tracks; the track-selection
dialog (shadow modal) offers up to three simultaneous tracks with per-domain
"remember my choice". With `streamingAutoSync` (default **on**) the last-used
language auto-loads without a dialog; on a failed match,
`streamingAutoSyncPromptOnFailure` (default **on**) opens the dialog.
**Remembered-list semantics:** entries are slot-wise, `'-'` = "leave this slot
empty". A list with no real language (never remembered, or remembered
all-Empty — stored as `[]`; confirm normalizes all-`'-'` to `[]`) is never a
complete match while the video offers tracks, so the dialog prompts; it IS
complete when the video has no tracks, so subtitle-less videos don't nag.
(`'-'` would otherwise match anything: `['-','-']` used to complete-match
every video, silently syncing nothing and suppressing the dialog forever.) YouTube additionally offers:

- **translation controls** (Language Reactor-style; YouTube only): on YouTube
  the dialog renders TWO track selectors and the third slot holds a
  "Translation language" dropdown (codes from the player response's
  `translationLanguages`, rendered via `Intl.DisplayNames` in the UI locale)
  plus two mutually-exclusive switches — **Machine translation** (synthesizes
  a track at confirm time by setting `tlang` on the primary track's timedtext
  URL; no page round trip) and **Human translation** (selects an existing
  non-ASR track in that language; disabled "not available" otherwise; ASR-ness
  comes from `track.kind === 'asr'` plumbed as `isAutoGenerated`). The
  dropdown defaults to the last machine-translated language
  (`streamingPages.youtube.targetLanguages[0]`) falling back to the paired
  user's native language, cached from `bootstrapPrefs` alongside the target
  language (`flicktionary.native-language.v1`; storage-only read in content
  scripts). The toggle choice persists across dialog reopens via
  `streamingTranslationMode` (`'off' | 'machine' | 'human'`), written on
  confirm. **Data-source trap:** the ANDROID innertube payload (preferred for
  track URLs — no POT needed) is unreliable as metadata: it often trims
  `translationLanguages` (measured 18 vs the web response's 156; as few as 1
  in some experiment buckets) and can omit human-authored caption tracks;
  whenever it looks deficient the page script also reads the web player
  response (the in-realm `window.ytInitialPlayerResponse` global when fresh,
  else `fetchPlayerContextForPage`'s watch-page re-fetch) and merges — full
  translation list, plus missing tracks deduplicated on (language, asr-ness)
  with POT-tokenized URLs. Confirming
  with machine translation on records the code into
  `streamingPages.youtube.targetLanguages` (most-recent-first, limit 3 — the
  same setting the YouTube page-settings form edits): the page script then
  publishes `>> code` variants on future videos, which is what lets
  remembered track choices auto-sync. **Republish trap:** the target codes
  ride on each `asbplayer-get-synced-data` request (the page realm can't read
  settings); the page script's 500ms videoId-change republish (Shorts/SPA
  navigations) must reuse the last requested codes — publishing with `[]`
  drops the `>>` variants from whichever publish wins the auto-sync race and
  the dialog reopens despite a remembered translated track. Translated tracks carry interpolated
  per-word timing + punctuation, so ASR re-chunking applies to them too,
- **Whisper transcript generation** via an external transcript server
  (`TranscriptSettings`: `transcriptServerUrl`/`transcriptApiKey`; the
  `supadata-generate-handler` POSTs the video URL, gets SRT back), cached
  per-video-id in IndexedDB (`asbplayer-transcript-cache` — the extension's only
  IndexedDB use; cache management lives in the Misc settings tab).
  **Test-user only**: the transcript server scrapes YouTube with the
  developer's own credentials (yt-dlp), so non-test users get neither the
  Generate button (`canGenerateTranscripts` in the dialog model) nor the
  Misc-tab Subtitle Generation section, and the background handler refuses
  the request outright (the authoritative gate).

Subtitle files can also be drag-and-dropped or loaded via the context menu /
`Ctrl+Shift+F` video-select. All upstream playback machinery is kept: offset
adjustment, condensed/fast-forward playback modes, per-track blur/toggle,
subtitle appearance styling, top/bottom positioning.

**ASR re-chunking** (`common/subtitle-reader/asr-chunker.ts`): YouTube
auto-generated (`.ytsrv3`) tracks are hard-wrapped at ~40 chars with no regard
for phrase structure (measured: 54–63% of cue boundaries fall mid-phrase),
which used to make terms span cues — unselectable, since selection is per-cue.
The srv3 parser detects per-word timing (≥10 explicitly timed `<s>` tokens;
manually-authored srv3 lacks these) and rebuilds cues from the word stream:
split on sentence-final punctuation (new-model ASR only — old videos have
none) or on silence gaps, with a pause threshold **adapted to the speaker's
cadence** (3.5× median inter-word delta, clamped 550–2200ms; fixed thresholds
misfire on slow narration). Soft/hard caps at 84/110 effective chars
(full-width CJK counts double); hard-cap overflow back-splits preferring
sentence ends > clause punctuation > largest gap; a 3-word lookahead keeps a
pause from splitting just before a sentence end. Multi-script rules: tokens
keep the payload's own spacing (Japanese carries none), except row-initial
tokens which lack their leading space and get one re-inserted in
space-separated scripts only (Korean is full-width *but* space-separated);
hiragana-initial tokens (particles/auxiliaries) never start a cue unless the
pause is ≥2.5× threshold. `>>` speaker markers force a cue boundary and are
stripped; non-speech rows (`[music]`) stay standalone cues. Note: re-chunking
changes the uploaded segment list, hence the `contentHash` — videos studied
before the change get a fresh text track/session on their next save (old
highlights stay on the old session).

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
  The lookup is a TanStack Query (`use-gloss.ts`) keyed
  `['gloss', word, sentence]` on the realm-wide `glossQueryClient`: successes
  cache (`staleTime: Infinity`, 30 min gcTime — re-hover is instant), errors
  THROW and are never cached (re-hover refetches; a "Sign in to translate"
  error must not survive sign-in). The key omits the auth/target-language
  context the background derives, so the client is **cleared on any auth
  change**; the background's target/native-language cache also resets on auth
  change (`resetFlicktionaryLanguageCache` — to `undefined`, not `null`, which
  would mean a known "no language" and skip the refetch). Nothing is persisted.
- **Selection** — click selects a word; press-and-drag extends to a contiguous
  multi-word (even multi-segment) chunk, highlighted in yellow.
- **Save** — right-click (word or selection) shows the Save action; success
  drops a toast and clears the selection. Signed-out → a "Sign in" action;
  registration-failed → disabled Save with the reason. The save calls
  `highlights.create({sessionId, start/endSegmentId, offsets, selectionText})`.
  **Toast cold-start trap:** sonner's `toast()` publishes to subscribers only
  (no replay), and the page-global Toaster host is created lazily — a bare
  `ensureToasterHost(); toast(...)` drops the page's first toast (the save
  succeeds with no visual cue). All toast call sites go through
  `dispatchToast()` (`toaster-host.ts`), which queues until the Toaster's
  subscription is live.
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
despite its upstream "mobile overlay" ancestry. It shows whether or not
subtitles are synced (`emptySubtitleTrack` model state) — it hosts the Load
Subtitles button, the only path back into the track dialog, so gating it on
synced would strand users who cancel the dialog.

### Other shadow surfaces

- **Notification** — fullscreen-aware modal for update alerts/errors; pauses the
  video and hides subtitles while open.
- **Video select** — when a page has several `<video>` elements, a thumbnail
  picker (visible-tab capture, cropped per video) chooses which one to bind.

### Popup

Two variants, switched by the active tab's URL (`PopupUi.tsx`):

- **On a supported video page:** OPEN APP + USER GUIDE header (→ Flicktionary
  web app / its public `/user-guide` page), pairing section, the full embedded
  settings form, and the settings-profile switcher.
- **On any other page:** the same header, pairing section, **"Import this
  article"**, and slim Misc (theme/language) + About tabs.

Both variants also show a **"Finish setup"** section
(`FlicktionaryFinishSetupSection`) when paired with `nativeLanguage === NULL`
(a user who paired without completing web onboarding — glosses would fail with
`BAD_REQUEST`): a native-language select (`SUPPORTED_LANGUAGES` native names)
that calls `userPrefs.setNativeLanguage` and hides itself. Keyed on
`nativeLanguage === null`, NOT `isOnboarded` — web onboarding remains the full
flow; this only unblocks lookups. Popup open also refreshes the UI prefs from
the server (one shared `getPrefs` per open, memo invalidated on auth change).

On video pages, paired accounts on the test-user allow-list also get an
**Admin** tab (`AdminSettingsTab`, `SettingsForm`'s `adminTab` prop): debugging
toggles persisted in `flicktionary.devTools.v1` (`dev-tools-storage.ts`,
deliberately outside settings/profiles/export, like auth). The allow-list ships
as `WXT_PUBLIC_HASHED_EMAILS_OF_TEST_USERS` (sha256 of lowercased email — same
scheme as the web app's `VITE_HASHED_EMAILS_OF_TEST_USERS`; the backend keeps
the plaintext `EMAILS_OF_TEST_USERS`). Currently one toggle: the floating
notification/dialog test buttons on video pages (`dev/notification-test-buttons.ts`),
off by default, mounted/unmounted live by the content script in any build.

### Article import

The import button injects `flicktionary-import.content.ts`, which clones the
document and runs `@mozilla/readability` — extracting the title and
paragraph-segmented text (one line per block element, flat-text fallback) — then
the background calls `studySessions.importText({title, text, sourceUrl})`. The
backend detects language, segments, and creates a session; success opens it in
a new tab. A selection-based path imports highlighted text as a paste (no
sourceUrl). Errors show inline in the popup with retry, plus an on-page toast.
Both paths check pairing up front — a signed-out user gets a sign-in prompt
before any extraction is attempted.

### Settings, profiles & options page

The options page and the popup share `SettingsForm`. Tabs: subtitle appearance
(with live preview), keyboard shortcuts, streaming-video behavior (display
subtitles, overlay, auto-sync, condensed-playback interval, per-site page
settings), Misc (theme, language, playback steps, pause-on-hover mode, subtitle
regex filter, and — test-user only — transcript-server config +
transcript-cache management), About.

- **Profiles** — full settings profiles, switchable from the popup; stored with
  settings in `chrome.storage.local` (`ExtensionSettingsStorage`, profiles under
  `settingsProfiles`).
- **Import/export** — settings JSON export/import with a **strict** schema
  (`validateAllKnownKeys` rejects unknown keys; the schema mirrors the live
  `AsbplayerSettings` shape — there is no legacy-export tolerance). When
  removing a settings field, prune the schema too; when adding one, add it or
  export breaks (this bit us: `wordClickEnabled`/`transcriptServerUrl`/
  `transcriptApiKey` once missing made fresh-install export throw).
- **Settings model** (`common/settings/settings.ts`):
  `MiscSettings` + `SubtitleSettings` + `KeyBindSettings` +
  `StreamingVideoSettings` + `CaptureSettings` (the 4 surviving capture-geometry
  fields) + `TranscriptSettings`.
- **Defaults tuned for the common case:** `streamingAutoSync` on,
  `pauseOnHoverMode: inAndOut`, overlay on.
- **Theme & interface language:** `themeType` is `'dark' | 'light' | 'system'`
  and `language` accepts `'system'` — both default to `'system'` (there is no
  install-time language write; `'system'` resolves the browser locale/OS theme
  at runtime). `'system'` flows through controller messages **unresolved** and
  resolves at each realm's consumer edge (`resolveTheme`/`useResolvedTheme`,
  live matchMedia follow); the sonner toaster resolves inside `setToasterTheme`.
  When paired, theme/language are **person-level**: changes from the popup and
  options-page sinks write through to the server (`userPrefs.setUiTheme`/
  `setUiLanguage`, fire-and-forget, no retry queue, last-write-wins across
  browsers), and popup/options open pulls non-NULL server values down. Settings
  stay profile-scoped in storage; server→local writes go through
  `settingsProvider.set` and never push back (no loops).

### Keyboard shortcuts

One Chrome-level command: `toggle-video-select` (`Ctrl+Shift+F`). Everything
else is the in-page `KeyBindSet`: play/pause, auto-pause, condensed and
fast-forward modes, subtitle toggle (global and per-track ×3), blur toggle ×3,
seeking (±, previous/next/current subtitle), subtitle offset (to
previous/next, ±, reset), playback rate ±, repeat, and top/bottom subtitle
position nudges. All editable in the shortcuts tab. The mining-era binds
(copy/export/screenshot/record, token marking, side panel) are gone.

### FTUE

First install opens the welcome page (`ftue-ui.html`): a static greeting that
links to the web app's public `/user-guide` page. The upstream interactive
tutorial (bundled video + SRT, `asbplayer-tutorial-page.ts`, scroll-triggered
walkthrough bubbles) was removed 2026-06 — the user guide replaced it. The
`ftueHasSeenSubtitleTrackSelector` first-run hint in the track-selector dialog
is unrelated and stays.

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
| `userPrefs.getPrefs` | UI-prefs refresh on popup/options open; `nativeLanguage === null` gates the finish-setup section |
| `userPrefs.setUiTheme` / `userPrefs.setUiLanguage` | write-through + pairing reconcile of theme/interface language (NULL round-trip supported) |
| `userPrefs.setNativeLanguage` | JIT native-language picker |

Plus Supabase auth (`verifyOtp`, publishable key in `flicktionary-config.ts`),
the web app's `/extension-pair` route, and the external Whisper transcript
server. Contract edits require rebuilding `@flicktionary/api-client` before the
extension typecheck sees them.

## Persistence summary

| Store | Contents |
|---|---|
| `chrome.storage.local` | settings + profiles (`ExtensionSettingsStorage`), global state (FTUE flags), `flicktionary.auth.v1` session, `flicktionary.devTools.v1` admin debug toggles, cached target language, pairing nonces |
| IndexedDB `asbplayer-transcript-cache` | generated Whisper SRTs per video id |
| In-memory only | gloss query cache (`glossQueryClient`, cleared on auth change), session/segment-id cache |

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
8. Theme: default System follows the OS (flip the OS theme live — popup,
   options, and shadow overlays follow); explicit Light/Dark sticks. Language
   System follows the browser locale; explicit Français switches the UI.
9. Sync: pair with server-NULL prefs → local values pushed (PUT in Network);
   pair with server-set prefs → local pulled; change theme/language while
   paired → PUT fires; a second browser pulls on popup open.
10. JIT picker: pair an account with `native_language` NULL → "Finish setup"
    shows in both popup variants → picking a language calls
    `setNativeLanguage`, the section hides, and glosses work.
11. **Firefox build** (`build:firefox`, `web-ext run`) — smoke-test manually;
    Firefox-only failure modes (Xray wrappers, promise-only `sendMessage`) are
    invisible to CI. For this feature: matchMedia in popup/options AND inside
    shadow-DOM overlays, `.dark` toggling on shadow roots, orpc sync calls,
    JIT-picker Radix portal rendering.

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
