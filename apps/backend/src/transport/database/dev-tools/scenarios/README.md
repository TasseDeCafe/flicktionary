# Dev practice scenarios

> **Status: reference.** How `pnpm dev:scenario` seeds a dev-tunnel account into an exact practice state, and how to add a scenario.

```bash
pnpm dev:scenario                   # list scenarios
pnpm dev:scenario ru-family-due     # seed it, print a sign-in link
pnpm dev:scenario --link            # fresh sign-in link for the current account
pnpm db:advance-day --email dev-scenario@flicktionary.app   # then: "tomorrow"
```

The command wipes the scenario account's content and writes the scenario directly into the
database: cards, `study_facets` SRS state, rating-event history, banked exercises, known
lemmas, and word-family insights. It makes no LLM calls and doesn't need the backend
running. It does need the dev-tunnel Supabase stack (`pnpm db:dev:tunnel`) and, for
`ru-family-due`, the ru kaikki load. Open the printed link and press **Verify**. It lands on the
language's practice screen, or in the reader for a scenario with a reading text. The token is single-use and expires with GoTrue's OTP lifetime.

Every practice timestamp is relative to `NOW()`/`CURRENT_DATE`, the clocks all day logic
compares against (docs/SRS.md), so `pnpm db:advance-day` moves a seeded account like real
data.

## Scenarios

| Name | State |
| --- | --- |
| `ru-family-due` | 8 recognition cards due. Five have word-family relatives the user knows (`known_lemmas`) or saved, with curated cached insights, so the front offers a Clue. Three are opaque controls. Half have a banked hint. |
| `ru-leech-edge` | забывать (recognition, 5 lapses) and внимательный (production, 3 lapses) are one Again from leech parking. Their gate ladders are banked. Three ordinary due cards. |
| `ru-warmup-day2` | The day after a warm-up: five onboarding-parked gates (скучный graduates on a correct answer), two planned introductions, three review cards. |
| `ru-production-hints` | Six production cards due. Five have a banked production hint (`mc_cloze`); сравнивать has none. |
| `ru-production-family` | The `ru-family-due` words as 8 production cards due, same anchors and curated insights. Five offer the meaning-only production Clue (#517), the three opaque ones don't; писатель, водопад and дюжина have a banked hint. |
| `ru-capture-states` | One saved word per "Translate & add" row state, each found by searching its English meaning: собака ("dog", due in 23 days → Review tomorrow), окно (due tomorrow), водопад (learning), читать (no production card), перевод (production paused), писатель (never started → Moved up). Searching дюжина in Russian tests recognition (due in 23 days). |
| `ru-reader-closeout` | An unread text in the reader for the declaration flow (the sign-in link opens it). собака, окно, водопад are due and appear in it (the reviews list); читать appears but isn't due; писатель, дюжина, решение were saved but never practiced; улица was saved two days ago, too recent to offer. The other words are unmarked, for the sweep. Needs the ru kaikki load and ranks, and the backend running so the session's word profile builds. |

## Safety

- Runs only with `NODE_ENV=development-tunnel` (the package script sets it). It refuses any
  database other than `127.0.0.1`/`localhost:34322` and any Supabase auth other than port
  `34321` (`dev-scenario-guard.ts`).
- The reset is destructive, so `--email` must start with `dev-scenario` (default
  `dev-scenario@flicktionary.app`). Reset deletes the account's sessions (and their cards),
  lookups (and their facets, rating events, exercises), known lemmas, lemma lookups, book pins,
  coverage snapshots, import batches, language prefs, and the content sources a scenario created.
- Scenario accounts are not on the test-user allow-list, so admin settings stay hidden.
  Time-travel through `pnpm db:advance-day --email …` instead.

## How it stays faithful to the app

- **No generation on compose.** Every seeded flashcard has a hint-type slot. Hint shows on
  `ready` slots. `failed` slots hide it deterministically: the compose pre-warm and the
  serve-miss top-up both skip a type with a failed slot, while an empty bank would trigger
  generation. Parked and planned-introduction terms get their full gate ladder banked.
  Every flashcard term also gets a cached word-family insight. Terms marked `curated` get the
  catalog's breakdown, replacing what's cached so its parts, meanings and hidden ancestors are
  deterministic. Terms marked `fill` get an opaque entry only when nothing is cached.
- **Prerequisites before the wipe.** `prepareScenario` resolves each insight key the way the
  app does (`loadWordFamilyEntries` + `pickFamilyEntries`) and refuses curated words with no
  single dictionary lemma.
- **Read-back.** After seeding, the CLI rebuilds every expected family line through
  `buildWordFamily` (the flashcard's own path) and fails on any anchor mismatch.
- `seed-scenario.integration.test.ts` seeds every scenario on the test stack. It asserts the
  promised session-plan counts, hint availability per card, and zero LLM calls (counted, since
  the background warmers swallow errors). It also covers the word-family path on synthetic
  dictionary fixtures.

## Adding a scenario

1. Add any new words to `ru-catalog.ts`. Hand-write the exercise sentences; offsets are
   computed at seed time. Add an `insight` for words whose family line matters.
2. Add a `ScenarioSpec` to `scenarios.ts`. `expectations.preview` must match what the landing
   shows. The integration test enforces it, along with `familyAnchors` if you set them.
3. Give every flashcard a hint-type slot and an `insight` mode, and every parked or unseen term
   its full ladder, or the compose will generate.
