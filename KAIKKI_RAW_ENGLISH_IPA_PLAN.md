# Kaikki Raw Loader, English Grounding, and IPA Display Plan

## Context

This plan replaces the deprecated per-language Russian Kaikki dump with the
canonical raw Wiktextract dump, adds English to Wiktionary grounding, and stores
Wiktionary IPA on grounded grammar data so the focus view can show it without
waiting for the LLM full-exploration pass.

Key constraints from the current repo:

- Database migrations are append-only. Do not edit
  `apps/backend/supabase/migrations/20260510091540_initial_app_schema.sql` or
  any other existing migration for new schema/data changes.
- Create migrations from `apps/backend/supabase/supabase-dev-tunnel/` with
  `doppler run -- supabase migration new <name>`, then edit only the new file.
- Verify migrations with `doppler run -- supabase db reset --local` from
  `apps/backend/supabase/supabase-dev-tunnel/`, or use the root `pnpm db:reset`
  wrapper. The backend package script is `db:dev:tunnel:reset`, not `db:reset`.
- After schema changes, regenerate `apps/backend/src/transport/database/database.public.types.ts`.
- The current Wiktionary grounding entry point is
  `apps/backend/src/service/wiktionary-grounding/index.ts`, not a `ground-row.ts`
  or `process-session.ts` callsite.

## Phase 1 - Loader Rewrite

File: `apps/backend/scripts/load-kaikki.ts`

Replace the Russian-only download with the canonical raw dump:

```ts
const KAIKKI_URL = 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz'
const KAIKKI_GZ_FILENAME = 'raw-wiktextract-data.jsonl.gz'
const LOAD_LANGUAGES = ['ru', 'en'] as const
```

Use a streaming pipeline throughout:

- Download the `.gz` with backpressure-aware streaming rather than manual
  `out.write(...)`.
- Read with `createReadStream(gzPath).pipe(createGunzip())`.
- Parse line by line with `readline.createInterface`.
- After `JSON.parse(line)`, immediately skip entries whose `lang_code` is not
  in `LOAD_LANGUAGES`.
- Keep the existing `word`, `pos`, `forms[]`, `NON_FORM_TAGS`, and stress-strip
  logic, but write per-entry `lang_code` to both CSVs instead of the old
  hardcoded `TARGET_LANGUAGE`.

`loadCsvs()` can keep its current `TRUNCATE` + `COPY` behavior. Update sample
queries to show grouped counts by `target_language` and keep Russian spot
checks.

Also update `.github/workflows/load-kaikki-prod.yaml`:

- Cache key `kaikki-ru-v1` -> `kaikki-raw-v1`.
- Restore key `kaikki-ru-` -> `kaikki-raw-`.
- Update the cache comment from roughly 600 MB to roughly 2.5 GB.

## Phase 2 - Enable English Grounding

Files:

- `apps/backend/src/service/wiktionary-grounding/config.ts`
- `packages/core/src/constants/language-grammar.ts`

Add English to both mirrors:

```ts
export const KAIKKI_ENABLED_LANGUAGES: ReadonlySet<string> = new Set(['ru', 'en'])
export const KAIKKI_LANGUAGES: ReadonlySet<string> = new Set(['ru', 'en'])
```

English has a text-search regconfig already, but the extractor must be
language-aware before enabling English.

## Phase 3 - IPA Data Model and Shared Types

Files:

- `packages/api-client/src/orpc-contracts/common/flicktionary-schemas.ts`
- `packages/core/src/constants/language-grammar.ts`
- new `packages/core/src/utils/pick-ipa.ts`

Add a shared IPA bag shape instead of only a backend-local type:

```ts
export const GrammarIpaBagSchema = z.object({
  ga: z.string().nullable().optional(),
  rp: z.string().nullable().optional(),
  untagged: z.string().nullable().optional(),
})
export type GrammarIpaBag = z.infer<typeof GrammarIpaBagSchema>
```

