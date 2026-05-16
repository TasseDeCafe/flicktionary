---
name: add-wiktionary-language
description: Add (or remove) a target language to the Kaikki/Wiktionary grounding pipeline — the loader, the grounding service, the shared grammar config, and any language-specific extractors. Run this when the user asks to ground a new study language against Wiktionary, NOT for UI locales (see `manage-locale` for that).
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash(pnpm:*), Bash(doppler:*), Bash(grep:*), Bash(gzip:*), Bash(psql:*)
---

You are adding a language code (e.g. `de`, `fr`, `es`) to the set of languages whose cards get grounded against the Kaikki Wiktionary dump. This is *separate* from UI locales — don't touch Lingui files.

The grounding pipeline has four moving parts, all keyed on a two/three-letter `lang_code` matching kaikki's value:

1. **Loader** — `apps/backend/scripts/load-kaikki.ts` decides which `lang_code` values survive the filter when streaming the raw `raw-wiktextract-data.jsonl.gz` dump into `wiktionary_entries` / `wiktionary_forms`.
2. **Grounding allowlist (backend)** — `apps/backend/src/service/wiktionary-grounding/config.ts` decides whether grounding runs at all for a card's `targetLanguage`.
3. **Grounding allowlist (shared)** — `packages/core/src/constants/language-grammar.ts` mirrors the backend set so the focus view can render the "Wiktionary" badge correctly.
4. **Per-language extractor** — `apps/backend/src/service/wiktionary-grounding/extract.ts` decides what to pull out of each entry. The default path (POS only + IPA) works for most languages; only Russian currently has language-specific noun/verb logic, and English has dialect-bucketed IPA + a display-form skip.

Always read the current state of these files before editing — the example values below were correct at the time of writing but the sets change as languages are added.

## Adding a language

