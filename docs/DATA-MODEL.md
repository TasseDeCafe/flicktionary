# Data model

> **Status: authoritative-spec.** The core schema — content sources → segments →
> sessions → highlights → cards → lookups, the background-job tables, and the practice
> tables — plus the card content tiers (basic data, `grammar` bag, `exploration_extras`,
> export front/back). Split out of `SPEC.md`. SRS/facet scheduling columns are specified
> in `docs/SRS.md` §1.

## Schema

Generic source shape so non-movie content can plug in later without migration.

```
content_source
  id                  uuid pk
  type                'movie' | 'tv' | 'youtube' | 'book' | 'article' | 'text' | 'adhoc' | 'lesson'
                                   -- 'tv' rows are one content_source per
                                   -- episode (metadata: tmdbShowId, showTitle,
                                   -- seasonNumber, episodeNumber, episodeTitle,
                                   -- year, posterUrl); deduped globally on
                                   -- (tmdbShowId, seasonNumber, episodeNumber)
                                   -- via a partial unique index, like movies.
                                   -- 'youtube' rows are created by the browser
                                   -- extension; deduped per user on
                                   -- metadata->>'youtubeVideoId'.
                                   -- 'lesson' rows are one per confirmed
                                   -- lesson-notes import batch (title = the
                                   -- upload's title) — unlike 'adhoc' they are
                                   -- NOT deduped per (user, language).
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
  context_blob        text?        -- source context, populated by the first background job
                                   -- (no session-level status/processed_at: terms are
                                   -- enriched immediately on selection, so there is no
                                   -- processing lifecycle to track. Live job state lives
                                   -- in processing_jobs.)
  processing_warnings text[]       -- per-pass / per-highlight non-fatal failures
  furthest_read_segment_index int? -- resume-reading position: deepest segment index the
                                   -- reader has reached (track-relative, monotonic).
                                   -- NULL until they scroll a normal session view.
  reviewed_until_segment_index int? -- checkpoint-review pointer: deepest segment index
                                   -- the user explicitly collected reviews up to
                                   -- (docs/SRS.md §6b). Monotonic; NULL until the first
                                   -- press; checkpoint undo is the only exact
                                   -- (non-monotonic) restore.
  created_at          timestamptz
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
  highlight_id        uuid?         -- normally set; null only for legacy/direct non-highlight cards
  segment_id          uuid -> text_segment.id    -- where it appears in source
  headword            text          -- LLM-normalized, dictionary citation form
  sense               text          -- 1-5 word sense disambiguator
  surface_form        text
  -- basic data (populated by step-3 basic-data pass)
  translation         text?         -- null when real L1 = target language, or when
                                    -- show_translations_enabled is off for this
                                    -- target language
  definition          text?         -- target-lang paraphrase; back-of-card when
                                    -- L1 = L2 or show-translations is off
  target_example      text?
  native_example      text?         -- null when real L1 = target language, or when
                                    -- show_translations_enabled is off for this
                                    -- target language
  -- enrichment (populated only on demand by Generate full exploration)
  exploration_extras  jsonb         -- partial bag: ipa, frequency, frequency_detail, register,
                                    -- register_alternatives, collocations, etymology, l1_notes, notes,
                                    -- more_frequent_synonym, more_examples, regionalism,
                                    -- context_segment. Default '{}'.
  grammar             jsonb         -- typed sparse bag of language-agnostic morphology / grammar
                                    -- facts: pos, gender (m/f/n/c), aspect (impf/perf/biaspectual),
                                    -- aspect_pair_headword, government (e.g. "от + gen"), number_only
                                    -- (plurale_tantum/singulare_tantum), is_indeclinable, is_reflexive,
                                    -- animacy, display_form (e.g. stress-marked Russian "ви́деть"),
                                    -- notable_forms (irregular paradigm cells), ipa
                                    -- ({ga?, rp?, untagged?}). Default '{}'.
                                    -- Populated by basic-data pass; refinable by enrichment pass.
                                    -- Per-language instructions block dictates which keys to fill.
                                    -- Wiktionary grounding for enabled languages overrides high-confidence
                                    -- structured fields and IPA via kaikki data after the basic-data pass.
  grounded_at         timestamptz?  -- stamped when wiktionary grounding merged kaikki data into
                                    -- `grammar`. Null = pure LLM (no dump for this language, or
                                    -- nothing matched). Historical provenance: does not get cleared
                                    -- by user edits.
  grounding_patch     jsonb?        -- the exact kaikki patch merged at grounding time. Per-field
                                    -- provenance compares grammar values against it (equal =
                                    -- Wiktionary-verified, diverged = edited). Null = never grounded
                                    -- or grounded before the column existed; such legacy rows claim
                                    -- nothing and re-ground once (backfill) when next touched.
  grammar_user_edited_at timestamptz?
                                    -- stamped when the user manually edits grammar-provenance-
                                    -- sensitive data (grammar fields, headword, or sense). Guards
                                    -- reprocessing: automatic grammar patches and re-grounding skip
                                    -- edited rows. (The UI no longer reads it — per-field provenance
                                    -- is value-comparison against grounding_patch.) Automatic
                                    -- processing, grounding, enrichment, and chat tool patches do
                                    -- not stamp this.
  status              'needs_data' | 'kept' | 'removed'
                                    -- auto-transitions 'needs_data' -> 'kept' the
                                    -- moment the card gains basic data (after
                                    -- applyStudyIntent, so intent facets exist
                                    -- before the keep-time recognition default).
                                    -- 'needs_data' is therefore transient (a card
                                    -- between materialization and its first
                                    -- basic-data write) or a note-only stub with
                                    -- no data yet. 'removed' = unkept via
                                    -- Remove-from-session; auto-keep never
                                    -- resurrects a 'removed' row. (NOT a
                                    -- soft-delete of the term — chunks.deleteChunk
                                    -- is that, via user_lookups.deleted_at.)
  created_at          timestamptz
  updated_at          timestamptz

card_chat_message
  id                  uuid pk
  card_id             uuid
  role                'user' | 'assistant'
  content             text
  created_at          timestamptz

card_chat_read_state                 -- per-card chat read marker (server-side, cross-device)
  card_id             uuid pk -> card.id (ON DELETE CASCADE)
  last_read_at        timestamptz  -- bumped to NOW() when the chat panel opens or
                                   -- observes a fresh assistant turn. cards.* read paths
                                   -- derive hasUnreadChat = newest card_chat_message
                                   -- with role='assistant' has created_at > last_read_at.
                                   -- card_id alone is the PK (a card has exactly one owner).

processing_jobs                      -- durable background-job queue (enrichment + ghost nomination + lesson extraction)
  id                  uuid pk
  kind                'enrich_highlight' | 'nominate_window' | 'seed_card_chat' | 'extract_lesson'
                                   -- legacy enum may still include discover_session; worker treats it as no-op
  study_session_id    uuid? -> study_session.id  (ON DELETE CASCADE; required for
                                    -- every kind EXCEPT extract_lesson — the
                                    -- lesson session is created at confirm,
                                    -- not upload, so extract jobs carry only
                                    -- an import_batch_id)
  import_batch_id     uuid? -> import_batches.id (ON DELETE CASCADE; required for
                                    -- extract_lesson, null otherwise; a partial
                                    -- unique index keeps one LIVE extract job
                                    -- per batch)
  highlight_id        uuid? -> highlight.id      (ON DELETE CASCADE; required for
                                    -- enrich_highlight/seed_card_chat, null otherwise)
  window_start_index  int?          -- required for nominate_window
  window_end_index    int?          -- required for nominate_window
  user_id             uuid
  status              'pending' | 'processing' | 'done' | 'failed'
  attempts            int          -- bumped at claim; gates retry vs fail
  last_error          text?
  run_after           timestamptz  -- debounce (enqueue) + exponential backoff (retry)
  locked_at           timestamptz? -- lease: stamped on claim, reclaimed when stale
  locked_by           text?        -- claiming worker id
  created_at          timestamptz
  updated_at          timestamptz
  -- Partial unique indexes over LIVE (pending/processing) rows make enqueue
  -- idempotent: one in-flight enrich job per highlight. Nominate-window
  -- idempotency lives in nominated_windows and is inserted atomically with the job.

nominated_windows                   -- coverage set for reading-window ghost nomination
  id                  uuid pk
  study_session_id    uuid -> study_session.id  (ON DELETE CASCADE)
  start_index         int          -- track-relative segment index, inclusive
  end_index           int          -- track-relative segment index, inclusive
  status              'pending' | 'done' | 'failed'
  created_at          timestamptz
  updated_at          timestamptz
  -- unique (study_session_id, start_index, end_index)

ghost_candidates                    -- passive LLM-nominated spans in the reader
  id                  uuid pk
  study_session_id    uuid -> study_session.id  (ON DELETE CASCADE)
  segment_id          uuid -> text_segment.id
  char_start          int          -- raw segment text offset, same coordinate space as highlights
  char_end            int
  surface_form        text
  dismissed_at        timestamptz? -- set when adopted into a real highlight
  created_at          timestamptz

user_lookup                          -- cross-source dedup + canonical user vocabulary record + SRS state
  user_id             uuid
  target_language     text
  headword            text
  sense               text          -- 1-5 word disambiguator; '' for legacy rows
  first_card_id       uuid?         -- representative card for content lookup (Practice generation prompt)
  exported_at         timestamptz?  -- last CSV export (legacy; the vocab-wide
                                    -- export does not stamp this)
  count               int default 0 -- transition-driven: how many cards across
                                    -- all sessions currently have status='kept'
                                    -- pointing at this lookup. count > 0 is the
                                    -- visibility gate for both Vocabulary and
                                    -- Practice (alongside deleted_at IS NULL).
                                    -- needs_data/removed → kept
                                    -- bumps +1 (and clears deleted_at);
                                    -- kept → anything-else decrements -1
                                    -- (floored at 0). SRS state is preserved
                                    -- across un-keep so re-keeping resumes the
                                    -- schedule.
  -- SRS/FSRS scheduling, leech-rehab, and first-introduction state do NOT
  -- live on user_lookups. They live in public.study_facets — one row per
  -- (user_lookup_id, skill, target_form), each owning its own srs_* columns,
  -- leech_* columns, and introduced_at (the daily-new stamp). There is no
  -- per-term learning_mode column: "in production" is an enabled
  -- (disabled_at IS NULL) (meaning_production,'') facet, surfaced on the
  -- wire as a DERIVED `learningMode` for read-only display.
  -- See docs/SRS.md §1 for the study_facets schema + the full data model.
  zipf_estimate       numeric(3,1)? -- LLM-estimated continuous Zipf frequency of the
                                    -- headword (0-8, one decimal; ~7 = "the", ~2 =
                                    -- rare). Emitted by the basic-data pass. NULL =
                                    -- not yet estimated (sorts last). Orders tier 3
                                    -- of the new-term queue (docs/SRS.md §4).
  last_encountered_at timestamptz   -- refreshed by recordEncounter() at user-intent
                                    -- boundaries only (highlight-save enrichment,
                                    -- lesson-import confirm). Drives the tier-2
                                    -- freshness window and the 90-day new-term decay.
  encounter_count     int default 1 -- bumped by the same boundaries, 1-hour collapse
                                    -- window (retries can't inflate it). >= 2 = tier-1
                                    -- "revealed demand" in the new-term queue.
                                    -- NEVER bumped by checkpoint passes.
  content_encounter_count int default 0 -- checkpoint-review aggregate: how many collected
                                    -- spans this term appeared in (recordContentEncounter;
                                    -- also refreshes last_encountered_at). No
                                    -- per-occurrence log; not reverted on checkpoint undo.
  last_content_encounter_at timestamptz?
  created_at          timestamptz   -- powers Vocabulary "Recently added" sort
  deleted_at          timestamptz?  -- soft-delete from Vocabulary tab; also hides from Practice queue
  primary key (id)
  unique (user_id, target_language, headword, sense)

practice_text                        -- one LLM-generated reading passage. Reading is
                                     -- SESSIONLESS: texts are keyed directly by
                                     -- (user_id, target_language, pool, ord) — there is
                                     -- no practice_sessions table. A partial unique
                                     -- index allows at most one status='reading' text
                                     -- per (user, language, pool); "resume reading"
                                     -- resolves to that row.
  id                  uuid pk
  user_id             uuid -> auth.users (ON DELETE CASCADE)
  target_language     text
  pool                'recognition' | 'production' default 'recognition'
                                    -- which facet family the finalizer's ratings
                                    -- advance (production reading = the old
                                    -- active drill).
  scope               'review_due' | 'learn_new' | 'mixed' | null
                                    -- the live candidate filter this text was
                                    -- built under; a resumed/pre-gen slot whose
                                    -- scope differs from the one being entered
                                    -- is discarded rather than surfaced.
  ord                 int           -- slot order within (user, language, pool)
  status              'pending' | 'generating' | 'ready' | 'reading' | 'done' | 'failed'
  body                text?
  annotations         jsonb         -- [{ headword, sense, surface_form, char_start,
                                    --    char_end, user_lookup_id }]
                                    -- char_start/end computed server-side from surface_form (LLMs
                                    -- are unreliable at counting characters; the tool only emits
                                    -- surface_form and the server locates each occurrence).
                                    -- user_lookup_id is stamped at generation time so the
                                    -- finalizer and serve-time content resolution survive a
                                    -- mid-text rename of the (headword, sense) key; readers
                                    -- fall back to the key for texts stored before ids existed.
  skipped_chunks      jsonb         -- chunks the LLM declined to embed
                                    -- ({ headword, sense, reason }); feeds the
                                    -- stubborn-chunk rescue/exclusion logic
  generation_token    uuid?         -- fencing token minted at claim; markReady /
                                    -- markFailed verify it so raced or stale
                                    -- writers silently no-op
  generation_warning  text?         -- e.g. dropped annotations summary
  created_at          timestamptz
  ready_at            timestamptz?
  read_at             timestamptz?

practice_rating_events               -- append-only audit log of EVERY rating event:
                                     -- flashcard ratings, explicit reading ratings,
                                     -- and the implicit-good applied on Next-text
                                     -- advance. Written in the same transaction as
                                     -- the FSRS write; it is the undo handle and the
                                     -- daily review-budget source (budget queries
                                     -- filter live events, so an undo auto-refunds).
  id                  uuid pk
  user_id             uuid
  user_lookup_id      uuid -> user_lookup (ON DELETE CASCADE)
  target_language     text
  pool                'recognition' | 'production'
  skill               'meaning_recognition' | 'meaning_production' | 'pronunciation'
  target_form         text          -- '' = citation; (skill, target_form) is the
                                    -- rated facet's identity
  rating              'again' | 'hard' | 'good' | 'easy'
  was_explicit        bool          -- false = implicit-good applied on Next-text advance
  was_introduction    bool          -- this rating introduced the facet (it consumed
                                    -- the daily-new budget, not the review budget)
  caused_parking      bool          -- this rating crossed the leech threshold and
                                    -- parked the facet
  practice_text_id    uuid? -> practice_text.id (ON DELETE SET NULL)
                                    -- reading-mode context; null for flashcard ratings
  import_batch_id     uuid? -> import_batches.id (ON DELETE SET NULL)
                                    -- lesson-import provenance: set only on the
                                    -- implicit 'again' lapses a confirmed import
                                    -- applies. Budget queries add
                                    -- import_batch_id IS NULL, so an import never
                                    -- eats the day's review allowance
  study_session_id    uuid? -> study_session.id (ON DELETE SET NULL)
                                    -- checkpoint-review provenance: the session whose
                                    -- span was collected (docs/SRS.md §6b).
                                    -- import_batch_id stays NULL on checkpoint credits,
                                    -- so they DO consume the daily review budget.
  checkpoint_id       uuid? -> study_session_checkpoints.id (ON DELETE SET NULL)
                                    -- the press that batch-applied this event; the
                                    -- batch-undo handle (partial index WHERE NOT NULL)
  headword            text
  sense               text
  prev_srs_state      srs_state?    -- pre-rating snapshot of the rated facet
  prev_srs_due        timestamptz?  -- (state/due/stability/difficulty/last_review/
  prev_srs_stability  real?         -- reps/lapses/learning_steps); restored by
  prev_srs_difficulty real?         -- practice.undoRating. All NULL for an
  prev_srs_last_review timestamptz? -- introduction.
  prev_srs_reps       int?
  prev_srs_lapses     int?
  prev_srs_learning_steps int?
  reverted_at         timestamptz?  -- undo tombstone: reverted events stay
                                    -- (append-only) but leave every budget count
  rated_at            timestamptz

study_session_checkpoints            -- one row per checkpoint press ("I've followed up
                                     -- to here", docs/SRS.md §6b). The batch-undo
                                     -- handle (rating events reference it via
                                     -- checkpoint_id) and the server-authoritative
                                     -- backlog claim set for the known-assertion sheet.
  id                  uuid pk
  user_id             uuid
  study_session_id    uuid -> study_session.id (ON DELETE CASCADE)
  from_segment_index  int?          -- the reviewed-until pointer BEFORE this press;
                                    -- NULL = pointer was NULL (undo restores NULL)
  to_segment_index    int           -- clamped to the track's real max index
  credited_count      int
  backlog_candidate_ids uuid[]      -- user_lookup ids offered as backlog known-assertion
                                    -- candidates; assert-known verifies membership here
  created_at          timestamptz
  reverted_at         timestamptz?  -- checkpoint undo tombstone

teacher_profiles                     -- lesson-import: stored per-teacher format
                                     -- descriptions (user-editable prose injected
                                     -- into the extraction prompt as DESCRIPTIVE
                                     -- context only — never prescriptive rules)
  id                  uuid pk
  user_id             uuid -> auth.users (ON DELETE CASCADE)
  name                text          -- user-facing identity; unique (user_id, name)
  language            text
  profile_text        text
  created_at          timestamptz
  updated_at          timestamptz

import_batches                       -- lesson-import extraction drafts. Idempotent
                                     -- by (user_id, target_language, input_hash)
                                     -- over non-failed rows (partial unique index):
                                     -- re-uploading the same text resumes the draft
                                     -- or routes to the confirmed batch's session.
                                     -- Drafts expire (worker sweep); confirmed
                                     -- batches stay (rating-event provenance).
  id                  uuid pk
  user_id             uuid -> auth.users (ON DELETE CASCADE)
  target_language     text
  teacher_profile_id  uuid? -> teacher_profiles.id (ON DELETE SET NULL)
  source_title        text
  raw_text            text          -- the client-normalized markdown, verbatim
  input_hash          text          -- sha256 of raw_text; the batch identity
  status              'extracting' | 'ready' | 'failed' | 'confirmed'
  format_profile      text?         -- the extractor's inferred conventions; the
                                    -- user can save it as a teacher profile
  study_session_id    uuid? -> study_session.id (ON DELETE SET NULL; set at confirm)
  error               text?
  expires_at          timestamptz
  created_at          timestamptz

import_batch_rows                    -- one extracted candidate per row, verbatim
  id                  uuid pk
  batch_id            uuid -> import_batches.id (ON DELETE CASCADE)
  row_index           int           -- unique (batch_id, row_index)
  payload             jsonb         -- the extractor row verbatim (sourceText, type,
                                    -- headword, targetForm, context, wrongForm,
                                    -- stressMark, proposedFacets, confidence)
  lesson_date         date?
  duplicate_user_lookup_id uuid? -> user_lookup (ON DELETE SET NULL)
  duplicate_facets    jsonb?        -- resolution snapshot (production state,
                                    -- enabled skills) for the confirm screen
  planned_action      'create' | 'add_facet' | 'lapse_and_add_facet' | 'skip'
  confirmed           bool?         -- null until confirmBatch records the decision
  created_card_id     uuid? -> card.id (ON DELETE SET NULL; unused in v1 — cards
                                    -- materialize async in the enrich job)
  created_at          timestamptz

practice_exercise                    -- durable pre-generated exercise bank for the
                                     -- Strengthen surface (leech rehab gates +
                                     -- post-session bonus). Fencing lifecycle
                                     -- mirrors practice_text.
  id                  uuid pk
  user_id             uuid -> auth.users (ON DELETE CASCADE)
  user_lookup_id      uuid -> user_lookup (ON DELETE CASCADE)
  target_language     text
  pool                'recognition' | 'production'
  exercise_type       'mc_cloze' | 'mc_comprehension' | 'production_cloze' | 'use_in_sentence'
  status              'pending' | 'generating' | 'ready' | 'used' | 'failed'
  generation_token    uuid?         -- fencing token minted at claim; markReady /
                                    -- markFailed verify it so crashed/raced
                                    -- workers' late writes are fenced out
  payload             jsonb         -- per-type shape; answer fields (answer /
                                    -- answerIndex / acceptedForms) are stripped
                                    -- server-side before serving
  gate_eligible       bool          -- deterministic grading only (MC + production
                                    -- cloze). LLM-graded use_in_sentence is false:
                                    -- bonus-only, never gates a graduation
  seen_at             timestamptz?
  used_at             timestamptz?  -- consume-on-answer: stamped when an answer is
                                    -- SUBMITTED, never when served. Refresh/abandon
                                    -- re-serves the same row; skip consumes nothing
  generation_warning  text?
  created_at          timestamptz
  ready_at            timestamptz?

-- users (template table, extended with global Flicktionary prefs)
users
  id                       uuid pk
  ...
  native_language          text?
  tap_to_translate_enabled boolean default false
  llm_highlights_enabled   boolean default true
  telegram_chat_id         bigint? unique  -- Telegram-bot pairing; one chat per account
  account_flags            text[] default '{}'  -- write-once account facts (checklist
                                    -- dismissed/completed, hint dismissals,
                                    -- extension_installed); allowed values live in the
                                    -- contract's AccountFlagSchema, not a DB constraint

user_target_language_pref
  user_id                   uuid
  target_language           text
  cefr_level                text
  show_translations_enabled boolean default true
```

