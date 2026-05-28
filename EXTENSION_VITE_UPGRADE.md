# Extension Vite Upgrade

## Context

`packages/extension` currently pins `@vitejs/plugin-react` to `^4.7.0` instead of using the root catalog version.

The root catalog currently carries newer Vite tooling, including `@vitejs/plugin-react@6.0.1` and `vite@8.0.5`. The extension is built by `wxt@0.20.7`, which currently runs its own build pipeline on `vite@6.4.2`.

When the extension used the newer React plugin line, WXT dev mode failed while processing asbplayer HTML pages that contain plain content-script references such as:

```html
<script src="content-scripts/video.js"></script>
```

The observed error was:

```text
[vite:build-html] Missing field moduleType
```

Production build still worked, but dev/tunnel mode was broken.

## Current Compromise

`packages/extension/package.json` pins:

```json
"@vitejs/plugin-react": "^4.7.0"
```

This is localized to the extension package. It does not downgrade React or the main Flicktionary web app.

## Cleanup Goal

Eventually align the extension with the same modern Vite/plugin-react dependency line as the rest of the monorepo, without breaking WXT dev mode.

## Cleanup Tasks

1. Re-check WXT compatibility.
   - Look for a newer WXT release that supports the root Vite/plugin-react line cleanly.
   - Upgrade `wxt` and `@wxt-dev/module-react` together if needed.

2. Try removing the local plugin-react pin.
   - Change `packages/extension` back to the catalog version for `@vitejs/plugin-react`.
   - Run `pnpm install`.

3. Verify extension dev and build modes.
   - `pnpm --filter @flicktionary/extension run dev`
   - `pnpm --filter @flicktionary/extension run dev:tunnel`
   - `pnpm --filter @flicktionary/extension run build`
   - `pnpm --filter @flicktionary/extension run check`

4. If dev mode still fails, inspect the asbplayer HTML entrypoints.
   - Known affected pages include `ftue-ui/index.html` and `sidepanel/index.html`.
   - The suspicious pattern is plain `<script src="content-scripts/...">` tags.
   - Determine whether WXT expects these to be declared differently, marked as `type="module"`, moved out of dev HTML pre-rendering, or loaded through another extension-safe mechanism.

5. Remove the compatibility pin only when both production build and dev/tunnel HMR work.

## Current Verification Baseline

These commands pass with the compatibility pin:

```bash
pnpm check:types
pnpm --filter @flicktionary/extension run check
pnpm --filter @flicktionary/extension run build
```
