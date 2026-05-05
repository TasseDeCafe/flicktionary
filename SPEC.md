# Flicktionary — MVP spec

## What it is

A language-learning companion app. Pick a movie (fetch or upload its subtitles in a target language) or paste a chunk of text in a target language — Reddit comment, news excerpt, Telegram post. Highlight chunks you don't understand inside the app, then process the session into structured, deep-dive cards informed by the lexical approach. Export the kept cards to CSV for Anki import.

The app's value is **not** flashcard generation per se — it's the structured exploration of each chunk in the context of the source, the user's L1, and the user's level. Card export is a side-effect of having explored well.

## What it isn't (non-goals for MVP)

- Not a video player. The app does not host or sync to movie playback.
- Not a real-time companion. No auto-scroll, no audio fingerprinting, no clock sync.
- Not a flashcard review system (no SRS). Cards leave Flicktionary as CSV; review happens in Anki.
- Not a free-form chatbot. Per-card chat is scoped to refining understanding of one chunk.
- Not a books/articles reader. MVP handles movie subtitles and pasted text; books and articles are designed for in the data model but not yet implemented.

## Core decisions

### Source content

Two source types in the MVP, both feeding the same `text_segment` table.

- **Movie subtitles.**
  - **OpenSubtitles search.** Search by title; results filtered to the user's target language. The track's `language` must match the chosen study language — never inferred.
  - **Manual `.srt` upload.** First-class, not a fallback. User specifies the language at upload time.
  - On import, SRTs are normalized into per-line `text_segment` records (with `start_ms`/`end_ms`) and indexed for full-text search. The raw SRT is not preserved as a single blob.
- **Pasted text.** First-class, not a fallback. The user pastes raw text (50–20,000 chars), provides a short title (auto-suggested from the first ~60 chars), and picks the language.
  - Segmented one row per non-empty line (`\n`-split, trimmed). `start_ms`/`end_ms` are null.
  - Same FTS / dedup-hash plumbing as subtitles.
- All user content is RLS-scoped. Don't expose subtitle or paste text publicly.

### During a session

- No in-movie sync. The app is for triage and lookup, not playback.
- The mid-source screen is a search bar over the track plus a scrollable list of segments. Movie segments show a timestamp; text segments don't. That is the entire mid-source UI.
- Selecting text in a line — single line or contiguous multi-line — creates a `highlight`. Default behaviour: silent. No inline translation, no inline gloss.
- Optional **tap-to-translate** setting (off by default). When on, a selection opens a sheet with a fast one-line gloss + POS + register tag. Result cached on the highlight; re-tapping is instant.
- Highlight sheet has: selection text, optional free-text note, preset chips (`Explain`, `3 examples`, `Synonyms`, `Etymology`, `Why this form?`). The note and tags are passed to the LLM at processing time.

### Processing pipeline

Triggered when the user taps "Process" at end of viewing. Re-runnable: tapping
Process again on a `processed` / `exported` / `failed` session is idempotent —
the orchestrator skips the basic-data pass when LLM-suggested cards already
exist AND every highlight already has a card; otherwise it runs the pass for
the missing highlights only. Only `processing` rejects (in-flight). Pipeline
runs server-side, async, streamed (Anthropic SDK requires streaming for any
request whose worst-case duration exceeds 10 minutes — basic-data on long
tracks does).

1. **Source context blob** — one call per `study_session`, persisted on the row.
   - Output ~300 tokens: topic (genre + plot sketch for narrative material; subject matter for non-narrative), register, tone, recurring vocabulary themes, named entities or recurring referents the learner will encounter.
   - Source-type-aware: prompt is the same but the user message labels the excerpts (`Subtitle excerpts` / `Article excerpts` / `Text excerpts` / `Book excerpts`) so the model knows what it's looking at.
   - Acts as a cacheable prompt prefix for every subsequent call related to this session.
2. **L1-interference notes** — one call per `(L1, target_language)` pair, persisted globally and cached forever.
   - Output ~500 tokens: false friends, structural transfers, tense/aspect mismatches, register conventions.
   - Generated lazily on first session for that pair, then reused for all users.
