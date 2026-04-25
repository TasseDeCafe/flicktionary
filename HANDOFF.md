# Handoff: Make Monorepo Template Modular — Phase 1: Analytics (Sentry + PostHog)

## What was done

All implementation is complete. A central `features.ts` file was created in `packages/core` with `SENTRY` and `POSTHOG` boolean flags. All 4 apps (web, native, landing-page, backend) were updated to gate Sentry and PostHog initialization, logging, event capture, providers, and env config schemas/defaults behind these flags.

Additionally, a sign-out infinite re-render bug was fixed in the web app by replacing `<Navigate>` with a `beforeLoad` route guard on `_authenticated`.

## Verification status

- `pnpm check:types` — all 10 tasks pass
- `pnpm test:run` — all 161 tests pass
- Manual testing: sign-out flow on web works correctly

## What remains

1. **Verify with flags set to `false`**: Change `SENTRY: false` and `POSTHOG: false` in `packages/core/src/features.ts`, then run:
   - `pnpm check:types` — should pass with no type errors
   - `pnpm build` — should succeed for all apps
   - Start the backend with both false — no crashes, no missing env var errors
   - Start the web app with both false — app loads, no PostHog/Sentry console errors

2. **Review and commit**: Review all changes, then commit. The modified files are:
   - `packages/core/src/features.ts` (new)
   - `apps/web/src/app/instrument.ts`
   - `apps/web/src/app/provider.tsx`
   - `apps/web/src/app/main.tsx`
   - `apps/web/src/app/routes/_authenticated.tsx`
   - `apps/web/src/lib/analytics/log-with-sentry.ts`
   - `apps/web/src/lib/analytics/posthog-events.ts`
   - `apps/web/src/stores/auth-store.ts`
   - `apps/web/src/config/environment-config-schema.ts`
   - `apps/web/src/config/environment-config.ts`
   - `apps/web/src/features/auth/components/authenticated-layout.tsx`
   - `apps/web/src/features/profile/components/profile-view.tsx`
   - `apps/web/src/features/billing/components/pricing-view.tsx`
   - `apps/native/src/app/_layout.tsx`
   - `apps/native/src/lib/analytics/sentry-initializer.ts`
   - `apps/native/src/lib/analytics/log-with-sentry.ts`
   - `apps/native/src/lib/analytics/posthog.ts`
   - `apps/native/src/lib/analytics/posthog-events.ts`
   - `apps/native/src/config/environment-config-schema.ts`
   - `apps/native/src/config/environment-config.ts`
   - `apps/native/src/features/auth/components/user-setup-gate.tsx`
   - `apps/native/src/stores/auth-store.ts`
   - `apps/landing-page/src/instrumentation.ts`
   - `apps/landing-page/sentry.server.config.ts`
   - `apps/landing-page/sentry.edge.config.ts`
   - `apps/landing-page/src/lib/analytics/posthog-initializer.ts`
   - `apps/landing-page/src/lib/analytics/posthog-events.ts`
   - `apps/landing-page/src/config/environment-config-schema.ts`
   - `apps/landing-page/src/config/environment-config.ts`
   - `apps/backend/src/transport/third-party/sentry/sentry-initializer.ts`
   - `apps/backend/src/transport/third-party/sentry/error-monitoring.ts`
   - `apps/backend/src/transport/third-party/sentry/log-message-with-sentry.ts`
   - `apps/backend/src/transport/third-party/posthog/posthog-client.ts`
   - `apps/backend/src/server.ts`
   - `apps/backend/src/config/environment-config-schema.ts`
   - `apps/backend/src/config/environment-config.ts`

3. **Sign-out bug fix files** (also included above, but worth noting separately):
   - `apps/web/src/app/routes/_authenticated.tsx` — added `beforeLoad` guard with `redirect`
   - `apps/web/src/features/auth/components/authenticated-layout.tsx` — simplified to pure render logic (no `<Navigate>`, no effects)
   - `apps/web/src/stores/auth-store.ts` — `signOut` takes `onComplete` callback for navigation
   - `apps/web/src/features/profile/components/profile-view.tsx` — passes navigate callback to signOut
   - `apps/web/src/features/billing/components/pricing-view.tsx` — passes navigate callback to signOut

## Key patterns used

- **Feature flag ternaries in config**: `FEATURES.SENTRY ? { dsn: env.SENTRY_DSN, ... } : { dsn: '', ... }` — provides empty defaults when disabled so env vars aren't required
- **Schema relaxation**: `FEATURES.SENTRY ? z.string().min(1) : z.string()` — allows empty strings when the feature is off
- **Guard at function entry**: `if (!FEATURES.SENTRY) return` at the top of init/logging functions — avoids touching 50+ call sites
- **Nullable PostHog client (native)**: `posthog` is `PostHog | null`, call sites use `posthog?.capture()` etc.
- **No-op client (backend)**: `posthogClient` returns a no-op object when PostHog is disabled
- **Auth guard via `beforeLoad`**: TanStack Router's intended mechanism for route guards — no `<Navigate>` component needed
