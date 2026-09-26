# Book import (EPUB / FB2 / MOBI)

> **Status: historical** (archived 2026-09-26). Design and implementation plan for book import (issue #474), implemented by PR #477; kept for design rationale. Current behavior lives in `../docs/READER-SPEC.md` (book sources and reading), `../docs/DATA-MODEL.md` (book tracks, per-track lemma profiles) and `../SPEC.md`. Follow-ups #475 (fresh-save frequency floor) and #476 (pinned-book priority) are tracked as issues.

## Goal

Read whole books in the app instead of on a Kindle: upload a DRM-free file, read it part by part with the existing reader, and resume at the exact line on any device. Scope of the first version is **import + reading only** — no SRS/priority changes.

## Decisions

| Topic | Decision |
|---|---|
| Formats | EPUB, FB2 (incl. `.fb2.zip`), MOBI/AZW3 (DRM-free). DRM-protected files are rejected with a clear message. |
| Parser | `foliate-js` (npm, MIT), **client-side**, loaded via dynamic `import()` so it stays out of the main bundle. One API for all three formats. |
| Unit of reading | One **part** = one `text_track` = one `study_session`. A book is one `content_source(type='book')` with N tracks. Mirrors TV (show → episodes); a book costs one guest source slot. |
| Splitting | A chapter over **30k chars** is split into near-equal parts at paragraph boundaries (`Глава 12 · 1/2`). |
| Chapter boundaries | Chapters come from **TOC entries resolved to anchors**, not from foliate sections: when several TOC entries land in one section (EPUBs with one XHTML file per several chapters, MOBI filepos entries) the section is cut at each anchor via `resolveHref(href).anchor(doc)`; sections with no TOC entry keep their own boundary. |
| No chapters | If the book has ≤ 1 substantive section, fall back to ~20k-char parts cut at paragraph boundaries, titled `Part N`. |
| Front/back matter | Chapter picker step at import; sections matching back-matter titles (Notes, Copyright, Contents, Bibliography, Acknowledgments, About the author, Index, Примечания, Содержание, Оглавление, …) or under ~1k chars start **unchecked**; non-linear sections (FB2 notes body) are dropped. |
| Moderation | **One Haiku call** over a spread sample (start + 2–3 random ~5k windows), server-side, from the stored text. Book policy: only `csam` hard-blocks; `sexual-explicit` is recorded as flagged but accepted (novels have sex scenes; books are never shared — `SHARE_MODE_BY_SOURCE_TYPE.book = 'none'` already). Verdict stored on every track. |
| Resume anywhere | Per-part position already lives server-side (`furthest_read_segment_index`). Add `study_sessions.last_read_at`; the book's **current part** = its session with the latest `last_read_at`. Book cards open the current part directly at the saved line. |
| Sessions creation | Parts get their session lazily (`studySessions.create` is already find-or-create). Import creates the first included part's session so the book shows up in lists immediately. |

## Findings from real files

Checked against 4 books (2 FB2 ru, 2 MOBI en), parsed with foliate-js 1.0.1 under Node + jsdom, < 1 s each:

- **Гарри Поттер 5 (FB2, windows-1251):** 38 flat chapters, 22–50k chars, 1.41M total. foliate re-decodes from the XML declaration's encoding — must not assume UTF-8 if we ever parse FB2 ourselves.
- **Убик (FB2, UTF-8):** 17 chapters 2–31k; title/dedication/epigraph as tiny sections; footnotes body is `linear: 'no'`.
- **Player Piano (MOBI7):** sections align with the 35 chapters; blurb/foreword as small sections. Drop-caps / small-caps markup (`D<span>OCTOR</span>`) joins correctly in foliate's DOM — our text extraction must not insert spaces at inline-tag boundaries.
- **The Lonely Century (MOBI7):** 11 chapters 31–75k plus back matter; the **Notes section is ~265k chars** — why the picker must default-exclude back matter.
- foliate returned **empty TOC labels for MOBI** (under jsdom — verify in a browser). Title fallback: TOC label → first heading-like block of the section → `Part N`.
- Longest paragraph seen ~1.3k chars, but the reader sends the whole starting segment as the gloss `contextLine` (`selection-adapter.ts`), capped at 2000 by `glosses-contract.ts`. Segments therefore get a **hard 1,500-char cap**: split at sentence boundaries (`Intl.Segmenter`), then at word boundaries for over-long or punctuation-free sentences, then at grapheme boundaries as a last resort.
- Body limit is **4 MB** (`apps/backend/src/app.ts`): HP5 is ~2.6 MB of UTF-8; War and Peace would be ~5.5 MB → parts upload in batches.

## Data model

Migration (via the `db-migrations` skill):

- `text_tracks.book_part_index int NULL`, `text_tracks.book_part_title text NULL`; partial unique index on `(content_source_id, book_part_index) WHERE book_part_index IS NOT NULL`. The existing `UNIQUE (content_source_id, language, hash)` stays: a book track's `hash` is `sha256(partIndex + '|' + part text)`, so two parts with identical text (e.g. repeated interludes) never collide.
- `study_sessions.last_read_at timestamptz NULL`, bumped by `updateReadingProgress` / `setReadingPosition` (and on first open).
- `content_sources.metadata` for books: `{ author, contentHash, fileName, importStatus: 'uploading' | 'ready', uploadId, partCount }`. `uploadId` is a fresh uuid per upload attempt. Per-user dedup on `metadata->>'contentHash'` (sha256 of the normalized part texts); `importStatus = 'uploading'` rows are hidden from every list **and enforced server-side**: `studySessions.create` / `books.openPart` refuse a book source that isn't `ready`, and the shared `canWriteTracksToSource` guard (`text-tracks-router.ts`, used by `importFromPaste`, `uploadSrt` and `importFromOpenSubtitles`) refuses `type = 'book'` sources outright (book tracks are only written through `books.appendParts`, which refuses a `ready` book).
- `text_track_source`: reuse `'upload'`.

The `'book'` enum value, `SHARE_MODE_BY_SOURCE_TYPE.book`, the context-blob "Book excerpts" label and the web `book` letterform palette already exist.

## API (new `books` router)

1. `books.create({ title, author?, language, fileName, contentHash, partCount })` → `{ contentSourceId, alreadyExisted }`. Checks the **guest source quota up front** (fail before uploading megabytes). Dedup hit on a `ready` book returns it (client calls `books.openPart` for the current part — after a removal that recreates fresh sessions, i.e. a removed-then-reimported book starts over); on an `uploading` one, deletes its tracks and resets it with a **new `uploadId`** under a row lock. Returns `uploadId`. **Pending uploads are bounded per user (any user, not just guests):** at most one `uploading` book at a time — starting a new book upload deletes the user's other `uploading` book. This bounds abandoned multi-megabyte uploads to one per user without a cron.
2. `books.appendParts({ contentSourceId, uploadId, parts: [{ partIndex, title, segments: string[] }] })` — batches ≤ ~1.5 MB; idempotent per `partIndex` (upsert track, insert segments only if empty). Rejected unless `uploadId` matches under the row lock, so a stale tab's queued batches can't write into a reset upload.
3. `books.finalize({ contentSourceId, uploadId, nativeLanguage? })` → checks all `partCount` parts arrived, samples + moderates **before** the transaction, then in **one transaction** (row-locked source) **re-verifies `uploadId`** (mismatch → 409, nothing committed or deleted); on a block verdict deletes the book (`CONTENT_BLOCKED` 422); otherwise stamps verdicts, creates the first part's session (guest quota re-checked in the same tx) and flips `importStatus = 'ready'` — a quota failure rolls back, leaving the book `uploading` (retryable, never a ready book with no session). After commit, enqueues `ensureTrackLemmaProfileJob` per track. **Idempotent**: finalizing a `ready` book returns its first part's session.
4. `books.get({ contentSourceId })` → metadata + parts `[{ trackId, partIndex, title, segmentCount, sessionId?, furthestReadSegmentIndex?, lastReadAt? }]` + `currentPartIndex`.
5. `books.openPart({ contentSourceId, partIndex })` → find-or-create session → `{ sessionId }` (thin wrapper over the existing create path, owner-only, `ready` only).
6. `books.remove({ contentSourceId })` → soft-deletes **all** the book's sessions in one statement (same semantics as single-session removal: kept vocabulary survives), which also frees the guest slot. The source + tracks stay for dedup; reimporting starts fresh sessions.

`StudySessionSchema` gains `bookPartIndex`, `bookPartTitle`, `bookPartCount`, `lastReadAt`. Moderation gains a policy option (`hardBlock: ModerationCategory[]`) threaded through `moderationPass` → `parseModerationVerdict`, plus a `'book-upload'` surface; the sample is built server-side by a pure helper.

## Web

- **Parsing** — `features/books/utils/parse-book-file.ts`: dynamic-import foliate `makeBook`; walk `book.sections` (skip `linear === 'no'`), `createDocument()`, extract block-level paragraphs (block elements → boundaries, inline text concatenated without separators, whitespace collapsed, empties dropped), resolve TOC hrefs via `resolveHref` and **cut sections at TOC anchors** into chapters, detect DRM (foliate errors / `META-INF/encryption.xml`). `build-book-parts.ts` (pure, unit-tested): default inclusion heuristic, 30k split, no-chapter fallback, long-paragraph sentence split, content hash.
- **Upload wizard** — `+` overlay row "Upload a book" → `/books/import`: pick file (`Reading file…` state, as in lesson import) → chapter picker (checkbox list with char counts, select-all) → language (book metadata → `languages.detect` on a sample; manual wins) + CEFR step when missing → upload with a progress bar (batches) → navigate into part 1.
- **Book page** — `/sessions/book/$contentSourceId` (template: `show-detail-view.tsx`): cover letterform, title/author, big **Continue reading** (current part at saved line), part list with per-part progress (`furthestReadSegmentIndex / segmentCount`), remove book.
- **Lists** — `derive-books.ts` groups book sessions by `contentSourceId` (like `derive-tv-shows.ts`); `BookGroupCard` / media card on the sessions list and dashboard "Continue learning" rail; tapping opens the current part directly, a secondary action opens the book page. Group sort key = latest `lastReadAt ?? createdAt`. Add a `book` type filter chip.
- **Reader** — `SessionView` is reused across `$sessionId` changes by TanStack Router, and its session-scoped refs (`didRestoreRef`, `writtenMaxRef`, …) would carry over from the previous part (skipped restore, suppressed progress writes). The route renders it **keyed by `sessionId`** so each part remounts. **Cross-device resume:** the one-shot restore runs as soon as cached session data exists, so a stale cache (another device read further, or set a lower bookmark that the monotonic `mergeFurthestReadSegmentIndex` would then discard) restores to the wrong line. On reader mount the session query's cached data is dropped and the restore waits for the fresh server response (brief skeleton); the monotonic merge keeps protecting against stale refetches *within* a sitting. This applies to every session, not just books. For book parts: header title `Book · Chapter title`, a contents button → book page; an end-of-part card after `CheckpointCloseoutCard` with **Next part** (calls `books.openPart`, navigates) / previous part.

## Implementation checklist

- [x] Backend: migration + regenerated types
- [x] Backend: moderation policy option + sample builder (unit tests)
- [x] Backend: `books` contract + router + service + repository (integration tests: golden path incl. batched append + idempotent re-append + early finalize refused + idempotent finalize + list DTO + openPart + progress + remove + re-upload dedup; 401; unfinished book not openable + paste refused on a book source; restarted upload supersedes old uploadId + one pending upload per user; csam blocks / sexual-explicit accepted; missing CEFR → 412)
- [x] Backend test gaps: guest quota at create/finalize, stale `uploadId` on finalize, `studySessions.create` refused for an uploading book, SRT/OpenSubtitles refused on a book source
- [x] Backend: `lastReadAt` bump + session DTO book fields
- [x] Web: foliate dependency + `parse-book-file.ts` + `build-book-parts.ts` (unit tests with synthetic fixtures — never commit real books; cover multi-chapter-per-section anchors, long/punctuation-free sentences, no-chapter fallback)
- [x] Web: import wizard + `+` overlay entry
- [x] Web: book page route
- [x] Web: sessions list / dashboard grouping + continue
- [x] Web: reader header + end-of-part navigation (route keyed by `sessionId`; verify part → part restores position and writes progress)
- [x] Web: fresh-fetch-before-restore on reader mount (verify: read further on device B, reopen on device A with a warm cache → lands on B's line)
- [x] Manual smoke with the four sample books (desktop + mobile resume)
- [x] Specs: `docs/READER-SPEC.md` (book source), `docs/DATA-MODEL.md`, `SPEC.md` (drop "not a books reader"); archive this proposal

## Open questions

- MOBI TOC labels: foliate reads them via `innerText`, which jsdom lacks (hence empty in the Node check); expected to work in browsers — confirm in the manual smoke. Fallback: first heading-like line.
- Book cover images: skipped in v1 (letterform tile); would need storage.
- Vocabulary tab filter "words from this book" — nice-to-have, likely with #476.