Add `ipa: GrammarIpaBagSchema.nullable().optional()` to `GrammarSchema`.

Add `'ipa'` to `GrammarFieldKey`, then include it in `ru` and `en` grammar
configs with `ipa: { label: 'IPA' }`. Do not add `ipa` to the default grammar
config yet.

Create `pickIpa` in core so web code can use the typed shared shape:

```ts
import type { GrammarIpaBag } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const pickIpa = (
  ipa: GrammarIpaBag | null | undefined,
  langCode: string,
  englishDialect: 'ga' | 'rp'
): string | undefined => {
  if (!ipa) return undefined
  if (langCode === 'en') return ipa[englishDialect] ?? ipa.untagged ?? undefined
  return ipa.untagged ?? undefined
}
```

## Phase 4 - Dialect-Bucketed IPA Extraction

File: `apps/backend/src/service/wiktionary-grounding/extract.ts`

Extend `KaikkiEntry` with `lang_code?: unknown` and `sounds?: unknown`.
Extend `GrammarPatch` with:

```ts
ipa?: {
  ga?: string
  rp?: string
  untagged?: string
}
```

Change the extractor signature:

```ts
export const extractGrammarPatch = (entry: KaikkiEntry, langCode: string): GrammarPatch => {
  // ...
}
```

Important: gate Russian-specific noun/verb extraction to Russian only. The
current noun/verb extractors parse Russian `head_templates`, so English should
use the generic POS fallback plus display form and IPA unless English-specific
extractors are added later.

Implement `extractIpaBag(entry, langCode)`:

- Walk every `entry.sounds[]` item.
- Ignore entries with no string `ipa`.
- Ignore entries with quality tags such as `uncommon`, `dated`, `obsolete`,
  `nonstandard`, `dialectal`, `archaic`, `sometimes`, and `rare`.
- Prefer phonemic IPA strings starting with `/`; fall back to phonetic strings
  starting with `[` when no phonemic candidate exists for a bucket.
- Deduplicate by IPA string within each bucket.

For non-English languages, only populate `untagged`.

For English:

- `rp`: tags include `Received-Pronunciation` or `UK`, and do not include GA,
  narrower US region tags, or unrelated regional tags.
- `ga`: tags include `General-American`, or tags include `US` without narrower
  US region tags, RP tags, or unrelated regional tags.
- `untagged`: missing or empty `tags`.

After building the existing patch:

```ts
const ipa = extractIpaBag(entry, langCode)
if (ipa.ga || ipa.rp || ipa.untagged) patch.ipa = ipa
```

Update existing unit tests in
`apps/backend/src/service/wiktionary-grounding/extract.unit.test.ts` for the
new `extractGrammarPatch(entry, langCode)` signature, and add focused tests for:

- Russian untagged IPA.
- English GA/RP extraction.
- English untagged fallback.
- No GA/RP cross-fallback.
- Quality tag rejection for `crayon`-style cases.

## Phase 5 - Grounding Callsite Update

File: `apps/backend/src/service/wiktionary-grounding/index.ts`

The actual callsite is currently:

```ts
const grammarPatch: GrammarPatch = extractGrammarPatch(entry.data)
```

Change it to:

```ts
const grammarPatch: GrammarPatch = extractGrammarPatch(entry.data, params.targetLanguage)
```

No `ground-row.ts` change is needed because that file does not exist in the
current tree.

## Phase 6 - User Preference for English IPA Dialect

Create a new append-only migration:

```bash
cd apps/backend/supabase/supabase-dev-tunnel
doppler run -- supabase migration new add_english_ipa_dialect
```

In the new migration file only:

```sql
ALTER TABLE public.users
  ADD COLUMN english_ipa_dialect TEXT NOT NULL DEFAULT 'ga'
  CHECK (english_ipa_dialect IN ('ga', 'rp'));
```

Verify:

```bash
doppler run -- supabase db reset --local
```

