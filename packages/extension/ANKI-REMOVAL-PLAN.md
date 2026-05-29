# Plan: remove the Anki / AnkiConnect subsystem (decouple `dictionary-db`)

> **For a fresh thread.** Self-contained. Follows the 2026-05 dead-code cleanup
> (`CUSTOMIZATIONS.md §6` "Landed since…") and the WXT/vite catalog upgrade. Branch:
> `feat/add-asbplayer-extension`.
>
> **Decision (user, 2026-05):** Flicktionary does **not** use Anki at all — it is its own
> card system; all cards are created in Flicktionary. So the entire AnkiConnect
> integration (card-status sync into the dictionary) is unwanted and should be **deleted**,
> not preserved. This is **NOT** mechanical orphan deletion like the previous plan — it is a
> real feature removal + a refactor of the load-bearing `dictionary-db`, so it needs the
> manual verification step (§Gate) every cluster.

## Why this is the last big structural win

`dictionary-db.ts` (load-bearing — profiles, token storage, token coloring) is the **only
reachable importer of `anki/anki.ts`**, which is the **only reachable importer of
`audio-clip/`**, which is the **only reachable user of `MediaRecorder`** (the
`@types/dom-mediacapture-record` dep). So this single cut cascades:

```
dictionary-db.ts ──imports──> anki/anki.ts ──imports──> audio-clip/ ──uses──> MediaRecorder
   (KEEP, refactor)            (DELETE)                  (DELETE)              (drop @types dep)
```

`lamejs` was already removed (its worker was orphan). After this cut the deletable set is
`anki/` (`anki.ts` 629 lines + `index.ts` + `anki.test.ts`), `audio-clip/`
(`audio-clip.ts` + `mp3-encoder.ts` + `index.ts`), and the
`@types/dom-mediacapture-record` devDep. **Verify** the chain before deleting (it can shift
as other clusters land):

```sh
cd packages
grep -rn "common/anki'\|/anki/anki'" asbplayer-common extension --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v 'anki/anki.ts\|anki.test.ts\|anki/index.ts'
grep -rn "common/audio-clip'\|/audio-clip'" asbplayer-common extension --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v 'audio-clip/'
```
Both should show **only `dictionary-db.ts`** (for anki) and **only `anki.ts`** (for
audio-clip). If anything else appears, that consumer must be handled first.

## The careful part: `dictionary-db.ts` is KEPT — surgically remove only the Anki concern

The Anki integration is woven through the core read/delete paths, **not** isolated in one
method. The good news (verified): the per-token result carries two *independent* fields —
`states: TokenState[]` (the dictionary's **native / Flicktionary** token state, sourced from
the token record) and `statuses: CardStatus[]` (the **Anki** card status, sourced from the
`ankiCards` Dexie table). Removing Anki means dropping `statuses` + the `ankiCards` lookups
while leaving `states` untouched. The cache-miss path already returns `statuses: []`, so the
shape tolerates the removal.

Surface to remove inside `asbplayer-common/dictionary-db/dictionary-db.ts`:

- **Import** (line 1): `Anki, escapeAnkiDeckQuery, escapeAnkiQuery, NoteInfo` from
  `@asbplayer-fork/common/anki`; and the `DictionaryBuildAnkiCache*` message-type imports
  (lines 3–8) from `@asbplayer-fork/common` (defined in `asbplayer-common/src/message.ts`).
- **Dexie schema** (`DictionaryDatabase`, lines 86–98): drop the `ankiCards!` table field
  and the `ankiCards: '[cardId+track+profile],[profile+noteId]'` store line. ⚠️ **Dexie
  migration:** don't just delete the line on `version(1)` — that rewrites history and can
  break existing local DBs. Add a **`version(2)`** that omits `ankiCards` (Dexie deletes a
  table whose name is absent in a later version). Also consider the `tokens` table's
  `*cardIds` multi-entry index (line 95) — it links tokens→Anki cards and becomes vestigial;
  decide whether to drop it in the same `version(2)` (lower risk to leave it and stop
  writing to it, but cleaner to drop).