Notes:

- `highlight` uses `start_segment_id` + `end_segment_id` so multi-line selections work cleanly. Single-line is the case where they're equal.
- `card` is split from `highlight` because LLM-suggested chunks have no highlight, and because regenerating a card shouldn't churn the original highlight metadata.
- Foreign keys point to `text_segment.id` — the stable id, not `index`. We don't re-fetch SRTs in v1.
- Card content is fully captured by the basic columns + `exploration_extras`.
  There is no separate `front_override` / `back_override` — the front/back used
  at export are computed from the basic columns and edits go directly into
  those columns.

### Wiktionary reference tables & checkpoint matching

Reference data loaded from kaikki.org dumps by `apps/backend/scripts/load-kaikki.ts`
(TRUNCATE + reload per run; backend reads only, RLS enabled with no policies):

```
wiktionary_entries
  id                  bigserial pk
  target_language     text         -- kaikki lang_code; loaded languages = KAIKKI_LANGUAGES
  headword            text
  pos                 text
  data                jsonb        -- the verbatim kaikki record

wiktionary_forms                   -- flattened paradigm cells (stress-stripped,
  target_language     text         -- case-preserved), many-to-many form → entry
  form                text
  entry_id            bigint -> wiktionary_entries.id

wiktionary_form_redirects          -- precomputed stub resolution (form-of /
  target_language     text         -- alt-of chains followed ≤2 hops); rows exist
  folded_form         text         -- only when the chain ends on a real lemma.
  lemma               text         -- Rebuilt by build-wiktionary-redirects.ts,
                                   -- invoked at the end of every load-kaikki run.
```

