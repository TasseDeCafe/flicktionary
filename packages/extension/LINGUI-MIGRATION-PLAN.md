# Lingui migration plan (extension + asbplayer-common)

Goal: move the browser extension and `@asbplayer-fork/common` off **i18next** onto
**Lingui**, so they share the same i18n toolchain, catalog, and translation
pipeline as `apps/web` / `apps/native` (the shared `@flicktionary/i18n` package).

The migration is **incremental and extract-driven**: i18next and Lingui run side
by side, and we convert strings component-by-component. Only strings wrapped in a
Lingui macro resolve through Lingui; everything else keeps using i18next until
converted. i18next is removed only once nothing references it.

---

## 1. Status — proof of concept (done)

`Popup.tsx` has two strings (`Open App`, `User guide`) migrated end-to-end and
verified in both the production bundle and the dev-mode bundle.

What's already wired (don't redo):

- **Build (`wxt.config.ts`)** — a dedicated `@rolldown/plugin-babel` pass runs the
  Lingui macro (`<Trans>`, `` t`…` ``, `` msg`…` ``). See gotchas below.
- **Catalog config (`lingui.config.mjs`)** — `packages/extension/src` and
  `packages/asbplayer-common` are in the shared catalog's `include`, so
  `lingui extract` scans them and writes into `packages/i18n/locales/{locale}/messages.po`.
- **TS resolution (`packages/extension/tsconfig.json`)** — `paths` entries for
  `@flicktionary/i18n/locales/*` and `@flicktionary/i18n/*`.
- **Runtime (`src/ui/lingui.ts`)** — loads the compiled `en`/`fr` catalogs at module
  top level and exposes `setupLingui(language)` + `i18n`.
- **Provider (`PopupUi.tsx`)** — wraps the tree in `<I18nProvider i18n={i18n}>` and
  calls `setupLingui(settings.language)`.
- **Deps (`package.json`)** — `@flicktionary/i18n`, `@lingui/core`, `@lingui/react`,
  `@lingui/babel-plugin-lingui-macro`, `@rolldown/plugin-babel`.

### Two non-obvious build gotchas (already solved — keep them)

1. **Macro must use `@rolldown/plugin-babel`, not `@vitejs/plugin-react`'s `babel`
   option.** Under WXT's Rolldown (vite 8) build the plugin-react babel option
   silently fails to apply the macro, leaving an `@lingui/react/macro` runtime stub
   that throws / renders the source string regardless of locale. We mirror
   `apps/web`'s dedicated babel pass.
2. **Import compiled `messages.ts`, not raw `.po`.** `@lingui/vite-plugin`'s `.po`
   transform relies on a Rolldown `moduleType: "js"` signal that WXT's pipeline
   drops, so `.po` imports bundle **empty**. The `.ts` is plain JS and sidesteps the
   plugin. **Consequence: run `lingui compile` after every `lingui extract`** (web
   relies on the vite plugin and can skip compile).

### Catalog workflow (run from repo root)

```bash
pnpm --filter @flicktionary/i18n lingui:extract    # scan macros -> messages.po (+ flags obsolete)
# translate fr (manually, or via the i18n `translate` script)
pnpm --filter @flicktionary/i18n lingui:compile    # messages.po -> messages.ts (what the extension imports)
```

The compiled `messages.ts` are **git-ignored** (`/packages/i18n/locales/**/*.ts`).
To make fresh checkouts / CI work, `@flicktionary/i18n`'s `build` script runs
`lingui compile`, and the extension build `dependsOn: ["^build"]` (turbo), so the
catalogs exist before the extension bundles. **During local iteration you must still
run `lingui:compile` yourself** after editing strings/translations — the dev server
imports the on-disk `messages.ts` and won't recompile them for you.

---

## 2. Why this also solves the "stale strings" problem

With i18next, strings live in `asbplayer-common/locales/*.json` (501 keys in
`en.json`) keyed by dotted paths; you can't statically know which are live. Lingui
inverts it: the source text lives in the code inside macros, and `lingui extract`
is AST-based — it collects **only** strings actually wrapped in a macro and marks
catalog entries with no macro as obsolete (`#~`). So as we migrate, the live set
emerges automatically and the old JSON becomes irrelevant. **No manual audit of the
501 keys is needed.**

