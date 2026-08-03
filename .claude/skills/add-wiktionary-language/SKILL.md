---
name: add-wiktionary-language
description: Adds (or removes) a target language to the Kaikki/Wiktionary grounding pipeline — the loader, the grounding service, the shared grammar config, and any language-specific extractors. Run this when the user asks to ground a new study language against Wiktionary, NOT for UI locales (see `manage-locale` for that).
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash(pnpm:*), Bash(doppler:*), Bash(grep:*), Bash(gzip:*), Bash(psql:*)
---

You are adding a language code (e.g. `de`, `fr`, `es`) to the set of languages whose cards get grounded against the Kaikki Wiktionary dump. This is *separate* from UI locales — don't touch Lingui files.

The grounding pipeline has three moving parts, all keyed on a two/three-letter `lang_code` matching kaikki's value:

1. **Loader** — `LOAD_LANGUAGES` in `apps/backend/scripts/kaikki-languages.ts` decides which `lang_code` values survive the filter when `scripts/load-kaikki.ts` streams the raw `raw-wiktextract-data.jsonl.gz` dump into `wiktionary_entries` / `wiktionary_forms`. The standalone redirect rebuilder (`scripts/build-wiktionary-redirects.ts`) and `scripts/build-lemma-ranks.ts` import the same list; only `scripts/export-wordfreq.py` keeps its own `DEFAULT_LANGUAGES`.
2. **Grounding allowlist** — `KAIKKI_LANGUAGES` in `packages/core/src/constants/language-grammar.ts` is the single set gating everything: backend grounding, the focus view's "Wiktionary" badge, and checkpoint reviews. (There is no separate backend config file.)
3. **Per-language extractor** — `apps/backend/src/service/wiktionary-grounding/extract.ts` owns a `LANGUAGE_EXTRACTORS` registry (per-POS parsers + a `skipDisplayForm` flag per language; no if/else chain — adding a language is one registry entry at most). The default path (generic POS + IPA) works for most languages. IPA bucketing lives in `extract/ipa.ts`: English GA/RP from region tags, Portuguese BR/EU from bare `Brazil`/`Portugal` tags, Spanish Castilian/LatAm via the θ-twin rule over untagged variants; every other language keeps the `untagged` bucket.

Always read the current state of these files before editing — the example values below were correct at the time of writing but the sets change as languages are added.

## Adding a language

