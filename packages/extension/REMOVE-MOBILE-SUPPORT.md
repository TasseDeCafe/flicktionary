# Removing mobile / Firefox-Android support from the extension

**Goal (decided by the owner):** drop *all* mobile support — the touch
mobile-controls overlay, the gesture controller, the `isMobile` detection and
every branch it gates, the mobile message handlers, and the Firefox-Android
build target. The extension becomes desktop-only.

This is a planning doc for a **future, separate thread**. It is the result of a
codebase audit; **treat line numbers as approximate** (they drift) and re-grep
before each edit. Verdicts marked **VERIFY** were flagged during the audit as
needing a re-check at execution time.

- **Branch:** make a fresh one off `main` (the dictionary-DB removal lands on
  `cleanup/extension-dead-code` first; rebase or branch after that merges).
- **Gate (from `packages/extension/`):**
  `pnpm run check:types && npx vitest run && pnpm run build`, plus the same for
  `packages/asbplayer-common`. The **build is the real gate** (CI gates on
  `tsc`). `tsc` will NOT catch a runtime message-routing mistake, so also do a
  manual desktop pass: YouTube + one streaming site, confirm the controls
  overlay, notifications, video-select, and subtitle rendering all still work.
- **Why no users = easier:** there are no installed users, so settings
  back-compat (the unknown-key import trap) is *not* a blocker — removed
  settings fields don't need `ignoreKeys` retention. Still mind the trap if you
  later re-enable user installs.

---

## ⚠️ Shared — do NOT delete (used by desktop code)

The audit's first pass mislabeled some of these as mobile-only. They are shared:

- **`ui/shadow/model-store.ts`** — **SHARED. KEEP.** Used by
  `notification-controller.ts` + `ShadowNotificationApp.tsx` and
  `video-select-controller.ts` + `ShadowVideoSelectApp.tsx` (both desktop). The
  mobile overlay is just one of several consumers.
- **`PlayMode`** (`model.ts`) — SHARED. The Binding's play modes
  (normal/condensed/auto-pause/…) are core; the mobile overlay only *selected*
  them. KEEP.
- **`ToggleSubtitlesMessage`** / `ToggleSubtitlesHandler` — SHARED. The mobile
  overlay sent `toggle-subtitles`, but the command + handler are general
  (keyboard shortcut, context menu). KEEP the handler; just remove the mobile
  *sender*.
- **`streamingDisplaySubtitles`** setting — SHARED. Read by the desktop
  notification/subtitle logic in `binding.ts`, not just the mobile overlay. KEEP.
- **`isFirefoxBuild`** (`services/build-flags.ts`) — NOT mobile-specific; it
  covers Firefox **desktop** too. KEEP. Only the `firefox-android` half of the
  build matrix goes (see §6).
- **`react-device-detect`** — see §1; this is a responsive-UI concern, not
  device support. Decide separately; don't reflexively delete.

---

## 1. `isMobile` detection + its branches

- **Module:** `packages/asbplayer-common/device-detection/mobile.ts` — exports
  the `isMobile` constant (Android user-agent check). **Delete** once all
  importers are gone.
- **Importers / branches (all mobile-only, safe to delete):**
  - `entrypoints/background.ts`
    - install-listener mobile default settings (subtitleSize / offsets / width).
    - `action.onClicked`: on mobile sends `toggle-video-select`; on desktop opens
      popup. After removal, the desktop branch becomes the only path.
    - the `if (!isMobile) action.setPopup(...)` guards (both the Firefox and
      Chrome branches) collapse to always setting the popup.
  - `services/binding.ts`: the `isMobile` import + the notification-suppression
    branch (skips the toggle-subtitles-shortcut notice on mobile).
- **`react-device-detect`'s `isMobile`** (separate library, viewport/UA for the
  popup chrome): used in `ui/components/Popup.tsx`, `PopupUi.tsx`,
  `Tutorial.tsx`. This drives *responsive popup sizing / tutorial copy*, not
  device support. **VERIFY + decide:** likely keep (it's a desktop-popup
  responsiveness thing), or refactor to a viewport check. Don't lump it into the
  mobile-support deletion.
- `apps/web/src/hooks/use-is-mobile.ts` — the **web app's** own viewport hook.
  Unrelated to the extension. Leave it.

## 2. Mobile overlay controllers (mobile-only — delete)

