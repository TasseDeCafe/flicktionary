# Leftover dead code after the iframe → Shadow DOM migration

The injected over-video UIs (controls overlay, notification, video-data-sync,
video-select) were migrated off `<iframe>` + FrameBridge to in-realm Shadow DOM,
and the iframe/bridge transport was deleted. The items below were made dead (or
adjacent-dead) by that work but **left in place** — either because they're in the
shared `@asbplayer-fork/common` package (cross-package risk) or because they're
harmless and out of that thread's scope. Clean them up here.

> Verify across the whole monorepo (`apps/web`, side panel, `@asbplayer-fork/common`
> consumers) before removing anything shared — these types/handlers may still be
> referenced outside `packages/extension`.

## ✅ ALL FOUR ITEMS DONE (branch `cleanup/extension-dead-code`, 2026-06-02)

All four items below were removed and the gate is green (`check:types` + `vitest`
+ `build` for both `packages/extension` and `packages/asbplayer-common`).

**Companion found while doing #1/#2:** the mobile overlay's model flow is now
store-based (`mobile-video-overlay-controller.ts` → `createModelStore` →
`ShadowMobileVideoOverlayApp`), so the *request* half was dead too — its handler
`handlers/mobile-overlay/request-model-handler.ts` (command
`request-mobile-overlay-model`, never sent) and its message type
`RequestMobileOverlayModelMessage` were removed alongside the documented `update`
half.

**Left in place (NOT cleanly dead — a separate audit):** `CurrentTabHandler`
(`current-tab`) and `MobileOverlayForwarderHandler` (catch-all on sender
`asbplayer-mobile-overlay-to-video`). The overlay still posts `toggle-subtitles`
via that sender, which is caught earlier by `ToggleSubtitlesHandler` in the
dispatch loop — so the forwarder's reachability depends on handler ordering.
Removing them is runtime-risky (tsc won't catch it) and out of this scope.

## ~~1. Dead background handler: `update-mobile-overlay-model`~~ — DONE

The mobile controls overlay no longer posts `update-mobile-overlay-model` (the
model now flows through an in-realm store), so its background handler never fires.

- `packages/extension/src/handlers/video/update-mobile-overlay-model-handler.ts` — delete the file.
- `packages/extension/src/entrypoints/background.ts` — remove the import (`import UpdateMobileOverlayModelHandler …`, ~line 30) and the registration (`new UpdateMobileOverlayModelHandler(),`, ~line 110).

Risk: low (extension-only; the handler is unreachable).

## ~~2. Unused mobile-overlay bridge message types (in `@asbplayer-fork/common`)~~ — DONE

No longer referenced anywhere in `packages/extension` (grep returns nothing):

- `UpdateMobileOverlayModelMessage`
- `RequestMobileOverlayModelMessage`
- `VideoToMobileOverlayCommand`

Also check `UpdateStateMessage` — only referenced in extension *comments* now
(was the FrameBridge model-push payload for notification / video-data-sync /
video-select). 

Action: confirm no other package imports these, then prune from common.
Risk: medium — shared package; grep the monorepo first. (Mind the settings-schema
unknown-key trap if any of these ever touch `AsbplayerSettings`.)

Removed: `UpdateMobileOverlayModelMessage`, `RequestMobileOverlayModelMessage`,
`UpdateStateMessage` (message.ts), `VideoToMobileOverlayCommand` (command.ts), plus
the now-unused `MobileOverlayModel` import in message.ts. None touched
`AsbplayerSettings`. Three `// formerly UpdateStateMessage over the FrameBridge`
comments were left as accurate historical notes.

## ~~3. Dead WAR entry: `anki-ui.js`~~ — DONE

`packages/extension/wxt.config.ts` `web_accessible_resources` still lists
`'anki-ui.js'` (~line 162), but there is no `entrypoints/anki-ui/` and no Anki
controller/component in the extension — the asset doesn't exist. (Pre-existing,
from the Anki/mining removal effort — see the "Remove all Anki/mining" goal.)

Action: confirm nothing references `anki-ui.js`, then remove the WAR line.
Risk: low.

## ~~4. Orphaned iframe CSS + guard: `.asbplayer-ui-frame`~~ — DONE

The `.asbplayer-ui-frame` class styled the (now-removed) injected UI iframes:

- `packages/extension/src/entrypoints/video.content/video.css` (~line 119) — the `.asbplayer-ui-frame { … }` rule.
- `packages/extension/src/controllers/controls-controller.ts` (~line 47) — `!element.classList.contains('asbplayer-ui-frame')` guard that excluded those iframes from controls detection.

With every `.asbplayer-ui-frame` iframe gone (including anki-ui), nothing creates
that class anymore. Verify no remaining creator, then drop the CSS rule and
simplify the guard.
Risk: low–medium — re-check there's no other injected iframe relying on this class
before removing the guard.

## Not in this list (intentionally)

- The MUI → Radix (+ Tailwind) component swap for these surfaces **and** the
  standalone popup / options pages — that's the separate follow-up thread, not
  dead code.
- `CachingElementOverlay` (`services/element-overlay.ts`) — still load-bearing for
  the React **subtitle** overlay; not dead.
- The legacy subtitle DOM path / `WordInteractionController` / `video.css` subtitle
  rules — tracked separately ("retiring the legacy subtitle DOM path").
