# Flicktionary browser extension — spec

> **Source of truth** for the extension — behavior, architecture, and fork
> policy. Removal/migration history lives in git, not here.

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
- **Per-user Anthropic API key** — an early Flicktionary design had the user paste
  their own Anthropic key into the extension for glossing. There is no per-user
  key anymore; the gloss always goes through Flicktionary's authenticated backend
  (`glosses.fastGloss`). Do not reintroduce client-held LLM credentials.
- **Mobile / Firefox-Android support** — touch gestures, `isMobile` UA branches,
  the `gecko_android` build target. Desktop-only. (Beware: the on-pause controls
  overlay was historically named `MobileVideoOverlay` but is a desktop feature —
  it lives on as `VideoOverlay*`.)
- **Image-based (.sup/PGS) subtitles** and the rich-text cue path — text-format
  tracks only (srt/vtt/ass/nfimsc/ytsrv3…). Netflix tracks are IMSC 1.1 (TTML,
  `.nfimsc`): the page script reads track URLs from the player session state
  (there are no window.JSON manifest hooks; image-based Netflix tracks are
  skipped at detection).
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
  The Firefox manifest declares `browser_specific_settings.gecko.data_collection_permissions`
  (`required: ['websiteContent', 'personallyIdentifyingInfo']`) — AMO mandates
  this consent declaration for new add-ons; it covers the selected subtitle text
  sent for glossing/highlights and the account email/name captured on sign-in.
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
    Injected at `<all_urls>`/`allFrames` (upstream binds everywhere), but
    activation is gated to recognized platforms via `services/frame-activation.ts`:
    each frame binds only if the **top-level** page matches a `pages.json` host.
    A child frame can't read its top host cross-origin, so the top frame answers
    a postMessage query (responder installed in every top document, platform or
    not). This keeps third-party embeds inert — a YouTube clip in a news article,
    a video on an unrecognized site — while still activating platforms that host
    their player in a same-site iframe.
  - 21 platform **page scripts** (`<site>-page.ts` + `src/pages.json` row each):
    Netflix, YouTube, TVer, Bandai, Amazon Prime, Hulu, iWantTFC, Disney+ (×2),
    U-NEXT, Viki, Emby/Jellyfin, Twitch, OSN+, Bilibili, NRK, Plex, Yle Areena,
    HBO Max, Stremio, CIJapanese. Each answers `asbplayer-get-synced-data` with
    the platform's subtitle track list. Adding a platform = one page script +
    one `pages.json` row (donor-harvestable).
  - `popup-ui`, `options` — extension pages (popup, settings).
  - `flicktionary-pair.content.ts` — URL-restricted to the web app's
    `/extension-pair` route; forwards the pairing payload to the background.
    Runs at `document_start` — the pair page posts its one-shot message within
    a few hundred ms of booting, so a listener registered at `document_idle`
    loses the race and pairing silently times out.
  - `flicktionary-marker.content.ts` — presence beacon on the whole web-app
    origin: stamps `data-flicktionary-extension="<version>"` on `<html>` at
    `document_start` so the web app can passively detect the install (the
    `/extension-welcome` page branches on it; the app records the
    account-level `extension_installed` fact from it). Informational only —
    no message channel, page-spoofable by design.
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
settings export.

The pairing tab is closed by a **signal**, not a timer. The page can't close
itself (`window.close()` only works on script-opened windows — the extension
opened this one with `tabs.create`), so the page decides when pairing is *done*
and posts `flicktionary-pair-finished`; the pair content script forwards it and
a background handler removes the tab. On success the pair handler records the
paired `sender.tab.id` in `browser.storage.local` (so it survives an MV3 worker
suspend between the ack and the finished signal); the finished handler **only
ever closes `sender.tab.id`** and uses the recorded id purely as a guard
(refuse if a recorded id is present and does not match; close `sender.tab.id`
anyway if the record was lost to a suspend — the pair content script is
URL-gated to `app.flicktionary.app/extension-pair*` and the message only closes
its own sender tab). `start-pairing.ts` sets `openerTabId` to the tab the user
paired from, so the browser re-focuses it on close.

What counts as "done" depends on web onboarding (single onboarding surface, no
drift — see "Onboarding" below): an **onboarded** account posts `finished`
immediately (the old UX — the tab closes right away); a **not-onboarded**
account runs web onboarding *in the pairing tab* and posts `finished` from its
"Get started" button. With the timer gone the tab can no longer auto-close on a
stall, so the page also exposes a manual **"Return to the extension"** fallback
(re-posts `finished`, tells the user to close the tab) on the loading /
onboarded-but-not-yet-closed and prefs-error/retry states.

The popup shows the paired email + sign-out
(revokes the session server-side via `extensionAuth.revokeSession`). Auth state
changes propagate live to open overlays via a storage subscription.

Right after the session persists, the background handler reconciles the
server-synced UI prefs (`ui-prefs-sync.ts`): for each of theme/interface
language, a server `NULL` ("never explicitly set" — distinct from an explicit
`'system'`) pushes the local value up; a server value pulls down into local
settings. Sign-out keeps the last local values; the server value re-applies on
next pairing.

### Subtitle loading (video-data-sync)

On video detection the page script supplies available tracks; the track-selection
dialog (shadow modal) offers up to three simultaneous tracks. With
`streamingAutoSync` (default **on**) tracks auto-load without a dialog, under
one of two per-page policies:

**Video-language policy (YouTube — `autoSyncVideoLanguage` in `pages.json`):**
auto-sync loads the track matching **the video's own language**, so switching
between videos in different study languages just works with zero configuration
— the multi-language counterpart of the web app's "no target-language toggle".
The page script publishes `VideoData.videoLanguage`, resolved best-signal-first
(`services/youtube-audio-track.ts`, live-probed 2026-07-11 on a 25-track
multi-dub video):

1. a **dub** the player is set to — subs match what the user hears
   (`#movie_player.getAudioTrack().id` embeds a base64url xtags blob decoding
   to `{acont: original|dubbed|dubbed-auto, lang}`; only `dubbed*` wins here);
   read at publish time only, mid-video audio switches are not chased;
2. the sole ASR track's language — YouTube runs speech recognition on the
   original audio only (dubs never get ASR), so this reflects what is actually
   spoken and **outranks the original audio track's own lang label**, which is
   creator/YouTube metadata that can misstate the speech (live-probed
   2026-07-12 on vf4OFZ87jWM: "English (US) original" audio whose sole ASR is
   `ru` — the video is spoken in Russian);
3. the playing audio track's xtags lang (original or unlabeled audio, when no
   ASR signal exists);
4. `audioTracks[defaultAudioTrackIndex].audioTrackId`'s language prefix from
   the in-realm web player response (YouTube labels that audio track
   "<language> original"; read only while the page global is still for this
   video — never re-fetched just for this);
5. the single human caption track, when it is the only one on offer.

`selectVideoLanguageTrack` (`services/video-language-track-selection.ts`) then
picks among tracks matching on the BCP-47 primary subtag: human over ASR, then
exact code over subtag match, then published order; synthetic `_from_`
variants are never candidates. No match / no language signal → **nothing
loads, silently** — no prompt-on-failure dialog (it would nag on every
casually-browsed video); the dialog stays reachable via the overlay/toolbar.
A different track picked in the native gear menu or the dialog is video-local
(see Native track mirroring): the next video returns to its own language. The
per-site remember toggle is hidden on YouTube
(`hideRememberTrackPreferenceToggle`) and remembered
`streamingLastLanguagesSynced` entries are ignored there. Cached Whisper
transcripts still take precedence over both policies.

