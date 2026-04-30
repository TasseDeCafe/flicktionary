# Flicktionary — MVP spec

## What it is

A language-learning companion app. Pick a movie, fetch (or upload) its subtitles in a target language, watch the movie elsewhere, highlight chunks you don't understand inside the app, then process the session into structured, deep-dive cards informed by the lexical approach. Export the kept cards to CSV for Anki import.

The app's value is **not** flashcard generation per se — it's the structured exploration of each chunk in the context of the movie, the user's L1, and the user's level. Card export is a side-effect of having explored well.

## What it isn't (non-goals for MVP)

- Not a video player. The app does not host or sync to movie playback.
- Not a real-time companion. No auto-scroll, no audio fingerprinting, no clock sync.
- Not a flashcard review system (no SRS). Cards leave Flicktionary as CSV; review happens in Anki.
- Not a free-form chatbot. Per-card chat is scoped to refining understanding of one chunk.
- Not multi-source. MVP only handles movie subtitles. The data model is generic so books/articles can plug in later without migration.

## Core decisions

### Subtitle sources

- **OpenSubtitles search.** Search by title; results filtered to the user's target language. The track's `language` must match the chosen study language — never inferred.
- **Manual `.srt` upload.** First-class, not a fallback. User specifies the language at upload time.
- On import, SRTs are normalized into per-line `text_segment` records and indexed for full-text search. The raw SRT is not preserved as a single blob.
- All user content is RLS-scoped. Don't expose subtitle text publicly.

### During the movie

- No in-movie sync. The app is for triage and lookup, not playback.
- The "watch" screen is a search bar over the track plus a scrollable list of timestamped lines. That is the entire mid-movie UI.
- Selecting text in a line — single line or contiguous multi-line — creates a `highlight`. Default behaviour: silent. No inline translation, no inline gloss.
- Optional **tap-to-translate** setting (off by default). When on, a selection opens a sheet with a fast one-line gloss + POS + register tag. Result cached on the highlight; re-tapping is instant.
- Highlight sheet has: selection text, optional free-text note, preset chips (`Explain`, `3 examples`, `Synonyms`, `Etymology`, `Why this form?`). The note and tags are passed to the LLM at processing time.

### Processing pipeline

Triggered when the user taps "Process" at end of viewing. Re-runnable: tapping
Process again on a `processed` / `exported` / `failed` session is idempotent —
the orchestrator skips the difficult-words pass when LLM-suggested cards
already exist for the session, and skips per-highlight exploration for
highlights that already have a card. Only `processing` rejects (in-flight). Pipeline runs server-side, async.

1. **Movie context blob** — one call per `study_session`, persisted on the row.
   - Output ~300 tokens: genre, register, character list, plot sketch, tone, recurring vocabulary themes.
   - Acts as a cacheable prompt prefix for every subsequent call related to this session.
2. **L1-interference notes** — one call per `(L1, target_language)` pair, persisted globally and cached forever.
   - Output ~500 tokens: false friends, structural transfers, tense/aspect mismatches, register conventions.
   - Generated lazily on first session for that pair, then reused for all users.
3. **Difficult-words pass** — one call per session.
   - Input: full SRT (segment list), movie context blob, CEFR level, user's already-seen `(headword, sense)` pairs from `user_lookup` for this `target_language`.
   - Output: ~20–40 suggested chunks (target scales with CEFR — A1/A2=20, B1/B2=25, C1=35, C2=40), each with normalized `headword`, `sense` (1-5 word disambiguator), `surface_form`, and source `segment_id`.
   - **Hard CEFR floor**: only chunks at or above the user's level. The LLM is told to skip common B-level filler even when frequent in the source, and to **prioritize regional / dialectal / colloquial chunks** when the movie context blob signals that register (e.g. rioplatense voseo, peninsular slang, mexicanismos) over neutral pan-language equivalents.
   - Below-level chunks that slip through are flagged `below_cefr=true` and stored with status `auto_rejected`; user can override per chunk.
4. **Per-chunk Full exploration** — one call per chunk (user-highlighted + LLM-suggested), batched where the model allows.
   - Input: chunk + 10 surrounding segments + movie context blob + L1-interference notes + user's note + preset tags + methodology prompt.
   - Output: structured Full exploration (see template below).
   - The LLM **normalizes the chunk**: it produces a `headword` that may differ from `selection_text`. Example: user highlights `out` inside `ran out of milk` → `headword = "run out of"`.

### Review screen

Two-layer UI.

**Layer 1 — Triage list (default landing).**
- Two sections: "Your highlights" and "LLM-suggested chunks". Auto-rejected chunks collapsed under a `Show N filtered out` toggle.
- Each row: chunk surface form, the subtitle line as greyed context, a 1-line gloss, keep/reject toggle, tap target.
- Filter, search, sort across both sections.
- Sticky footer: `Export N kept cards`.
- No chat here. This layer is for fast triage.

**Layer 2 — Focus view (route push or full-screen drawer).**
- Top: editable card front/back.
- Middle: rendered Full exploration template (every section, no Short variant).
- Bottom: per-card chat thread, scoped to that chunk.
- Prev/next navigation through the kept set. Keyboard `j`/`k` and `←`/`→`.

Per-card chat seed prompt = methodology + `(L1, target, CEFR)` + movie context blob (cached) + chunk + 10 surrounding segments + the already-shown structured output. The user's question is the only dynamic turn.

### Export

- CSV with columns: `front`, `back`, `context`, `tags`, `headword`, `surface_form`, `note`. Imports cleanly into Anki.
- No `.apkg` for MVP.
- Exporting a card upserts a row in `user_lookup`.

