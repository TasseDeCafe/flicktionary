# Extension cleanup — remaining work plan

Self-contained execution plan for the dead-code still left in the asbplayer fork
after the 2026-05 strips. Companion to `CUSTOMIZATIONS.md` (the living playbook);
this file is a task list to burn down. Written 2026-05-29.

## How to verify (the gate — run after every item)

The WXT **build** is the real gate, not tsc. After each change:

```
cd packages/extension && pnpm exec tsc --noEmit        # must stay at 8 errors (baseline)
cd packages/extension && pnpm build                    # must succeed; bundle ~6.96 MB
cd packages/asbplayer-common && pnpm exec jest settings-import-export   # must stay 5/5
```

Baselines / known noise (do NOT chase these — they predate this work):
- `tsc --noEmit` has **8 pre-existing errors** (e.g. `TutorialBubble.tsx` TS2589,
  `subtitle-collection.ts` generics, `video-data-sync-controller.ts` sender type).
  Compare the *count*; only fail if it rises above 8.
- `settings-provider.test.ts` fails to run (`Cannot find module
  '@asbplayer-fork/common/settings'`) — a pre-existing jest path-resolution quirk,
  unrelated. The `settings-import-export` suite is the one that must stay green.
- `message.ts` shows many "Unused interface" IDE warnings — per-file analysis of an
  exported-types module; unreliable for cross-file usage. Verify with grep, not the
  warning (see item 3).

## Schema is now STRICT (important context)

`settings-import-export.ts` no longer keeps dead entries for old-export tolerance —
the schema mirrors the live `AsbplayerSettings` shape, and `validateAllKnownKeys`
throws on any unknown key. **Consequence for every item below:** when you remove a
field from the `AsbplayerSettings` type + `defaultSettings`, you MUST also remove its
entry from `settingsSchema` in `settings-import-export.ts` (and from the test fixture
in `settings-import-export.test.ts`), or `validateSettings(defaultSettings)` will
throw. There are no legacy exports to honor.

`ensureConsistencyOnRead` (in `settings-provider.ts`) rebuilds `keyBindSet` from
`Object.keys(defaultSettings.keyBindSet)`, so removing a keybind from the defaults is
enough to drop it on read.

---

## Item 2 (do FIRST — quick, safe, self-contained): three dead-reader mining settings

These three fields are still in the live `AsbplayerSettings` type + defaults + strict
schema, but have **no runtime reader** (verified: only referenced in settings type,
provider default, import/export schema, and tests). Remove each from ALL of:

- `copyToClipboardOnMine` (boolean)
- `postMiningPlaybackState` + the `PostMinePlayback` enum
- `miningHistoryStorageLimit` (number)

Sites to edit (grep each name first to confirm no new readers appeared):
1. `packages/asbplayer-common/settings/settings.ts` — the `readonly` field(s) in the
   `MiscSettings` interface; for `PostMinePlayback`, also its import from `../src/model`.
2. `packages/asbplayer-common/settings/settings-provider.ts` — the `defaultSettings`
   entries (and the `PostMinePlayback` import).
3. `packages/asbplayer-common/settings/settings-import-export.ts` — the `settingsSchema`
   property entries.
4. `packages/asbplayer-common/settings/settings-import-export.test.ts` — the keys in the
   `validates exported settings` fixture.
5. `packages/asbplayer-common/src/model.ts` — delete the `PostMinePlayback` enum once
   no importer remains (`grep -rn PostMinePlayback`).

CAUTION: confirm `postMiningPlaybackState`/`PostMinePlayback` is not read by any live
binding/controller before deleting the enum — grep `PostMinePlayback` and
`postMiningPlaybackState` across `packages/extension/src` + `packages/asbplayer-common`
(excluding the 4 settings files above). At time of writing: 0 live readers.

LEAVE ALONE (verified LIVE — have real readers): `autoCopyCurrentSubtitle`
(`binding.ts`, `subtitle-controller.ts`), `streamingSubsDragAndDrop` (`binding.ts`),
`streamingSubtitleListPreference` (`binding.ts`), `tabName` (`binding.ts`,
`MiscSettingsTab.tsx`), `TokenStatus` (used by `dictionary-db`).

---

## Item 3 (verify, then remove): dead message-contract types

In `packages/asbplayer-common/src/message.ts`. **Verified dead** (defined, never
constructed/sent, never handled) at time of writing:

- `RecordingStartedMessage`
- `RecordingFinishedMessage`
- `DownloadAudioMessage`  ← references `CardModel`
- `DownloadImageMessage`