- `controllers/mobile-video-overlay-controller.ts`
- `controllers/mobile-gesture-controller.ts`
- **Wiring to unpick in `services/binding.ts`:** the two controller fields, their
  construction in the Binding constructor, the offset-change → `updateModel`
  callback, the model pushes on subtitle-sync / seek / playback-rate, the
  gesture bind in `_bind()` + the swipe→prev/next-subtitle callbacks, the
  conditional bind/unbind gated on `streamingEnableOverlay`, the unbind in
  `unbind()`, and the show-on-pause / dispose-on-reset calls. Re-grep
  `mobileVideoOverlayController` / `mobileGestureController` to get them all.

## 3. Mobile overlay UI (mobile-only — delete)

- `ui/mobile-video-overlay/ShadowMobileVideoOverlayApp.tsx` (+ the directory).
- `packages/asbplayer-common/components/MobileVideoOverlay.tsx`.
- Its mobile-only subcomponents (each imported **only** by `MobileVideoOverlay`):
  `ScrollableNumberControls.tsx`, `PlayModeSelector.tsx`, `HoldableIconButton.tsx`.
  **VERIFY** each is unimported elsewhere right before deleting.
- `packages/asbplayer-common/hooks/use-last-scrollable-control-type.ts`
  (mobile-only).
- **KEEP `ui/shadow/model-store.ts`** (shared — see top).

## 4. Mobile message handlers (mobile-only — delete)

- `handlers/mobile-overlay/current-tab-handler.ts` (`current-tab`).
- `handlers/mobile-overlay/mobile-overlay-forwarder-handler.ts` (catch-all on
  sender `asbplayer-mobile-overlay-to-video`).
- Their registrations in `background.ts` (tail of the handler array — removing
  them doesn't affect ordering of earlier handlers).
- Types in `packages/asbplayer-common/src/`:
  - `command.ts`: `MobileOverlayToVideoCommand`, `MobileOverlayCommand`.
  - `message.ts`: `CurrentTabMessage`.
- **Dispatch note:** `toggle-subtitles` from the (deleted) overlay was caught by
  `ToggleSubtitlesHandler` (registered earlier), never by the forwarder — so
  removing the forwarder changes no live desktop behavior.

## 5. Mobile-only settings

- `streamingEnableOverlay` (`settings/settings.ts` + default in
  `settings-provider.ts`) — gated the mobile overlay; **delete** the field,
  default, and usages (`binding.ts`, and a reference in `Tutorial.tsx` — VERIFY).
- The mobile install-defaults block in `background.ts` (see §1).
- **KEEP `streamingDisplaySubtitles`** (shared).
- No users ⇒ no `ignoreKeys` retention needed. If `SettingsForm` (in
  `asbplayer-common/components`) renders a toggle for `streamingEnableOverlay`,
  remove that control too — **VERIFY** in the settings form / its page config.

## 6. Firefox-Android build target

- `wxt.config.ts`: the `if (browser === 'firefox-android')` block
  (`clipboardWrite` perm, `<all_urls>` host perm, `gecko_android`, the FF-Android
  add-on id). Delete it.
- `package.json`: the `dev:firefox-android` / `build:firefox-android` /
  `zip:firefox-android` scripts.
- There are **no** mobile-specific entrypoints or content scripts — everything
  else is shared across platforms, so nothing else to remove here.

## 7. `ControlType` enum

- `ControlType` (`model.ts`) — the audit found **no non-mobile consumers**, so it
  likely goes with the mobile overlay. **VERIFY** (re-grep `ControlType`
  monorepo-wide; `apps/web` too) before deleting; it's a shared `model.ts` export
  so be sure.

---

## Suggested execution order

1. Delete the mobile UI (§3) and controllers (§2); unpick the `binding.ts`
   wiring. Let `tsc` surface every dangling reference — work the error list.
2. Delete the handlers + their types (§4) and registrations.
3. Remove `isMobile` + its branches (§1); delete `mobile.ts` last (after
   importers are gone).
4. Remove `streamingEnableOverlay` (§5) and the `ControlType` enum (§7) once
   confirmed unused.
5. Drop the Firefox-Android build target (§6).
6. Run the gate (both packages) + the manual desktop pass.

Throughout: lean on `tsc --noEmit` as the worklist (it catches every type-level
dangling ref), but remember it can't catch runtime message-routing regressions —
hence the manual desktop pass.
