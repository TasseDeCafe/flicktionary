# Extension customizations vs. upstream asbplayer

`packages/extension` is a **vendored fork of [asbplayer](https://github.com/killergerbah/asbplayer)**.
This file inventories everything in it that is **not** vanilla upstream, so a
future re-base onto a newer upstream asbplayer can carry the custom parts
forward and leave the rest to upstream.

> If you're upgrading: clone the target upstream version, then reapply the
> items in **Custom features** and **Custom / modified files** below. Do **not**
> reintroduce anything under **Removed vs. the standalone fork**.

## Lineage (three layers)

1. **Upstream asbplayer** (open source, killergerbah). The base. Currently a few
   versions behind what we vendored.
2. **The "word-learning" fork** — a standalone fork that added Russian/YouTube
   word-learning features on top of upstream. A copy lives at
   `~/Documents/asbplayer`; its `HANDOFF.md` documents these features against
   upstream. Relevant features were brought into this repo.
3. **The Flicktionary integration layer** (this repo) — rewires the fork's
   features to talk to the Flicktionary backend (Supabase auth + oRPC API)
   instead of a local API key + IndexedDB. This is where most of the custom
   surface area now lives.

When the prompt says "the original asbplayer," layer 1 is the re-base target;
layers 2–3 are what must be preserved.

## Structural deltas (bite first on a re-base)

These are not features but they make a naive `git merge`/copy impossible:

- **Monorepo layout.** Upstream is `extension/` + `common/` at repo root. Here
  they're `packages/extension` and `packages/asbplayer-common` inside a pnpm +
  turbo monorepo.
- **Package scope rename.** `@project/*` → `@asbplayer-fork/*`
  (`@asbplayer-fork/common`, `@asbplayer-fork/extension`). **Every import differs**
  from upstream. The standalone fork still uses `@project/*`.
- **Build tool.** WXT (`pnpm dev` / `pnpm build` → `wxt` / `wxt build`). Dev
  bundle is `.output/chrome-mv3-dev`; prod is `.output/chrome-mv3`. (`pnpm build`
  only writes the **prod** dir — when testing the dev bundle you need `pnpm dev`
  running or `pnpm build:dev`.)
- **Vite env prefix.** `wxt.config.ts` adds `VITE_` to vite's `envPrefix` so the
  Flicktionary Doppler config (`VITE_API_HOST`, `VITE_SUPABASE_*`, …) resolves;
  see `src/services/flicktionary/flicktionary-config.ts`.
- **Typecheck gate.** ~18 pre-existing `tsc --noEmit` errors exist; the real
  gate is the **WXT build**, not tsc. Diff against a baseline build before
  blaming a change.

## Custom features (carry forward)

### Flicktionary integration layer (this repo only)

- **Pairing with Flicktionary** (Supabase magic-link). The web app's
  `/extension-pair` route posts a `{ tokenHash, email, nonce }` message; a
  URL-restricted content script forwards it to the background, which runs
  `verifyOtp({ type: 'magiclink' })` and persists the Supabase session.
  Auth lives in its **own** `browser.storage.local` namespace
  (`flicktionary.auth.v1`), deliberately **outside** `SettingsProvider` so it is
  never synced or included in settings export/import.
- **Hover gloss via backend.** Hovering a word calls the stateless backend
  endpoint `glosses.fastGloss` (selection + context line + target language →
  `{ gloss, pos, register, ipa }`). Native language / hide-translation mode are
  resolved server-side from the user's prefs. Nothing is persisted; the content
  script caches in memory. Tooltip renders selection + IPA + gloss +
  POS/register badges, mirroring the web fast-gloss popover.
- **Save → Flicktionary highlight.** Right-click a word, or drag-select a chunk
  then right-click, to save. On first save for a video the extension calls
  `studySessions.findOrCreateForYoutubeVideo` (creates a `content_source` of
  type `youtube`, a `text_track`, and `text_segments`), caches the
  segment-index → `text_segments.id` map, then calls `highlights.create` with
  the segment ids + char offsets. Flicktionary (Supabase) is the **system of
  record**.
- **Register subtitles at load.** When subtitles load on a YouTube video the
  binding sends `register-flicktionary-subtitles` so the session + segment map
  are ready before the first save. It **awaits** the response: on
  `UNSUPPORTED_LANGUAGE` it shows a one-time notice and sets a save-disabled
  reason (read by `WordInteractionController` to block saves); on `MISSING_CEFR`
  it surfaces the backend message.
- **Language is detected server-side, not sent.** The extension passes **no**
  language to `findOrCreateForYoutubeVideo`; the backend runs its Haiku
  `languageDetectionPass` on the segment text and uses the result as both the
  content language and the session `target_language`. The extension keeps the
  selected YouTube caption track's BCP-47 code (set on the binding via
  `setFlicktionarySubtitleLanguageHint` from `video-data-sync-controller`, just
  before `loadSubtitles`) only to *name* an unsupported language in the notice
  (`Intl.DisplayNames`). This replaced the old `_inferFlicktionarySubtitleLanguage`
  heuristic, which read the UI-language setting and defaulted to `'en'` —
  mislabeling every video.
