# Plan: replace both toast systems with sonner

Status: **planned, not implemented.** Replace the extension's two ad‑hoc toast
implementations with [`sonner`](https://sonner.emilkowal.ski/), positioned at the
viewport corner (`bottom-right`), and remove the legacy rendering paths that
become dead as a result.

## Background: what exists today

There are **two** independent toast-like systems in the extension:

1. **Status notifications** — `subtitle-controller.ts` `notification()` /
   `showTextNotification()` → `_showOverlayNotification()` →
   `_buildNotificationHtml()` → `notificationElementOverlay.setHtml()`.
   Light-DOM, anchored to the video, styled by `.asbplayer-notification`.
   This is the **last remaining consumer of `ElementOverlay.setHtml`** (subtitles
   already render via React/Shadow DOM).
2. **Save toasts** — `ui/video-overlay/SaveToast.tsx`, already a React component
   inside the Shadow DOM overlay tree, anchored to the video via `useLayoutEffect`,
   animated by the `overlay-toast` keyframe in `overlay.css`.

Both are single-toast-at-a-time, with bespoke timeout/animation logic.

## Decisions

- **Library:** `sonner@2.0.7` — already in the catalog (`pnpm-workspace.yaml`),
  already used by `apps/web`.
- **Position:** `bottom-right`. Toasts become viewport-anchored (no longer follow
  the video box). This is an accepted behavior change.
- **Config:** mirror `apps/web`, which renders a bare `<Toaster />` (sonner
  defaults — no `richColors`, default theme/styling). The only extension-specific
  deviations are forced by the environment, not style choices:
  - explicit high `z-index` (our overlays use max-int `2147483647`; sonner's
    default toaster `z-index` is `999999999`, which would sit below them);
  - the toaster's CSS must be placed in the Shadow DOM's **adopted** stylesheet.
- **One page-level Toaster, not per-binding.** Viewport-corner toasts are
  page-global, so a singleton is the correct model and it avoids duplicate toast
  stacks when multiple videos exist on one page. The per-binding `SubtitleStore`
  independence is preserved — toasts simply stop being per-video. `sonner`'s
  `toast()` is a global imperative dispatcher, so it can be called from the
  imperative `SubtitleController` (outside React).

## Verified facts that shape the approach

- sonner ships `sonner/dist/styles.css` **and** auto-injects a `<style>` into
  `document.head` at runtime. The head copy will not reach a shadow root, so we
  must put sonner's CSS into the overlay's adopted stylesheet ourselves; the head
  copy is a harmless duplicate.
- sonner's CSS uses **no real `rem`** (sizes are `12px`/`13px` absolute), so the
  host page's `html { font-size }` (e.g. YouTube's `10px`) will **not** shrink the
  toasts. No px-pinning needed for it (unlike the Tailwind chrome).
- sonner's default toaster `z-index` is `999999999` — below our overlays.

## Implementation steps

### 1. Add the dependency
- Add `"sonner": "catalog:"` to `packages/extension/package.json`.

### 2. Shadow-root CSS
- In `ui/shadow/overlay-stylesheet.ts`, append sonner's CSS to the adopted sheet:
  `import sonnerCss from 'sonner/dist/styles.css?inline'` and
  `sheet.replaceSync(overlayCss + '\n' + sonnerCss)`.
  (Raw string append rather than a CSS `@import`, to avoid any Tailwind‑v4
  `@import`-resolution uncertainty.)

### 3. Page-level Toaster host (new module, e.g. `ui/video-overlay/toaster-host.ts`)
- Lazily create **one** shadow host + React root that renders
  `<Toaster position="bottom-right" style={{ zIndex: 2147483647 }} />`.
- Guard against duplicates with a module singleton + a
  `data-asbplayer-toaster-host` attribute, and clear stranded hosts on init
  (mirror the popover-host cleanup in `ui/video-overlay/mount.ts`).
- Adopt the overlay sheet (now including sonner CSS) onto its shadow root.
- Reparent into `document.fullscreenElement ?? document.body` on
  `fullscreenchange` — reuse the exact pattern from `mount.ts`'s
  `placePopoverHost()` (keeps `position: fixed` working and visible in
  fullscreen; must not live inside a transformed ancestor).