For a brand-new language code `<code>` (kaikki's `lang_code`, e.g. `de` for German):

1. **Loader** — in `apps/backend/scripts/kaikki-languages.ts`, append `<code>` to `LOAD_LANGUAGES`:

   ```ts
   export const LOAD_LANGUAGES = ['ru', 'en', '<code>'] as const
   ```

   No other loader change is needed: the filter writes `lang_code` per row, the CSVs are language-tagged, and the workflow caches by gzipped raw dump.

2. **Redirects/ranks defaults** — nothing to do for the TS scripts (`build-wiktionary-redirects.ts` and `build-lemma-ranks.ts` import `LOAD_LANGUAGES`); the Python wordfreq list comes later, step 11.

3. **Grounding allowlist** — in `packages/core/src/constants/language-grammar.ts`, add the code to `KAIKKI_LANGUAGES` (the single set — backend gates and web badges both read it). Note the blast radius: this set also hard-gates **checkpoint reviews** (docs/SRS.md §6b) — adding the language turns on the reader-footer / close-out / extension checkpoint affordances for it, so the checkpoint-matching decisions in the step below are part of shipping, not optional polish.

4. **Per-language grammar config** — in the same file, add (or extend) the `LANGUAGE_GRAMMAR[<code>]` entry. The fields you list drive what the focus view *and* the practice rate sheet render as chips (both consume `getLanguageGrammarConfig`), and what the focus view's editable panel exposes. The renderer narrows this list further by part-of-speech via `getEffectiveGrammarFields(targetLanguage, pos)` — POS-specific keys (e.g. `aspect` for verbs, `gender` for nouns) live in `POS_SPECIFIC_FIELDS` in the same file and apply across languages, so the language config just decides which keys even exist for that language. `ipa` is editable and dialect-aware: `FocusView` shows the picked bucket via `pickIpa(...)` above the chips, and the editable panel writes back to the correct bucket (`ga`/`rp`/`untagged`) based on the user's `englishIpaDialect` pref. Example shape:

   ```ts
   de: {
     fields: ['pos', 'display_form', 'ipa', 'gender', 'government', 'notable_forms', 'notes'],
     hints: {
       display_form: { label: 'Display form', placeholder: 'e.g. das Haus' },
       government: { placeholder: 'e.g. + dat, + akk' },
       ipa: { label: 'IPA' },
     },
   },
   ```

5. **Extractor decisions** — in `apps/backend/src/service/wiktionary-grounding/extract.ts`:

   - **Default path is often enough.** `extractGrammarPatch(entry, langCode)` falls through to `pos = POS_KAIKKI_TO_GRAMMAR[posRaw]` for any langCode not explicitly handled. For non-English languages, IPA extraction only keeps `sounds[]` entries with no tags (`untagged` bucket), and display-form extraction runs unless the language is explicitly skipped. Do not assume this is correct until you inspect real raw dump entries for the new language.

   - **5a. Language-specific POS extraction.** Only add if Russian/German-style template parsing would meaningfully help (gender, aspect, plural, etc.). Add a `LANGUAGE_EXTRACTORS[<code>]` registry entry with a `byPos` map (see the `ru`/`de` entries) plus an `extract/<code>.ts` module — no if/else chain.

     ```ts
     const LANGUAGE_EXTRACTORS: Record<string, LanguageExtractor> = {
       // ...
       '<code>': { byPos: { noun: extract<Code>Noun } },
     }
     ```

   - **5b. Display-form quirks.** en/de/es/pt skip `extractDisplayForm` because their head_template expansions are noisy whole head lines ("dictionary (plural dictionaries)", "pie m (plural pies)") — a card title, not a display form. Watch for the bullet: `extractDisplayForm` strips everything past ` • `; a language WITHOUT that separator (es/pt) returns the entire expansion, which is almost never wanted. If the new language has the same problem, set `skipDisplayForm: true` in its `LANGUAGE_EXTRACTORS` entry. Check by hand against a few entries before deciding.

   - **5c. Dialect-bucketed IPA.** Only needed for languages where users pick between dialect variants (English GA/RP from region tags; Portuguese BR/EU from bare `Brazil`/`Portugal` tags; Spanish Castilian/LatAm via the θ-twin rule — see `extract/ipa.ts`). Don't add buckets speculatively — `untagged` works for everything else. A new dialect split needs the full pref flow: `IpaBagShape`/`GrammarIpaBagSchema` keys, a DB column + migration, the `setIpaDialect` contract union arm, `pickIpa`/`hasDisplayableIpa`/`pickIpaForDisplay` resolution, the settings row + `IpaDialectFlag` entry, LLM steering (language-instructions dialect block + `grammar-tool-schema` + `sanitizeGrammarIpa`), and the export labels in `build-vocabulary-csv.ts`.

   - **5d. IPA tag validation.** Before trusting the default untagged IPA behavior, inspect several real entries from the raw dump:

     ```bash
     gzip -cd apps/backend/scripts/.cache/kaikki/raw-wiktextract-data.jsonl.gz \
       | grep -m 5 '"lang_code":"<code>"'
     ```

     Look specifically at `sounds[]`. If useful IPA is consistently tagged (regional, standard, dialect labels, etc.), add language-specific IPA handling and tests instead of silently dropping it.

6. **Checkpoint-matching decisions** — checkpoint reviews (docs/SRS.md §6b) match span tokens against the user's vocab through language-keyed folding and particle rules. For each, the default path may be fine, but decide explicitly:

   - **Fold twins.** `foldCheckpointToken` in `packages/core/src/utils/checkpoint-fold.ts` and the SQL function `public.checkpoint_fold` are byte-for-byte twins (the SQL side feeds expression indexes on `wiktionary_forms`/`wiktionary_entries`/`wiktionary_form_redirects`). The default fold (strip U+0301, NFC, trim, lowercase) covers most languages; add a per-language orthography fold ONLY if the language has variant spellings that must unify (existing: ru `ё`→`е`, de `ß`→`ss`, fr `’`→`'` + `œ`/`æ` digraphs + leading elision-clitic strip). If you add one, change BOTH sides in lockstep — the SQL side via a NEW migration that re-creates the function — and extend the shared vectors in `checkpoint-fold.unit.test.ts` plus the SQL-vs-TS parity test (`checkpoint-fold-parity.integration.test.ts`).

     **Never put `REINDEX` of the checkpoint_fold expression indexes inline in the migration.** The Supabase GitHub integration replays migrations against the LIVE prod database, and reindexing the multi-million-row expression indexes holds an AccessExclusive lock while recomputing the fold per row — the French-fold attempt took prod down for ~9 minutes mid-rebuild (2026-08-03; the July es/pt load hit the same wall). Decide by what the fold changes:
     - **New language branch only** (existing languages' output byte-identical): no rebuild is needed at all — existing index entries are still correct, and the language's own rows arrive later via the loader, which computes them with the new function.
     - **Output changes for an already-loaded language**: the indexes really are stale, but rebuild them OUT-OF-BAND — `REINDEX INDEX CONCURRENTLY` via psql during a low-traffic window, after the migration lands — never as a migration statement.
   - **Headword particles.** `foldUserHeadwordCandidates` (same file) de-particles LLM-normalized headwords so `to run`/`sich freuen` match the kaikki lemma. If the new language's citation convention prefixes a particle, add the strip rule.
   - **MWE particles.** `MWE_PARTICLES` in `apps/backend/src/service/checkpoint/checkpoint-matching.ts` lists function words dropped when splitting a multi-word headword into content lemmas. Add the language's function words if MWEs are common in it; an absent entry just means no words are dropped. `isMweHeadword` (same file) decides what even counts as an MWE — French adds hyphens because its compounds (`peut-être`) tokenize apart; consider whether the new language needs the same.
   - **Real-word token pattern.** `REAL_WORD_TOKEN_PATTERNS` in `apps/backend/src/service/lemma-ranks/build-ranking.ts` needs a regex for the language (it THROWS for unknown languages, and checkpoint claims/known-lemma flows run tokens through it). The pattern sees checkpoint_fold OUTPUT — write it for post-fold text (e.g. fr never sees `œ` or a leading `l'` because the fold rewrote them).
   - A redirects rebuild needs no separate step — `load-kaikki.ts` rebuilds `wiktionary_form_redirects` in the same run (locally and in the prod workflow).

7. **LLM steering** — add a language block in `apps/backend/src/transport/third-party/anthropic/language-instructions.ts` (headword citation conventions, per-field fill rules, which `grammar.ipa` bucket to fill) and register its aliases in `LANGUAGE_INSTRUCTIONS` (or a builder if the language has a dialect pref). Without one the model gets zero language-specific guidance. The grammar tool schema needs no per-language change — it derives from `LANGUAGE_GRAMMAR`.

8. **Unit tests** — extend `apps/backend/src/service/wiktionary-grounding/extract.unit.test.ts`. At minimum, add:

   - A fixture for the new langCode that exercises the generic POS fallback and asserts the Russian-specific extractors do *not* fire (`gender`, `aspect`, etc. should be undefined for non-`ru`).
   - An IPA fixture covering the untagged path.
   - If you added 5a/5b/5c logic, fixtures for the new behavior.

9. **Type / lint check**:

   ```bash
   pnpm check:types
   pnpm lint
   pnpm --filter @flicktionary/backend exec vitest run src/service/wiktionary-grounding
   ```

10. **Local data load** — the loader downloads the raw dump (~2.5 GB gz) once, filters by `LOAD_LANGUAGES`, COPYs into the tables, rebuilds `wiktionary_form_redirects`, and rewrites the on-disk reference-table snapshot at `apps/backend/scripts/.cache/wiktionary/wiktionary.dump` (see `scripts/snapshot-reference-tables.ts`) that `pnpm db:reset` replays. After changing `LOAD_LANGUAGES`, the existing snapshot is stale (it doesn't have the new language). Run:

   ```bash
   doppler run -- pnpm --filter @flicktionary/backend load:kaikki
   ```

   The dev-tunnel Supabase stack must be running first (`pnpm db:dev:tunnel`). The loader connects to `127.0.0.1:34322`, truncates/reloads `wiktionary_entries` / `wiktionary_forms`, and snapshots the result from the `supabase_db_supabase-dev-tunnel` container. Then sanity-check all enabled languages landed:

   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 34322 -U postgres -d postgres \
     -c "SELECT target_language, COUNT(*) FROM public.wiktionary_entries GROUP BY 1 ORDER BY 1;"
   ```

   From then on `pnpm db:reset` will restore all enabled languages from the snapshot in seconds.

11. **Lemma-ranks build** — the personalized difficulty stat and coverage read only treat a language as supported once it has a `lemma_rank_builds` row (docs/DATA-MODEL.md § Lemma frequency ranks), so a new grounded language also needs a ranks build. Check first that wordfreq even covers the language (`top_n_list` in `scripts/export-wordfreq.py` throws for unsupported codes) — if it doesn't, the language ships without difficulty support and you're done. Otherwise, add `<code>` to `DEFAULT_LANGUAGES` in `scripts/export-wordfreq.py` (the TS ranks script already imports `LOAD_LANGUAGES`), then:

    ```bash
    pnpm --filter @flicktionary/backend export:wordfreq <code>
    pnpm --filter @flicktionary/backend build:lemma-ranks <code>
    ```

    The build fails loud below the 95% mass-matched acceptance threshold instead of publishing a degraded list — investigate resolution misses rather than lowering the bar. A successful local run also refreshes the reference-table snapshot, so `pnpm db:reset` keeps the ranks.

12. **Production data load** — done out-of-band by manually triggering `.github/workflows/load-kaikki-prod.yaml` from `main` during a low-traffic window. The TRUNCATE+COPY temporarily knocks grounding offline for in-flight cards (and checkpoint matching with it), so don't auto-trigger. The run rebuilds `wiktionary_form_redirects` too — no separate redirect step. If the cached gz dump is stale and you want to force a fresh download, bump the cache key in the workflow (`kaikki-raw-v1` → `kaikki-raw-v2`). The prod lemma-ranks build is a separate manual step after the load lands: `doppler run --config prd -- npx tsx scripts/build-lemma-ranks.ts <code>` (per-language atomic publish; safe while the app is live).

## Removing a language

Reverse of adding, in roughly this order to keep types happy:

1. Remove from `LANGUAGE_GRAMMAR` (or downgrade the config to a minimal entry — the focus view will fall back to `DEFAULT_GRAMMAR_CONFIG` when omitted).
2. Remove from `KAIKKI_LANGUAGES` in `packages/core/src/constants/language-grammar.ts` (the single allowlist).
3. Remove from `LOAD_LANGUAGES` in `apps/backend/scripts/load-kaikki.ts` and from `DEFAULT_LANGUAGES` in `scripts/build-wiktionary-redirects.ts`.
4. Remove the language's `LANGUAGE_EXTRACTORS` entry, any `extract/<code>.ts` module, and their tests.
5. If the language had a dialect split, unwind the pref flow too (bag keys, DB column, contract arm, settings row, steering).
6. Remove any checkpoint fold/particle branches added for the language (`foldCheckpointToken` needs its SQL twin changed via a NEW migration in lockstep, plus the parity vectors; `foldUserHeadwordCandidates` / `MWE_PARTICLES` are TS-only).
7. `pnpm check:types` + tests.
8. Remove the language from `DEFAULT_LANGUAGES` in `scripts/export-wordfreq.py` + `scripts/build-lemma-ranks.ts` (if it was ever added) and delete its rows from `lemma_ranks` / `lemma_rank_builds` by hand — the build script only touches languages it's asked to build, so nothing deletes them automatically.
9. Re-run `doppler run -- pnpm --filter @flicktionary/backend load:kaikki` to drop the language's rows from the local tables and refresh the snapshot (redirects rebuild in the same run). Trigger the prod workflow when ready.

Existing user cards in the removed language keep whatever `groundedAt`/`grammar` they already had — there's no automatic rollback. That's intentional.

## Notes

- The `lang_code` you add must match kaikki's exact value (the JSONL's `lang_code` field). Spot-check by piping a few raw lines through `gzip -cd apps/backend/scripts/.cache/kaikki/raw-wiktextract-data.jsonl.gz | grep -m 5 '"lang_code":"<code>"'`.
- The new language must also be present in `packages/core/src/constants/supported-languages.ts` (otherwise it can't be selected as a target language in the first place). That's a separate change and not gated by this skill — confirm before starting.
- Don't write `ipa` chips into `GrammarChips` — IPA isn't a chip in the UX. `FocusView` picks the displayed value with `pickIpa(...)` and renders it above the chips; the editable panel surfaces an editable `Input` for the active bucket (`ga`/`rp` for English by user pref, `untagged` otherwise); the practice rate sheet uses the same `pickIpa(...)` to render IPA as a subtitle line under the headword.
- Don't try to load data through `pnpm db:reset` — that script *only* replays the snapshot. To regenerate the snapshot you must run the loader.