- **Target-language sync** (hover-gloss only now), **popup session highlight
  counter**, **YouTube context extraction** (video id / title / url / subtitle
  hash + segments — no language) — all under `src/services/flicktionary/`.
- **API client.** Uses `@flicktionary/api-client` (oRPC) with the Supabase
  access token; `flicktionary-config.ts` selects prod / dev / dev-tunnel hosts.

### Word-learning features (from the standalone fork, kept)

- **Word-click mode** (`wordClickEnabled` setting). Tokenizes subtitle text into
  `<span class="asbplayer-word" data-word data-sentence data-segment-index
  data-char-start data-char-end>` (the data-* coordinates are a Flicktionary
  addition — they let a save resolve to an exact `text_segments` row + offsets).
- **Chunk drag-select** with a selection overlay positioned inside the subtitle
  container.
- **Whisper transcript generation** — `supadata-generate-handler` +
  `transcript-cache.ts` + the `transcript-server/` FastAPI service. Generated
  SRTs are cached in **IndexedDB** (`asbplayer-transcript-cache`) and auto-loaded.
  This IndexedDB cache is **still here** — only the *saved-words* DB was removed.

## Removed vs. the standalone fork (do NOT reintroduce)

The Flicktionary migration deleted these on purpose:

- **Saved-words IndexedDB (Dexie).** `common/saved-words/saved-words-repository.ts`
  + barrel, and the `get/export/clear-saved-words` handlers. Words now go to the
  backend; there is no local fallback. (The remaining `handlers/saved-words/`
  file is just `save-word-handler.ts`, which posts to Flicktionary.)
- **Manual LLM settings + UI.** `llmEnabled`, `llmApiKey`, `llmApiEndpoint`,
  `llmModel`, the `LLMSettings` interface, and their Misc-settings tab section.
  Hover gloss is always on when word-click is enabled **and** the extension is
  paired — there is no per-user API key.
- **Direct Anthropic calls.** `handlers/llm/llm-translate-handler.ts` (and the
  `llm-translate` message) — replaced by `glosses.fastGloss`.

## Custom / modified files