**Remembered-language policy (all other sites):** the last-used language
auto-loads; on a failed match, `streamingAutoSyncPromptOnFailure` (default
**on**) opens the dialog.
**Remembered-list semantics:** entries are slot-wise, `'-'` = "leave this slot
empty". A list with no real language (never remembered, or remembered
all-Empty — stored as `[]`; confirm normalizes all-`'-'` to `[]`) is never a
complete match while the video offers tracks, so the dialog prompts; it IS
complete when the video has no tracks, so subtitle-less videos don't nag.
(`'-'` would otherwise match anything: `['-','-']` used to complete-match
every video, silently syncing nothing and suppressing the dialog forever.)
**Reopen semantics:** while subtitles are loaded, reopening the dialog shows
the tracks actually synced (the controller records them per video;
`services/synced-track-resolution.ts`), NOT the remembered-language match —
that alone shows Empty with the remember toggle off, and confirming it
unloads the playing subtitles (and clears the per-site preference via the
all-Empty rule above). Resolution is by **stable identity** (language +
asr-ness, label tiebreak), never raw id: track ids embed the signed timedtext
URL and the page script republishes the same logical tracks with fresh
signatures, so exact-id matching goes stale across publish generations.
Switching a selector back to Empty + OK remains the explicit unload path.
Local-file and Whisper-generated loads aren't in the page's track list, so
the reopened dialog falls back to the auto-match for those. YouTube
additionally offers:

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
  with POT-tokenized URLs. **POT sourcing:** a web-response track URL without
  a `pot` token returns HTTP 200 with an **empty body** (no error). The legacy
  sessionStorage cache `decodePoToken` reads is no longer minted by current
  YouTube, so the page script harvests the token from the native player's own
  `/api/timedtext` fetches (seen by the same PerformanceObserver as track
  mirroring, keyed by video id) and — when none has been observed — induces
  one by flipping the CC toggle (off→on refetch, or on→off restore), only
  while caption rendering is suppressed so nothing flashes. When the web
  response is the **only** URL source, publishing polls for a token
  (500 ms × 16, aborted on navigation) instead of wrongly marking a captioned
  video subtitle-less — this is the age-restricted-video case, where the
  ANDROID client answers LOGIN_REQUIRED with zero captionTracks even with web
  cookies; metadata-only merges never wait. The ANDROID fetch itself is
  **prefetched speculatively** at page-script startup (keyed by video id,
  re-armed by the 500 ms interval on SPA navigations, retried until `ytcfg`
  exists) so its round trip overlaps the content script's boot. **Signed-URL
  expiry trap:** timedtext URLs carry a ~6 h signed `expire` (expired
  signatures 404), and a long-idle tab wake makes YouTube partial-reload the
  player for the *same* video id — so the still-"matching" prefetch and
  `ytInitialPlayerResponse` global can hold hours-old URLs whose fetch would
  404 and silently downgrade the video to native captions. Both cached
  sources are therefore validated against their URLs' own `expire` before use
  (a stale prefetch is dropped and re-armed, a stale global bypassed via the
  watch-page re-fetch); relatedly the
  video content script starts at `document_idle` without waiting for
  `readyState === 'complete'` (that gate stalled subtitle takeover behind
  every image on a cold load). Confirming
  with machine translation on records the code into
  `streamingPages.youtube.targetLanguages` (most-recent-first, limit 3 — the
  same setting the YouTube page-settings form edits): the page script then
  publishes `>> code` variants on future videos, so the dialog and the native
  gear menu can offer them (they never auto-load — auto-sync is the
  video-language policy). **Republish trap:** the target codes
  ride on each `asbplayer-get-synced-data` request (the page realm can't read
  settings); the page script's 500ms videoId-change republish (Shorts/SPA
  navigations) must reuse the last requested codes — publishing with `[]`
  drops the `>>` variants from whichever publish wins the republish race, and
  a reopened dialog could no longer represent a loaded translated track.
  Translated tracks carry interpolated
  per-word timing + punctuation, so ASR re-chunking applies to translations
  of auto-generated tracks too (the synthesized variant inherits the base
  track's `isAutoGenerated`),
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
Re-chunking is gated on the track being **marked auto-generated by YouTube**
(`kind === 'asr'`, plumbed as `isAutoGenerated` and carried into the serialized
subtitle filename as the `.asr.ytsrv3` marker by the video data controller)
AND the payload carrying per-word timing (≥10 explicitly timed `<s>` tokens).
Word timing alone is not the signal: human-authored karaoke-style tracks
(MrBeast-like styled captions) time every word too, and their authored cue
structure must be preserved — only the metadata flag separates them.
Auto-translate variants spread their base track, so a translation of an ASR
track re-chunks (machine text) while a translation of a human track doesn't.
Eligible tracks are rebuilt from the word stream:
split on sentence-final punctuation (new-model ASR only — old videos have
none) or on silence gaps, with a pause threshold **adapted to the speaker's
cadence** (3.5× median inter-word delta, clamped 550–2200ms; fixed thresholds
misfire on slow narration). Soft/hard caps at 84/110 effective chars
(full-width CJK counts double); hard-cap overflow back-splits preferring
sentence ends > clause punctuation > largest gap; a 5-word lookahead keeps a
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

Sessions are created **lazily, on a video's first save** — never by merely
loading or watching subtitles. When subtitles load, the binding only snapshots
the local video context (metadata + canonical segments + contentHash,
`_prepareFlicktionaryVideoContext`); the first `save-word` cold-starts
`studySessions.findOrCreateForYoutubeVideo` (deduped on video id) or
`findOrCreateForStreamingVideo` (any other platform), which creates the
`content_source`/`text_track`/`text_segments` server-side and returns a
segment-index → `text_segments.id` map plus the detected `targetLanguage`,
cached per `(source, contentHash)` (`youtube-session-cache.ts`, storage key
`flicktionary.session-cache.v3` — the v3 bump dropped v2 entries instead of
migrating; find-or-create is idempotent) so later saves are a single round
trip. Saved-highlight painting at load uses the cache or the lookup-only
`lookupForVideo` (see below) — watching with subtitles costs zero backend
writes, keeps the web sessions list free of never-studied videos, and leaves
`last_target_language` (stamped inside find-or-create) untouched by casual
viewing.

The extension sends **no language** — the backend detects it (Haiku) and uses it
as both content and target language. All three prefs/language failures surface
on the save path (there is no load-time registration to carry them anymore),
as **distinct codes** (the backend splits them so the extension picks the right
recovery — conflating them once stranded users who had a CEFR but no native
language in an unbreakable "set your level" loop):
- `422 NEEDS_ONBOARDING` (no native language → onboarding incomplete) → not an
  in-context fix (native language is global): the save toasts a **Finish setup**
  action that opens the pairing/onboarding tab (opener = the video tab, so it
  returns the user here when done). After onboarding, re-saving works.
- `422 MISSING_CEFR` (native set, CEFR for the detected language missing) →
  surfaced at save time as the in-video CEFR picker (below) and retried.
- `422 UNSUPPORTED_LANGUAGE` → on the first save attempt, a one-time notice
  naming the language; the overlay parks the reason on the binding
  (`setFlicktionarySaveDisabledReason`) so saving renders disabled for the
  rest of the video (hover gloss stays available). The platform's own caption
  code (YouTube BCP-47) is used ONLY to name the language in this notice — it
  is never trusted for storage; the server-detected language is the truth.

Unpaired users can still watch with subtitles; saving is simply unavailable (no
local fallback).

### Subtitle overlay & word interaction

The subtitle renderer is a single React app in a shadow root
(`subtitle-overlay-app.tsx`) — the sole renderer; there is no legacy DOM path and
word interaction is **always on** (the old `wordClickEnabled` setting is gone).
Each cue is tokenized (`services/word-tokenizer.ts`) into `Word` spans carrying
`data-word`/`data-sentence` plus segment-index and char-offset data so any save
resolves to an exact `text_segments` row + offsets. The tokenizer locale is the
session's server-detected subtitle language (delivered by the saved-highlights
load / the first save's response, held in the saved-highlights store), matching
what the web reader passes for the same text — `Intl.Segmenter` word rules are
locale-sensitive, so this keeps word boundaries (and saved offsets) identical
across platforms. Until a session exists (sessions are first-save-lazy) the
loaded caption track's own code (`getFlicktionarySubtitleLanguageHint`, YouTube
only) fills in, then `''` (locale-less); the same fallback chain feeds the
hover-gloss `targetLanguage` and its query key. Re-tokenization when a better
locale lands is safe because saved-span paint uses intersection, not exact
offsets. Cue text renders with **collapsed whitespace** (`whitespace-normal
text-balance`, not `pre-wrap`): human-authored cues carry hard `\n` line breaks
sized for YouTube's own renderer, which double-wrap into widowed lines at the
overlay's width cap. The `\n` stays in the DOM text (tokenizer offsets, save
coordinates and the contentHash all see the original), it just renders as a
collapsible space; `text-balance` evens out the soft-wrapped lines.

