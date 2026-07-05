# @flicktionary/screenshots

> **Status: reference.** How to run the automated screenshot capture scripts in this folder. The design, open questions, and roadmap live in `docs/proposals/automated-screenshots.md`.

Playwright scripts that drive a real browser to capture up-to-date product screenshots (Chrome Web Store listing, landing page) instead of taking them by hand.

## `shoot:extension`

Captures the extension's in-video surfaces on YouTube: paired popup, tokenized subtitle overlay, hover-gloss popover, saved-highlight popover. Output: `shots/*.png` at 1280×800 (the Chrome Web Store size).

Prereqs:

- Dev tunnel running (`pnpm dev` — web + backend + dev-tunnel Supabase).
- A dev-config extension build: `pnpm --filter flicktionaryextension build:dev`.
- Once: `pnpm --filter @flicktionary/screenshots playwright:install` (downloads Chromium).

Run:

```bash
pnpm --filter @flicktionary/screenshots shoot:extension
```

Opens a headed Chromium (extensions can't load headless). The browser profile persists in `user-data/` so sign-in and pairing survive across runs; pass `-- --fresh` to start over. Knobs (env vars): `SCREENSHOT_EMAIL`, `SCREENSHOT_WEB_URL`, `SCREENSHOT_VIDEO_ID`, `SCREENSHOT_SEEK_S`, `SCREENSHOT_TRACK_LANG`.

Side effect to know about: the save step creates a **real highlight** on the account it signs into (dev-tunnel DB), which flows through enrichment into a card. Clean up in the app afterwards, or use a dedicated demo account.

`user-data/` and `shots/` are gitignored.