### Cross-source dedup

- `user_lookup(user_id, target_language, headword, sense)` is the canonical "user has already studied this" table. The composite PK lets the same headword be studied in multiple distinct senses (polysemy on bare lemmas — `correr | race` and `correr | spread (news)` are two rows).
- Difficult-words pass receives the user's `(headword, sense)` list as exclusion context and is told **same headword + clearly distinct sense should still be included as a new entry**. The judgment is LLM-based; the only programmatic gate is the composite PK at write time, which lets `ON CONFLICT` increment `count` rather than create a duplicate.
- Designed so future content sources (books, articles) feed the same dedup table — a chunk learned from a movie won't resurface in a book.

## Settings (per user)

- Native language (single).
- CEFR level per `target_language`. Asked once when starting a session in a new target language.
- Tap-to-translate toggle (default off).

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
  context_blob        text?        -- movie context, populated at processing
  status              'active' | 'processing' | 'processed' | 'exported' | 'failed'
  processing_warnings text[]       -- per-pass / per-highlight non-fatal failures
  created_at          timestamptz
  processed_at        timestamptz?

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
  sense               text          -- 1-5 word sense disambiguator, '' for unprocessed cards
  surface_form        text
  full_exploration    jsonb         -- the structured output (see template)
  status              'pending' | 'kept' | 'rejected' | 'auto_rejected'
  front_override      text?         -- user-edited card front, null if untouched
  back_override       text?
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
```

Notes:
- `highlight` uses `start_segment_id` + `end_segment_id` so multi-line selections work cleanly. Single-line is the case where they're equal.
- `card` is split from `highlight` because LLM-suggested chunks have no highlight, and because regenerating a card shouldn't churn the original highlight metadata.
- Foreign keys point to `text_segment.id` — the stable id, not `index`. We don't re-fetch SRTs in v1.

## LLM methodology prompt

Used as the system prompt for every heavy pass (context blob, L1 notes, difficult-words, full-exploration) and per-card chat. Runtime variables: `{native_language}`, `{target_language}`, `{cefr_level}`, `{movie_context_blob}`, `{l1_interference_notes}`, plus a per-target-language instruction block (hardcoded in `language-instructions.ts`, e.g. Spanish-specific guidance for rioplatense / peninsular / Mexican variants and pronominal-verb headword rules). The block is injected right after the methodology preamble, inside the cacheable prefix; sessions in a target language with no entry fall through silently.

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

Source context (subtitles for this session):
{movie_context_blob}

When asked to explore a chunk, output the Full exploration template (defined by
the caller) and stop. For follow-up chat about an already-explored chunk, answer
directly and concisely. Never ask 'want me to explore X?' or suggest further
lookups. Never offer multiple follow-up options at the end. If a clarifying
question is needed, ask exactly one.
```

## Full exploration output template

Stored in `card.full_exploration` as JSON. The focus view renders each field as a labeled section.

```json
{
  "headword": "string",
  "surface_form": "string",
  "sense": "1-5 word disambiguator (NOT a definition); used for cross-session dedup",
  "context_segment": "string with the chunk **bolded**",
  "definition": "contextual, not dictionary-generic",
  "examples": ["string", "string", "string"],
  "context_example": {
    "target": "self-contained example sentence in target_language, inspired by but not equal to the source line",
    "native": "natural translation of context_example.target into native_language"
  },
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
  "translation": "into native_language"
}
```

Default card front/back at export time:
- `front` = `headword` (dictionary form; falls through to `surface_form` when missing)
- `back` = `translation` + blank line + `context_example.target` + blank line + `context_example.native`. Cards processed before `context_example` existed fall back to `examples[0]` for the target sentence.
- `front_override` / `back_override` on `card` win when present.

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

**Start a session**
1. Pick or search a movie (TMDB-backed metadata).
2. Pick a subtitle track: OpenSubtitles search filtered to target language, or upload `.srt`.
3. App verifies the chosen track's language matches target language; can't proceed otherwise.
4. If first session in this target language: prompt for CEFR level.
5. Session created, status `active`.

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
1. Triage list — keep/reject across both sections. Header has a `← Subtitles` link back to the mid-watch view.
2. Drill into focus view for any card. Edit front/back, chat to refine.
3. Export CSV. Status flips to `exported`. `user_lookup` upserted.

**Add more highlights after processing**
1. From the triage list, tap `← Subtitles` (or open the session card again).
2. The mid-watch UI is browsable on `processed` / `exported` sessions — `View triage` jumps back; `Highlight selection` still works.
3. Tap `Process new highlights`. Only the newly-added highlights run the full-exploration pass; the difficult-words pass does not re-run.

## Open questions / TBD

- Exact target count for difficult-words pass — start at 25, tune.
- Per-card chat token budget and prompt cache strategy depend on chosen model.
- Whether `user_lookup` is exclusion-only or also informs the difficulty model ("user has seen N B1 words → bar moves up").
- Auto-rejection threshold relative to CEFR (one level below? two?).

## v2 / out-of-scope ideas worth not forgetting

- Books, articles, pasted text as additional `content_source.type`.
- Cross-source personal vocabulary corpus screen.
- `.apkg` Anki export with audio + images.
- Inline subtitle player with sync, for users who actually want it.
- User-customizable methodology prompt for advanced users (the gf use case). The MVP already has per-target-language instructions hardcoded in `language-instructions.ts` — v2 promotes them to a DB-backed, per-user editable field.
- Multi-deck organization (per language pair, or by tag).
- Spaced-repetition history pulled back from Anki to close the loop.