### New files (Flicktionary)
| File | Purpose |
|------|---------|
| `src/entrypoints/flicktionary-pair.content.ts` | URL-restricted content script; forwards the pair message |
| `src/handlers/flicktionary/flicktionary-pair-handler.ts` | Background: Supabase `verifyOtp` + persist session |
| `src/handlers/flicktionary/gloss-handler.ts` | Calls `glosses.fastGloss` |
| `src/handlers/flicktionary/register-subtitles-handler.ts` | Find-or-create YouTube session + cache segment map |
| `src/handlers/saved-words/save-word-handler.ts` | Save highlight to Flicktionary (no local fallback) |
| `src/services/flicktionary/api-error.ts` | Extracts `{ code, message }` from a thrown oRPC error (e.g. `UNSUPPORTED_LANGUAGE`, `MISSING_CEFR`) |
| `src/services/flicktionary/*` | auth-storage, api-client, config, supabase-client, target-language, pairing-nonce-storage, session-highlight-counter, youtube-context (incl. `normalizeYoutubeLanguageCode` / `describeLanguageCode`), youtube-session-cache |
| `src/services/word-tokenizer.ts` | Subtitle tokenizer (stamps data-* coords) |
| `src/controllers/word-interaction-controller.ts` | Hover/click/drag/save + tooltip lifecycle |

### Modified upstream files
| File | Flicktionary changes |
|------|----------------------|
| `src/services/binding.ts` | Instantiates `WordInteractionController` (gated on `wordClickEnabled`, passed a save-disabled-reason getter); `register-flicktionary-subtitles` at load + awaits the response (`UNSUPPORTED_LANGUAGE` → notice + disable save); `setFlicktionarySubtitleLanguageHint`; pause-on-hover wiring. **Note:** `hoveredToken` must be `new HoveredToken()` in the constructor — it's a latent crash in upstream/the fork too. |
| `src/controllers/subtitle-controller.ts` | Tokenize words when `wordClickEnabled` |
| `src/controllers/video-data-sync-controller.ts` | Calls `setFlicktionarySubtitleLanguageHint` with the selected track's language before `loadSubtitles` (display-only) |
| `src/entrypoints/background.ts` | Registers the Flicktionary + saved-words + supadata handlers |
| `src/entrypoints/video.content/video.css` | `.asbplayer-word` / selection overlay / gloss tooltip styles. **GOTCHA:** the tooltip rule is `display: flex !important`; JS show/hide must use `style.setProperty('display', …, 'important')` or the popover can't hide (see commit history / SPEC). |
| `packages/asbplayer-common/src/message.ts` | `flicktionary-gloss`, `save-word`, `register-flicktionary-subtitles`, pair messages. The register message + `SaveWordFlicktionaryVideoContext` carry **no** language fields (backend detects); register carries an optional display-only `youtubeLanguageCode`, and `RegisterFlicktionarySubtitlesResponse` carries the backend `code`. |
| `packages/asbplayer-common/settings/settings.ts` & `settings-provider.ts` | `wordClickEnabled`, `TranscriptSettings`; **removed** `LLMSettings` |
| `packages/asbplayer-common/components/MiscSettingsTab.tsx` | Word-learning + transcript settings UI (LLM key UI removed) |
| `src/ui/components/Popup.tsx` (popup-ui) | Saved-highlight counter |

### Whisper transcript files (kept from the fork)
`src/handlers/supadata/supadata-generate-handler.ts`,
`src/handlers/video/{get-cached,export,clear,get-…-count}-transcript*.ts`,
`src/services/transcript-cache.ts`, and the `transcript-server/` FastAPI service.

## Backend / web coupling

The extension now depends on Flicktionary surfaces (preserve or stub them):

- `glosses.fastGloss` — stateless gloss (`apps/backend` glosses-router).
- `studySessions.findOrCreateForYoutubeVideo` — `content_source.type = 'youtube'`,
  deduped on `metadata->>'youtubeVideoId'`. Detects the subtitle language
  server-side (`languageDetectionPass`) and uses it as the content + target
  language; returns `422 UNSUPPORTED_LANGUAGE` when it isn't a supported
  language. Requires the user's native language + CEFR for the *detected*
  language to be set (else `422 MISSING_CEFR` → popup tells the user to finish
  setup).
- `highlights.create`.
- Supabase auth (anon/publishable key shipped in `flicktionary-config.ts`) and
  the web `/extension-pair` route.
