# Automated product screenshots

> **Status: historical** (archived 2026-07-06). The pipeline this proposed is implemented in `packages/screenshots/` — see its README for how to run it and the recipes that survived. Kept for the design rationale; the open questions below resolved as: screens = sessions list, video+text readers (gloss sheet open), session vocabulary, focus view with chat, practice exercise (correct-answer state) + flashcard, vocabulary tab, plus extension overlay/gloss/saved/multi-word shots on a German (manual `de-DE` track) and a Spanish (ASR) video; data = a dedicated `demo@flicktionary.app` account seeded through the real API + enrichment pipeline (SQL only for practice due-states); languages = German + Spanish; presentation = raw 1280×800 captures plus per-shot cropped variants written into `apps/landing/src/assets/`; on-demand only; localized screenshots out of scope; the track-dialog mount failure stayed un-root-caused (the auto-sync seeding path makes it irrelevant).

## Problem

The landing page (`apps/landing/src/assets/*.png`, imported by `src/pages/index.astro`) and the Chrome Web Store listing carry hand-taken screenshots that go stale every time the UI changes. Retaking them by hand is slow enough that it doesn't happen.

Rejected alternative: rendering live app components inside the Astro landing page. The screenshot-worthy surfaces are feature views coupled to TanStack Router / React Query / oRPC / auth — embedding them means a permanent mock-provider harness, and it turns "screenshot is stale" into "marketing page is broken". Astro itself is fine and stays.

Direction instead: **screenshots as a build artifact** — a Playwright script drives the real app against the dev-tunnel stack and writes PNGs on demand. One command refreshes everything; the Chrome Web Store upload stays manual (its publish API cannot update listing screenshots), but regenerating the files is the automatable 90%.

## What exists (proven, spike-grade)

`packages/screenshots/src/shoot-extension.mjs` (`pnpm --filter @flicktionary/screenshots shoot:extension`; prereqs in the package README) runs the full extension flow unattended in ~50s and produces 1280×800 captures: paired popup, fullscreen video with the tokenized subtitle overlay, hover-gloss popover (live backend gloss + study-skill cards), saved-highlight popover. Verified 2026-07-05 against the dev tunnel.

The recipes that make it work (hard-won; keep):

- **Web sign-in without email round-trips.** Local Supabase admin `generateLink({type:'magiclink'})` at `http://127.0.0.1:34321` (the local demo secret is hardcoded in `apps/backend/src/config/environment-config.ts`), then drive `/login/email/verify?token_hash=…` and click `Verify`. No Inbucket scraping, no OAuth.
- **Pairing is scriptable as-is.** Open `chrome-extension://<id>/popup-ui.html` in a tab, click `Sign in with Flicktionary`; the nonce → mint → postMessage → verifyOtp flow completes in ~1s. The dev build (`build:dev`) bakes in the dev-tunnel web URL, and the pair content script matches `*.flicktionary.dev`.
- **Skip the track dialog; seed auto-sync.** Write `chrome.storage.local.streamingLastLanguagesSynced = {'www.youtube.com': ['<lang>']}` via the service worker before opening the video; `streamingAutoSync` then loads the track silently. The prompt-on-failure dialog mounts unreliably under automation — the page-script handshake works (verified: request answered with tracks in ~200ms), but the `data-asbplayer-video-data-sync-host` often never appears. Root cause not found; the seeding path makes it irrelevant. Do **not** "nudge" by re-firing `loadedmetadata` on the video — that tears down the whole binding.
- Overlay shadow roots are all `mode:'open'`, so Playwright locators pierce them; word spans are `[data-word]`; `click({button:'right'})` triggers the save toggle.
- YouTube chrome: consent-dialog buttons need a JS text-match click (not `getByRole`); pre-roll ads are skipped by polling `.ytp-skip-ad-button`; the watch-history nag and YouTube's own caption renderer (double-renders behind the overlay) are dismissed before capture; `f` fullscreens for clean frames.
- Chromium must be headed (`headless: false`) for extension loading. The persistent `user-data/` profile keeps sign-in, pairing, and consent dismissal across runs, so iteration is fast.

Known side effect: the save step creates a real highlight → enrichment job → card on the signed-in account.

## Remaining work

1. **Web-app capture script** (`shoot-web.mjs`) — the easier and higher-value half: same sign-in trick, then walk Sessions / reader with gloss sheet open / session vocabulary / focus view / Practice queue / Vocabulary, capturing straight into `apps/landing/src/assets/` (Astro's image pipeline optimizes at build). Needs desktop and possibly mobile-viewport variants.
2. **Seeded demo data.** Screenshots are only as good as the data on screen. A seed script should provision a demo account with curated fixtures (nice sessions, an appealing vocabulary list, a mid-state practice queue, a card with chat) instead of LLM-generated noise, so every run renders identically.
3. **Shot manifest.** Replace the spike's heuristics (longest word on screen) with a declarative list: per shot — surface/route or video ID, timestamp, exact word to hover, viewport, output name/destination. The manifest is where "which screens do we want" (open question below) gets encoded.
4. **Extension-script hardening.** Curate video + track (the spike's default video only has an ASR track, so word quality is luck — ASR garbage like `Идуть` happens); consider a dedicated demo account so saves don't pollute the developer's vocabulary; assert on popover content before capturing (the current script can capture the gloss skeleton if the fetch is slow). Reruns are not idempotent: right-click is a save/remove **toggle**, so a second run over an already-saved word removes it and the "saved popover" shot captures a preview instead — check the span's saved state (yellow paint / `data-highlight-id`) before toggling, or reset the account's highlights first.

## Open questions

- **Which screens?** The current landing assets are `subtitle-popover`, `vocabulary`, `practice`, `ai-chat`, `sessions`, `import-article` — decide the target set (and the Chrome Web Store set, max 5) before building the manifest. *(Owner has this one.)*
- **Demo account & data:** reuse the developer account, or a dedicated `demo@` user seeded by script? Seeding fixtures bypasses the LLM pipeline (insert cards/lookups directly) or runs it once and freezes the DB state?
- **Language of the showcased content:** Russian shows the stress-mark/Cyrillic polish but is less legible to most store visitors; Spanish or German may market better. Per-shot choice?
- **Presentation layer:** ship raw captures, or post-process (device frames, crops, captions) — and if so, where does that live (script-side compositing vs. hand-done in a design tool over the raw PNGs)?
- **When does it run?** On-demand only (current assumption), or also a CI job that diffs regenerated PNGs against committed ones to flag drift? CI needs the whole stack (backend + Supabase + tunnel or localhost equivalents) — likely not worth it yet.
- **Localized screenshots** for the store listing / landing i18n — out of scope for v1?
- **Landing integration:** captures write to `apps/landing/src/assets/` directly, or to `packages/screenshots/shots/` with a copy step? (Direct write keeps the "one command" property.)
- **The undiagnosed track-dialog mount failure** under automation — worth root-causing someday (it may indicate a real-world race on slow machines), but not a blocker for this effort.