3. **Basic-data pass** — one call per session, combining LLM chunk discovery and
   per-highlight basic-data population.
   - Input: full SRT (segment list), the user's highlights (so the model emits
     one row per highlight too), movie context blob, CEFR level, user's
     already-seen `(headword, sense)` pairs from `user_lookup`, and the
     `llm_highlights_enabled` user pref.
   - Output: one row per user highlight (always) plus, when LLM discovery is
     enabled, ~20–40 LLM-suggested chunks (target scales with CEFR — A1/A2=20,
     B1/B2=25, C1=35, C2=40). Each row has `source` (`'highlight'` or `'llm'`),
     normalized `headword`, `sense` (1-5 word disambiguator), `surface_form`,
     `segment_id`, and the **basic flashcard data** (`translation`,
     `definition`, `target_example`, `native_example`).
   - **Hard CEFR floor**: only LLM-discovered chunks at or above the user's
     level. The LLM is told to skip common B-level filler even when frequent
     in the source, and to **prioritize regional / dialectal / colloquial
     chunks** when the source context blob signals that register (e.g.
     rioplatense voseo, peninsular slang, mexicanismos) over neutral
     pan-language equivalents. Highlights bypass the CEFR floor — they always
     produce a card.
   - Below-level LLM chunks that slip through are flagged `below_cefr=true`
     and stored with status `auto_rejected`; user can override per chunk.
   - When `llm_highlights_enabled = false`, the prompt is shortened and the
     model is told to emit only highlight rows. When the user has no new
     highlights AND llm-highlights is off, the call is skipped entirely.
   - The LLM **normalizes the chunk**: it produces a `headword` that may
     differ from `selection_text`. Example: user highlights `out` inside
     `ran out of milk` → `headword = "run out of"`.
4. **Per-chunk Full exploration (deferred, on-demand)** — one call per card,
   triggered manually by clicking `Generate full exploration` in the focus
   view. Cards arrive from step 3 with only the basic data populated; this
   pass adds the optional enrichment fields. NOT run automatically during
   processing.
   - Input: chunk + 10 surrounding segments + source context blob + L1
     notes + user's note + preset tags + methodology prompt.
   - Output: refined basic columns (the model may revise them based on
     deeper analysis) plus an `extras` bag containing optional fields (IPA,
     frequency, register, register alternatives, collocations, etymology,
     L1 notes, more frequent synonyms, regionalism, free-form notes,
     bolded context segment).

### Review screen

Two-layer UI.

**Layer 1 — Triage list (default landing).**
- Two sections: "Your highlights" and "LLM-suggested chunks". Auto-rejected chunks collapsed under a `Show N filtered out` toggle.
- Each row: chunk surface form, the subtitle line as greyed context, a 1-line gloss, keep/reject toggle, tap target.
- Filter, search, sort across both sections.
- Each section header has `Keep all` / `Reject all` bulk-action buttons that act on the visible (search-filtered) cards in that section.
- Highlights are inserted with status `kept` by default (the user already signaled intent by highlighting). LLM-suggested chunks land as `pending` and require explicit triage. Below-CEFR LLM chunks are still `auto_rejected`.
- Sticky footer: `Export N kept cards`.
- No chat here. This layer is for fast triage.

**Layer 2 — Focus view (modal screen pushed above the tab navigator).**
- Modal header: chevron-back to triage, position counter (`Card N of M`),
  keep/reject toggles in the right slot.
- Below the header: a compact toolbar with prev/next arrows and the
  `Open in subtitles` deep-link (navigates to
  `/sessions/$id?segment=<id>` and flashes the source line).
- Card section: each basic column gets its own labeled input — `Headword`,
  `Target example`, plus `Translation` + `Native example` (and optional
  `Definition`) when L1 ≠ L2, or just `Definition` when L1 = L2. Every input
  debounces a partial PATCH to `cards.updateFields`; the basic columns are
  the single source of truth (no more `front_override` / `back_override`).
