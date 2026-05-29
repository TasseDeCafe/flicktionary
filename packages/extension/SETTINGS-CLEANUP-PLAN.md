# Plan: finalize Anki/mining settings-UI cleanup

> **For a fresh thread.** Self-contained. Companion: `CUSTOMIZATIONS.md` (the lean
> fork was already stripped of mining/recording/anki/coloring/side-panel/dictionary-UI
> at runtime — this finishes the **settings UI + schema** that was deliberately left
> intact so old exports stayed valid). Branch: `feat/add-asbplayer-extension`.
>
> **Gate:** `pnpm build` (in `packages/extension`) is the real gate; esbuild does
> NOT type-check. After each phase ALSO run `pnpm exec tsc --noEmit` and compare to
> the **baseline of 9 pre-existing errors** — this is how dangling refs get caught
> (it already caught one regression). Commit per phase. Re-smoke-test the popup.
>
> **Line numbers below are from a 2026-05 scan and may drift — grep for the symbol,
> don't trust the line number.**

## Goal

Remove the **ANKI** and **MINING** settings tabs entirely, and the mining options
scattered in **Streaming Video**, **Misc**, and **Keyboard Shortcuts**. This is the
shared common UI (`packages/asbplayer-common/components/SettingsForm.tsx` + tab
components + `settings/settings.ts` schema), rendered in the extension popup
(`Popup.tsx`/`PopupUi.tsx`) and options page (`SettingsPage.tsx`).

## CRITICAL — do NOT remove these (verified runtime-load-bearing)

1. **`maxImageWidth` / `maxImageHeight`** — KEEP in the schema + defaults. They live
   near the Anki/mining fields, but `binding.ts` reads them in **`cropAndResize`**,
   which the **video-select** flow (kept) uses for thumbnails. Removing them breaks
   video selection. (The investigation agent wrongly flagged these as safe — they
   are NOT.) Only their *UI* (in the to-be-deleted MiningSettingsTab) goes; the
   schema fields stay.
2. **`clickToMineDefaultAction`** — still read by the **mobile overlay**
   (`mobile-video-overlay-controller.ts` builds the overlay model's `postMineAction`;
   `MobileVideoOverlayUi.tsx`). See Phase D — decide whether to neuter the mobile
   overlay mine button or keep this field.
3. The **web-app integration** (`asbplayer.content.ts`, `common/app`) and the
   **`dictionary-db`** data layer (profiles) — out of scope, keep (per
   `CUSTOMIZATIONS.md §4/§6`).

## Settings import/migration — no migration code needed

`settings/settings-import-export.ts` validates via JSON schema + `ensureConsistencyOnRead()`
(fills missing keys from defaults). Old exports containing removed `anki*`/mining
fields are **silently ignored** on import. So once a field is gone from the schema +
defaults, old exports still import cleanly — **no migration function required**.
(Confirm `validateSettings` doesn't *reject* unknown keys; if it does, add the removed
keys to the ignore list.)

---

## Phase A — remove the ANKI + MINING tabs from SettingsForm

`packages/asbplayer-common/components/SettingsForm.tsx`:
- Remove `'anki-settings'` and `'mining-settings'` from the `tabs` array in
  `tabIndicesById`.
- Remove the two `<Tab … id="anki-settings">` / `id="mining-settings">` elements.
- Remove the two `<TabPanel>` blocks rendering `<AnkiSettingsTab>` and
  `<MiningSettingsTab>`, and their imports.