Checkpoint-review matching folds BOTH sides of every comparison through
`public.checkpoint_fold(input, lang)` (strip U+0301 → NFC → trim → lower, then
ru `ё→е`, de `ß→ss`). Expression indexes
`(target_language, checkpoint_fold(form|headword, target_language))` on
`wiktionary_forms` / `wiktionary_entries` make folded point lookups indexed;
query-side tokens fold through the byte-pinned TS twin
`packages/core/src/utils/checkpoint-fold.ts` (parity enforced by an
integration test). A "real lemma" for matching purposes has
`data ? 'head_templates'` and is neither a form-of nor an alt-of stub.

## Card output template

Cards have two tiers of data:

### Basic data (populated by step 3 — basic-data pass)

Promoted to typed columns on `cards`. Every card has these populated after
processing — user highlights bypass the CEFR floor (the basic-data pass forces
`below_cefr=false` for them), so they always get full basic data and a card that
auto-keeps. (`below_cefr` is still parsed for telemetry but never maps to a card
status.)

- `headword` — LLM-normalized dictionary citation form
- `sense` — 1-5 word disambiguator (NOT a definition; used for cross-session dedup)
- `surface_form` — literal form as it appears in the segment
- `translation` — into native_language (null when real L1 = target language or the per-target Show-translations pref is off)
- `definition` — contextual paraphrase in target_language (back-of-card when translation fields are hidden; optional otherwise)
- `target_example` — self-contained example sentence in target_language, inspired by but not equal to the source line
- `native_example` — natural translation of `target_example` into native_language (null when real L1 = target language or the per-target Show-translations pref is off)