- Below the card: a collapsed `Context` block showing ±2 surrounding source
  segments. Open it with the chevron when needed.
- Full exploration: rendered when `exploration_extras` has data. Otherwise
  shows a `Generate full exploration` button that triggers the on-demand
  enrichment pass.
- Per-card chat thread, scoped to that chunk. The chat tool can call
  `update_card_fields` to patch any basic column or merge into
  `exploration_extras` server-side; the assistant body gets a
  `_Updated: …_` italic line and the focus view re-fetches the card.
- Prev/next navigation through the kept set. Keyboard `j`/`k` and `←`/`→`.

Per-card chat seed prompt = methodology + `(L1, target, CEFR)` + source context blob (cached) + chunk + 10 surrounding segments + the card's current basic data + extras (if populated). The user's question is the only dynamic turn.

### Export

- CSV with columns: `front`, `back`, `context`, `tags`, `headword`, `surface_form`, `note`. Imports cleanly into Anki.
- No `.apkg` for MVP.
- Exporting a card upserts a row in `user_lookup`.

### Navigation chrome

Native-style shell so the eventual React Native port is a translation, not a redesign.

- **Mobile** (`< 768px`): bottom tab bar with three slots — `Sessions` / central `+` button / `More`. The `+` opens an action sheet listing the start-something-new options (`Start a movie session`, `Practice with a text`; designed to grow as more `content_source.type`s land).
- **Desktop** (`≥ 768px`): left sidebar with the same item set, with a prominent `+ New` button at the top opening the same action overlay. The Sessions list itself has no `+` — it would be redundant.
- **Sessions list** offers `All / Movies / Texts` filter chips with counts so the unified list stays scannable as content types diversify. Each row has a **Remove** action (trash icon) that soft-deletes the session via `study_session.deleted_at` — the session disappears from the list, but the kept cards stay in the user's vocabulary and the source text is retained so future "my vocabulary" views can back-link to it. The confirmation overlay is explicit about this and points users at account deletion for full erasure.
- **Modal screens** hide the chrome (no tab bar, no sidebar) and fill the viewport. They are: subtitles / mid-watch, triage list, focus view, processing poller, new-session wizard, and the `More` sub-pages (Account, Languages). Top of a modal stack uses an **X** close in the top-left; in-stack pushes use a **chevron-back**. This mirrors React Navigation's `presentation: 'modal'` / `'fullScreenModal'` semantics.
- **More tab** consolidates user prefs and account pages: a sectioned list (General / Settings / About) with sub-pages for Account and Languages, plus inline `Switch` rows for tap-to-translate and LLM-suggested chunks.

### Cross-source dedup

- `user_lookup(user_id, target_language, headword, sense)` is the canonical "user has already studied this" table. The composite PK lets the same headword be studied in multiple distinct senses (polysemy on bare lemmas — `correr | race` and `correr | spread (news)` are two rows).
- Difficult-words pass receives the user's `(headword, sense)` list as exclusion context and is told **same headword + clearly distinct sense should still be included as a new entry**. The judgment is LLM-based; the only programmatic gate is the composite PK at write time, which lets `ON CONFLICT` increment `count` rather than create a duplicate.
- Designed so future content sources (books, articles) feed the same dedup table — a chunk learned from a movie won't resurface in a book.

## Settings (per user)

- Native language (single).
- CEFR level per `target_language`. Asked once when starting a session in a new target language.
- Tap-to-translate toggle (default off).
- LLM-suggested chunks toggle (default on). When off, the basic-data pass
  emits cards only for the user's manual highlights — no LLM chunk discovery.
  The Process button is disabled when this pref is off and the user has zero
  highlights.

## Data model

Generic source shape so non-movie content can plug in later without migration.