- **Types:** `CardStatus` (line 120, exported — check UI consumers), `DictionaryAnkiCardKey`
  / `DictionaryAnkiCardRecord` (75–84), `AnkiCacheSettingsDependencies` (37), the `statuses`
  field on the `TokenResults` / lemma result shapes (lines ~65–72, 126, 133–134), `CardsForDB`
  (101) and `TrackStatesForDB` plumbing if only used by the build path.
- **Read-path decoration** in `getBulk` (189) and `getByLemmaBulk` (278): remove the
  `cardStatusMap = await this.db.ankiCards…` lookups and the `statuses` assembly; return
  `states` only.
- **Delete path:** `deleteProfile` (584) clears `ankiCards` — remove that branch.
- **Whole methods to delete** (Anki-only): `buildAnkiCache` (771, public),
  `_getAnkiCardKeys` (620), `_getAnkiCardsByNoteIdBulk` (624), `_deleteCardBulk` (661),
  `_orphanAllCardIds` (702), `_syncTrackStatesWithAnki` (987), `_buildAnkiCardStatuses`
  (1134), `_processAnkiCardStatuses` (1207), `_updateBuildAnkiCacheProgress` (1223), plus the
  build-id health-check machinery **only if** it is exclusive to the Anki build
  (`_ensureBuildId`/`_buildIdHealthCheck`/`_clearBuildId`/`_clearBuildIds` — grep each;
  some may be shared with `_buildTokensForTracks` at 1319, which is the native dictionary
  build and **must stay**). Verify each method's callers before deleting.

> Line numbers are a snapshot — they will drift as you edit. Anchor on the symbol names.

## Extension message/handler plumbing to remove

- `extension/src/handlers/dictionary/dictionary-handler.ts`: the
  `case 'dictionary-build-anki-cache':` branch (≈line 81) + its imports.
- `extension/src/services/extension-dictionary-storage.ts`: the `buildAnkiCache` method
  (≈123) and the entire `buildAnkiCacheStateChange*` callback/listener machinery (≈22–32,
  165–180).
- `asbplayer-common/dictionary-db/dictionary-provider.ts`: the `buildAnkiCache` member
  (≈34, 89) from both the interface and the impl.
- `extension/src/entrypoints/asbplayer.content.ts`: the `buildAnkiCache(... useOriginTab)`
  branch (≈171). (This file is the web-app integration bridge — see the related deferred
  follow-up in `CUSTOMIZATIONS.md §6`; only the Anki branch goes here.)
- `asbplayer-common/src/message.ts`: the `DictionaryBuildAnkiCache*` message + state +
  stats + progress + error types and their `command` string `'dictionary-build-anki-cache'`.
- `asbplayer-common/app/services/chrome-extension.ts:725` has a `buildAnkiCache` method —
  this is a **Cluster-1 KEEP** web-app-integration bridge file. Trim the method here too
  (it forwards to the now-deleted path).
- Grep `\.statuses\b` and `CardStatus` repo-wide for the **content-script token-coloring
  consumers** (the token highlighter reads `TokenResults`); simplify them to use `states`
  only. (As of writing the only non-dictionary-db hits are in `asbplayer.content.ts`,
  `dictionary-handler.ts`, `extension-dictionary-storage.ts` — none in `extension/src/ui`,
  so the popup/settings React tree does not render card status directly.)

## Settings — the unknown-key trap (decision required)

These keys exist in `asbplayer-common/settings/settings.ts`:
`ankiConnectUrl` (line 205, part of `interface AnkiSettings`), and the dictionary group
`dictionaryAnkiDecks`, `dictionaryAnkiWordFields`, `dictionaryAnkiSentenceFields`,
`dictionaryAnkiSentenceTokenMatchStrategy`, `dictionaryAnkiMatureCutoff`,
`dictionaryAnkiTreatSuspended` (136–141). `extractAnkiSettings` (327) and the equality map
(162–165) reference them.