- Initialize lazily on first `toast()` need.

### 4. Route status notifications through sonner
- In `subtitle-controller.ts`:
  - `notification(locKey, replacements)` → `toast(i18n._(this._notificationMessage(locKey, replacements ?? {})))`.
  - `showTextNotification(text)` → `toast.error(text)` (it's the longer-lived
    "saving disabled" reason; pick `toast()` vs `toast.error()` to taste).
  - Keep `_notificationMessage` (still maps loc-keys → text).
- Delete `_showOverlayNotification`, `_buildNotificationHtml`,
  `notificationElementOverlayHideTimeout`.

### 5. Route save toasts through sonner
- In `ui/video-overlay/SubtitleOverlayApp.tsx`: replace `showToast(text, isError)`
  with `toast.success(text)` / `toast.error(text)`. Remove `ToastState`, the
  `toast` state, the auto-dismiss `useEffect`, the `SaveToast` import, and its
  render inside the portal.
- Delete `ui/video-overlay/SaveToast.tsx`.

### 6. Drop the notification overlay instance
- Remove `notificationElementOverlay` and `notificationOverlayParams` from
  `_overlays()` / `_elementOverlayParams()` / `setSubtitleSettings` / `unbind` /
  `refresh` in `subtitle-controller.ts`.

## Legacy removal (once nothing calls `setHtml`)

**`services/element-overlay.ts`** — remove the content-element rendering path:
`setHtml`, `_displayNonFullscreenContentElementsWithHtml`,
`_displayNonFullscreenContentElements`, `_displayFullscreenContentElementsWithHtml`,
`_displayFullscreenContentElements`, `_setChildren`, `_cachedContentElement`,
`_appendHtml`, `defaultContentElement`, the `nonFullscreenContentClassName` /
`fullscreenContentClassName` fields, the `KeyedHtml` interface, `setHtml` on the
`ElementOverlay` interface, and `displayingElements` / `domCache`
(`OffscreenDomCache`) **if verified unused** afterward.
**Keep** the shared container machinery used by the React subtitle path:
`_nonFullscreenContainerElement`, `_fullscreenContainerElement`,
`_applyContainerStyles`, `_transferChildren`, `mountPersistentHost` /
`disposePersistentHost`, `hide`, `refresh`, `dispose`.

**`entrypoints/video.content/video.css`** — delete `.asbplayer-notification`,
`.asbplayer-notification-container-top`, `.asbplayer-notification-container-bottom`
(and the YouTube z-index rule lines referencing those container classes), plus the
already-dead `.asbplayer-subtitles` / `.asbplayer-fullscreen-subtitles` rules and
their `ruby` sub-rules.

**`subtitle-controller.ts`** — drop the now-unused `nonFullscreenContentClassName`
/ `fullscreenContentClassName` from the subtitle overlay params.

**`ui/video-overlay/overlay.css`** — remove the `--animate-overlay-toast` /
`--animate-overlay-toast-error` theme tokens and the `overlay-toast` keyframe
(only `SaveToast` used them).

## Verification

- `pnpm --filter @flicktionary/extension check:types` and the common package
  typecheck; build the extension.
- Grep that `setHtml` has **zero** remaining callers before deleting it.
- Manual, in **windowed and fullscreen**, on YouTube (the 10px-font host) and one
  more site:
  - status notification (toggle auto-pause → "Auto-pause: On");
  - save success and save error toasts.
  - Confirm toasts appear bottom-right, correctly styled inside the shadow root,
    above subtitles/controls, and survive fullscreen toggling.

## Risks / watch-items

- **Fullscreen + `position: fixed`:** the Toaster host must not sit inside a
  transformed ancestor; parent it directly under
  `document.fullscreenElement` / `body` (like the popover host).
- **z-index in fullscreen:** verify the explicit max-int actually wins over the
  site's own fullscreen controls.
- **Initialization timing:** the singleton Toaster must exist before the first
  `toast()` from the controller — lazy-init on first call.
- **Duplicate head `<style>`:** harmless, but be aware sonner still injects one
  into `document.head` that does nothing for the shadow-rendered toaster.