- **Hover gloss** — hovering a word (300 ms debounce) calls `glosses.fastGloss`
  (selection + context line + the video's detected target language when known,
  else server-detected from the context line — see the query-key note below)
  and shows a floating tooltip (the shared
  `FloatingSheet` desktop popover, portaled into a separate non-transformed
  popover shadow host): word, IPA
  (the server-picked `ipaDisplay` string — the backend resolves the user's
  `english_ipa_dialect` pref, so the overlay shows the same dialect as the web
  app; no client-side bag picking). When the surface form has no Wiktionary
  pronunciation of its own and the lookup fell back to its lemma's, the
  response's `ipaLemma` labels the IPA with that lemma (`beheben /bəˈheːbən/`
  under a `behoben` selection) so an inflected form is not implied to be
  pronounced like its lemma; null otherwise. Then a one-line gloss, POS and
  register badges.
  Both popovers (preview + saved mode) are built from the web app's shared
  components — `FloatingSheet`/`GlossCardBody`/`Badge`/`Button`/`Textarea`
  from `@flicktionary/ui` — with the web's DARK theme hardcoded via a `dark`
  class on the popover root (they always float over video; tokens.css is
  already adopted into the popover shadow root and `overlay.css` already
  `@source`-scans `packages/ui/src`). Desktop positioning/collision/viewport
  height are handled by the shared Radix-backed `FloatingSheet` in `desktopOnly`
  mode. The scrollable body owns the viewport cap and overscroll containment;
  the main action footer is sticky below it, and the extension uses the
  `visualScrollAffordance` scrollbar so the track only spans the scrollable
  region. The shared
  `StudyOptionsSection` (Radix Checkbox + Switch) is used as-is: the old
  rem-vs-host-root sizing trap was fixed at source — the ui Checkbox is
  spacing/px-sized and the ui Switch's track height is pinned to px (see its
  in-component comment) — so the controls are pixel-identical to the web.
  The lookup is a TanStack Query (`use-gloss.ts`) keyed
  `['gloss', targetLanguage, word, sentence]` on the realm-wide
  `glossQueryClient`: successes cache (`staleTime: Infinity`, 30 min gcTime —
  re-hover is instant), errors THROW and are never cached (re-hover refetches;
  a "Sign in to translate" error must not survive sign-in). `targetLanguage`
  is the VIDEO'S detected subtitle language (from the saved-highlights store,
  riding the `flicktionary-gloss` message), so a Russian video glosses Russian
  even for a user whose primary target language is Spanish. While the overlay
  doesn't know it yet ('' in the key), the background sends **no** language and
  the backend **detects it from the context line** (`glosses.fastGloss`'s
  `targetLanguage` is optional). It deliberately does NOT fall back to the
  user's primary study language — that's wrong for a video in another language
  and empty for a just-onboarded user (this caused a bogus "set your target
  language" gloss error). The detected language landing later changes the key so
  a no-language gloss is never re-served from cache. The key still omits the
  auth/native-language context the background derives, so the client is
  **cleared on any auth change**. The background still warms a target/native
  bootstrap cache (the content-script track-select dialog reads the cached
  native language) and resets it on auth change (`resetFlicktionaryLanguageCache`
  — to `undefined`, not `null`, which would mean a known "no language" and skip
  the refetch). Nothing is persisted.
  **Pin-on-entry:** a gloss that the pointer never enters keeps the light
  hover-out dismissal (150 ms grace; quick lookups stay friction-free), but
  once the pointer ENTERS the popover it is pinned — pointer-leave no longer
  hides it (no more losing the Study options to a stray mouse move). A pinned
  gloss dismisses on outside pointerdown (same gesture as the saved-mode
  popover; right-button presses are exempt — right-click is the save/remove
  toggle and morphs the popover instead), play, cue change, overlay hide, or
  by hovering another word (the new gloss replaces it and starts unpinned).
  Presses on the SUBTITLE SURFACE itself are also exempt
  (`ignoreOutsidePointerDownSelector` covers the overlay host + lines
  container, web-reader parity with its word/highlight spans): a press on a
  word starts an interaction — hover swap, drag-select, saved-popover open —
  that updates or replaces the popover itself, so it is never a dismiss
  intent. This exemption is also load-bearing: Radix popover ≥1.1.16 resolves
  outside-press dismissal on the gesture's trailing *click*, which would land
  right after a drag's release opens the born-pinned chunk gloss and close it.
  **Saved words don't get the preview:** hovering a word on a saved span opens
  the SAVED-MODE popover instead (hover variant — same 300 ms debounce and
  150 ms hover-out grace; entering it flips it sticky), so a saved word never
  shows a second Save button. Hover and click on a saved span agree.
- **Selection** — click selects a word; press-and-drag extends to a contiguous
  multi-word (even multi-segment) chunk. The painted selection PERSISTS past
  release (deliberate; the web's painter was aligned to this): the sky wash
  keeps showing what the open popover refers to, clearing on save / play /
  cue change / saved-popover open / the next mousedown. A multi-word release
  opens the chunk gloss immediately (no hover debounce) — unless the range
  EXACTLY matches a saved highlight, in which case its sticky saved-mode
  popover opens instead (a preview's Save would stack a duplicate row; the
  chunk twin of the saved-span routing below, and the counterpart of the web
  sheet's findCachedHighlight dedup) — **born pinned** (an
  intentional drag shouldn't die to a stray hover-out; outside pointerdown
  OFF the subtitle surface / play / cue change / hovering another word
  dismiss it), with the word-ordinal
  range SNAPSHOTTED into the gloss's save target (`GlossSaveTarget` chunk
  carries `minOrd`/`maxOrd`, so Save / right-click power-save stay correct
  even if the live selection is cleared independently of the gloss). Color
  semantics match the web reader: selection paints the sky wash
  (`bg-sky-400/25`, the reader's dark-mode word-selection color), saved
  highlights paint yellow (below), and the hover affordance is a neutral
  white wash (`hover:bg-white/20` — hover means "glossable" here, a state the
  click-driven web doesn't paint; the web reader instead got an accent-tint
  hover affordance on selectable words).
- **Save / right-click toggle** — right-click saves the word (or selection /
  open chunk gloss) under the pointer; right-click on an already-saved span
  (any word of it; a chunk toggles on an exact range match) REMOVES it instead,
  so repeated right-clicks cycle save → remove rather than stacking duplicates
  (web session-view parity — it has the same right-click toggle, where the
  open sheet likewise morphs preview ⇄ saved in place). **An open popover
  survives the toggle and morphs to the new state** — right-button pointerdown
  is never an outside-dismiss for either popover: a right-click save from an
  open gloss rides the in-place handoff below (preview → saved-mode popover),
  and a right-click remove with the saved-mode popover open swaps it into the
  preview gloss for the same span (chunk gloss — born pinned as usual — for a
  multi-word highlight; skipped if the video resumed, the cue changed, or the
  highlight was cross-cue). With NO popover open the toggle stays silent, and
  the pending hover debounce is cleared so a stale preview can't pop over the
  result. **No success toasts** in either direction: the span's yellow wash
  appearing/disappearing is the feedback (toasts per word got noisy at
  volume); failures still toast. Success clears the selection. Signed-out → a
  "Sign in" action; an unsupported-language video → disabled Save with the
  reason (set by the video's first save attempt, see Session registration). The
  save calls `highlights.create({sessionId, start/endSegmentId, offsets,
  selectionText, studyIntent?, fastGloss?})`; when the preview gloss is already
  loaded, the compact `{gloss, pos, register}` triple is persisted with the new
  row so saved mode does not run a second first-gloss LLM pass that can infer
  slightly different metadata. The remove calls `highlights.delete` after the
  server ack.
  **In-place handoff (web gloss-sheet parity):** a save from an open gloss
  popover keeps it open as "Saving…" and, on success, swaps it into the
  saved-mode popover anchored at the same word — note/tags/Remove are
  immediately reachable, no re-click on the span. That handoff carries the
  richer preview gloss including `ipaDisplay`; saved mode prefers it over the
  compact row cache so the IPA line does not disappear. The Save button swaps
  in STICKY (the pointer is inside the popover); the right-click toggle swaps
  in the HOVER variant (the pointer is on the word — the popover yields on
  word-leave so rapid right-click saving isn't blocked). On the fallback paths
  (segment-map miss, video resumed, cue changed, or the user already hovered a
  different word's gloss) the gloss simply closes — the painted span is the
  only success cue.
- **Study options** — the gloss tooltip carries a collapsed "Study options"
  disclosure above its Save button (only when saving is available):
  Recognition (pre-checked) / Production / Pronunciation checkboxes plus a
  "Study this exact form" row labelled with the hovered word. FULL-SET
  semantics: untouched → no `studyIntent` is sent and the backend's keep-time
  default (citation recognition) applies; touched → exactly the checked set.
  The last checked skill is locked (no empty set); exact-form locks when only
  Pronunciation is checked (pronunciation never gets a form facet).
  Pronunciation is ALWAYS offerable — the preview's IPA is a Wiktionary-only
  lookup and says nothing about studiability (enrichment generates IPA for
  every saved selection; an IPA-less facet stays pending / is reconciled
  backend-side, see docs/SRS.md). The tooltip owns
  the draft (`StudyIntentDraft` + `draftToStudyIntent`) and renders the
  SHARED `StudyOptionsSection` from
  `@flicktionary/ui/components/study-options-section` (Radix controls,
  px-pinned at source — see the popover bullet above). The draft resets and
  the section re-collapses (`key={word}` remount) when the hovered word
  changes. `studyIntent` rides
  `SaveWordParams` → the `save-word` message → `highlights.create`, and
  survives the CEFR-picker retry via `pendingSave`. The right-click power-save
  bypasses the tooltip and always saves with the default. No ghost/"Use
  suggested" affordance here (web-only for now).
- **Two commit lanes + the inner note view (pre-save)** — web parity. The
  preview tooltip carries an **Add note** affordance beside Save; tapping it
  navigates the WHOLE popover content to an inner **note view** — back chevron
  (ghost icon button) + "Add note" title with the word as a subtitle, the
  shared `HighlightNoteEditor` (textarea + preset chips), and ONE commit
  button — instead of expanding the editor inline. **Save** (the main view's
  primary button) is the main lane (full card; a note drafted in the note view
  and kept via Back rides along and seeds the chat — the main view signals the
  pending draft by morphing `Add note` into `Edit note` with a dot). **Save
  note** (the note view's single button, disabled until a note or preset is
  entered) is the **note-only** lane: the `save-word` message carries
  `noteOnly: true` (+ `note` / `presetTags` / `chatSeedPrompt`),
  `highlights.create` makes an empty stub card + seeds the chat with NO
  enrichment / study facets. The note fields ride `SaveWordParams` → the
  `save-word` message → `highlights.create`, alongside `studyIntent` (ignored
  in the note-only lane), and survive the CEFR-picker retry via `pendingSave`.
  The note view resets when the hovered word changes.
  **Toast cold-start trap:** sonner's `toast()` publishes to subscribers only
  (no replay), and the page-global Toaster host is created lazily — a bare
  `ensureToasterHost(); toast(...)` drops the page's first toast (the save
  succeeds with no visual cue). All toast call sites go through
  `dispatchToast()` (`toaster-host.ts`), which queues until the Toaster's
  subscription is live.
- **Saved highlights (persistent spans)** — saved words/chunks render the web
  reader's dark-mode committed-highlight treatment: yellow wash + yellow
  glyphs (`bg-yellow-400/20 text-yellow-200`, hover `/30`; explicit colors,
  not `dark:` variants — the subtitle shadow tree has no `.dark` ancestor; no
  shadow-ring cushion — per-token spans would double-darken overlapping rings
  at word boundaries). Distinct from the live-selection sky; selection wins
  while both apply; outer-corner rounding per painted run. State lives in a per-mount vanilla zustand store
  (`saved-highlights-store.ts`); painting projects highlights onto cues via
  `buildLineRanges` (index-coordinate twin of the web reader's
  `buildSegmentRanges`: single-cue `[startOffset, endOffset]`, cross-cue
  start-tail / whole-middles / end-head, **clamped** to the cue length so
  web-created offsets that drift from this tokenizer still paint). Tokens
  paint on **intersection**, not exact offsets, for the same drift reason.
  - **Loading** — on mount/sign-in (plus a 3×2 s retry while the binding's
    video context is still landing) and on contentHash change, the overlay
    sends `load-flicktionary-saved-highlights`. The background resolves the
    session from its cache, or — cache cold (fresh install, second device,
    cleared storage) — via the **lookup-only**
    `studySessions.lookupForVideo` (NEVER find-or-create: loading must not
    mint sessions for videos the user merely watched; `data: null` = no
    session, normal state). A cached session whose highlight listing fails is
    treated as stale (deleted in the web app): evicted
    (`removeFlicktionarySession`) and re-resolved once via the lookup.
    Highlights whose segment ids don't resolve in the cached index map are
    dropped (different track revision). Signed-out → `signedIn: false`, no
    paint, zero further calls.
  - **Optimistic save** — `save-word` now returns the created highlight
    converted to segment-index coordinates plus the `sessionId` and
    `targetLanguage`; the overlay pushes them straight into the store
    (replace-by-id; the session id and tokenizer locale backfill a store that
    loaded before the video's FIRST save created the session — without them
    the saved-mode popover can't open on the new span and tokenization stays
    locale-less). A response without the highlight falls back to a full reload.
  - **Saved-mode popover** — a plain click (no drag) on a saved span opens a
    sticky popover (`SavedGlossTooltip`); HOVERING a saved span opens the same
    popover in a hover variant (300 ms debounce, hover-out grace dismissal,
    sticky once the pointer enters it) — there is no preview-with-Save over a
    saved word. Parity with the web session view's gloss sheet minus
    ghost-extend: cached `fastGloss` parses instantly (the shared
    `@flicktionary/core/utils/parse-fast-gloss`, same decoder as the web
    sheet). A direct open refreshes via `flicktionary-saved-gloss` →
    `highlights.fastGloss` to add the server-picked IPA; a just-saved handoff
    keeps the richer preview gloss already on screen and skips that immediate
    refresh. **Remove highlight** is the **cyclable green "Saved" control**
    itself — clicking it removes the span (`delete-flicktionary-highlight`, 404
    counts as success) silently (no success toast — the wash disappearing is the
    feedback, same as the right-click remove), replacing the old standalone trash
    button (web parity). Like the right-click remove, the on-screen Remove routes
    through the parent's `removeHighlight` so it **morphs the popover back into the
    preview gloss** for that span (chunk gloss for a multi-word highlight,
    single-word hover gloss otherwise) instead of just closing — it only closes
    for a cross-cue highlight or a resumed/detached anchor. **Add/Edit note**
    navigates to the same inner **note view** as the preview tooltip (back
    chevron + editor + single `Save note`) and composes the same localized
    `chatSeedPrompt` (`update-flicktionary-highlight-note` →
    `highlights.updateNoteAndTags`).
    Like the web sheet, **the note/presets seed the card chat exactly once and
    lock on save**: a committed note/preset set renders read-only inline on the
    main view (saved note + selected chips, dimmed + non-interactive, lock
    caption) and the footer collapses to the cyclable **Saved** control with no
    `Add/Edit note` — the seed
    is keyed per highlight, so re-saving would post a duplicate chat turn. The
    only way to change a committed note is to delete the highlight; an empty save
    seeds nothing and stays editable.
    The **study-target picker is shown but locked read-only** (the same
    `StudySkillCards` as the preview, uniformly dimmed + non-interactive via
    `pointer-events-none`, with a lock caption): it displays the saved skills +
    scope from the highlight's stored `study_intent` pre-enrich, then the term's
    live facets once a `chunkId` resolves (`get-flicktionary-study-targets` →
    `chunks.getStudyTargets`, read-only). Editing study targets is a save-time
    decision — afterwards it happens only in the web app's term view (the
    extension has none); there is no Save here.
    **Note-only stub state ("note saved, word not saved")** — web parity. While
    the highlight's `noteOnly` flag is set (the DTO derives it server-side as
    "the highlight's card is parked in `needs_data`"), the popover is
    deliberately DISTINCT from saved mode: the study-target picker stays
    **editable** (the shared `StudyOptionsSection`, its own local draft), the
    committed note shows locked inline, and the footer is primary **Save** + a
    green cyclable **Note saved** control (→ Remove on hover, discarding stub +
    chat). `Save` upgrades the stub into a full study card
    (`save-flicktionary-word` → `highlights.saveWord`: persists the intent +
    runs the normal enrichment, which re-points the stub's card to the enriched
    lemma+sense lookup — the note/chat survive — and auto-keeps it). On success
    the popover patches the store (`patchWordSaved`: `noteOnly` off + the
    intent) and morphs into the normal saved state, showing the just-chosen
    skills from the stored intent through the enrich window.
    A STICKY saved popover wins over the hover
    preview (the preview neither opens over it nor renders while it's up); a
    hover-opened one yields to hovering other words. Sticky dismissal is
    outside pointerdown (composedPath — shadow root; right-button presses are
    exempt — right-click is the toggle and morphs the popover instead), play,
    cue change, or overlay hide — never pointer-leave (it has a textarea).
    A left-press on a subtitle word closes it AT PRESS TIME (in
    `onWordMouseDown`, not via Radix, whose ≥1.1.16 dismissal only resolves
    on the gesture's trailing click): the release-time chunk-gloss open is
    gated on no saved popover being up, so a drag that starts on a word must
    find it already closed.
    A right-click remove while this popover is open swaps it into the preview
    gloss for the removed span (see the save/toggle bullet).
- **CEFR picker** — if a save bounces with `MISSING_CEFR`, an over-video A1–C2
  grid appears; picking a level calls `extensionAuth.setCefrLevel` and retries
  the save.
- **Pause-on-hover** — `pauseOnHoverMode` defaults to `inAndOut`: hovering the
  subtitle pauses, leaving resumes. The subtitle hit-rect "hover bridge" also
  counts BOTH popovers as inside — the preview gloss and the saved-mode
  popover (the save handoff morphs one into the other, and hovering a saved
  span opens the saved-mode popover directly) — and the tooltip has a 150 ms
  hide grace, so moving from word → popover doesn't auto-resume and tear the
  popover down.

### Controls overlay

`VideoOverlayController` (default-on via `streamingEnableOverlay`) shows a
control bar over the video on pause: load/toggle subtitles (the toggle hides
when a native caption control is in charge — see "Native caption control"
below), playback-mode switches, offset/playback-rate/subtitle-navigation
scroller, and a power button that flips the global switch off (see "Global
on/off switch"). Desktop feature —
despite its upstream "mobile overlay" ancestry. It shows whether or not
subtitles are synced (`emptySubtitleTrack` model state) — it hosts the Load
Subtitles button, the only path back into the track dialog, so gating it on
synced would strand users who cancel the dialog. The show is deferred by a
250 ms grace period (cancelled by `play`): Prime/Netflix players pause/resume
internally around seeks, and reacting to the raw `pause` event made the
controls flash on every subtitle navigation — or stick on screen mid-playback
when the async model push landed after the play-event hide.

While the global switch is off (see "Global on/off switch"), the controller
stays bound in **disabled mode** — regardless of `streamingEnableOverlay`,
since the pill is the only on-video way back — and the bar renders as a single
dimmed logo pill (`VideoOverlayDisabled`, same shell and pause/grace behavior)
whose click writes the global flag back on.

### Declaration flow (collect reviews + mark words known)

The controls bar hosts the video counterpart of the web reader's declaration
pill (web behavior: `docs/READER-SPEC.md`; scheduling semantics: `docs/SRS.md`
§6b) — one button beside the power button whose tap opens a two-step sheet
over the video: confirm "I understood up to here" (collect checkpoint
reviews) → optional "Mark N words as known?" (bulk `known_lemmas` sweep) →
done step with a combined Undo. It deliberately lives on the pause-state
controls: the press happens while paused, a deliberate act; the evidence is
the explicit press, not playback position.

- **Button faces** (`VideoOverlay.tsx`, same priority ladder as the web
  pill): with a markable-word count > 0 the button wears the web pill's sweep
  face — WholeWord icon + count — so the affordance is recognizably the same
  across apps; otherwise it falls back to the BookmarkCheck face (collect
  stays reachable when there's nothing to mark).
- **Passive badge probe**: the count is fetched when the paused bar shows
  (and re-fetched on seek-while-paused and after the sheet closes), via
  `flicktionary-declaration-preview` with `readOnly: true`. Read-only
  resolution (`resolveExistingFlicktionarySession`: cache → `lookupForVideo`
  probe, NEVER find-or-create — pausing is not an explicit act and must not
  create a session). All passive failures are silent (no session → no badge);
  a `checkpointSupported: false` response latches the unsupported hide before
  any press. Probes are keyed by segment index and guarded by a request id.
- **Playback→segment mapping is CONTENT-SIDE**: the background session cache
  stores no timings. The controller picks the last
  `subtitleController.subtitles[]` cue with `startMs <= currentTimeMs`
  (between cues → the last ended one); its `index` IS the ingested segment
  index — the run's frontier, snapshotted at tap.
- **Sheet** (`declaration-sheet.tsx`, rendered by `ShadowVideoOverlayApp`
  OUTSIDE the pause-visibility gate so it survives play/pause; centered dark
  panel + scrim in the controls shadow host, remounted per open via a bumped
  `runKey`): step state lives in the shared pure reducer
  `@flicktionary/core/utils/checkpoint-sweep-sheet-state` (extracted from the
  web sheet — both apps share transition/undo semantics). Both steps open
  included: the tap IS the checkpoint act; the sweep learns its inclusion
  from the async preview and auto-skips when the exact count resolves to 0 or
  the profile isn't `ready`. Dismissal is blocked while a mutation is in
  flight; the done step auto-closes after ~4s. Because the extension can't
  know `reviewed_until` client-side, an empty-span collect (success with
  `checkpointId: null`) gets honest "all caught up" done copy keyed on the id,
  never on the result object.
- **Messages/handlers**: on open, `flicktionary-declaration-preview`
  (`declaration-preview-handler.ts`) resolves the session (find-or-create —
  the tap is an explicit act) and fetches `getCheckpointPreview` +
  `getMarkKnownPreview` in one round trip; lanes degrade independently
  (failed checkpoint preview → collect proceeds blind without a count; failed
  mark-known preview → the optional sweep silently drops for this run). A
  NOT_FOUND from either preview (session deleted in the web app) evicts the
  cache entry and re-resolves once. Confirm sends the existing
  `flicktionary-collect-checkpoint` (empty `previewedSpans`; saved highlights
  are suppressed server-side); the sweep sends `flicktionary-mark-known`
  (`markRemainingKnown`), its undo `flicktionary-unmark-known`
  (`unmarkKnownBySession` with the press's `sweepBatchId`), checkpoint undo
  the existing `flicktionary-undo-checkpoint`. Every response tolerates
  `undefined` AND rejection (background mid-reload; Firefox promise-only
  API) — command callbacks never throw into the sheet.
- **Conflict**: a concurrent pointer advance (another tab / the web reader)
  rejects the collect with 409; the handler detects it via
  `ORPCError.code === 'CONFLICT'` (the payload carries no domain code) and
  the sheet shows an inline "reading position changed" retry that re-snapshots
  the frontier from playback AND re-fires the preview so both counts re-key
  (request-id-guarded; a failed re-fetch degrades to countless-but-usable
  rather than tearing down a mid-flight run).
- **Visibility**: shown whenever a subtitle track is loaded and a video
  context is prepared. The target language is unknown before first
  registration (the backend detects it), so pre-emptive hiding is impossible —
  except via the cache: a one-shot `flicktionary-checkpoint-availability`
  probe (cache-only, no network) hides the button when the CACHED session's
  language has no wiktionary data; an UNSUPPORTED_LANGUAGE outcome (coded
  error, `checkpointSupported: false` preview, or a press) latches the same
  hide. Cold-start outcomes mirror the save flow — UNSUPPORTED_LANGUAGE /
  NEEDS_ONBOARDING / MISSING_CEFR — reported through the feedback chip.
- **Feedback chip** (`CheckpointFeedbackChip`, also outside the
  pause-visibility gate, ~8s lifetime owned by the controller): info/error
  only — "Nothing to collect yet.", unsupported notice, coded errors. The
  success/undo affordance lives in the sheet's done step (combined Undo:
  sweep then checkpoint, partial failures kept on screen with per-part
  retry; a stale checkpoint undo (`undone: false`) reports the credits as
  kept, never an error).
- **No claims sheet** in the extension (phase-1 scope): backlog
  known-assertions are web-only; `backlogCandidates` from the collect
  response are discarded.

### Native caption control (YouTube CC button)

On YouTube, once subtitles load, the player's own CC button (and YouTube's
`c` shortcut) becomes the user-facing subtitle toggle, Language-Reactor-style:
the overlay hides its own toggle button (`subtitleToggleHidden` model flag)
and YouTube's caption rendering is suppressed
(`.ytp-caption-window-container { display: none !important }`, injected by the
page script) so only the extension overlay draws.

Mechanics — a self-negotiating document-CustomEvent protocol between
`NativeCaptionsController` (content, per binding) and the page script:

- `asbplayer-native-captions-bind` (content → page): sent from
  `_updateSubtitles` whenever subtitles load on a page-script site. The page
  starts observing its native control and applies rendering suppression.
  Sites whose page script doesn't implement the protocol never respond, so
  everything falls back to the overlay toggle + global setting — no per-site
  flag needed.
- `asbplayer-native-captions-state` (page → content):
  `{ available, on }`. Availability means the `#movie_player` API
  (`isSubtitlesOn`/`toggleSubtitles` — unofficial, but same shape as the
  documented iframe player API) is present and the CC button is rendered,
  visible and not `aria-disabled` — YouTube hides it on videos without native
  tracks (e.g. a local file loaded on a caption-less video), in which case the
  overlay toggle stays. Published from a `MutationObserver` on the button's
  attributes (`onApiChange` does NOT fire on caption toggles), re-attached from
  the page script's existing 500 ms interval because SPA navigations can
  replace the button node and silently kill the observer.
- `asbplayer-native-captions-set` (content → page): flip the native control
  via `toggleSubtitles()`. The resulting state event is what updates the
  extension, so the native player remains the single source of truth.
- `asbplayer-native-captions-unbind` (content → page): drop suppression; sent
  on subtitle reset/unbind. The native CC on/off state is deliberately left
  as-is (it matches what the user last saw). An unbind whose video id differs
  from the bound one is the SPA-navigation reset: it transitions straight into
  a provisional hide for the incoming video (below) instead of revealing.
- `asbplayer-native-captions-decline` (content → page): the auto-sync decision
  resolved to "load nothing" for the current video — release the provisional
  hide. Sent from every no-load exit of `_setSyncedData` (no matching track,
  sync failure, auto-sync off, no data, global switch off), but only by the binding whose video
  sits under `#movie_player` (a Shorts/preview binding declining would flash
  the captions the main pipeline is about to replace). Ignored while bound.

**Provisional suppression (no native-caption flash):** the subtitle pipeline
(content-script boot → track-list fetch → srv3 fetch + parse) runs a second or
two behind YouTube's own caption renderer, so with CC on the native captions
would flash before the overlay takes over. The page script therefore hides the
caption window the moment it detects a desktop `/watch` video — at
document_start, before knowing whether the extension will bind — and reveals
it again only when the takeover doesn't happen: the decline event above, or a
10 s timeout as a safety net so an extension failure can never leave native
captions permanently hidden. Watch pages only (m.youtube.com and Shorts never
bind the native control, so a provisional hide there could not be reliably
released); `bind` converts the provisional hide into the bound suppression
with no visible transition.

Visibility state model: the native state lands in
`SubtitleController.displaySubtitlesOverride`, a **per-video layer over the
global `streamingDisplaySubtitles` setting** (`effectiveDisplaySubtitles =
override ?? setting`). The setting is never written from the native path — the
CC button is video-local by design, so toggling it must not affect other tabs
or sites. Who wins on first contact depends on how the subtitles loaded
(`userRequested`, threaded from `_syncSubtitles` through
`Binding.loadSubtitles`):

- **Explicit load** (dialog confirm, Open Files, drag-and-drop, Generate):
  the native control is forced ON — the user just loaded subtitles and must
  see them even if their YouTube CC preference was off.
- **Automatic load** (video-language auto-sync on page load / SPA
  navigation): the native control's own state is **adopted**. YouTube
  persists the CC choice across reloads and videos, so the toggle survives a
  hard reload; pushing our state here instead would overwrite that memory and
  make CC appear to reset on every reload — this adoption is also what keeps
  auto-load-on-every-video non-intrusive (subs load hidden while CC is off).

`Binding.toggleSubtitles()` is the single entry point for the overlay button
and the `toggleSubtitles` keybind: it flips the native control when it's in
charge, else sends the classic `toggle-subtitles` runtime message (global
setting + broadcast).

### Native track mirroring (YouTube gear → Subtitles/CC menu)

While the native control is bound, YouTube's own subtitle menu (including
Auto-translate) also selects the track the extension loads, and the extension
mirrors its loads back so the menu's checkmark shows what is actually playing.
Track identity across the two worlds is the **(lang, asr, tlang?) triple**
(pure mapping helpers + the per-event decision logic live in
`services/native-track-selection.ts`, unit-tested): it maps onto the published
track list via the same identity the page script dedupes on
(language + asr-ness), with Auto-translate corresponding 1:1 to the
`${tlang}_from_${lang}` machine-translation variants.

Two more protocol events:

- `asbplayer-native-captions-track-selected` (page → content): the user picked
  a track in the native menu. Detection is a `PerformanceObserver` on
  `resource` entries — every native track change fetches `/api/timedtext`
  carrying the triple in its query string. (Patching `window.fetch` misses
  these: YouTube captures its network functions at boot, before a
  content-script-injected patch lands. `getOption('captions','track')` can't be
  read lazily either — it returns `{}` while CC is off.) The extension's own
  subtitle fetches always carry `fmt=srv3` and are filtered out; the native
  player requests json3.
- `asbplayer-native-captions-select-track` (content → page): write-back. Sent
  from `_recordSyncedTracks` after every successful sync whose slot-1 track
  exists in YouTube's world (skipped for local files, generated transcripts and
  Empty — the menu is left alone); the page script applies it via
  `setOption('captions','track', { languageCode, kind?, translationLanguage? })`.
  The write is **deferred while captions are toggled off** and (re-)applied on
  every CC-on edge: `setOption` while captions are off force-enables them
  (live-probed 2026-07-10), which would clobber the adopted CC-off state.

Rules, in both directions:

- **Extension auto-sync stays the initial source.** The page script only
  forwards selections while **armed for the current video** (armed on
  bind/write-back, disarmed on unbind or video-id change). This rejects
  YouTube's own persisted-track fetch during the page-load / SPA-navigation
  window before the extension has loaded anything — the video-language
  auto-sync, second track and human-translation pairing all survive, and the
  write-back then aligns the native menu to what actually loaded.
- **The native menu owns slot 1 only.** Slots 2/3 survive a native switch. The
  dialog's translation-toggle overlay track (the appended 4th confirm track) is
  tied to the previous primary and does not survive; the persisted
  `streamingTranslationMode` reconstructs it on the next dialog confirm. For
  a dual base+translation load, write-back mirrors slot 1 (the base track).
- **Session-local, like the CC button**: a native pick never writes
  `streamingLastLanguagesSynced` (the dialog's remember toggle — hidden on
  YouTube, where the video-language policy ignores that setting anyway —
  stays the only writer). A picked Auto-translate target IS recorded into
  `streamingPages.youtube.targetLanguages` (same as a dialog confirm) so future
  videos publish its `>> code` variants — that list offers, it never auto-loads.
- **Any Auto-translate target works**, remembered or not: an unpublished
  `${tlang}_from_${lang}` variant is synthesized from the base track and merged
  into the published list after a successful load, so the reopened dialog can
  represent it (it resolves loaded tracks against that list only).
- **Echo-proof and serialized**: on the page side, only fetches matching the
  player's *current* selection (`getOption('captions','track')`) are forwarded
  — this drops YouTube's CC-on restore fetch of its own persisted track (the
  deferred write-back applied on the same CC-on edge wins: microtask vs
  network) and superseded fetches from rapid menu picks. On the content side,
  selections equal to the loaded or currently loading track are dropped
  (write-back itself triggers a native re-fetch), concurrent selections are
  serialized latest-wins per binding, pending work is cleared on video
  change/unbind, and only the binding whose video sits under `#movie_player`
  reacts (Shorts/preview bindings ignore the event).

Supporting fix shipped with this: `_syncSubtitles` awaits
`Binding.loadSubtitles`, so `_recordSyncedTracks`/write-back run only after a
load actually succeeded (and after `activate()` has bound the page), and load
failures surface through the sync error path.

### Other shadow surfaces

- **Notification** — fullscreen-aware modal for update alerts/errors; pauses the
  video and hides subtitles while open.
- **Video select** — when a page has several `<video>` elements, a thumbnail
  picker (visible-tab capture, cropped per video) chooses which one to bind.

### Global on/off switch

A sticky, profile-independent kill switch for everything the extension does on
video pages — for users who want it out of the way without uninstalling. The
master switch sits at the top of both popup variants (`ExtensionEnabledRow`);
on-video, the controls overlay's power button turns it off and its disabled
pill turns it back on, so both directions live in the same bar (see "Controls
overlay").

- **Storage:** `flicktionary.extensionEnabled.v1` in `chrome.storage.local`
  (`extension-enabled-storage.ts`, same out-of-band pattern as auth/devTools —
  deliberately NOT a setting, so profile switching and settings import/export
  can never re-enable the extension). Default on. Changes propagate everywhere
  via `browser.storage.onChanged` subscriptions — no message round-trips: the
  content script fans the flag out to every `Binding`
  (`Binding.setExtensionEnabled`) and the `VideoSelectController`; the
  background regrays the toolbar icon (`applyActionIcon`, gray `icon*-gray.png`
  variants, re-applied at background startup since `setIcon` doesn't persist
  across service-worker restarts).
- **Off gates** (soft gate — the Binding and its invisible plumbing stay
  alive): subtitle overlay cleared (`_resetSubtitles`), native captions
  un-suppressed (`nativeCaptionsController.deactivate()` → CC button handed
  back), track dialog dismissed (`dismissDialog`, without unbinding its
  synced-data listener), notifications hidden, play mode reset to normal, key
  bindings + drag-drop unbound, and early returns in `loadSubtitles` /
  `_updateSubtitles` / `showVideoDataDialog` / `toggleSubtitles` /
  `VideoSelectController._trigger`. The disabled branch of `_refreshSettings`
  keeps all of this true against later `settings-updated` broadcasts (e.g. a
  profile switch) and binds the overlay in disabled-pill mode regardless of
  `streamingEnableOverlay`. New bindings (SPA navs, late videos) read the flag
  at construction and boot directly into disabled mode.
- **No new subtitle loading while off, but `requestSubtitles` still runs:**
  the gate lives in `_setSyncedData` as a no-load exit so
  `_declineNativeCaptions()` fires per video — releasing the page script's
  provisional native-caption hide in under a second instead of its 10 s safety
  timeout (see "Native caption control").
- **Stays live while off:** the popup, article import (own content script),
  pairing, context menus (video-facing entries no-op via the per-binding
  gates), heartbeat/tab-registry plumbing.
- **Re-enable** (popup switch or overlay pill): the normal bind pipeline
  re-runs (`_refreshSettings` + `requestSubtitles`), so subtitles auto-reload
  and native-caption suppression re-activates adopting the current CC state.

### Popup

Two variants, switched by the active tab's URL (`popup-ui.tsx`):

- **On a supported video page:** OPEN APP + USER GUIDE header (→ Flicktionary
  web app / its public `/user-guide` page), the global on/off master switch,
  pairing section, the full embedded settings form, and the settings-profile
  switcher.
- **On any other page:** the same header, the same master switch, pairing
  section, **"Import this article"**, and slim Misc (theme/language) + About
  tabs.

Both variants also show a **"Finish setup"** section
(`FlicktionaryFinishOnboardingSection`) when paired with `isOnboarded === false`
(a user who paired without completing web onboarding — saving would fail and the
web gate walls them): a CTA that opens the **pairing tab**
(`openFlicktionaryPairingTab`), NOT the bare app. That tab re-runs pairing,
renders onboarding in the `extensionPair` variant, and on completion the
extension closes it and the browser returns the user to the tab they came from
(opener-tab return) — so "finish setup" never dead-ends on the app. There is
**no** second native-language picker in the popup — web onboarding is the single
onboarding surface, so the popup can't drift when onboarding grows past native
language. Keyed on `!isOnboarded`, NOT `nativeLanguage === null`, so a user who
already set native language via the retired inline picker (while `is_onboarded`
stayed false) still sees it. Popup open also refreshes the UI prefs from the
server (one shared `getPrefs` per open, memo invalidated on auth change).

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

A `MISSING_CEFR` failure (the detected language has no CEFR level yet) is
handled in-context, not dead-ended: the **popup** import surfaces an inline
A1–C2 picker (same recovery shape as the in-video CEFR picker), sets the level
via `userPrefs.setCefrForLanguage`, and replays the import once (an `isCefrRetry`
flag prevents looping). The **context-menu** import has no popup to host a
picker, so it keeps toasting — with copy pointing the user at the extension
popup to set their level there. The import service threads a `presentation:
'popup' | 'contextMenu'` flag so the same path can surface either way.

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
(copy/export/screenshot/record, token marking, side panel) are gone. The
`KeyBindSet` is bound on `document` in the capture phase; a shared guard skips
every shortcut while a text field is focused (`INPUT` / `TEXTAREA` / `SELECT` /
contenteditable), detected via `event.composedPath()` so it sees fields inside
the overlay's shadow root despite event retargeting — otherwise typing in the
saved-highlight note textarea triggers seek/play. The note textarea additionally
stops its own native keyboard propagation so the host site's shortcuts (YouTube
space/`j`/`k`) don't fire either.

### FTUE

First install opens the web app's public `/extension-welcome` page in a new
tab (`onInstalled` INSTALL branch → `${webUrl}/extension-welcome`), and the
background sets the same URL as the runtime uninstall URL. There is no bundled
welcome page: the web page detects this browser's install via the marker
content script and walks the user through pinning and pairing (its
marker-absent state is the install pitch, doubling as the post-uninstall
page). The upstream interactive tutorial (bundled video + SRT,
`asbplayer-tutorial-page.ts`, scroll-triggered walkthrough bubbles) was
removed 2026-06 — the web app's user guide replaced it. The
`ftueHasSeenSubtitleTrackSelector` first-run hint in the track-selector dialog
is unrelated and stays.

## Backend API surface (preserve or stub)

All via the oRPC client (`@flicktionary/api-client`) against `VITE_API_HOST`:

| Procedure | Used for |
|---|---|
| `extensionAuth.bootstrapPrefs` | primary target language after pairing |
| `extensionAuth.revokeSession` | sign-out |
| `extensionAuth.setCefrLevel` | CEFR picker |
| `glosses.fastGloss` | hover gloss `{gloss, pos, register, ipaDisplay, ipaLemma}` (the overlay relays the server-picked `ipaDisplay`, not the `ipa` bag; `ipaLemma` labels the IPA with its lemma on form-of fallback) |
| `studySessions.findOrCreateForYoutubeVideo` | session registration on a video's first save (YouTube, deduped on video id) |
| `studySessions.findOrCreateForStreamingVideo` | session registration on a video's first save (all other platforms) |
| `studySessions.lookupForVideo` | lookup-only session resolve for saved-highlight loading and the passive badge probe (never creates rows; `data: null` = no session) |
| `studySessions.importText` | article/selection import |
| `studySessions.getCheckpointPreview` | declaration preview: pending review count + `supported` flag |
| `studySessions.getMarkKnownPreview` | declaration preview + paused-bar badge: markable-word count for the span |
| `studySessions.collectCheckpoint` | declaration sheet confirm (implicit review credits up to the frontier) |
| `studySessions.undoCheckpoint` | combined Undo, checkpoint part |
| `studySessions.markRemainingKnown` | declaration sheet sweep step (bulk `known_lemmas` marks) |
| `studySessions.unmarkKnownBySession` | combined Undo, sweep part (batch-scoped) |
| `highlights.create` | saving a word/chunk, optionally with the preview `{gloss, pos, register}` persisted as `fastGloss` |
| `highlights.listBySession` | loading saved highlights for the persistent spans |
| `highlights.fastGloss` | saved-mode popover gloss for direct/older saved-highlight opens (server-cached, IPA-enriched) |
| `highlights.updateNoteAndTags` | saved-mode note + preset tags (+ chatSeedPrompt) |
| `highlights.delete` | Remove highlight from the saved-mode popover |
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
| `chrome.storage.local` | settings + profiles (`ExtensionSettingsStorage`), global state (FTUE flags), `flicktionary.auth.v1` session, `flicktionary.devTools.v1` admin debug toggles, `flicktionary.extensionEnabled.v1` global on/off switch, cached target language, pairing nonces |
| IndexedDB `asbplayer-transcript-cache` | generated Whisper SRTs per video id |
| In-memory only | gloss query cache (`glossQueryClient`, cleared on auth change), session/segment-id cache, saved-highlights store (per overlay mount) |

No learning data is stored locally; highlights live in the backend. The
session/segment-id cache (`flicktionary.session-cache.v3` in
`chrome.storage.local`; entries also carry the detected `targetLanguage`) is
evictable per video (`removeFlicktionarySession`):
the saved-highlights loader and the declaration-preview handler evict an
entry whose session no longer resolves (deleted in the web app) and
re-resolve via `lookupForVideo`.

## Verification golden path

`pnpm build` (or `pnpm dev`) → load on a YouTube video with subs:

1. Subtitles auto-load in the video's own language (human track preferred,
   else ASR; a video in another language loads that language) with NO backend
   write (check Network: no find-or-create; the web app's sessions list stays
   clean). No loadable language → nothing loads, no dialog.
2. Hover a word → gloss popover shows **and dismisses**; moving onto the
   popover doesn't resume playback.
3. Right-click save creates the session (first save = find-or-create) plus a
   highlight (verify in the backend / web app) and the saved span paints
   immediately (teal underline).
3a. Reload the page → the span reappears (cache); clear
    `flicktionary.session-cache.v3` from `chrome.storage.local` → it reappears
    via `lookupForVideo` with NO find-or-create issued (check Network). Click
    the span → saved popover: gloss renders, note edits persist to the web
    app, Remove syncs to the web app. Delete the session in the web app →
    reload → clean empty + cache evicted. Signed out → nothing painted.
4. An unsupported-language video: first save attempt toasts the one-time
   notice; saving disabled for the rest of the video, gloss still works.
5. Pause → controls overlay appears; toggle-subtitles works.
6. Popup: pairing status, settings tabs, profile switching/deletion.
7. On a news article: popup import creates a session.
8. Theme: default System follows the OS (flip the OS theme live — popup,
   options, and shadow overlays follow); explicit Light/Dark sticks. Language
   System follows the browser locale; explicit Français switches the UI.
9. Sync: pair with server-NULL prefs → local values pushed (PUT in Network);
   pair with server-set prefs → local pulled; change theme/language while
   paired → PUT fires; a second browser pulls on popup open.
10. Onboarding: pair a **not-onboarded** account → web onboarding renders in the
    pairing tab → complete → tab closes and focus returns to the page you paired
    from. Pair an **already-onboarded** account → tab closes immediately. A
    paired-but-not-onboarded account (incl. native language already set) → the
    "Finish setup" CTA shows in both popup variants and opens web onboarding
    (keyed on `!isOnboarded`). Force a prefs-load failure on the pairing tab
    (offline) → error/retry + manual "Return to the extension" fallback instead
    of hanging; confirm the finished handshake closes only the paired tab.
11. Global switch: toggle off in the popup on a YouTube video with extension
    subs → overlay vanishes, native captions + CC button work natively again,
    toolbar icon grays; reload while off → native captions render with only a
    sub-second provisional flash (no 10 s gap); pause → single logo pill at
    the bar's position → click → subs reload and the full bar returns;
    profile switching while off does not re-enable; both states survive a
    browser restart.
12. **Firefox build** (`build:firefox`, `web-ext run`) — smoke-test manually;
    Firefox-only failure modes (Xray wrappers, promise-only `sendMessage`) are
    invisible to CI. For this feature: matchMedia in popup/options AND inside
    shadow-DOM overlays, `.dark` toggling on shadow roots, orpc sync calls,
    the pairing-tab `flicktionary-pair-finished` handshake + tab close.

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
  Concretely: `SubtitleOverlayApp` must provide `PortalContainerContext` =
  `popoverContainer`, or shared components that portal via context (the Radix
  tooltip on `StudySkillCards`) fall back to `document.body` and render
  unstyled/transparent. `popoverContainer` is also marked `dark` + max z-index so
  portalled chrome — a sibling of the hardcoded-dark popover content — resolves
  the dark token scope and stacks above the popover, not under it.
- Don't trust "mobile" in inherited names — check the actual gating before
  removing anything.
- Settings schema is strict both ways (see "Settings" above).
- Never call `i18n.activate()` in a render body (use an effect).
- A subtitle track id (`language:label:url`) is NOT stable on YouTube: the URL
  carries per-request signed params (`signature`/`expire`/`pot`), and the page
  script republishes (get-synced-data requests + the 500ms videoId-change
  watcher) with freshly-signed URLs — the same logical track changes id across
  publish generations. Never persist or compare raw ids across publishes; use
  language + asr-ness (see `services/synced-track-resolution.ts`).