```
content_source
  id                  uuid pk
  type                'movie' | 'book' | 'article' | 'text'
  title               text
  language            text
  metadata            jsonb        -- tmdb_id, year, isbn, url, etc.
  created_by_user_id  uuid?        -- null for shared/OS-sourced rows
  created_at          timestamptz

text_track
  id                  uuid pk
  content_source_id   uuid -> content_source.id
  source              'opensubtitles' | 'upload' | 'paste' | 'url'
  language            text
  external_id         text?        -- e.g. opensubtitles file id
  hash                text         -- sha256 of normalized text, dedup helper
  created_at          timestamptz

text_segment
  id                  uuid pk      -- stable; foreign key target for highlights
  text_track_id       uuid -> text_track.id
  index               int          -- ordering within track
  text                text
  start_ms            int?         -- null for non-timed sources (books)
  end_ms              int?
  tsv                 tsvector     -- for full-text search

study_session
  id                  uuid pk
  user_id             uuid
  content_source_id   uuid -> content_source.id
  text_track_id       uuid -> text_track.id
  native_language     text         -- snapshotted from user pref
  target_language     text
  cefr_level          text         -- snapshotted from user pref
  context_blob        text?        -- source context, populated at processing
  status              'active' | 'processing' | 'processed' | 'exported' | 'failed'
  processing_warnings text[]       -- per-pass / per-highlight non-fatal failures
  created_at          timestamptz
  processed_at        timestamptz?
  deleted_at          timestamptz? -- soft-delete; "Remove" hides the session from
                                   -- the list. Cards / segments / content_source
                                   -- stay so kept vocabulary keeps its source
                                   -- back-link. Hard erasure happens via account
                                   -- deletion (auth.users CASCADE).

highlight
  id                  uuid pk
  study_session_id    uuid
  start_segment_id    uuid -> text_segment.id
  end_segment_id      uuid -> text_segment.id     -- equal to start for single-line
  start_offset        int           -- char offset within start segment
  end_offset          int           -- char offset within end segment
  selection_text      text          -- literal user selection
  note                text?
  preset_tags         text[]        -- 'explain', '3_examples', etc.
  fast_gloss          text?         -- cached from tap-to-translate
  created_at          timestamptz

card
  id                  uuid pk
  study_session_id    uuid
  highlight_id        uuid?         -- null for LLM-suggested chunks
  segment_id          uuid -> text_segment.id    -- where it appears in source
  headword            text          -- LLM-normalized, dictionary citation form
  sense               text          -- 1-5 word sense disambiguator
  surface_form        text
  -- basic data (populated by step-3 basic-data pass)
  translation         text?         -- null on L1 = L2 sessions
  definition          text?         -- target-lang paraphrase; back-of-card when L1 = L2
  target_example      text?
  native_example      text?         -- null on L1 = L2 sessions
  -- enrichment (populated only on demand by Generate full exploration)
  exploration_extras  jsonb         -- partial bag: ipa, frequency, register, register_alternatives,
                                    -- collocations, etymology, l1_notes, notes, more_frequent_synonym,
                                    -- regionalism, context_segment. Default '{}'.
  status              'pending' | 'kept' | 'rejected' | 'auto_rejected'
  created_at          timestamptz
  updated_at          timestamptz

card_chat_message
  id                  uuid pk
  card_id             uuid
  role                'user' | 'assistant'
  content             text
  created_at          timestamptz

user_lookup                          -- cross-source dedup
  user_id             uuid
  target_language     text
  headword            text
  sense               text          -- 1-5 word disambiguator; '' for legacy rows
  first_card_id       uuid?
  exported_at         timestamptz?
  count               int default 1
  primary key (user_id, target_language, headword, sense)

l1_interference_notes                -- shared across users
  l1_language         text
  target_language     text
  notes               text
  primary key (l1_language, target_language)

-- users (template table, extended with three Flicktionary prefs)
users
  id                       uuid pk
  ...
  native_language          text?
  tap_to_translate_enabled boolean default false
  llm_highlights_enabled   boolean default true
```

Notes:
- `highlight` uses `start_segment_id` + `end_segment_id` so multi-line selections work cleanly. Single-line is the case where they're equal.
- `card` is split from `highlight` because LLM-suggested chunks have no highlight, and because regenerating a card shouldn't churn the original highlight metadata.
- Foreign keys point to `text_segment.id` — the stable id, not `index`. We don't re-fetch SRTs in v1.
- Card content is fully captured by the basic columns + `exploration_extras`.
  There is no separate `front_override` / `back_override` — the front/back used
  at export are computed from the basic columns and edits go directly into
  those columns.

