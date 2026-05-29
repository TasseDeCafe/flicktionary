# Plan: delete orphaned dead code from the lean fork

> **For a fresh thread.** Self-contained. Follows the 2026-05 mining/anki settings
> strip (see `CUSTOMIZATIONS.md §4`). This plan targets code that is **on disk but
> unreachable** — never imported from any extension entrypoint, so never type-checked
> and never bundled. It's pure clutter (disk + git noise + "is this used?" confusion).
> Branch: `feat/add-asbplayer-extension`.

## How "dead" was determined (reproduce before each cluster)

`@flicktionary/extension` is the **only** consumer of `@flicktionary/common`
(`packages/asbplayer-common`) — nothing else in the monorepo imports it. So the
extension's TypeScript program is the authoritative reachable set. To regenerate the
orphan list:

```sh
cd packages/extension
pnpm exec tsc --noEmit --listFiles 2>/dev/null | grep asbplayer-common | grep -v node_modules \
  | sed 's#.*/packages/asbplayer-common/#asbplayer-common/#' | sort -u > /tmp/reachable.txt
cd ..
find asbplayer-common -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' | sort > /tmp/ondisk.txt
comm -13 /tmp/reachable.txt /tmp/ondisk.txt   # on disk, NOT in the program = orphan
```

At time of writing: **96 reachable, 170 on disk → ~74 orphan files** (incl. tests).

**A file in this orphan list is safe to delete** for the extension build/typecheck: it's
not in the tsc program (so deleting it cannot change the tsc error count) and esbuild
never reaches it (so the bundle is unaffected). Deletion is **iterative** — removing a
cluster makes its dependencies-only-used-by-it become newly unreachable, so re-run the
command after each cluster to surface the next wave.

### CRITICAL caveat — test files are NOT governed by this list
Jest has its own program/config. Files like `settings/settings-import-export.test.ts`,
`settings/settings-provider.test.ts`, `util/util.test.ts`, `pages/index.test.ts`,
`copy-history/copy-history-repository.test.ts` appear "unreachable from the extension"
but are **live jest tests for KEPT code** — do NOT delete them. Only delete a `.test.ts`
when its **subject file** is being deleted in the same cluster (e.g. `anki/anki.test.ts`
goes only if `anki/` goes).

## Gate (after every cluster, commit per cluster)

1. `pnpm --filter @flicktionary/extension build` — the real gate (esbuild). Note bundle
   size vs the current **7.22 MB**.
2. `pnpm exec tsc --noEmit` in `packages/extension` — must stay at the **9-error
   baseline** (the WXT build, not tsc, is the gate; see `[[project_extension_typecheck_gate]]`).
3. `pnpm exec jest` in `packages/asbplayer-common` — must not regress. Known
   **pre-existing** failures: 3 in `settings-import-export.test.ts` (`wordClickEnabled`
   not in `settingsSchema`) — unrelated, ignore.
4. Re-run the orphan command to see the next wave before moving on.

Each cluster ends by grepping the to-be-deleted symbols repo-wide one more time
(`grep -rln`) to confirm nothing reachable picked them up since the scan.

---

## Cluster 1 — the orphaned asbplayer standalone web-app UI (biggest win)

The standalone web client (`client/`) was already removed; its shared React UI in
`common/app/` is now pure orphan. **Delete** everything under `common/app/` EXCEPT the
8 reachable integration-bridge files (these are imported by `use-video-element-count`
via `app/index.ts`, the kept web-app *integration* — see `CUSTOMIZATIONS.md §4 "Kept"`):

**KEEP** (reachable):
`app/index.ts`, `app/components/localized-error.ts`, `app/hooks/use-chrome-extension.ts`,
`app/hooks/use-copy-history.ts`, `app/services/{app-key-binder,cached-local-storage,
chrome-extension,playback-preferences}.ts`.

