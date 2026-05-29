# Extension maintenance plan — donor model + full lean

> **Status:** Draft for review. No code changes yet.
> **Decision:** Own the fork (no wholesale re-bases). Keep upstream asbplayer as a
> *parts donor* (cherry-pick platforms + plumbing fixes). Aggressively strip the
> Anki / Yomitan / dictionary / annotation stack so the tree contains only what
> Flicktionary uses. Align TS/ESLint with the monorepo. Defer Tailwind.

This plan supersedes the "re-base onto a newer upstream" framing in the current
`CUSTOMIZATIONS.md`. That file becomes a *maintenance playbook* (§5).

---

## 0. Why this shape (the reasoning being approved)

- **Build system already matches upstream.** Upstream's extension uses WXT
  (`^0.20.19`), same as us. The package-scope rename (`@project/*` →
  `@asbplayer-fork/*`) and pnpm/turbo layout break a naive `git merge` but **not**
  file-level cherry-picking — the file implementing a feature sits in the same
  place on both sides.
- **Upstream velocity points away from us.** The 1.13→1.17 releases were almost
  entirely Anki/Yomitan/dictionary work (1.14 subtitle annotations, 1.16
  dictionary statistics, 1.17 word browser). "Free updates" are mostly updates to
  code we delete on arrival. The genuinely useful harvest is narrow: **new
  platform page-scripts** (e.g. Netflix, Hulu JP) and **shared video/HLS/DASH
  plumbing fixes** — both localized and cherry-pickable.
- **Our word path is independent (verified).** `subtitle-controller.ts:543`
  tokenizes with our own `word-tokenizer.ts` under `wordClickEnabled`;
  `WordInteractionController` imports only `floating-ui` + `uuid`. The unwanted
  stack is reachable but separable. Therefore full lean is an amputation, not a
  rewrite.
- **Dependency drift dissolves.** We already run React 19 / MUI 6 on our own
  cadence. Owning the fork makes that explicit instead of a problem.

License note: asbplayer is **MIT**. A closed/commercial vendored fork is fine as
long as the upstream copyright + license text are retained (we keep `LICENSE.md`).
Audit bundled assets (locales, any dictionaries) for stricter licenses before a
commercial ship — though the dictionary assets leave with the strip anyway.

---

## 1. Donor model setup (do first — it's cheap and unblocks Netflix)

1. Add upstream as a read-only remote:
   ```
   git remote add asbplayer https://github.com/asbplayer/asbplayer.git
   git fetch asbplayer --tags
   ```
   We never merge from it. It exists so we can `git show asbplayer/main:extension/src/entrypoints/<file>` and diff individual files.
2. Pin the reference version. We vendored ~1.13. Record the **upstream tag we
   consider our baseline** in the playbook so future ports diff against a known
   point, not a moving `main`.
3. Document the cherry-pick procedure (goes in the playbook, §5):
   - **A new platform:** copy `extension/src/entrypoints/<site>-page.ts` + its
     `pages.json` row + any new shared helper it pulls from `pages/` (`m3u8-util`,
     `mpd-util`). Rename imports to `@asbplayer-fork/*`. No core controller edits.
   - **A plumbing fix** (video-data-sync, HLS/DASH, browser-compat): diff the
     specific file against our baseline tag, port the hunk by hand, re-run the
     "do not reintroduce" checklist.

---

## 2. Full lean — strip Anki / Yomitan / dictionary / annotations

Goal: remove everything that serves card mining, Yomitan annotation, dictionary
DB, and subtitle vocab-coloring, while keeping the `wordClickEnabled` tokenizer
path, hover gloss, save-to-backend, transcript, and all video/platform plumbing.

The only gate is the **WXT build** (`pnpm build`) — tsc already has ~18 tolerated
errors. So each phase below must end with a green `pnpm build` and a manual smoke
test on a YouTube video (word-click → hover gloss → right-click save). Work on a
dedicated branch; commit per phase so any regression bisects cleanly.

### Verified entanglement map (what to cut, in dependency order)