## LLM methodology prompt

Used as the system prompt for every heavy pass (context blob, L1 notes, difficult-words, full-exploration) and per-card chat. Runtime variables: `{native_language}`, `{target_language}`, `{cefr_level}`, `{source_context_blob}`, `{l1_interference_notes}`, plus a per-target-language instruction block (hardcoded in `language-instructions.ts`, e.g. Spanish-specific guidance for rioplatense / peninsular / Mexican variants and pronominal-verb headword rules). The block is injected right after the methodology preamble, inside the cacheable prefix; sessions in a target language with no entry fall through silently.

```
You are a linguistic co-pilot for a language learner. Methodology: lexical approach.

Core principles — apply to everything you do:

- Chunks over single words. Always present language in its natural environment.
  Not 'suggest' but 'suggest doing something' / 'suggest that someone do something'.
- Register and frequency awareness. Flag whether something is frequent in speech
  vs writing. A word can dominate written prose but sound alien in conversation.
- Functional load. Many unnatural learner productions are fixed by common verbs
  + preposition, not fancier vocabulary. Flag these patterns when relevant.
- Connotation and prosody. Synonyms can share a denotation but differ in emotional
  weight or rhythm. Always flag this.
- L1 interference. See the L1 interference notes below. Flag false friends,
  structural transfer, missing or extra grammatical features, register mismatches.
- Discourse markers and pragmatics. Words like 'well', 'I mean', 'the thing is'
  carry no lexical meaning but are essential for natural speech. Don't ignore them.
- Collocational range. Some words are promiscuous (big, great, nice), some are
  highly restricted. This affects teachability.
- Default to standard educated {target_language}. Flag regional or dialectal usage.

User profile:
- Native language: {native_language}
- Target language: {target_language}
- CEFR level: {cefr_level}
- The user is a serious self-directed learner. Be efficient and direct. No praise,
  no pedagogical fluff. Skimmable formatting.

L1 interference notes ({native_language} -> {target_language}):
{l1_interference_notes}

Source context for this session:
{source_context_blob}

When asked to explore a chunk, output the Full exploration template (defined by
the caller) and stop. For follow-up chat about an already-explored chunk, answer
directly and concisely. Never ask 'want me to explore X?' or suggest further
lookups. Never offer multiple follow-up options at the end. If a clarifying
question is needed, ask exactly one.
```

## Card output template

Cards have two tiers of data:

### Basic data (populated by step 3 — basic-data pass)

Promoted to typed columns on `cards`. Every card has these populated after
processing (except for `below_cefr=true` rows where the example/translation
fields are skipped to save tokens — those land as `auto_rejected` and the
user can override + click `Generate full exploration` to populate them).

- `headword` — LLM-normalized dictionary citation form
- `sense` — 1-5 word disambiguator (NOT a definition; used for cross-session dedup)
- `surface_form` — literal form as it appears in the segment
- `translation` — into native_language (null when L1 = L2)
- `definition` — contextual paraphrase in target_language (back-of-card when L1 = L2; optional otherwise)
- `target_example` — self-contained example sentence in target_language, inspired by but not equal to the source line
- `native_example` — natural translation of `target_example` into native_language (null when L1 = L2)

### Exploration extras (populated only by `Generate full exploration`)

Stored in `card.exploration_extras` as a partial JSONB bag. The renderer
iterates known keys; missing keys collapse silently.

```json
{
  "ipa": "string",
  "frequency": "high | medium | low",
  "more_frequent_synonym": "string | null",
  "regionalism": "string | null",
  "register": "informal | neutral | formal | literary | ...",
  "register_alternatives": {
    "more_formal": "string | null",
    "less_formal": "string | null"
  },
  "collocations": ["string", "string", "string"],
  "etymology": "brief origin or idiom story",
  "l1_notes": "false-friend / interference flags for this user's L1, or null",
  "notes": "anything else needed to master usage, or null",
  "context_segment": "string with the chunk wrapped in **double asterisks**"
}
```