**DELETE** (orphan):
- `app/components/*` — `App, Alert, Bar, BulkExportModal, Controls, CopyHistory,
  CopyHistoryList, DragOverlay, LandingPage, NeedRefreshDialog, Player, RootApp,
  SettingsDialog, SubtitlePlayer, VideoElementFavicon, VideoElementSelector, VideoPlayer`,
  `components/index.ts` (verify `app/index.ts` doesn't re-export it — it doesn't today).
- `app/hooks/*` — `use-anki, use-app-bar-height, use-app-key-binder,
  use-app-web-socket-client, use-document-has-focus, use-dragging, use-fullscreen,
  use-i18n, use-playback-preferences, use-resize, use-service-worker,
  use-subtitle-dom-cache, use-subtitle-styles, use-swipe, use-window-size`.
- `app/services/*` — `app-extension-dictionary-storage,
  app-extension-global-state-provider, app-extension-settings-storage,
  app-settings-storage, broadcast-channel-video-protocol, chrome-tab-video-protocol,
  clock, extension-bridged-copy-history-repository, media-adapter, mining-context,
  player-channel, video-channel, video-protocol, util` (+ `app/services/util.test.ts`).

This is the single largest reduction (~45 files). Safe by construction: a KEEP file can't
import a DELETE file (it would make the DELETE file reachable). **Verify** the build after
this cluster — it's the riskiest only because of its size.

> **Decision to confirm with the user:** `CUSTOMIZATIONS.md §6` framed deleting
> `common/app` as gated behind removing the web-app *integration*. That gating applies to
> the integration bridge (the 8 KEEP files); the UI above is already orphaned and
> independent. The donor-model playbook (§3) says harvest from **upstream**, not from
> local orphan copies — so keeping these as a local reference isn't necessary. Recommend
> deleting; flag in case the user wants them retained as a reading reference.

## Cluster 2 — orphaned Anki/card UI components (in `common/components/`)

All unreachable (their only importers were Cluster-1 web-app files). **This corrects the
Phase-A decision to keep `AnkiDialog` — it is now confirmed unreachable.** Delete:
`AnkiDialog.tsx, AnkiDialogButton.tsx, AnkiDialogTutorialBubble.tsx,
DeckFieldTutorialBubble.tsx, NoteTypeTutorialBubble.tsx, AudioField.tsx, CustomField.tsx,
DefinitionField.tsx, ImageField.tsx, SentenceField.tsx, WordField.tsx, ImageDialog.tsx,
SubtitleTextImage.tsx, ConfirmDisableCspDialog.tsx, LoadSubtitlesIcon.tsx, PanelIcon.tsx,
settings-model.ts`.

Grep each before deleting (some — `LoadSubtitlesIcon`, `PanelIcon`,
`ConfirmDisableCspDialog` — aren't Anki-specific, just unreachable; confirm no reachable
importer survived).

## Cluster 3 — orphaned standalone dirs / stray files

- **`subtitle-coloring/`** (`index.ts` + `subtitle-coloring.ts`) — fully orphaned (only
  the Cluster-1 players imported it). Confirms `CUSTOMIZATIONS.md §6`'s note.
- **`yomitan/index.ts`** — orphan barrel. (KEEP `yomitan/yomitan.ts` — `dictionary-db.ts`
  imports it directly.)
- **`audio-clip/mp3-encoder-worker.ts`** — orphan worker. (KEEP `audio-clip.ts`,
  `mp3-encoder.ts`, `index.ts` — reachable via `anki/anki.ts ← dictionary-db`.)
- **`device-detection/mac.ts`**, **`hooks/use-i18n.ts`**, **`hooks/use-image-data.ts`** —
  orphaned.
- **HIGH-CAUTION, lowest priority:** `decs.d.ts`, `vite-env.d.ts` — ambient declaration
  files for asbplayer-common's standalone build. Likely unused by the extension (which
  supplies its own types), but ambient `.d.ts` can affect module resolution. Delete LAST
  and only if `pnpm build` + tsc stay green; revert immediately if module-type errors
  appear (e.g. for `lamejs`/`vtt.js`).