| Layer | Symbols / files | Importers to fix |
|---|---|---|
| Leaf UI | `anki-ui/` entrypoint, `ui/anki/`, `AnkiUi.tsx`, `anki-ui-controller.ts`, `bulk-export-controller.ts`, `tab-anki-ui-controller.ts`, `card-publisher.ts`, the 6 `asbplayerv2` card/bulk-export handlers | self-contained → delete first |
| Dictionary DB | `DictionaryDb` / `dictionary-db`, `dictionary-handler.ts`, `statistics-ui/`, `dictionary-statistics` | **10 files**: `SidePanel.tsx`, `PopupUi.tsx`, `SettingsPage.tsx`, `SidePanelUi.tsx`, `Popup.tsx`, `use-settings.ts`, `subtitle-controller.ts`, `dictionary-handler.ts`, `background.ts`, `binding.ts` |
| Coloring | `SubtitleColoring` (`@asbplayer-fork/common/subtitle-coloring`) | `subtitle-controller.ts` (line 23/142), `services/binding.ts` |
| Yomitan | `Yomitan` class in common | `background.ts` (sole importer) |
| Core types | `PostMineAction` enum, `CardModel`, `AnkiSettings`, card messages (`card-exported/updated/saved`, `ShowAnkiUiMessage`, `PublishCardMessage`) | `message.ts`, `model.ts`, `settings.ts`, `binding.ts` (lines ~66, 719, 743–751, 756–776, 1164–1291) |

### Phased sequence (leaf → root)

**Phase A — delete the cleanly-removable leaves.** The ~14 self-contained files
(anki UI, bulk-export, card handlers/controllers, `card-publisher`). Unregister
their handlers in `background.ts`. Expect build breaks only from dangling imports
in `background.ts` and the anki-ui entrypoint registration in `wxt.config.ts`.
Smoke test.

**Phase B — sever coloring + the dictionary path in `subtitle-controller.ts`.**
Keep the `wordClickEnabled` branch (line 542–544) intact; remove the
`SubtitleColoring` field/instantiation and the rich-text/annotation branch it
feeds. This is the highest-value cut because it isolates our word path. Smoke
test that word-click rendering is unaffected.

**Phase C — unwind `DictionaryDb` from the 10 importers.** Mostly UI components
(`SidePanel`, `PopupUi`, `SettingsPage`, …) that render dictionary stats / browser
panels. Delete those panels and their props. `dictionary-handler.ts` and the
`Yomitan` import in `background.ts` go here. This is the bulk of the labor.

**Phase D — gut the core types in `binding.ts` + common.** Remove the
`PostMineAction` mining branch from `_toggleRecordingMedia`, the
`card-exported/updated/saved` handlers, and the `AnkiSettings` switch case. Strip
`CardModel`/card messages from `message.ts` and `PostMineAction`/`AnkiSettings`
from `model.ts`/`settings.ts`. **Recording/screenshot stays** if you still want
audio/screenshot capture independent of Anki — decide explicitly (see open
questions). Default assumption: recording's *only* consumer was Anki export, so it
goes too.

**Phase E — settings migration + cleanup.** Add a `settings-provider` migration
that strips `anki*` / `dictionary*` / `clickToMineDefaultAction` /
`lastSelectedAnkiExportMode` keys from existing exports on import (so a user's old
export doesn't crash). Remove the corresponding `MiscSettingsTab` /
`DictionarySettingsTab` UI. Drop now-dead deps: `Dexie` (saved-words already gone;
confirm transcript cache uses raw IndexedDB, not Dexie — if it does, Dexie is
fully removable), and any Yomitan/MeCab packages.

**Phase F — locales + assets.** Remove anki/dictionary i18n keys from
`public/_locales` and any dictionary asset bundles. Re-run `pnpm build`; confirm
bundle size dropped.

### Risks specific to the strip
- **Settings import of old exports** must degrade gracefully (Phase E migration) —
  this is the one user-facing breakage if missed.
- **tsc won't catch removals.** After each phase, grep for the deleted symbol
  across `src` + `asbplayer-common/src` to find stragglers the build tolerated.
- **`copy-history` records `CardModel`.** If we keep any copy/recording feature,
  its IndexedDB schema changes — verify the side panel handles records without the
  card shape, or remove copy-history with recording in Phase D.

---

## 3. TS/ESLint alignment (parallel with §1; low risk)

- Replace the no-op `"lint": "echo 'lint skipped (legacy fork)'"` with the
  monorepo's shared ESLint config (flat config consistent with the other
  packages). Expect a large first-run error count — triage into "autofix now" vs
  "ignore via baseline" so this doesn't block the strip.