### Grammar (populated by basic-data pass; refinable by enrichment)

Stored in `card.grammar` as a typed sparse JSONB bag. Keys are
language-agnostic; the per-target-language instructions block decides which
keys are filled when. Every key is optional. The renderer treats `null` and
absent identically (LLMs and JSONB-merge writes both occasionally leave
explicit nulls behind, so consumers must be defensive).

```json
{
  "pos": "noun | verb | adjective | adverb | preposition | pronoun | particle | conjunction | numeral | phrase | idiom | other",
  "display_form": "string",
  "gender": "m | f | n | c",
  "number_only": "plurale_tantum | singulare_tantum",
  "is_indeclinable": true,
  "animacy": "animate | inanimate",
  "aspect": "impf | perf | biaspectual",
  "aspect_pair_headword": "string",
  "is_reflexive": true,
  "government": "string (e.g. '+ acc', 'от + gen', '+ on (gerund)')",
  "ipa": { "ga": "string | null", "rp": "string | null", "untagged": "string | null" },
  "notable_forms": [{ "label": "string", "form": "string" }],
  "notes": "string"
}
```

`ipa` is generated by default: the basic-data pass fills it
for every chunk (English → the user's `english_ipa_dialect` bucket, others →
`untagged`; dictionary delimiters kept in the string, omit-when-unconfident),
and Wiktionary grounding overwrites it where kaikki has data. The flashcard
renders a blue verified badge when the IPA is dictionary-grounded
(`ReviewTerm.ipaSource = 'wiktionary'`, computed server-side as grounded +
`grammar.ipa` still matching `grounding_patch.ipa`); LLM IPA carries the amber
"unverified" marker in the focus view via the existing per-field provenance.

### Exploration extras (populated only by `Generate full exploration`)

Stored in `card.exploration_extras` as a partial JSONB bag. The renderer
iterates known keys; missing keys collapse silently.

```json
{
  "ipa": "string (legacy only — no longer in the schema; new explorations write grammar.ipa instead, old rows keep it)",
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
- `back` = `[translation || definition, native_example]` joined by a blank line (skipping empty values)

In the CSV the blank line is rendered as `<br><br>` (the export imports with
`#html:true`).