## Cluster 4 — npm dependency pruning (verify, modest yield)

After Clusters 1–3, re-check for deps that became unused. Be conservative — `About.tsx`
(kept) lists library names as **credits strings only** (not imports), so a lib can be
both "credited" and unused. Honest assessment from the current scan:
- Most parser deps stay: `@flatten-js/interval-tree` (subtitle-collection),
  `vtt.js`/`ass-compiler`/`@qgustavor/srt-parser`/`pgs-parser` (subtitle-reader),
  `m3u8-parser`/`mpd-parser` (HLS/DASH), `dexie` (dictionary-db).
- `lamejs` + `@types/dom-mediacapture-record` are tied to `audio-clip` — but
  `audio-clip.ts`/`mp3-encoder.ts` stay reachable via `anki/anki.ts ← dictionary-db`,
  so these probably **cannot** be removed yet (they unlock only after Cluster 6's
  dictionary-db→anki cut). Re-grep after each cluster; remove a dep only when `grep -rln`
  finds zero importers in reachable code, then `pnpm build` to confirm.

## Cluster 5 — dead i18n keys (low value, deferred in Phase E)

The Anki/mining translation keys (`settings.anki`, `settings.mining`,
`binds.copySubtitle`/`ankiExport`/`extensionToggleRecording`, the
`extension.settings.*Screenshot`/`recordAudio` labels, and after Cluster 2 the
`ankiDialog.*` / anki-field-label keys) are dead in `common/locales/*.json` (12 langs).
Harmless. Skipped earlier because the locale JSON doesn't survive a `json.dump`
round-trip cleanly (a rewrite = noisy 12-file diff). If pursued, do a **line-based**
deletion of the specific leaf keys (one key per line in these pretty-printed files),
not a reserialize, and grep each key for 0 `t('…')` refs first (keep `settings.recordingBind`
— still used by the keybind-editing placeholder).

---

## Deeper unlocks (investigation, NOT mechanical deletion)

These are the high-leverage follow-ups that would unlock deleting whole subsystems but
require a real code change + decision, not just a `git rm`:

### Cut the `dictionary-db.ts → anki.ts` dependency
`dictionary-db.ts` (kept, load-bearing for profiles) is the **only reachable importer of
`anki/anki.ts`**, which in turn keeps `audio-clip/`, `card`-building code, and pulls
`lamejs`/MediaRecorder along. Investigate exactly what `dictionary-db` uses from `anki`
(likely a small type or helper). If it can be inlined / re-typed off `anki`, that unlocks
deleting `anki/`, the rest of `audio-clip/`, and the `lamejs` + `@types/dom-mediacapture-record`
deps. **Biggest remaining structural win.**

### Remove the web-app *integration* (the 8 Cluster-1 KEEP files)
Per `CUSTOMIZATIONS.md §6`: drop `asbplayer.content.ts` + `extensionSupportsAppIntegration`
+ the `ChromeExtension` usage in `use-video-element-count`. That unlocks deleting the
remaining `common/app/`, and (with the cut above) much of `dictionary-db`,
`copy-history/`, `web-socket-client/`. Larger decision — only if Flicktionary truly never
uses the `app.asbplayer.dev` bridge. Bundle benefit is small (already tree-shaken); the
value is a leaner tree.

## Notes
- This plan **supersedes/expands** `CUSTOMIZATIONS.md §6`'s "deferred follow-ups"
  (deep `dictionary-db` removal, web-app integration removal, `subtitle-coloring` orphan,
  dead i18n). Update §6 when clusters land.
- Recommended order: 1 → 2 → 3 → re-scan → 4, committing per cluster. Clusters 1–3 are
  pure `git rm` + the gate; 4–5 are optional; the deeper unlocks are separate efforts.