---

## 3. Scope

### 3a. Extension React roots — each needs `<I18nProvider>` + `setupLingui(lang)`

The extension renders React in several isolated realms (separate bundles); every
root must set up Lingui independently. `Popup` is done; remaining:

| Render entry (`src/ui/.../index.tsx`) | Component | Notes |
|---|---|---|
| `popup/` | `PopupUi` / `Popup` | ✅ done (reference implementation) |
| `settings/` | `SettingsPage` | options page; pulls in most `asbplayer-common` settings components |
| `ftue/` | `FtueUi` | first-time UX |
| `notification/` | `NotificationUi` | injected content-script UI |
| `video-select/` | `VideoSelectUi` | injected content-script UI |
| `video-data-sync/` | `VideoDataSyncUi` / `VideoDataSyncDialog` | injected content-script UI |
| `mobile-video-overlay/` | `MobileVideoOverlayUi` | injected content-script UI |

The injected UIs currently render via `renderXUi(element, lang, locStrings)` →
`i18nInit(lang, locStrings)`. Migration per root:
- Replace `i18nInit(lang, locStrings)` with `setupLingui(lang)` (catalogs are
  bundled — `locStrings` no longer needs to be fetched/passed).
- Wrap the rendered component in `<I18nProvider i18n={i18n}>` (import from
  `../lingui`).
- Eventually drop the now-unused `lang`/`locStrings` params and their callers.

### 3b. `@asbplayer-fork/common` components (~14 files)

`SettingsForm` + ~13 others (`About`, `KeyboardShortcutsSettingsTab`,
`MiscSettingsTab`, `PageSettingsForm`, `PlayModeSelector`, `SettingsProfileSelectMenu`,
`StreamingVideoSettingsTab`, `SubtitleAppearance*`, `MiniProfileSelector`,
`ListField`, `MobileVideoOverlay`, `TutorialBubble`). These use `useTranslation()`
and are rendered inside the extension's roots, so they work once (a) their root has
an `<I18nProvider>` and (b) their strings are converted to macros.

⚠️ **Blast radius:** `asbplayer-common` is a shared package. Before converting its
strings, confirm every consumer (the extension, and any remaining asbplayer web
app) mounts an `<I18nProvider>` — a Lingui macro rendered without a provider throws.
Convert `asbplayer-common` **after** all extension roots have providers, or gate it.

### 3c. Non-React string lookups (the `i18n.t()` collision)

Two call sites use the i18next **singleton** directly, outside React:

- `src/controllers/subtitle-controller.ts:601` — `i18n.t(locKey, replacements)` (dynamic key)
- `src/controllers/video-data-sync-controller.ts:98` — `i18n.t('extension.videoDataSync.emptySubtitleTrack')`

Note: Lingui's `i18n.t()` is an alias for `i18n._()`, so these collide with i18next
and **`lingui extract` will falsely pick them up** while i18next is still imported.
Migrate them to Lingui's imperative API:
- Static: `import { i18n } from '@/ui/lingui'; i18n._(msg\`…\`)` (or `t\`…\``).
- Dynamic key (`subtitle-controller`): the dynamic `locKey` has no static message to
  extract — give it an explicit-id message or a small `switch` mapping keys to
  `msg\`…\`` so extraction works.

---

## 4. Recommended order

1. **Settings/options root** (`settings/`) first — it transitively exercises the
   bulk of `asbplayer-common`, so the provider is in place before 3b.
2. **Injected UIs** one at a time (`notification` → `video-select` →
   `video-data-sync` → `mobile-video-overlay`), proving the multi-realm activation
   path. After each: `lingui extract && lingui compile`, then build dev **and** prod
   and load the UI.
3. **`ftue/`** root.
4. **`asbplayer-common` components** (3b) — convert strings now that all roots have
   providers.
5. **Non-React `i18n.t()` sites** (3c).
6. **Decommission i18next** (section 5).

Per string, the mechanical change is `t('some.key')` → `<Trans>Source text</Trans>`
(JSX) or `` t`Source text` `` via `useLingui()` (attributes/non-JSX). Use the
existing `en.json` value as the source text so translations carry over; fill the
French `msgstr` after extract.