For a brand-new language code `<code>` (kaikki's `lang_code`, e.g. `de` for German):

1. **Loader** — in `apps/backend/scripts/load-kaikki.ts`, append `<code>` to `LOAD_LANGUAGES`:

   ```ts
   const LOAD_LANGUAGES = ['ru', 'en', '<code>'] as const
   ```

   No other loader change is needed: the filter writes `lang_code` per row, the CSVs are language-tagged, and the workflow caches by gzipped raw dump.

2. **Backend grounding allowlist** — in `apps/backend/src/service/wiktionary-grounding/config.ts`, add to `KAIKKI_ENABLED_LANGUAGES`. Both sets must agree.

3. **Shared grounding allowlist** — in `packages/core/src/constants/language-grammar.ts`, add the same code to `KAIKKI_LANGUAGES`. (Mirror of the backend set; used by the focus view's grounding badge.)

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

   - **5a. Language-specific POS extraction.** Only add if Russian-style verb/noun template parsing would meaningfully help (gender, aspect, animacy, etc.). Gate on the new langCode the same way the Russian extractors are gated:

     ```ts
     if (langCode === 'ru' && posRaw === 'verb') patch = extractVerb(entry)
     else if (langCode === 'ru' && posRaw === 'noun') patch = extractNoun(entry)
     else if (langCode === '<code>' && posRaw === '<pos>') patch = extract<Code><Pos>(entry)
     else patch = { pos: POS_KAIKKI_TO_GRAMMAR[posRaw] }
     ```

   - **5b. Display-form quirks.** English skips `extractDisplayForm` because the head_template expansion is noisy ("dictionary (plural dictionaries)") and confuses learners. If the new language has the same problem, add it to the skip list:

     ```ts
     const display = langCode === 'en' || langCode === '<code>' ? null : extractDisplayForm(entry)
     ```

     Check by hand against a few entries before deciding — most languages are fine with the default.

   - **5c. Dialect-bucketed IPA.** Only needed for languages where users will pick between dialect variants (currently only English: GA vs RP, driven by `users.english_ipa_dialect`). Don't add buckets speculatively — `untagged` works for everything else. If a new dialect preference is needed, you'll also need a new DB column + migration + user-prefs contract field + selector component, mirroring the English flow.

   - **5d. IPA tag validation.** Before trusting the default untagged IPA behavior, inspect several real entries from the raw dump:

     ```bash
     gzip -cd apps/backend/scripts/.cache/kaikki/raw-wiktextract-data.jsonl.gz \
       | grep -m 5 '"lang_code":"<code>"'
     ```

     Look specifically at `sounds[]`. If useful IPA is consistently tagged (regional, standard, dialect labels, etc.), add language-specific IPA handling and tests instead of silently dropping it.

6. **Unit tests** — extend `apps/backend/src/service/wiktionary-grounding/extract.unit.test.ts`. At minimum, add:

   - A fixture for the new langCode that exercises the generic POS fallback and asserts the Russian-specific extractors do *not* fire (`gender`, `aspect`, etc. should be undefined for non-`ru`).
   - An IPA fixture covering the untagged path.
   - If you added 5a/5b/5c logic, fixtures for the new behavior.

7. **Type / lint check**:

   ```bash
   pnpm check:types
   pnpm lint
   pnpm --filter @flicktionary/backend exec vitest run src/service/wiktionary-grounding
   ```

8. **Local data load** — the loader downloads the raw dump (~2.5 GB gz) once, filters by `LOAD_LANGUAGES`, COPYs into the tables, and rewrites the on-disk snapshot at `apps/backend/scripts/.cache/wiktionary/wiktionary.dump` that `pnpm db:reset` replays. After changing `LOAD_LANGUAGES`, the existing snapshot is stale (it doesn't have the new language). Run:

   ```bash
   doppler run -- pnpm --filter @flicktionary/backend load:kaikki
   ```

   The dev-tunnel Supabase stack must be running first (`pnpm db:dev:tunnel`). The loader connects to `127.0.0.1:34322`, truncates/reloads `wiktionary_entries` / `wiktionary_forms`, and snapshots the result from the `supabase_db_supabase-dev-tunnel` container. Then sanity-check all enabled languages landed:

   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 34322 -U postgres -d postgres \
     -c "SELECT target_language, COUNT(*) FROM public.wiktionary_entries GROUP BY 1 ORDER BY 1;"
   ```

   From then on `pnpm db:reset` will restore all enabled languages from the snapshot in seconds.

9. **Production data load** — done out-of-band by manually triggering `.github/workflows/load-kaikki-prod.yaml` from `main` during a low-traffic window. The TRUNCATE+COPY temporarily knocks grounding offline for in-flight cards, so don't auto-trigger. If the cached gz dump is stale and you want to force a fresh download, bump the cache key in the workflow (`kaikki-raw-v1` → `kaikki-raw-v2`).

## Removing a language

Reverse of adding, in roughly this order to keep types happy:

1. Remove from `LANGUAGE_GRAMMAR` (or downgrade the config to a minimal entry — the focus view will fall back to `DEFAULT_GRAMMAR_CONFIG` when omitted).
2. Remove from `KAIKKI_LANGUAGES` in `packages/core/src/constants/language-grammar.ts`.
3. Remove from `KAIKKI_ENABLED_LANGUAGES` in `apps/backend/src/service/wiktionary-grounding/config.ts`.
4. Remove from `LOAD_LANGUAGES` in `apps/backend/scripts/load-kaikki.ts`.
5. Remove language-specific extractor branches and their tests if any were added.
6. `pnpm check:types` + tests.
7. Re-run `doppler run -- pnpm --filter @flicktionary/backend load:kaikki` to drop the language's rows from the local tables and refresh the snapshot. Trigger the prod workflow when ready.

Existing user cards in the removed language keep whatever `groundedAt`/`grammar` they already had — there's no automatic rollback. That's intentional.

## Notes

- The `lang_code` you add must match kaikki's exact value (the JSONL's `lang_code` field). Spot-check by piping a few raw lines through `gzip -cd apps/backend/scripts/.cache/kaikki/raw-wiktextract-data.jsonl.gz | grep -m 5 '"lang_code":"<code>"'`.
- The new language must also be present in `packages/core/src/constants/supported-languages.ts` (otherwise it can't be selected as a target language in the first place). That's a separate change and not gated by this skill — confirm before starting.
- Don't write `ipa` chips into `GrammarChips` — IPA isn't a chip in the UX. `FocusView` picks the displayed value with `pickIpa(...)` and renders it above the chips; the editable panel surfaces an editable `Input` for the active bucket (`ga`/`rp` for English by user pref, `untagged` otherwise); the practice rate sheet uses the same `pickIpa(...)` to render IPA as a subtitle line under the headword.
- Don't try to load data through `pnpm db:reset` — that script *only* replays the snapshot. To regenerate the snapshot you must run the loader.