- The other tabs reindex automatically (they're `Object.fromEntries(tabs.map((t,i)…))`);
  the `<Tab tabIndex={…}>` literals are now wrong but `tabIndex` is cosmetic — the
  `value`/`index` matching uses `tabIndicesById`. **Verify** tab switching still
  selects the right panel after removal (this is the main risk of this phase).
- Remove the **Anki tutorial** logic (`TutorialStep` ankiConnect/noteType/ankiFields,
  `testCard`, `ankiPanelRef`) — it only served the Anki tab.
- Drop the now-unused **`anki` prop** (`Anki` import, prop type, destructure) — it was
  used ONLY by AnkiSettingsTab.

Then in the extension, stop creating/passing `anki`:
- `Popup.tsx`: remove `const anki = useMemo(() => new Anki(...))`, the `anki={anki}`
  prop, and the `Anki`/`ExtensionFetcher` imports if now unused.
- `SettingsPage.tsx`: same (`new Anki(... HttpFetcher())`).
- `PopupUi.tsx`: does not use Anki — no change expected.

Delete the now-orphaned components (verify no other importers first — grep each):
`AnkiSettingsTab.tsx`, `MiningSettingsTab.tsx`, and Anki-only helpers
`AnkiSelect.tsx`, `AnkiDialog.tsx`, `AnkiDialogButton.tsx`,
`AnkiDialogTutorialBubble.tsx`, `AnkiConnectTutorialBubble.tsx`. **Caution:**
`AnkiDialog`/`Anki` may be imported by the kept `common/app` web-app bridge or
`anki/anki.ts` — grep before deleting; if referenced by kept code, leave the file and
only drop the SettingsForm usage.

`pnpm build` + `tsc` + smoke (popup tabs). Commit.

## Phase B — prune mining options from the other tabs

- **`StreamingVideoSettingsTab.tsx`**: remove the `{t('settings.mining')}` section —
  `streamingRecordMedia`, `streamingTakeScreenshot`, `streamingCleanScreenshot`,
  `streamingCropScreenshot`, `streamingScreenshotDelay` toggles/fields + their
  destructure. Keep app-integration, UI, subtitle, pages-table sections.
- **`MiscSettingsTab.tsx`**: remove the `{t('settings.mining')}` section
  (`miningHistoryStorageLimit`). Keep theme/language/subtitle/pause-on-hover/
  websocket/word-learning/transcript/import-export.
- **`KeyboardShortcutsSettingsTab.tsx`**: remove the mining rows from
  `keyBindProperties`: `copySubtitle`, `ankiExport`, `updateLastCard`, `exportCard`,
  `takeScreenshot`, `toggleRecording`. Keep play/pause/offset/subtitle-track binds.

`pnpm build` + `tsc` + smoke. Commit.

## Phase C — remove the fields from the settings schema + defaults

`packages/asbplayer-common/settings/settings.ts` and `settings/settings-provider.ts`
(defaults). Remove (grep each symbol repo-wide first to confirm no kept reader):
- **`AnkiSettings`** interface + the `ankiSettingsKeys`/`extractAnkiSettings` helpers
  — **EXCEPT** carve out `maxImageWidth`/`maxImageHeight` (move them to a kept
  interface, e.g. MiscSettings or a small ImageCaptureSettings, since `binding.ts`
  still reads them).
- `MiscSettings`: `copyToClipboardOnMine`, `postMiningPlaybackState`,
  `lastSelectedAnkiExportMode`, `miningHistoryStorageLimit`. **`clickToMineDefaultAction`
  → see Phase D.**
- `StreamingVideoSettings`: `streamingRecordMedia`, `streamingTakeScreenshot`,
  `streamingCleanScreenshot`, `streamingCropScreenshot`, `streamingScreenshotDelay`.
- `KeyBindSet`: `copySubtitle`, `ankiExport`, `updateLastCard`, `exportCard`,
  `takeScreenshot`, `toggleRecording` + their defaults.
- Anki/mining fields with no kept reader: `recordWithAudioPlayback`, `preferMp3`,
  `audioPaddingStart`, `audioPaddingEnd`, `surroundingSubtitlesCountRadius`,
  `surroundingSubtitlesTimeRadius` (confirm via grep — these had no extension runtime
  readers in the scan).
- Optionally remove the now-dead `bindCopy/bindAnkiExport/bindUpdateLastCard/
  bindExportCard/bindTakeScreenshot/bindToggleRecording` methods in
  `key-binder/key-binder.ts` (the extension `key-bindings.ts` does NOT call them —
  verify with a grep — so they're dead; leaving them is also harmless).

**This phase touches the schema, so re-run `tsc` carefully** — every removed field
will surface readers you missed. Each surfaced reader is either kept-code (then DON'T
remove the field) or removable. `pnpm build` + `tsc` + smoke. Commit.

## Phase D — mobile-overlay mine button decision (`clickToMineDefaultAction`)

The mobile overlay (`mobile-video-overlay-controller.ts` + `MobileVideoOverlayUi.tsx`)
still wires a mine button via `clickToMineDefaultAction` → `postMineAction`. The button
now sends `copy-subtitle`, which `binding.ts` no longer handles (dead no-op). Choose:
- **(a) Neuter it** (recommended for full lean): remove the mine button from the
  mobile overlay model/UI + the `postMineAction`/`clickToMineDefaultAction` plumbing,
  then remove `clickToMineDefaultAction` from the schema. Touches the
  `MobileOverlayModel` type in common.
- **(b) Keep `clickToMineDefaultAction`** as a harmless schema field and leave the
  (no-op) mobile mine button. Smaller change.

`pnpm build` + `tsc` + smoke (incl. mobile overlay if (a)). Commit.

## Phase E — i18n + final pass

- Remove now-unused i18n keys (`settings.anki`, `settings.mining`, `binds.copySubtitle`,
  the anki/mining field labels, `action.openSidePanel` from the earlier strip, etc.)
  from `public/_locales` + `asbplayer-common/locales`. Optional/low-risk; grep the
  key before deleting.
- Drop the now-unused `tabCapture` manifest permission in `wxt.config.ts` (recording
  is gone — verify no `chrome.tabCapture` usage).
- Final `pnpm build` (note bundle size vs. the 7.28 MB current), `tsc` (should still
  be ≤9 pre-existing), full golden-path smoke (popup tabs + profile switching +
  YouTube word-click → gloss → save).
- Update `CUSTOMIZATIONS.md §4/§6` to record the settings UI + schema removal.

## Verification (golden path)

Load the dev bundle (`pnpm dev` → `.output/chrome-mv3-dev`): popup opens; the
settings tabs are now Subtitle Appearance / Keyboard Shortcuts / Streaming Video /
Misc / About (no Anki, no Mining); each tab opens correctly (verify reindexing);
profile switching/deletion works; YouTube word-click → hover gloss (shows + dismisses)
→ right-click save creates a highlight.