Then regenerate public DB types from the local dev-tunnel database and update
`apps/backend/src/transport/database/database.public.types.ts`.

Repository/router/contract changes:

- `apps/backend/src/transport/database/users/users-repository.ts`
  - Add `getEnglishIpaDialect(userId): Promise<'ga' | 'rp'>`.
  - Add `setEnglishIpaDialect(userId, dialect): Promise<boolean>`.
  - Add both to `UsersRepositoryInterface` and `UsersRepository()`.
- `packages/api-client/src/orpc-contracts/user-prefs-contract.ts`
  - Add `englishIpaDialect: z.enum(['ga', 'rp'])` to `UserPrefsSchema`.
  - Add `setEnglishIpaDialect` input `{ dialect: z.enum(['ga', 'rp']) }`.
- `apps/backend/src/router/user-prefs-router/user-prefs-router.ts`
  - Add the pref to `UserPrefsResponse`.
  - Load it in `buildPrefs`.
  - Add the mutation handler.
- `apps/web/src/features/sessions/api/sessions-hooks.ts`
  - Add `useSetEnglishIpaDialect()`.

## Phase 7 - Settings UI

New file:

- `apps/web/src/features/settings/components/english-ipa-dialect-selector.tsx`

Add a two-option American/British selector following the existing small
button-group style in `CefrPerLanguageList`. Use Lingui for every user-facing
string.

File:

- `apps/web/src/features/more/components/languages-page.tsx`

Render the selector under `<CefrPerLanguageList />` only when English is one of
the user's target languages:

```tsx
<EnglishIpaDialectSelector
  currentValue={prefs.englishIpaDialect}
  visible={prefs.targetLanguagePrefs.some((p) => p.targetLanguage === 'en')}
/>
```

## Phase 8 - Focus View Rendering

Files:

- `apps/web/src/features/review/components/focus-view.tsx`
- `apps/web/src/features/review/components/full-exploration-renderer.tsx`
- `apps/web/src/features/review/components/editable-grammar-panel.tsx`
- `apps/web/src/features/review/components/grammar-chips.tsx`

In `focus-view.tsx`, compute:

```ts
const displayedIpa = pickIpa(
  card.chunk.grammar?.ipa,
  targetLanguage,
  userPrefs?.englishIpaDialect ?? 'ga'
)
```

Render it above grammar chips. Keep the Wiktionary badge next to the chips.

Pass a `hideIpa` or `hideExtrasIpa` prop to `FullExplorationRenderer` so
`extras.ipa` is hidden when `displayedIpa` exists. The LLM may still generate
`extras.ipa`; the renderer should avoid double-rendering.

Do not make `grammar.ipa` editable in v1. In `EditableGrammarPanel`, derive
editable fields with:

```ts
const editableFields = config.fields.filter((f) => f !== 'ipa')
```

Then use `editableFields.includes(...)` for the panel. `GrammarChips` does not
need to render `ipa`; IPA is not a chip.

## Verification

1. Run targeted unit tests for `extract.ts` and `pick-ipa.ts`.
2. Run `pnpm check:types`.
3. Load Kaikki locally with `pnpm --filter @flicktionary/backend load:kaikki`.
4. Confirm both languages are loaded:

   ```sql
   SELECT target_language, count(*)
   FROM public.wiktionary_entries
   GROUP BY 1
   ORDER BY 1;
   ```

5. Process a Russian card such as `собака`; verify `grammar->'ipa'->>'untagged'`
   is set and the focus view shows it.
6. Process English cards such as `cat`, `dictionary`, and `crayon`; verify
   `grammar.ipa` has correct GA/RP buckets when available.
7. Switch English IPA dialect in More -> Languages and verify the focus view
   changes without reprocessing.
8. Generate full exploration on a grounded IPA card and verify IPA appears only
   once.
9. Process a non-Kaikki language such as Spanish and verify behavior is
   unchanged.
10. Trigger `load-kaikki-prod.yaml` manually during a low-traffic window after
    local validation.

