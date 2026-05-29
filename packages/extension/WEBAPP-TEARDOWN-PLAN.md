# Plan: remove the asbplayer web-app integration + finish the Anki teardown

> **For a fresh thread.** Self-contained. This is the deferred "Removing the web-app
> integration" follow-up from `CUSTOMIZATIONS.md §6`, plus the finish-off of the Anki
> removal it unlocks. Branch: `feat/add-asbplayer-extension`.
>
> **Decision (user, 2026-05):** Flicktionary has its **own** web app (`apps/web` =
> `@flicktionary/web`, served at the Flicktionary app URL) and its **own** extension
> pairing (`FlicktionaryPairSection`, Supabase magic-link). The upstream **asbplayer**
> web-app integration — the `app.asbplayer.dev` content-script bridge, the `common/app`
> player layer, and the `streamingAppUrl`/`extensionSupportsAppIntegration` surface — is
> unused and should be **deleted**. The **OPEN APP button is kept but hijacked** to open
> the Flicktionary web app instead.

## What is the "asbplayer web app" here (and what it is NOT)

There is **no separate asbplayer web app package** in this repo (upstream's `client/` was
never vendored — `CUSTOMIZATIONS.md` "Build deltas"). The asbplayer web app survives only
as:

1. **`packages/asbplayer-common/app/`** — the shared player-app layer (`ChromeExtension`
   app↔extension bridge, `AppKeyBinder`, `use-chrome-extension`, `use-copy-history`,
   `playback-preferences`, `cached-local-storage`, `localized-error`). **9 files.**
2. **`packages/extension/src/entrypoints/asbplayer.content.ts`** — the content script that
   runs **only** on asbplayer domains (`matches = ['*://killergerbah.github.io/asbplayer*',
   '*://app.asbplayer.dev/*']`, `+ localhost` in dev) and bridges `get/set-settings`,
   profiles, `dictionary-*-bulk`, copy-history, and `get/set-global-state` between those
   pages and the extension background.
3. **The `extensionSupportsAppIntegration` settings surface** — the "App integration"
   section in `StreamingVideoSettingsTab` (`streamingAppUrl` URL field + `streamingAutoSync`
   toggle "also open subtitle list via the app in a separate tab") and the `Popup`/`SettingsForm`
   prop that gates it.

**DO NOT TOUCH — these are Flicktionary's, not asbplayer's:**

- **`apps/web` (`@flicktionary/web`)** — Flicktionary's own web app. It has **no dependency
  on `asbplayer-common`** (verified: nothing in `apps/web/package.json` references asbplayer),
  so removing `common/app` cannot affect it.
- **Flicktionary's own "export kept terms as Anki-compatible CSV"** feature
  (`apps/backend/src/service/export/build-vocabulary-csv.ts`,
  `apps/web/.../vocabulary-options-overlay.tsx`, `api-client/.../chunks-contract.ts`, the
  "Anki-compatible" i18n string). This is the user's own card system exporting to an Anki
  *file format*; it is unrelated to the asbplayer AnkiConnect integration. **Keep it.**
- The **Flicktionary pairing** (`FlicktionaryPairSection`, `flicktionary-pair.content.ts`,
  `flicktionary.auth.v1`), hover gloss, save→highlight, word-click — all carry forward.
- **`dictionary-db` / `DictionaryProvider`** — still load-bearing for **profile management**
  (`use-settings-profile-context`), independent of the web-app bridge. Keep (it is already
  Anki-free after the prior teardown).

## The good news: almost all of this is already orphaned

The prior Anki teardown (7 commits on this branch) left the bridge tree-shaken:

- **`use-video-element-count.ts` — the *only* importer of `common/app` — has zero callers.**
  So `ChromeExtension` (and all of `common/app`) is reachable from nothing live. No rewire is
  needed; it is straight orphan deletion. (This corrects the stale `CUSTOMIZATIONS.md §4`
  note that says `ChromeExtension` is "imported by `use-video-element-count`" — true, but
  that hook is itself dead.)
- **`asbplayer.content.ts`** only activates on asbplayer.dev / killergerbah pages, which
  Flicktionary users never use for this purpose — dead in practice.

So the deletions are mostly mechanical. **Verify the orphan chain before deleting** (it can
shift):

```sh
cd packages
# common/app should have NO importer except the (dead) use-video-element-count
grep -rn "common/app'\|@asbplayer-fork/common/app" extension/src asbplayer-common --include='*.ts' --include='*.tsx' | grep -v node_modules
# useVideoElementCount should have NO caller
grep -rn "useVideoElementCount" extension/src --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v 'use-video-element-count.ts'
```

## Part A — Hijack OPEN APP (and the app-integration setting) to Flicktionary

**OPEN APP button.** `Popup.tsx` renders it and calls the `onOpenApp` prop;
`PopupUi.tsx` defines `handleOpenApp` (≈line 60) which currently does
`browser.tabs.create({ url: settings.streamingAppUrl })`. Repoint it to the Flicktionary
web app via the existing centralized config:

```ts
import { getFlicktionaryConfig } from '@/services/flicktionary/flicktionary-config';
const handleOpenApp = useCallback(() => {
    browser.tabs.create({ active: true, url: getFlicktionaryConfig().webUrl });
}, []);
```

