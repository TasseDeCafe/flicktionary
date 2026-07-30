# Disabled / removed for the Flicktionary prototype

This repo started as my SaaS template. For Flicktionary I trimmed it down to a single web app + backend. The machinery for everything else is still in place but disabled, so it can be restored if/when this grows.

## Things deleted from disk

### `apps/landing-page/` — gone
The Next.js marketing site. To restore it, copy the directory back from the template repo (or from this commit's parent) and re-add it everywhere it was unwired below.

References that were also unwired (search for `landing-page` if restoring):

- `lingui.config.mjs` — drop the `apps/landing-page/src` include path
- `scripts/generate-logos.sh` — `LANDING_APP` / `LANDING_PUBLIC` paths and the "Landing Page" image generation block
- `.husky/prepare-commit-msg` — `landing-page` scope detection
- `AGENTS.md` — stack list line
- `apps/web/src/config/environment-config-schema.ts` — `landingPageUrl` field
- `apps/web/src/config/environment-config.ts` — `landingPageUrl` in production / development / development-tunnel / test

### `apps/native/eas.json` — gone
This was the EAS Build / EAS Submit config (production + preview build profiles, App Store / Play Store submit). Restore by re-creating the file:

```json
{
  "cli": {
    "version": ">= 14.5.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "env": { "APP_VARIANT": "development" }
    },
    "preview": {
      "distribution": "internal",
      "environment": "production",
      "channel": "preview",
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "autoIncrement": true,
      "environment": "production",
      "channel": "production"
    }
  },
  "submit": {
    "production": {
      "android": { "track": "internal" },
      "ios": { "ascAppId": "<APP_STORE_CONNECT_APP_ID>" }
    }
  }
}
```

## Things stripped from `apps/native/app.config.js`

All of the following push artifacts to a hosted production environment. To re-enable native production builds, restore them:

- `buildCacheProvider: 'eas'` (top-level under `expo`)
- `'@sentry/react-native/expo'` plugin block — uploaded native source maps to Sentry on EAS builds:
  ```js
  ['@sentry/react-native/expo', {
    url: 'https://sentry.io/',
    project: 'native',
    organization: 'fluencist',
  }],
  ```
- `updates: { url: 'https://u.expo.dev/<EAS_PROJECT_ID>' }` — Expo OTA update channel
- `runtimeVersion: { policy: 'appVersion' }` — paired with OTA updates
- `extra.eas.projectId: '<EAS_PROJECT_ID>'`

The dev workflow (`pnpm dev:tunnel`, `pnpm ios:emulator`, etc.) still works without these.

## Things disabled via feature flags (still in code)

`packages/core/src/features.ts` controls these. Flip a flag to `true` and the corresponding init / providers / env config wake up across all apps. Current state for the prototype:

| Flag          | State   | What it gates                                                                                                          |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SENTRY`      | `false` | Sentry init + logging in the native app only — web and backend now use PostHog and their Sentry code paths are deleted |
| `POSTHOG`     | `true`  | PostHog analytics/replay/error tracking in web + backend; native stays off via an empty `EXPO_PUBLIC_POSTHOG_TOKEN`    |
| `STRIPE`      | `true`  | Stripe billing (web)                                                                                                   |
| `REVENUECAT`  | `true`  | RevenueCat in-app purchases (native)                                                                                   |
| `GOOGLE_AUTH` | `true`  | Google Sign-In via Supabase Auth                                                                                       |
| `APPLE_AUTH`  | `false` | Apple Sign-In (native)                                                                                                 |
| `TELEGRAM`    | `true`  | Telegram bot import                                                                                                    |

The wiring pattern (from the original template handoff): guard at function entry (`if (!FEATURES.X) return`), nullable / no-op clients, schema relaxation (`z.string()` instead of `z.string().min(1)` when off), and ternaries in environment configs that supply empty defaults so env vars aren't required.

## What's still kept (and why)

- **Backend (`apps/backend`)** — Flicktionary will use it for the LLM-call endpoint and Supabase queries.
- **TanStack Router / Query, oRPC, Zustand, Lingui, Tailwind, Radix** — keeping them in the web app; they're light and the cost of ripping them out and re-adding later is higher than the cost of keeping them.
- **Native app (`apps/native`)** — left in place but cannot push to production until the items above are restored. Runtime `EasUpdateGate` + `expo-updates` are still there but no-op since `updates.url` is gone.
- **Backend GitHub workflows** — `backend-ci.yaml` runs the backend suite on pushes to `main`. (`push-migrations.yaml` was deleted: Supabase's GitHub integration points at `apps/backend/supabase/migrations` directly and auto-applies on merge to main.)
