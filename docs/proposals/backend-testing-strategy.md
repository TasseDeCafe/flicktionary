# Backend testing strategy

> **Status: proposal.** Assessment of the backend test suite (patterns, coverage, flakiness) and a plan for where to invest. Not yet implemented.

## Current state

Counts (2026-07-13): 48 `*.unit.test.ts` files, 24 `*.integration.test.ts` files in `apps/backend/src`.

**Unit tests** are in good shape. The dominant style extracts pure functions and feeds them hand-built row objects (`service/practice/*.unit.test.ts`, `service/lesson-import/extract-lesson-job.unit.test.ts`) — fast, no mocking framework. The LLM passes are unit-tested at the parser level against static strings (`transport/third-party/anthropic/passes/*.unit.test.ts`). Only 6 files use `vi.mock` module mocking, all clustered around one cause: the Anthropic client is a module singleton (`getAnthropicClient()` in `transport/third-party/anthropic/anthropic-client.ts`), not injectable, so services that call the LLM (`processing/enrich-highlight`, `chat/run-card-chat`, `study-facets/*`, `adhoc/create-adhoc-card`) have to patch modules.

**Integration tests** split into two clusters:

- Template-era Express routers: billing, checkout, removals, auth, portal-session, user, user-prefs, contact-email, plus the stripe/revenuecat/telegram webhooks and `subscription-middleware`.
- Repository-level SQL tests: `study-facets`, `user-lookups` (list-review-terms-facets, vocab-stage-filters), `ghost-candidates`, `processing-jobs`, `users`, subscriptions, `shift-practice-timestamps`.

**Gap:** the Flicktionary oRPC surface — practice, cards, glosses, highlights, content-sources, study-sessions, lesson-import, card-chat, ghosts, chunks, text-tracks/segments — has zero integration tests. No test mounts an oRPC router and drives it over HTTP. `service/long-running/` (enrichment-worker, telegram-polling-worker, subscription-cache) has no tests at all.