`getFlicktionaryConfig().webUrl` already resolves dev / development-tunnel / production
(see `src/services/flicktionary/flicktionary-config.ts`): development → `http://localhost:5174`,
dev-tunnel → `VITE_WEB_URL` (personal `*.flicktionary.dev`), production → **`https://app.flicktionary.app`**.

> ⚠️ **URL discrepancy — confirm before coding.** The user asked for prod
> `https://app.flicktionary.dev`, but `flicktionary-config.ts` currently has prod
> `webUrl = https://app.flicktionary.app`. Resolve this once: either (a) the user meant
> `.app` and the config is correct, or (b) prod web URL should be `.dev` and the config is
> wrong. **Use `getFlicktionaryConfig().webUrl` as the single source of truth** (do not
> hardcode a URL in the popup) and fix the config value if needed — that keeps OPEN APP,
> pairing, and any future web links consistent.

**The "App integration" settings section** (`StreamingVideoSettingsTab`: `streamingAppUrl`
field + `streamingAutoSync` / `streamingAutoSyncPromptOnFailure` toggles, gated by
`extensionSupportsAppIntegration`). Its original purpose — auto-opening the asbplayer web
app's subtitle list and handing subtitles to it — does not apply to Flicktionary (the
Flicktionary web app doesn't consume the asbplayer bridge). **Recommended: remove the whole
section** (and the `extensionSupportsAppIntegration` prop) since OPEN APP now points at a
fixed URL and there is nothing to "integrate" with. Keep the section **only** if the user
wants a user-toggle to auto-open the Flicktionary tab on subtitle load — in which case keep
`streamingAutoSync` (re-labeled), drop the editable `streamingAppUrl` field, and have the
auto-open use `getFlicktionaryConfig().webUrl`. **This is a user decision — ask.**

`streamingAutoSync` is read by `video-data-sync-controller.ts` (`_autoSync`); trace that path
when deciding, so removing the toggle also removes the dead auto-open branch.

## Part B — Delete the asbplayer web-app integration

Once Part A no longer reads `streamingAppUrl` / `extensionSupportsAppIntegration`:

1. **`extension/src/entrypoints/asbplayer.content.ts`** — delete the entrypoint. Confirm no
   other entrypoint/manifest piece references it. The `dictionary-*-bulk` /
   `get/set-profiles` cases here are the **web-page** side of the bridge; the extension's own
   video content scripts talk to the dictionary via `ExtensionDictionaryStorage` →
   `runtime.sendMessage` → `dictionary-handler.ts`, **not** through this file, so deleting it
   does not affect in-extension dictionary/profile use. (Re-verify: grep that nothing else
   posts the app-integration `window.postMessage` commands.)
2. **`packages/asbplayer-common/app/`** — delete the directory (all 9 files) and its
   `package.json` `./app` export entry if present.
3. **`extension/src/ui/hooks/use-video-element-count.ts`** — delete (unused).
4. **`extensionSupportsAppIntegration`** — remove the prop from `SettingsForm.tsx`
   (interface + the gated render block + the `tabIndex` arithmetic that references it) and
   from `Popup.tsx` / `SettingsPage.tsx` / `FtueUi.tsx` / `Tutorial.tsx` call sites (grep all).
5. **`asbplayer-common/src/message.ts`** — remove the app-integration message types that are
   now orphaned (the `get/set-settings`, `get/set/add/remove-profiles`, `get/set-global-state`,
   `save/delete/clear/request-copy-history` app-bridge messages **iff** they have no other
   consumer — many are dual-purpose; grep each before removing). Anchor on consumers, not
   names.

## Part C — Finish the Anki removal (unlocked by deleting `common/app`)

`common/app/app-key-binder.ts` was the **last live consumer of `PostMineAction`**, and
`common/app/services/chrome-extension.ts` was the last consumer of `AnkiExportMode`, the
card-dialog messages, and `AnkiSettings.getSettings`. With `common/app` gone, re-grep and
remove what is now dead (each was confirmed app-layer-only in the prior teardown — re-verify):

- **`PostMineAction`** (`model.ts`) + the `postMineAction` fields on the copy/mine messages
  in `message.ts` (`CopyMessage`, `CopyToVideoMessage`, `CopySubtitleMessage`,
  `CopySubtitleWithAdditionalFieldsMessage`, `StartRecordingMediaMessage`, etc.) — and the
  copy/mine messages themselves if they have no remaining consumer.
- **`AnkiExportMode`** (`model.ts`) + the `lastSelectedAnkiExportMode` setting
  (`settings.ts`, `settings-provider.ts`, `settings-import-export.ts` schema) +
  `supportsLastSelectedAnkiExportModeSetting` (was in the deleted `chrome-extension.ts`).