---

## 5. Decommissioning i18next (final step, only when nothing references it)

- Remove deps: `i18next`, `react-i18next`, `i18next-resources-to-backend`.
- Delete the parallel inits: `src/ui/i18n.ts`, `src/services/i18n.ts`,
  `src/ui/hooks/use-i18n.ts`.
- **Delete the runtime-CDN localization machinery** in
  `src/services/localization-fetcher.ts` (`fetchLocalization`, `primeLocalization`,
  `fetchAndCache`, the `locStrings-*`/`locVersion-*` storage keys) and the
  `asbplayer-locales/*.json` public assets + the `build:publicAssets` copy of them in
  `wxt.config.ts`. **Decided (2026-05-30): the CDN hot-update feature is not needed —
  translations ship with releases.** This is a teardown step for the *end* of the
  migration; the JSON assets must stay until the last i18next string is gone.
- Drop the now-dead `lang`/`locStrings` params threaded through the render functions
  and their content-script callers.
- Delete `packages/asbplayer-common/locales/*.json` once unused.

---

## 6. Open decisions / risks

- **(a) Locale set. — RESOLVED (2026-05-30): en + fr only.** The shared
  `@flicktionary/i18n` catalog ships `en` + `fr`; the asbplayer JSON shipped 12 (de,
  es, fi, id, ja, ko, pl, pt_BR, ru, zh_CN + en/fr). Decision: **drop everything
  except en + fr** — the other translations are not needed. Non-en/fr users fall back
  to English. (Re-adding a locale later is a one-line change in `lingui.config.mjs` +
  `i18n-config.ts` plus translations.)
- **(b) Browser-language detection. — RESOLVED (2026-05-30): no detection.**
  `lingui.ts` activates `en` by default and follows `settings.language` (the
  UI-language dropdown) — the dropdown is the single source of truth, which is also
  easier to test. We deliberately do **not** seed from `navigator.language` like
  `apps/web`'s `getBrowserLocale()`. (Easy to add to `setupLingui` later if wanted.)
- **(c) Loss of runtime translation updates. — RESOLVED (2026-05-30).** i18next
  currently fetches translation updates from a CDN at runtime
  (`localization-fetcher`); Lingui bundles catalogs at build time. Decision: the CDN
  feature is **not needed** — translations ship with releases. `localization-fetcher`
  and the `asbplayer-locales/*.json` assets are flagged for deletion in the
  decommission step (section 5).
- **(d) Provider-before-macro invariant.** A Lingui macro rendered without an
  ancestor `<I18nProvider>` throws. Keep provider rollout ahead of string conversion,
  especially for shared `asbplayer-common` components.
- **(e) Settings schema.** Removing translation-related `AsbplayerSettings` fields can
  break old-export import (`validateSettings` throws on unknown keys). If any are
  dropped, leave them in `settingsSchema`/`ignoreKeys`.

---

## 7. Workflow & verification (batch-based)

Convert in **batches** (e.g. a whole root + the `asbplayer-common` components it
pulls in), not one component at a time — per-component verification is too slow.
Manual browser verification happens **once per batch**, not per component.

Per component (mechanical, no build/verify in between):

- [ ] Root has `<I18nProvider i18n={i18n}>` and calls `setupLingui(<language>)`.
- [ ] Convert `t('key')` → `<Trans>…</Trans>` / `` t`…` `` via `useLingui()`; use the
      existing `en.json` text as the source string.
- [ ] Remove the component's `useTranslation` / i18next imports.

Per batch (the slow steps, run once):

- [ ] `pnpm --filter @flicktionary/i18n lingui:extract`
- [ ] Fill French `msgstr` for new entries (or run the `translate` script).
- [ ] `pnpm --filter @flicktionary/i18n lingui:compile`
- [ ] `pnpm --filter @flicktionary/extension check` (lint + typecheck — cheap, catches
      unconverted strings and provider gaps).
- [ ] Build **dev** + **prod** and spot-check one or two of the batch's UIs in the
      browser (en + fr). Trust `check` + the en/fr catalog for the rest.