⚠️ **`[[reference_settings_schema_unknown_key_trap]]`:** removing a field from
`AsbplayerSettings` breaks importing an old settings export — `validateSettings` throws on
unknown keys unless the key stays in `settingsSchema` or in the import `ignoreKeys` list.
**Decide:**
- **(a) Defang but keep the keys** — stop reading/writing them but leave them in the
  interface + `settingsSchema` (zero import-breakage, minimal diff, some dead fields linger).
  Recommended for a first pass.
- **(b) Fully remove** the keys and add them to `ignoreKeys` so old imports still validate.
  Cleaner end-state, larger diff, must touch `extractAnkiSettings` and any settings UI that
  edited these (check the settings tabs — the Anki-dictionary settings UI may already be
  stripped from this lean fork; grep `dictionaryAnki` in `extension/src/ui`).

## Dependencies / declarations freed

- `extension/package.json`: drop `@types/dom-mediacapture-record` once `audio-clip/` is gone
  (re-grep `MediaRecorder` first — should be zero hits).
- `extension/decs.d.ts`: still declares `lamejs` (now fully dead) and `vtt.js` (still used).
  Remove the `lamejs` line.

## Dead i18n (folds in the old plan's Cluster 5)

With the Anki UI gone, the `settings.anki` / `settings.mining` /
`binds.copySubtitle`/`ankiExport`/`extensionToggleRecording` /
`extension.settings.*Screenshot`/`recordAudio` keys in `common/locales/*.json` (12 langs)
are fully dead. Low value, noisy 12-file diff. If pursued: delete the specific leaf keys
**line-by-line** (these are pretty-printed JSON — do not reserialize) and grep each for 0
`t('…')` refs first. Keep `settings.recordingBind` (still used by the keybind placeholder).

## Gate (after every step; commit per logical step)

1. `pnpm --filter @flicktionary/extension build` — the real gate (esbuild/WXT). Note size vs
   the current **7.13 MB**; both `build` and `build:firefox`.
2. `pnpm exec tsc --noEmit` in `packages/extension` — must stay at the **9-error baseline**
   (`[[project_extension_typecheck_gate]]`). Diff error *locations* vs baseline, not just the
   count, since this refactor touches typed code.
3. `pnpm exec jest` in `packages/asbplayer-common` — must not regress past the known
   baseline (**4 suites fail / 3 pass; 3 tests fail / 9 pass** — pre-existing module-resolution
   + `wordClickEnabled` failures). `anki/anki.test.ts` currently fails-to-run (module
   resolution); it is **deleted** in this plan, so the failing-suite count should drop by one
   — that's an improvement, not a regression.
4. **MANUAL (this is why this plan ≠ mechanical):** load the extension on a video with subs
   and confirm **native dictionary token coloring still renders** (driven by `states`, which
   must be untouched) and **profile create / switch / delete** still works (`dictionary-db`
   is load-bearing). See `CUSTOMIZATIONS.md §7` golden path. A green build does **not** prove
   the Dexie `version(2)` migration is correct — test with a pre-existing local DB.

## Recommended order (commit per step)

1. Remove the extension message/handler plumbing (handler case, storage machinery, provider
   member, content branch, `message.ts` types) — pure deletions, build stays green.
2. Refactor `dictionary-db.ts`: strip the read-path `statuses` decoration + delete the
   Anki-only methods + remove the import. Keep `states`. Build + tsc + **manual coloring check**.
3. Dexie `version(2)` dropping `ankiCards` (+ decide on `*cardIds`). **Manual migration test.**
4. `git rm` `anki/` + `audio-clip/`; drop `@types/dom-mediacapture-record` + the `lamejs`
   line in `decs.d.ts`; `pnpm install`; full gate.
5. Settings decision (a) or (b).
6. (Optional) dead i18n keys.
7. Update `CUSTOMIZATIONS.md §6` — move "Deep `dictionary-db` removal" from deferred to
   landed; note Anki is fully gone.

## Out of scope (separate effort)

Removing the **web-app integration** itself (`asbplayer.content.ts` +
`extensionSupportsAppIntegration` + `ChromeExtension` in `use-video-element-count`) — still
deferred per `CUSTOMIZATIONS.md §6`. This plan only removes the *Anki* branch from those
bridge files, not the bridge.