- Decide the tsc posture: the ~18 pre-existing errors should *shrink* as dead code
  leaves. Once the strip lands, re-evaluate making `tsc --noEmit` a real gate. Set
  a target (e.g. "0 errors after Phase F") rather than fixing in the abstract.
- **Defer Tailwind.** It only pays off once the MUI-heavy dictionary/anki UI is
  gone (it largely is, post-strip) *and* paired with a settings-UI rewrite. Make
  it a follow-up, not part of this plan.

---

## 4. Verification strategy

- **Gate:** `pnpm build` green after every phase; `pnpm build:dev` for the dev
  bundle when smoke-testing.
- **Golden path (manual, per phase):** load dev bundle → YouTube video with subs →
  word-click tokenization renders → hover gloss popover shows + dismisses
  (watch the `display: flex !important` / `setProperty(...,'important')` trap) →
  right-click save creates a highlight (check Flicktionary backend) → unsupported-
  language video shows the one-time notice.
- **Pairing path:** re-pair via `/extension-pair` after any `background.ts` or
  settings change (auth lives in the `flicktionary.auth.v1` namespace outside
  `SettingsProvider` — confirm the settings migration doesn't touch it).
- Phase 10 integration tests are shelved; manual golden paths are the contract.

---

## 5. `CUSTOMIZATIONS.md` → maintenance playbook

Rewrite the framing from "how to re-base" to "how to own + harvest":
- **Lineage** stays (still useful context).
- Replace "Custom features to carry forward on re-base" with the **donor
  cherry-pick procedure** (§1.3) and the **baseline upstream tag**.
- Keep the **"do not reintroduce"** list — it's now the checklist applied when
  porting a donor file, to make sure a cherry-picked platform script doesn't drag
  Anki/dictionary hooks back in.
- Add a **"removed in full-lean strip"** section so a future port knows the whole
  mining/dictionary surface is intentionally gone.
- Fix the stale **transcript-server** reference: `CUSTOMIZATIONS.md` cites
  `transcript-server/` but it isn't in this repo — document where it actually
  lives (external service?) or remove the claim.

---

## 6. Netflix port (proof-of-concept of the donor workflow)

After §1 + at least Phase A of the strip (so we're not porting onto a dirty tree):
1. `git show asbplayer/<baseline-tag>:extension/src/entrypoints/netflix-page.ts` →
   add as `src/entrypoints/netflix-page.ts`, rename imports to `@asbplayer-fork/*`.
2. Add the `netflix` row to `pages.json` (`host: www\\.netflix\\.com`,
   `pageScript: netflix-page.js`, `syncAllowedAtPath: watch`, `autoSync.enabled`).
3. Port any shared helper it imports from `pages/` if not already present.
4. **Backend gap:** the save/register path is YouTube-specific
   (`findOrCreateForYoutubeVideo`, `content_source.type = 'youtube'`). Netflix
   word-save needs a backend content-source type + register flow — Netflix
   *playback/subtitle* support works at the extension layer, but *saving* does
   not until the backend learns Netflix. Scope this explicitly: ship Netflix
   subtitle/word-click first, gate save behind the backend work.

This validates the donor procedure end-to-end on the cheapest real platform.

---

## 7. Open questions for you

1. **Recording/screenshot:** keep audio/screenshot capture (decoupled from Anki),
   or remove it entirely with the mining stack? (Affects how much of `binding.ts`
   Phase D touches.)
2. **Netflix save:** is extension-layer Netflix support (subtitles + word-click +
   hover gloss) enough for now, with save deferred until the backend gains a
   Netflix content-source type? Or is save table-stakes?
3. **Sequencing:** do the strip first then port Netflix (cleaner), or land Netflix
   early as motivation/validation and strip around it? Plan currently assumes
   strip-Phase-A → Netflix → finish strip.

---

## 8. Execution order (summary)

1. §1 donor remote + baseline tag (cheap, unblocks everything).
2. §3 ESLint/TS config in parallel (low risk).
3. §2 Phase A (delete leaves).
4. §6 Netflix PoC (optional here vs after strip — see Q3).
5. §2 Phases B→F (the real strip, leaf→root).
6. §5 rewrite playbook; finalize TS gate from §3.
7. Defer: Tailwind, Netflix save backend.