A full integration run takes ~40s against the `supabase-test` stack (ports 64xxx), strictly serial (`maxWorkers: 1`, `fileParallelism: false`, `retry: 2` in `apps/backend/vitest.config.mts` — all three inherited from the template's initial commit).

## Assessment

### The mocking pattern is right — keep it

`buildApp(AppDependencies)` (`src/app.ts`) with hand-rolled interface fakes (`MockStripeApi`, `MockTelegramApi`, …) is ports-and-adapters: the interface is scoped to the operations *we* use (StripeApi = 6 methods), not the vendor's full API. Alternatives are worse here:

- `vi.mock` module mocking: no compile-time link between mock and interface, hoisting quirks, action-at-a-distance.
- HTTP interception (msw/nock): replaces "write a 6-method fake" with "author Stripe's wire-format JSON fixtures". Only worth it to test the client's own serialization/error handling.
- Vendor emulators (stripe-mock): heavy, per-vendor, doesn't generalize to Anthropic/TMDB.

Two refinements, not rewrites:

- The per-method files (`stripe/cancel-subscription/mock-cancel-subscription.ts`, …) are ceremony; one `Mock<X>Api` object literal per vendor is enough.
- Prefer recording fakes (`MockTelegramApi` captures `sentMessages`) over ad-hoc `let called = false` closures in tests.

### The one real inconsistency: Anthropic is outside the DI seam

`AppDependencies` covers stripe/resend/revenuecat/telegram plus a few repos and workers; Anthropic, TMDB, and OpenSubtitles have no mock and no injection point. Anthropic is the heart of the app and the only reason `vi.mock` exists in the service tests. Making the client (or the pass layer) injectable with a scripted fake removes the module mocking and unblocks integration tests of LLM-adjacent flows without network.

### Integration coverage should grow — a little, in one place

The missing failure modes are exactly what pure unit tests can't see:

- Wiring and auth: ~20 repos are constructed inline in `buildApp`; nothing verifies the assembly.
- Contract/DTO drift: oRPC output validation, the `timestamptz` Date-vs-ISO-string trap (`AGENTS.md`).
- SQL in composition: multi-table service flows (rate-term → facet update → rating event), transactions.

Scenario coverage stays in the unit tests; integration tests assert the plumbing.

## Plan

1. **Make the Anthropic client injectable** with a scripted fake (canned per-pass outputs). Kills most `vi.mock` usage; unblocks everything below. Inject TMDB/OpenSubtitles the same way when their code first needs a test, not preemptively.
2. **Add ~6–10 golden-path oRPC integration tests**: practice (compose queue → rate → resume), cards/review editing, glosses, highlights, lesson-import, study-sessions. Golden path + one auth failure each; not exhaustive scenarios. Written with per-test unique users from day one (no global truncation) so they never join the serialization problem.
3. **Opportunistic cleanup** (as files are touched, not a sweep): collapse per-method `mock-*.ts` files into single Mock objects; recording fakes over boolean-flag closures.
4. **Test the enrichment-worker driver** (`service/long-running/enrichment-worker`) once (1) lands.
5. **De-flake, then re-parallelize** (see below): migrate old integration tests off global truncation, re-enable `fileParallelism`, drop `retry: 2`. **Implemented** — see "Fix directions" below.

Explicitly not planned: broadly adding unit tests (pure-logic coverage is already good — keep adding them with new code), or integration-testing every router.

## Flakiness

History: the suite was parallel, flaked, was serialized (`fileParallelism: false`), and still rarely flakes — hence `retry: 2`. A third retry is almost never needed; root cause never found.

Structural suspects found by inspection:

- **Swallowed cleanup errors** (`src/test/test-utils.ts`, `__removeAllAuthUsersFromSupabase`): supabase-js returns `{ error }` instead of throwing; the `listUsers` error path just logs and returns, and the `deleteUser` result is discarded entirely. Any transient GoTrue/Kong hiccup silently leaves stale auth users; the next test's `createUser('some@email.com')` then fails with "already registered", and the retry (which re-runs `beforeEach`) cures it. Matches the observed signature: rare, one retry suffices.
- **Shared hardcoded emails**: 72 no-arg `__createUserInSupabaseAndGetHisIdAndToken()` calls across 17 integration files all create the same default `john@gmail.com`, and the helper throws on "already registered". Every one of those creates depends on the immediately preceding wipe having succeeded — one swallowed wipe failure anywhere and the next create in any file fails.
- Under the old parallel mode, global truncation guarantees cross-file interference (file A wipes file B's users mid-test) — that flakiness was by construction, not mysterious.

Empirical runs (2026-07-13, M-series laptop, supabase-test warm):

- Serial runs with `--retry=0`: **3 failures in 30 runs** (~10% per-run, each a different test, each would have passed on one retry — matching the observed "retry cures it" behavior). The three caught signatures:
  1. `user-router` — second `PUT /users/me` for the same user returned 404 right after the first returned 200 (same signature later caught on `telegram-pair-router`). No server-side error logged. **Root cause found and reproduced — see "The serial flake: root cause" below.**
  2. `revenuecat-subscriptions-repository` "should update an existing subscription" — `updated_at` came out 5ms **earlier** than `created_at`. Mechanism confirmed: `created_at` is a DB `now()` default while `updated_at` is a JS-side `new Date()` passed through `upsertSubscription` — two different clocks (Node vs Postgres-in-Docker), so millisecond drift occasionally flips `expect(updated_at >= created_at)`. Fix: don't compare timestamps from different clocks — assert against the value the test passed in.
  3. `telegram-webhook-router` "returns 401 when the secret token header is wrong" — `Error: socket hang up` at the supertest layer. The JSON body *is* drained before the 401 (ruled out the early-response/unread-body race), so this is the known supertest/Node teardown race (per-request ephemeral server closing connections). Generic HTTP-layer flake, not app logic.
- 3 runs with `--fileParallelism --maxWorkers=4` (the original flaky config): **3/3 failed**, ~19s each, 15–25 tests failing per run across billing/checkout/portal-session/removals/user-router/user-prefs/webhook and even repository files. The signature is uniform: `Failed to create user in supabase: A user with this email address has already been registered` thrown at `test-utils.ts:101`, plus downstream 404/500s and count assertions seeing other files' rows. This is cross-file interference by construction — every file wipes **all** auth users in `beforeEach` and most create the same default `john@gmail.com` — not an environmental mystery.

Ruled out by inspection: rate limiting (off in `testConfig`), stripe webhook response-vs-processing race (handler awaits before 200), telegram pending-import ordering (DB write precedes `sendMessage`), `payment-utils` time math (fixed dates — and no DB usage; it was misfiled as an integration test and has since been renamed to `.unit.test.ts`). No `ECONNRESET`/`fetch failed`/GoTrue error traces appeared in any passing-run log, so transient local-stack errors are rare at serial pace.

One more structural fragility: JWKS is fetched over HTTP from local GoTrue (`jwks-rsa`, cached 10 min per process) but vitest isolates each test file in a fresh worker, so every file re-fetches; a transient failure there would 401 an entire file and vanish on retry.

## The serial flake: root cause

Reproduced standalone (outside vitest) by hammering `PUT /users/me` through supertest: ~1 naked 404 (empty body, `content-length: 0`) per ~3,000 requests, plus occasional `Parse Error: Expected HTTP/...` whose raw packet decoded to `{"type":"Tier1","version":"1.0"}\r\n` — bytes that exist nowhere in the repo or its dependencies. They come from **another process on the machine**.

Mechanism: `request(app)` makes supertest spin up a throwaway HTTP server per request via `listen(0)`, which binds the dual-stack IPv6 wildcard `[::]:P` — but the client then dials `127.0.0.1:P`. If any co-resident app holds a *specific IPv4 loopback* bind on that same ephemeral port, the kernel routes the connect to the more specific socket: the foreign app answers the test's request. On the machine where this was diagnosed, WebStorm's auxiliary listeners (127.0.0.1:53862/53872/64342 — all inside the macOS ephemeral range 49152–65535) answer any HTTP request with exactly `404 Not Found, Content-Length: 0`; PyCharm, Spotify, and rapportd squat other ports in the range. Depending on which squatter is hit, the test sees a bare 404, a `socket hang up`, or protocol garbage.

This explains every property of the mystery: rare (a handful of squatted ports out of ~16k ephemerals), cures on one retry (next request gets a new port), no server-side error ever logged (the app never saw the request), unfindable from inside the test code, and worse on dev machines running IDEs than anywhere else.

Fix (**implemented**: `apps/backend/src/test/bind-loopback.setup.ts`, loaded via `setupFiles` in `vitest.config.mts`): make the supertest server bind IPv4 loopback explicitly, so the kernel can only assign a port that is actually free on `127.0.0.1`. The setup file patches `net.Server.prototype.listen` to rewrite a bare `listen(0)` (supertest's exact call) — one file covers all 24 existing integration files and every future `request(app)` call; the patch condition (`port === 0 && no host`) keeps it away from anything else.

One subtlety, discovered the hard way: the rewrite cannot simply be `listen(0, '127.0.0.1')`. supertest reads `server.address()` *synchronously* right after `listen(0)` returns, which works because a host-less bind is synchronous — but adding a host string routes through `dns.lookup` and binds asynchronously, so `address()` is still null and supertest crashes. The shim instead pre-binds a handle with `net._createServerHandle('127.0.0.1', 0)` (the internal primitive Node's cluster module uses; stable for years) and passes it to `listen(handle)`, which sets up synchronously. The setup file fails loudly if that internal ever disappears.

Verified: 0 bad requests in 30k against an explicitly-bound server (concept), 0 in 20k through supertest's default `request(app)` path with the shim loaded (implementation), vs ~1/3,000 before.

## Fix directions for flakiness

Note on parallelization: the loopback-bind fix and the truncation problem are **independent blockers**, and re-enabling `fileParallelism` needs both. The port hijack is per-request and environmental — it flakes serial and parallel runs equally, and fixing it does nothing about files wiping each other's users. Conversely, per-test unique users without the bind fix would leave parallel runs flaking at the HTTP layer. Land 1 and 4 below, then parallelism is safe.

In priority order:

1. **Bind supertest servers to `127.0.0.1`** (see above) — kills the dominant serial flake (404s, socket hang-ups, parse garbage). **Implemented** (`src/test/bind-loopback.setup.ts`).
2. **Fix the cross-clock timestamp assertion** in `revenuecat-subscriptions-repository.integration.test.ts` — assert `updated_at` against the value the test passed in, not against the DB-clock `created_at`. **Implemented.**
3. Make cleanup helpers throw on error instead of swallowing (`listUsers`, `deleteUser` results in `__removeAllAuthUsersFromSupabase`) — defense in depth; a swallowed wipe failure turns into a confusing "already registered" error one test later. **Superseded by 4**: the wipe helpers (`__removeAllAuthUsersFromSupabase`, the `__deleteAll*` table wipes) were deleted outright once nothing called them.
4. Move tests to per-test unique users (`__generateUniqueId` for emails) and per-test cleanup; drop `beforeEach` global truncation. This is what unblocks parallelism (the parallel failure mode is interference by construction). **Implemented**: `__createUserInSupabaseAndGetHisIdAndToken` defaults to a unique email (and returns it), the initial-state helpers default to unique emails/stripe ids, telegram chat ids come from `__generateUniqueTelegramChatId`, and the handful of whole-table assertions (`getAllActiveSubscriptions`, `retrieveAllUsersCreatedLessThanNDaysAgo`, removals/auth-users) were scoped to test-owned rows. Rows accumulate in the never-reset test DB by design; anything a test asserts on is keyed by a per-test unique value. Two casualties worth knowing: `shift-practice-timestamps` no longer exercises the unscoped shift-everyone path (it would rewrite concurrent tests' SRS rows), and `mockGetSubscriptions` now derives its subscription id from the customer id — the fixed `sub_mock_123` was a globally-unique upsert target that concurrent syncs (revenuecat webhook vs `billing-service`) fought over, a flake that only existed under parallelism.
5. After 1–4: re-enable file parallelism and remove `retry: 2`; real failures then fail loudly and stay diagnosable, and the suite gets several times faster. **Implemented**: `maxWorkers: 4` (8 workers measured no faster — import time dominates — and adds Postgres connection pressure). Measured on the same M-series laptop: serial ~27–33s, parallel ~8.5–10.5s (~3×); 40 consecutive parallel runs green with retry 0.
