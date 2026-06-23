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
settings export. On success the page shows a brief "Pairing complete — closing
this tab…" message, then the background handler removes the pairing tab after
~1.5s (the page can't close itself — `window.close()` only works on
script-opened windows — so the background closes the tab it opened);
`start-pairing.ts` sets `openerTabId` to the tab the user paired from, so the
browser re-focuses it on close. The popup shows the paired email + sign-out
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
segment-index → `text_segments.id` map plus the detected `targetLanguage`,
cached per `(source, contentHash)` (`youtube-session-cache.ts`, storage key
`flicktionary.session-cache.v3` — the v3 bump dropped v2 entries instead of
migrating; re-registration is idempotent) so saves are a single round trip.

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
resolves to an exact `text_segments` row + offsets. The tokenizer locale is the
session's server-detected subtitle language (delivered by the saved-highlights
load / the first save's response, held in the saved-highlights store), matching
what the web reader passes for the same text — `Intl.Segmenter` word rules are
locale-sensitive, so this keeps word boundaries (and saved offsets) identical
across platforms; `''` (locale-less) is the fallback until the language is
known, and the re-tokenization when it lands is safe because saved-span paint
uses intersection, not exact offsets.

- **Hover gloss** — hovering a word (300 ms debounce) calls `glosses.fastGloss`
  (selection + context line + the video's detected target language, see the
  query-key note below) and shows a floating tooltip (the shared
  `FloatingSheet` desktop popover, portaled into a separate non-transformed
  popover shadow host): word, IPA
  (the server-picked `ipaDisplay` string — the backend resolves the user's
  `english_ipa_dialect` pref, so the overlay shows the same dialect as the web
  app; no client-side bag picking), one-line gloss, POS and register badges.
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
  even for a user whose primary target language is Spanish; while the overlay
  doesn't know it yet ('' in the key), the background falls back to the user's
  primary target language, and the detected language landing changes the key
  so a fallback-language gloss is never served from cache. The key still omits
  the auth/native-language context the background derives, so the client is
  **cleared on any auth change**; the background's target/native-language
  cache also resets on auth change (`resetFlicktionaryLanguageCache` — to
  `undefined`, not `null`, which would mean a known "no language" and skip the
  refetch). Nothing is persisted.
  **Pin-on-entry:** a gloss that the pointer never enters keeps the light
  hover-out dismissal (150 ms grace; quick lookups stay friction-free), but
  once the pointer ENTERS the popover it is pinned — pointer-leave no longer
  hides it (no more losing the Study options to a stray mouse move). A pinned
  gloss dismisses on outside pointerdown (same gesture as the saved-mode
  popover; right-button presses are exempt — right-click is the save/remove
  toggle and morphs the popover instead), play, cue change, overlay hide, or
  by hovering another word (the new gloss replaces it and starts unpinned).
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
  intentional drag shouldn't die to a stray hover-out; outside pointerdown /
  play / cue change / hovering another word dismiss it), with the word-ordinal
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
  "Sign in" action; registration-failed → disabled Save with the reason. The
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
- **Two commit lanes (pre-save note editor)** — web parity. The preview tooltip
  carries an **Add note** affordance beside Save; tapping it opens the shared
  `HighlightNoteEditor` (textarea + preset chips) and the footer shows both
  **Save** and **Save note**. **Save** is the main lane (full card; a typed note
  rides along and seeds the chat). **Save note** is the **note-only** lane: the
  `save-word` message carries `noteOnly: true` (+ `note` / `presetTags` /
  `chatSeedPrompt`), `highlights.create` makes an empty stub card + seeds the
  chat with NO enrichment / study facets, and the card stays data-less until the
  user generates it in the web app (it can't be kept into Vocabulary/Practice
  until then). The note fields ride `SaveWordParams` → the `save-word` message →
  `highlights.create`, alongside `studyIntent` (ignored in the note-only lane),
  and survive the CEFR-picker retry via `pendingSave`.
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
    offers the same textarea +
    preset tags as the web and composes the same localized `chatSeedPrompt`
    (`update-flicktionary-highlight-note` → `highlights.updateNoteAndTags`).
    Like the web sheet, **the note/presets seed the card chat exactly once and
    lock on save**: a committed note/preset set renders the editor read-only
    (saved note + selected chips, dimmed + non-interactive, lock caption) and
    the footer collapses to the cyclable **Saved** control with no `Add/Edit
    note` — the seed
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
    extension has none); there is no Save here. A STICKY saved popover wins over the hover
    preview (the preview neither opens over it nor renders while it's up); a
    hover-opened one yields to hovering other words. Sticky dismissal is
    outside pointerdown (composedPath — shadow root; right-button presses are
    exempt — right-click is the toggle and morphs the popover instead), play,
    cue change, or overlay hide — never pointer-leave (it has a textarea).
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
control bar over the video on pause: load/toggle subtitles, playback-mode
switches, offset/playback-rate/subtitle-navigation scroller. Desktop feature —
despite its upstream "mobile overlay" ancestry. It shows whether or not
subtitles are synced (`emptySubtitleTrack` model state) — it hosts the Load
Subtitles button, the only path back into the track dialog, so gating it on
synced would strand users who cancel the dialog. The show is deferred by a
250 ms grace period (cancelled by `play`): Prime/Netflix players pause/resume
internally around seeks, and reacting to the raw `pause` event made the
controls flash on every subtitle navigation — or stick on screen mid-playback
when the async model push landed after the play-event hide.

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
| `glosses.fastGloss` | hover gloss `{gloss, pos, register, ipaDisplay}` (the overlay relays the server-picked `ipaDisplay`, not the `ipa` bag) |
| `studySessions.findOrCreateForYoutubeVideo` | session registration (YouTube, deduped on video id) |
| `studySessions.findOrCreateForStreamingVideo` | session registration (all other platforms) |
| `studySessions.lookupForVideo` | lookup-only session resolve for saved-highlight loading (never creates rows; `data: null` = no session) |
| `studySessions.importText` | article/selection import |
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
| `chrome.storage.local` | settings + profiles (`ExtensionSettingsStorage`), global state (FTUE flags), `flicktionary.auth.v1` session, `flicktionary.devTools.v1` admin debug toggles, cached target language, pairing nonces |
| IndexedDB `asbplayer-transcript-cache` | generated Whisper SRTs per video id |
| In-memory only | gloss query cache (`glossQueryClient`, cleared on auth change), session/segment-id cache, saved-highlights store (per overlay mount) |

No learning data is stored locally; highlights live in the backend. The
session/segment-id cache (`flicktionary.session-cache.v3` in
`chrome.storage.local`; entries also carry the detected `targetLanguage`) is
evictable per video (`removeFlicktionarySession`):
the saved-highlights loader evicts an entry whose session no longer lists
(deleted in the web app) and re-resolves via `lookupForVideo`.

## Verification golden path

`pnpm build` (or `pnpm dev`) → load on a YouTube video with subs:

1. Subtitles load (auto-sync or dialog) and the registration call succeeds.
2. Hover a word → gloss popover shows **and dismisses**; moving onto the
   popover doesn't resume playback.
3. Right-click save creates a highlight (verify in the backend / web app) and
   the saved span paints immediately (teal underline).
3a. Reload the page → the span reappears (cache); clear
    `flicktionary.session-cache.v3` from `chrome.storage.local` → it reappears
    via `lookupForVideo` with NO find-or-create issued (check Network). Click
    the span → saved popover: gloss renders, note edits persist to the web
    app, Remove syncs to the web app. Delete the session in the web app →
    reload → clean empty + cache evicted. Signed out → nothing painted.
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
- A subtitle track id (`language:label:url`) is NOT stable on YouTube: the URL
  carries per-request signed params (`signature`/`expire`/`pot`), and the page
  script republishes (get-synced-data requests + the 500ms videoId-change
  watcher) with freshly-signed URLs — the same logical track changes id across
  publish generations. Never persist or compare raw ids across publishes; use
  language + asr-ness (see `services/synced-track-resolution.ts`).