- **`AnkiSettings`** interface + `ankiSettingsKeys` + `extractAnkiSettings` + the
  `AnkiField`/`AnkiFieldSettings`/`CustomAnkiFieldSettings`/`AnkiSettingsFieldKey` types
  (`settings.ts`), the `AnkiSettings` defaults (`settings-provider.ts`), and the schema
  entries (`settings-import-export.ts`). Add the removed top-level keys to `ignoreKeys` for
  old-export import compat (`[[reference_settings_schema_unknown_key_trap]]`); nested ones
  under a `$ref` subschema need no `ignoreKeys` (the validator allows extra props and
  `validateAllKnownKeys` doesn't recurse arrays — as used for `dictionaryAnki*` already).
- **Card-dialog messages** `CardUpdatedDialogMessage` / `CardExportedDialogMessage` — their
  only producer was the deleted `chrome-extension.ts`; remove from `message.ts`.
- **`global-state/index.ts`** ankiDialog bits, the **ankiExport keybind**
  (`KeyboardShortcutsSettingsTab.tsx` + `settings.ts` keybind map), `binding.ts` (1 ref),
  `yomitan.ts` (1 ref) — grep and clean.
- **The recording/screenshot entanglement** — `AnkiUiSavedState` is still referenced by
  `TakeScreenshotFromExtensionMessage` / `ScreenshotTakenMessage` / `RerecordMediaMessage`.
  Decide: if the recording/screenshot flow is itself dead post-teardown (it was largely
  stripped in the 2026-05 strip — see `CUSTOMIZATIONS.md §4` "Recording"), remove those
  messages + `AnkiUiSavedState`; otherwise drop just the `ankiUiState`/`uiState` fields.
  **Investigate consumers first.**

## Part D — Orphaned common dirs

After Parts B/C, re-check and delete if orphaned:

- **`asbplayer-common/copy-history/`** — `use-copy-history` (in `common/app`, deleted) and
  the deleted `chrome-extension.ts` were the consumers; `copy-history-repository.ts` likely
  ends up used only by its own test. Confirm, then remove the dir (and reassess `CopyHistoryItem`
  in `model.ts`). **Caveat:** `CopyHistoryItem extends CardModel`; if `CardModel` is still
  used by surviving messages, keep `CardModel` and only drop `CopyHistoryItem`.
- Re-grep `CardModel` / `CardTextFieldValues` consumers after Part C; keep whatever the live
  subtitle/video messages still need.

## Gate (after every step; commit per logical step)

1. `pnpm --filter @flicktionary/extension build` — the real gate (esbuild/WXT). Both `build`
   and `build:firefox`. Note size vs the current **~7.04 MB**.
2. `pnpm exec tsc --noEmit` in `packages/extension` — must stay at the **9-error baseline**
   (`[[project_extension_typecheck_gate]]`). Diff error *locations*, not just the count.
3. `pnpm exec jest` in `packages/asbplayer-common` — must not regress past the current
   baseline (**3 suites fail / 3 pass; 3 tests fail / 9 pass** — pre-existing
   `wordClickEnabled` + module-resolution failures, unrelated to this work).
4. `pnpm --filter @flicktionary/web build` (or its typecheck) — **new gate this time:** prove
   removing `common/app` / settings keys didn't break the Flicktionary web app. (It has no
   asbplayer dep, so this should be a no-op, but confirm.)
5. **MANUAL golden path** (`CUSTOMIZATIONS.md §7`): load the extension on a YouTube video →
   word-click tokenization renders → hover gloss shows **and dismisses** → right-click save
   creates a highlight → unsupported-language notice → popup settings tabs open and **profile
   switch/delete** works → **the OPEN APP button opens the Flicktionary web app** (dev URL in
   the dev build, prod URL in the prod build).

## Recommended order (commit per step)

1. **Part A** — repoint OPEN APP to `getFlicktionaryConfig().webUrl`; resolve the `.app`/`.dev`
   URL question; decide + apply the App-integration-section disposition. Build stays green.
2. **Part B** — delete `asbplayer.content.ts`, `common/app/`, `use-video-element-count.ts`,
   the `extensionSupportsAppIntegration` surface, and the orphaned app-bridge message types.
3. **Part C** — finish the Anki removal now unlocked (PostMineAction, AnkiExportMode,
   AnkiSettings, card-dialog messages, ankiExport keybind, global-state, recording entanglement).
4. **Part D** — sweep orphaned `copy-history` (and reassess `CardModel`/`CopyHistoryItem`).
5. Update **`CUSTOMIZATIONS.md`**: move "Removing the web-app integration" + "Deep dictionary-db"
   notes from §6 deferred to done; record that OPEN APP now targets the Flicktionary web app
   and that `common/app` + `asbplayer.content.ts` are gone; refresh the "Kept deliberately"
   list (the asbplayer web-app integration is no longer kept).
6. (Optional) the dead i18n keys (`CUSTOMIZATIONS.md §6` Cluster 5) — low value, noisy 12-file
   diff; line-by-line leaf deletion only, grep each for 0 `t('…')` refs first.

## Decisions to confirm with the user before/while executing

- **Prod web URL:** `https://app.flicktionary.dev` (user's message) vs `https://app.flicktionary.app`
  (current `flicktionary-config.ts`). Which is correct? (Drives the config fix.)
- **App-integration section:** remove entirely (recommended), or keep a re-pointed
  auto-open-Flicktionary toggle?