The enrichment pass is also allowed to refine the basic columns when its
deeper analysis improves on the shallow basic-data pass.

### Default card front/back at export time

Computed from the basic columns. There are no overrides — the user edits the
basic columns directly via the focus view's per-field inputs (or via chat
through the `update_card_fields` tool), and those edits are what flow into
the CSV.

- `front` = `[headword, target_example]` joined by a blank line (skipping empty values)
- `back`  = `[translation || definition, native_example]` joined by a blank line (skipping empty values)

## Tap-to-translate (fast path)

Separate, fast LLM call. Not the methodology prompt — just a gloss.

```
Target: {target_language}
Native: {native_language}
Context line: {segment_text}
Selection: {selection_text}

Return a one-line gloss in {native_language} (or a one-line definition in
{target_language} if the languages match). Optionally a single POS tag and a
single register tag. No examples, no etymology, no formatting.
```

Result cached on `highlight.fast_gloss`. Re-tapping the same highlight shows the
cached result instantly.

## User flows

**Start a movie session**
1. Pick or search a movie (TMDB-backed metadata).
2. Pick a subtitle track: OpenSubtitles search filtered to target language, or upload `.srt`.
3. App verifies the chosen track's language matches target language; can't proceed otherwise.
4. If first session in this target language: prompt for CEFR level.
5. Session created, status `active`.

**Start a text session**
1. From the `+` overlay, pick `Practice with a text`.
2. Paste the source text (50–20,000 chars). Title field auto-fills with the first ~60 chars (truncated at a word boundary); user can override.
3. Pick the language of the text.
4. If first session in this target language: prompt for CEFR level.
5. Session created, status `active`. Same mid-session UI as movies, minus the timestamps.

**Mid-watch**
1. Open the session.
2. Search the track or scroll. Optionally tap-to-translate (sheet) for quick checks.
3. Select text in a line (or across lines) → highlight sheet → optional note/presets → save.

**Process**
1. User taps `Process` on the session.
2. Status flips to `processing`. Frontend redirects to a polling page.
3. Pipeline runs (context blob if missing, L1 notes if missing, difficult-words pass if no LLM-suggested cards yet, per-chunk Full exploration for highlights without cards).
4. Status flips to `processed`. On uncaught failure: `failed` (retryable from the polling page).

**Review and export**
1. Triage list — keep/reject across both sections. The modal-header chevron closes back to the sessions list; a `Subtitles` button in the right slot cross-jumps to the mid-watch view.
2. Drill into focus view for any card. Edit front/back, chat to refine.
3. Export CSV. Status flips to `exported`. `user_lookup` upserted.

**Add more highlights after processing**
1. From the triage list, tap the `Subtitles` button (or open the session card again).
2. The mid-watch UI is browsable on `processed` / `exported` sessions — `Triage` jumps back; `Highlight selection` still works.
3. Tap `Process new highlights`. Only the newly-added highlights run the full-exploration pass; the difficult-words pass does not re-run.

## Open questions / TBD

- Exact target count for difficult-words pass — start at 25, tune.
- Per-card chat token budget and prompt cache strategy depend on chosen model.
- Whether `user_lookup` is exclusion-only or also informs the difficulty model ("user has seen N B1 words → bar moves up").
- Auto-rejection threshold relative to CEFR (one level below? two?).

## v2 / out-of-scope ideas worth not forgetting

- Books and articles as additional `content_source.type`s (pasted text already shipped — books/articles need their own ingestion path but reuse the rest of the pipeline).
- Cross-source personal vocabulary corpus screen.
- `.apkg` Anki export with audio + images.
- Inline subtitle player with sync, for users who actually want it.
- User-customizable methodology prompt for advanced users (the gf use case). The MVP already has per-target-language instructions hardcoded in `language-instructions.ts` — v2 promotes them to a DB-backed, per-user editable field.
- Multi-deck organization (per language pair, or by tag).
- Spaced-repetition history pulled back from Anki to close the loop.