PROCESS for each (do not trust the IDE "unused interface" warning — it's per-file):
1. `grep -rn "<TypeName>" packages/extension/src packages/asbplayer-common --include="*.ts" --include="*.tsx" | grep -v node_modules`
   — must show ONLY the definition in `message.ts` (no construction `{ command: '...' }`,
   no handler, no import).
2. Also grep the string command literal (e.g. `'download-audio'`) for a handler.
3. Remove the interface. If it was the last `CardModel` consumer, check whether
   `CardModel` itself is now dead (memory note: keep `CardModel` only if live —
   `grep -rn CardModel`). Do NOT remove `CardModel` without confirming.

LIKELY-DEAD CLUSTER worth investigating in the same pass (recording/audio/mp3/screenshot
machinery whose features were stripped — but each MUST be grep-verified, several may
still be referenced cross-file): `EncodeMp3Message`, `EncodeMp3InServiceWorkerMessage`,
`TakeScreenshotMessage` / `TakeScreenshotToVideoPlayerMessage` (NOTE: `take-screenshot`
is LIVE via `video-select-controller.ts` — verify carefully), `ToggleRecordingMessage`,
`StartRecordingAudio*` (4 variants), `StopRecordingAudioMessage`, `StartRecordingResponse`,
`StopRecordingResponse`, `AudioBase64Message`, `BackgroundPageReadyMessage`. Treat this
list as candidates, not a delete-list.

---

## Item 1 (biggest, riskiest — its own session): dictionary-coloring settings cluster

This is the deferred **"deep `dictionary-db` removal"** from `CUSTOMIZATIONS.md` §6.
The whole coloring settings surface has NO runtime readers, but is entangled with the
kept `dictionary-db` profile plumbing, so it is NOT mechanical.

The cluster (all in `packages/asbplayer-common/`):
- `settings/settings.ts` — `DictionaryTrack` interface + the enums `TokenMatchStrategy`,
  `TokenMatchStrategyPriority`, `TokenStyling`, `TokenReadingAnnotation`, and the
  `dictionaryTracks` field on settings.
- `settings/settings-provider.ts` — `defaultDictionaryTrackSettings`, the `dictionaryTracks`
  default, `NUM_DICTIONARY_TRACKS`, `NUM_TOKEN_STATUSES`, and the per-track validation/
  migration logic in the provider (the loop that normalizes `dictionaryTracks` on read).
- `settings/settings-import-export.ts` — `dictionaryTrackSchema` (`/DictionaryTrack`) +
  the `dictionaryTracks` array entry in `settingsSchema` + the `schemaForRef` branch.
- `settings/settings-import-export.test.ts` — the `dictionaryTracks` block in the fixture.

ENTANGLEMENT to resolve first (this is the "investigation" part):
- `dictionaryTracks` is normalized/migrated on EVERY settings read in `settings-provider.ts`.
  Removing it changes the read path — confirm nothing downstream expects the array.
- `TokenStatus` enum is used by `dictionary-db` (which is KEPT for profile management).
  Decide whether `TokenStatus` stays (likely yes) even after the coloring settings go.
- `dictionary-db` is reportedly the only reachable importer of `anki/anki.ts`; cutting
  it would unlock deleting `anki/`, the rest of `audio-clip/`, and
  `@types/dom-mediacapture-record` (see §6 "Still deferred"). Scope that separately.

Recommended approach: spike the removal on a branch, lean hard on `tsc` + `pnpm build`
+ the golden path (§7 of `CUSTOMIZATIONS.md`: profile switching/deletion must still
work, since that's what `dictionary-db` is load-bearing for).

---

## Item 4 (LAST — low value, deferred by policy): dead i18n keys

Per `CUSTOMIZATIONS.md` §6, the locale JSONs (`packages/asbplayer-common/locales/*.json`,
12 languages) don't survive a `json.dump` round-trip cleanly, so a bulk rewrite makes
noisy 12-file diffs for negligible gain. If pursued: delete specific leaf keys
line-by-line (NOT a reserialize), and `grep` each for 0 `t('…')` / `i18nKey=` refs first.

Now-orphaned keys to include (newly dead after the side-panel + coloring strips):
- `ftue.sidePanel`, `binds.toggleSidePanel`
- `binds.markHoveredToken`, `binds.toggleHoveredTokenIgnored`, `settings.dictionaryTokenStatus0-5`
- the older anki/mining keys already listed in §6 (`settings.anki`, `settings.mining`,
  `binds.copySubtitle`/`ankiExport`/`extensionToggleRecording`, `*Screenshot`/`recordAudio`,
  `ankiDialog.*`, anki-field labels).
- KEEP `settings.recordingBind` (still used by the keybind-editing placeholder).

NOTE: the `ftue.loadSubtitles` English copy was already repointed off the Side Panel
(2026-05). The non-English `ftue.loadSubtitles` / `ftue.sidePanel` strings still mention
the Side Panel — that's a translation/content task, not dead-code, handle separately.

---

## Suggested order

**2 → 3 → 1 → 4.** Item 2 is a clean warm-up; 3 is contained once grep-verified; 1 is a
dedicated investigation session; 4 is low-value cleanup to batch whenever.

Commit each item separately. Branch is `feat/add-asbplayer-extension`. Commit trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Update
`CUSTOMIZATIONS.md` §6 "landed" after each.
