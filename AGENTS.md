This turborepo monorepo is an attempt at creating a template for quick SaaS iteration. This is a work in progress, don't treat it like a polished product.

The following stack is used:

- Landing page: Typescript React Next.js
- Web: TypeScript React single-page application built with Vite.
- Backend: TypeScript on Node.js backend with Express framework.
- Native: Typescript Expo-managed React Native app with Expo Router.
- Database: Supabase database without an ORM, writing queries directly in the code with Postgres.js as the PostGresSQL client.

Some of the main third-party dependencies:
Data fetching: React Query (web and native only)
Shared API library: oRPC.
State management: Zustand.
i18n: Lingui JS.
Testing: Vitest.
Routing: TanStack Router.

The template is built so that it's easy to deploy this stack, and also have useful features like:

- Authentication (Supabase): Magic link, Google, Apple.
- Payments with Stripe (web) and RevenueCat (native)
- Marketing/Transactional emails with Resend
- Error monitoring with Sentry
- Analytics with Posthog
- Doppler for secrets management and injection.

# Conventions:

TS across all the apps: web, landing-page, backend, native. It's important for you to follow those conventions:

- use const for functions, don't use the "function" keyword
- use ESM when possible.

Here are the prettier rules for code formatting:

- Trailing Commas: Use trailing commas wherever they are valid in ES5 (e.g., in objects, arrays).
- Quotes: Use single quotes for all strings.
- JSX Quotes: Use single quotes for JSX attributes.
- Semicolons: Do not use semicolons at the end of statements.

For our react code style:

- Never import React
  do not do:
  `export const ProgressView: React.FC = () => {`
  just do:
  `export const ProgressView = () => {`

# General guidelines for your answers:

- If you think that a critical file or some context is missing, try to find it yourself, or ask for it to the user.
- Try not to apply "band-aid" solutions: try to fix the root cause of the problem.
- Do not hesitate to refactor the code if it fixes the root cause or simplify the code without changing the functionality.
- Do not write code that is backwards compatible unless explicitly asked to do so. Assume that the code is not yet in production.

## Localization pattern (Lingui)

- Default to Lingui for every user-facing text. Never ship raw strings; wrap them with `t`` template literals as soon as you add copy.
- In React components or hooks, import `useLingui` and call it near the top (`const { t, i18n } = useLingui()`). Use `t``Text`` in JSX/TS, and call `i18n.\_(messageDescriptor)`for shared descriptor maps like`langNameMessages`.
- Outside React (e.g., config files, query meta, utility modules), import `{ t }` from `@lingui/macro` and, when needed, the shared `i18n` instance for lookups. Keep text in template literals so translators see the full sentence.
- When interpolating values, assign them to descriptive variables and reference them inside the template literal (`const savedCount = ...; t`You saved ${savedCount} phrases``). Avoid string concatenation or unnamed `${expression}` chains.
- Do not set custom ids when calling `t`. The English source string remains the id so extraction keeps working without manual bookkeeping.

# Useful commands:

- Check typing with TS: pnpm check:types (executed from the root directory)
- Check linting with ESLint: pnpm lint (executed from the root directory)

# Comments

Rules:

- It's ok to put comments above big chunks of JSX in react components, this way we do not need to extract too many components
- Try to explain why you did something rather than what and how you did it.
- add links to docs above tickets, if the user provided the link.
  example:

```node
 // based on https://elevenlabs.io/docs/api-reference/twilio/outbound-call
 export const initiateCancelCallViaTwilio = async (
```

# Database Types

When the database schema changes (new tables, columns, enums, etc.), regenerate the TypeScript types to keep them in sync.

From the `apps/backend/supabase/supabase-dev-tunnel` directory, with local Supabase running:

```bash
# Public schema (application tables)
supabase gen types typescript --local > database.public.types.ts

# Auth schema (Supabase auth tables)
supabase gen types typescript --local --schema auth > database.auth.types.ts
```

See `apps/backend/src/transport/database/README.md` for usage examples.
