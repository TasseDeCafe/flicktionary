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
  type                'movie' | 'tv' | 'youtube' | 'book' | 'article' | 'text' | 'adhoc' | 'lesson' | 'chat'
                                   -- 'tv' rows are one content_source per
                                   -- episode (metadata: tmdbShowId, showTitle,
                                   -- seasonNumber, episodeNumber, episodeTitle,
                                   -- year, posterUrl, backdropUrl, stillUrl);
                                   -- deduped globally on
                                   -- (tmdbShowId, seasonNumber, episodeNumber)
                                   -- via a partial unique index, like movies.
                                   -- 'youtube' rows are created by the browser
                                   -- extension; deduped per user on
                                   -- metadata->>'youtubeVideoId'.
                                   -- 'lesson' rows are one per confirmed
                                   -- lesson-notes import batch (title = the
                                   -- upload's title) — unlike 'adhoc' they are
                                   -- NOT deduped per (user, language).
                                   -- 'chat' rows are one per vocabulary-chat
                                   -- thread (title = generated topic, first
                                   -- message until then); one track whose
                                   -- segments are the added terms' example
                                   -- sentences. adhoc/lesson/chat are the
                                   -- synthetic types (isSyntheticSourceType).
                                   -- 'book' rows are one per uploaded book
                                   -- (metadata: author, fileName, contentHash,
                                   -- partCount, importStatus 'uploading'|'ready',
                                   -- uploadId of the live upload attempt);
                                   -- deduped per user on metadata->>'contentHash'
                                   -- via a partial unique index. One text_track
                                   -- per part.
  title               text
  language            text
  metadata            jsonb        -- tmdbId, year, isbn, url, etc. TMDB image
                                   -- URLs are snapshotted here at creation:
                                   -- posterUrl (w342), backdropUrl (w780, the
                                   -- 16:9 card media), and per-episode
                                   -- stillUrl (tv only). Pre-existing rows are
                                   -- filled by scripts/backfill-tmdb-backdrops.ts.
  created_by_user_id  uuid?        -- null for shared/OS-sourced rows
  created_at          timestamptz

text_track
  id                  uuid pk
  content_source_id   uuid -> content_source.id
  source              'opensubtitles' | 'upload' | 'paste' | 'url'
  language            text
  external_id         text?        -- e.g. opensubtitles file id
  hash                text         -- sha256 of normalized text, dedup helper
                                   -- (book parts hash partIndex + text, so two
                                   -- identical parts never collide)
  book_part_index     int?         -- book parts only: 0-based reading order,
                                   -- unique per content_source
  book_part_title     text?        -- book parts only: chapter (· n/m) title
  profile_built_at    timestamptz? -- lemma-profile bookkeeping (see
  profile_segment_count int?       -- "Per-track lemma profiles" below):
  profile_max_segment_index int?   -- built_at doubles as "profile exists";
  profile_word_token_count int?    -- segment count + max index are the
  profile_matched_token_count int? -- staleness check
  profile_version     int?         -- builder logic version (TRACK_LEMMA_PROFILE_VERSION);
                                   -- older/NULL = served as-is while a background
                                   -- rebuild catches it up
  moderation_status   'clean' | 'flagged' | 'blocked' | null -- moderation verdict
                                   -- (null = pre-feature / unchecked / failed-open;
                                   -- gated ingest surfaces reject hard-blocked
                                   -- content before insert — 'blocked' exists only
                                   -- for tracks moderated AFTER ingest at share
                                   -- time (YouTube): never publishable, private
                                   -- study unaffected)
  moderation_category text?        -- set iff status='flagged'/'blocked'; pair
                                   -- enforced by an IS TRUE-wrapped CHECK (the bare
                                   -- OR would pass UNKNOWN for a (null, category) pair)
  created_at          timestamptz

shared_content_entry               -- public Explore catalog (docs/READER-SPEC.md
                                   -- "Shared content (Explore)"); one row per
                                   -- published track, kept forever as opt-out
                                   -- marker / admin tombstone
  id                  uuid pk
  content_source_id   uuid         -- composite FK (content_source_id, text_track_id)
  text_track_id       uuid unique  --   -> text_track (content_source_id, id), so the
                                   --   track provably belongs to the source
  canonical_key       text         -- cross-user identity: 'youtube:{videoId}' or
                                   -- 'hash:{track sha256}'; one LIVE entry per key
                                   -- (partial unique index)
  language            text
  shared_by_user_id   uuid?        -- FK auth.users, SET NULL on account deletion
  featured            bool         -- admin flag; featured entries surface on the
                                   -- dashboard section, feed orders featured-first
  unshared_at         timestamptz? -- owner opt-out (upserted pre-publish to win races)
  removed_at          timestamptz? -- admin tombstone; blocks re-share of this
  removed_reason      text         --   content permanently (pair-CHECKed)
  created_at          timestamptz

text_segment
  id                  uuid pk      -- stable; foreign key target for highlights
  text_track_id       uuid -> text_track.id
  index               int          -- ordering within track
  text                text
  start_ms            int?         -- null for non-timed sources (books)
  end_ms              int?

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
  furthest_read_segment_index int? -- deepest segment index the reader has had on
                                   -- screen (track-relative, monotonic). Progress,
                                   -- checkpoints, sweeps. NULL until they scroll a
                                   -- normal session view.
  resume_after_segment_index int?  -- resume anchor: last segment scrolled past or read
                                   -- into (gloss/save); the reader resumes after it.
                                   -- Monotonic, <= furthest_read; the manual bookmark
                                   -- sets both. NULL = resume at the start.
  last_read_at        timestamptz? -- stamped by every reading-progress write and
                                   -- bookmark set; a book's current part is its
                                   -- session with the latest value. NULL = never read.
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

vocab_chat_message                   -- vocabulary-chat turns, one thread per 'chat' session
  id                  uuid pk      -- assistant ids are minted before insert so the
                                   -- model can cite the turn as proposal_id
  study_session_id    uuid -> study_session.id (ON DELETE CASCADE)
  role                'user' | 'assistant'
  content             text
  proposal            jsonb        -- assistant only: {items: [{headword, note, example,
                                   -- inVocabulary, highlightId}]} from propose_cards;
                                   -- highlightId is set once the item was added
                                   -- (segment + highlight + enrich_highlight job)
  new_thread_suggestion jsonb      -- assistant only: {language, message} when the
                                   -- learner asked about another target language
  created_at          timestamptz

card_chat_read_state                 -- per-card chat read marker (server-side, cross-device)
  card_id             uuid pk -> card.id (ON DELETE CASCADE)
  last_read_at        timestamptz  -- bumped to NOW() when the chat panel opens or
                                   -- observes a fresh assistant turn. cards.* read paths
                                   -- derive hasUnreadChat = newest card_chat_message
                                   -- with role='assistant' has created_at > last_read_at.
                                   -- card_id alone is the PK (a card has exactly one owner).

processing_jobs                      -- durable background-job queue (enrichment + ghost nomination + lesson extraction + lemma-profile builds)
  id                  uuid pk
  kind                'enrich_highlight' | 'nominate_window' | 'seed_card_chat' | 'extract_lesson' | 'build_track_lemma_profile'
                                   -- legacy enum may still include discover_session; worker treats it as no-op
  study_session_id    uuid? -> study_session.id  (ON DELETE CASCADE; required for
                                    -- every kind EXCEPT extract_lesson and
                                    -- build_track_lemma_profile — the lesson
                                    -- session is created at confirm, not
                                    -- upload, and profile builds are keyed by
                                    -- track, which precedes any session in the
                                    -- SRT/paste wizard flows)
  import_batch_id     uuid? -> import_batches.id (ON DELETE CASCADE; required for
                                    -- extract_lesson, null otherwise; a partial
                                    -- unique index keeps one LIVE extract job
                                    -- per batch)
  text_track_id       uuid? -> text_track.id     (ON DELETE CASCADE; required for
                                    -- build_track_lemma_profile, null otherwise;
                                    -- a partial unique index keeps one LIVE
                                    -- build job per track — the enqueue-
                                    -- coalescing mechanism)
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
                                    -- of the new-term queue, and a fresh save below
                                    -- FRESH_SAVE_MIN_ZIPF (3.5) gets no tier 2
                                    -- (docs/SRS.md §4).
  last_encountered_at timestamptz   -- refreshed by recordEncounter() at user-intent
                                    -- boundaries (highlight-save enrichment, an adhoc
                                    -- re-save, lesson-import confirm, an explicit lookup
                                    -- of the saved term) and by checkpoint content
                                    -- encounters.
                                    -- Drives the tier-2 freshness window and the
                                    -- 90-day new-term decay.
  last_demand_at      timestamptz default now() -- the collapse clock for explicit demand:
                                    -- stamped only by recordEncounter (creation is the
                                    -- first episode). Kept apart from
                                    -- last_encountered_at so a checkpoint can't
                                    -- swallow a re-save or lookup within the hour.
  last_demand_attempt_at timestamptz default now() -- stamped by EVERY recordEncounter
                                    -- call, collapsed or not; a capture demand event
                                    -- can be undone only while nothing came after it.
  encounter_count     int default 1 -- bumped by the same boundaries, 1-hour collapse
                                    -- window on last_demand_at (retries can't inflate
                                    -- it), plus lookup episodes credited at save
                                    -- (lemma_lookups below). >= 2 = tier-1 "revealed
                                    -- demand" in the new-term queue.
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
                                    -- exact key; save-time sense dedup
                                    -- (senseMatchPass, docs/READER-SPEC.md) maps a
                                    -- reworded sense onto the saved row first

practice_rating_events               -- append-only audit log of EVERY rating event:
                                     -- flashcard ratings, checkpoint credits and
                                     -- known-assertions, and lesson-import lapses.
                                     -- Written in the same transaction as
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
  was_explicit        bool          -- false = implicit rating (checkpoint credit or
                                    -- lesson-import lapse)
  was_introduction    bool          -- this rating introduced the facet (it consumed
                                    -- the daily-new budget, not the review budget)
  caused_parking      bool          -- this rating crossed the leech threshold and
                                    -- parked the facet
  caused_unparking    bool          -- known-assertion on an onboarding-parked facet
                                    -- (docs/SRS.md §6c): the write unparked it; undo
                                    -- re-parks from the prev_leech_* snapshot below
  prev_leech_parked_at timestamptz? -- park-state snapshot for caused_unparking
  prev_leech_rehab_correct_days int? -- events (onboarding-parked facets can carry
  prev_leech_rehab_last_correct_on date? -- partial rehab progress from warm-up gates)
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
  backlog_evidence    jsonb?        -- {userLookupId: {surface, context}} — the matched
                                    -- surface + context window the claims sheet shows;
                                    -- NULL on rows predating the column
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
  moderation_status   'clean' | 'flagged' | null -- same semantics + pair CHECK as
  moderation_category text?         -- text_track; checked at createBatch, re-checked
                                    -- on resume while null, copied to the lesson
                                    -- track at confirm
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
                                     -- post-session bonus), with a fenced
                                     -- generation lifecycle.
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
  word_family_hints_enabled boolean default true  -- reader word-family line +
                                    -- guess-before-reveal; only offered for
                                    -- WORD_FAMILY_LANGUAGES
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
                                   -- inflections only: kaikki metadata rows and
                                   -- cross-references to another lexeme (ru
                                   -- aspect partners, de auxiliaries) are
                                   -- skipped at load (isInflectionForm)

wiktionary_form_redirects          -- precomputed stub resolution (form-of /
  target_language     text         -- alt-of chains followed ≤2 hops); rows exist
  folded_form         text         -- only when the chain ends on a real lemma.
  lemma               text         -- Rebuilt by build-wiktionary-redirects.ts,
                                   -- invoked at the end of every load-kaikki run.

wiktionary_word_family_edges       -- precomputed word-family graph for the
  target_language     text         -- reader's word-family line; built only for
  lemma               text         -- WORD_FAMILY_LANGUAGES. lemma/relative are
  lemma_pos           text         -- checkpoint_fold-folded. pk (target_language,
  relative            text         -- lemma, lemma_pos, relative, kind); indexed
  kind                text         -- (target_language, relative) for shared roots.
  depth               smallint     -- 'ancestor' (1-3) | 'related' (always 1)

word_family_insights               -- LLM layer of the word-family line, one row
  target_language     text         -- per lemma, shared by every user; generated
  lemma               text         -- lazily on first request. pk (target_language,
  lemma_pos           text         -- lemma, lemma_pos); lemma folded.
  parts               jsonb        -- learner breakdown [{text, isAffix}]; [] = opaque
  missing_parents     text[]       -- folded parents kaikki lacks (real kaikki lemmas only)
  hidden_ancestors    text[]       -- folded kaikki ancestors a learner can't see
  model               text
  created_at          timestamptz

word_family_insight_explanations   -- per explanation language (native language,
  target_language     text         -- or the target language for translations-off
  lemma               text         -- learners). pk adds explanation_language;
  lemma_pos           text         -- fk (target_language, lemma, lemma_pos) ->
  explanation_language text        -- word_family_insights, on delete cascade.
  part_meanings       jsonb        -- aligned with word_family_insights.parts
  cognates            jsonb        -- string[]; empty in the target language
  model               text
  created_at          timestamptz
```

`wiktionary_word_family_edges` is rebuilt by `scripts/build-word-family.ts`
(end of every load-kaikki run; standalone `pnpm build:word-family [lang...]`
rebuilds per language in one transaction). Parsing lives in
`src/service/word-family/parse-word-family.ts`: **ancestors** come from
form-of senses tagged participle / gerund / passive / verbal noun (plain
inflection links are never followed — homograph traps) and from structural
etymology templates written for the target language (`af`/`affix`, `surf`
incl. `+bf`/`+deverbal` directives, `com`/`compound`, `pre`/`prefix`,
`suf`/`suffix`, `con`/`confix`, `deverbal`, `back-form`/`bf`, and the
structural segments of the unified `{{ety}}`); `clipping`/`blend` and
history templates are ignored, as are components prefixed with another
language code. Walked transitively to depth 3, each ancestor at its shortest
depth. **Related** edges come from the `related`/`derived` lists, kept only
when both words share a ≥3-letter stem after stripping a prefix observed in
that language's templates. Both endpoints must be content words: real
noun/verb/adj/adv lemmas of ≥3 letters (affixes never appear as relatives).

The insight tables are written on first request by `buildWordFamily` in
`src/service/word-family/word-family.ts` (`wordFamilyInsightPass`,
`MODEL_WORD_FAMILY`). Both halves are first-writer-wins (`ON CONFLICT DO
NOTHING`); a later explanation language reuses the stored breakdown and only
explains its parts. An explanation is stored only when its breakdown equals the
stored one — a request that lost a concurrent race re-explains the winner's. Missing parents include the breakdown's base words; a base
word the breakdown shows is never stored as hidden.

Checkpoint-review matching folds BOTH sides of every comparison through
`public.checkpoint_fold(input, lang)` (NFC → strip U+0301 → trim → lower, then
ru `ё→е`, de `ß→ss`, fr `’`→`'` + `œ`→`oe` / `æ`→`ae` + strip of exactly one
leading elision clitic (`l'` / `d'` / `j'` / `n'` / `m'` / `t'` / `s'` / `c'` /
`qu'` and the `jusqu'`-family compounds) so elided tokens and lemmas converge
(`l'homme` → `homme`, `s'appeler` → `appeler`) while interior apostrophes
survive (`aujourd'hui`); NFC runs first so orthographic acutes arriving decomposed
compose and survive the strip — only non-composable marks, i.e. Russian-style
stress accents, are removed). Expression indexes
`(target_language, checkpoint_fold(form|headword, target_language))` on
`wiktionary_forms` / `wiktionary_entries` make folded point lookups indexed;
query-side tokens fold through the byte-pinned TS twin
`packages/core/src/utils/checkpoint-fold.ts` (parity enforced by an
integration test). A "real lemma" for matching purposes has
`data ? 'head_templates'` and is neither a form-of nor an alt-of stub.

### Lemma frequency ranks

The per-language frequency-ranked lemma list backing the personalized
difficulty stat and the whole-language coverage read (`coverage.getCoverage`
aggregates total/per-band mass over it; `coverage.getTopLemmas` serves the
top-5k head for detail-view tooltips). Built offline by
`apps/backend/scripts/build-lemma-ranks.ts` from a pinned wordfreq export
(`scripts/export-wordfreq.py`) resolved against the loaded kaikki tables
through `checkpoint_fold` (byte-for-byte fold parity with the runtime
matcher). Backend reads only; RLS enabled with no policies.

```
lemma_ranks
  target_language     text         -- pk (target_language, lemma)
  lemma               text         -- checkpoint_fold-folded — the canonical
                                   -- lemma key shared with the matcher
  rank                int          -- 1 = most frequent; indexed
                                   -- (target_language, rank)
  freq_mass           double precision  -- summed corpus-frequency mass

lemma_rank_builds                  -- build manifest, one row per language,
  target_language     text  pk     -- upserted in the same tx as each build.
  version             int          -- increments per publish; swaps are
                                   -- explicit events
  built_at            timestamptz
  wordfreq_version    text
  row_count           int
  mass_matched_pct    double precision  -- acceptance metric (build fails
                                        -- loud below 95%)
```

A language is "supported" for difficulty only when it is in
`KAIKKI_LANGUAGES` **and** has a `lemma_rank_builds` row — KAIKKI membership
alone would claim support against an empty ranks table between deploy and the
one-off prod build. Ambiguous surface forms split their mass across candidate
lemmas weighted by each candidate's own corpus frequency (never evenly);
candidates wordfreq doesn't list weigh in at epsilon (min listed frequency
/ 10); `pos = 'character'` entries and multi-word lemmas are excluded; German
capitalized lemmas competing with their lowercase twin for the same form are
discounted ×0.02 (wordfreq is caseless).

The published list applies a **mass floor**: lemmas whose total mass is below
the least frequent listed form's own frequency are dropped before ranking.
Below that floor sit only epsilon-share slivers of forms dominated by other
candidates (alt-spellings and acronym homographs — "because" → becuz,
"five" → MI5); their near-identical masses would otherwise rank as a dense
junk plateau deep in the list, which made sweep-marked coverage render as
artificial clusters of adjacent "known" cells. A lemma wordfreq doesn't list
still ranks when it is the sole candidate of a listed form (it inherits the
form's full mass). The floor trims roughly 8–12% of positive-mass lemmas per
language.

### Populating the reference tables locally

Three scripts (all run from `apps/backend`, all defaulting to the dev-tunnel
DB) fill the reference tables above; `pnpm load:reference-data` chains them
for the fresh-machine case:

1. `pnpm export:wordfreq` — exports the pinned wordfreq form/frequency lists
   to `scripts/.cache/wordfreq/{lang}.csv` (needs `uv`; no DB).
2. `pnpm load:kaikki` — downloads (and caches) the raw kaikki dump, fills
   `wiktionary_entries` / `wiktionary_forms`, rebuilds
   `wiktionary_form_redirects`.
3. `pnpm build:lemma-ranks [lang...]` — builds `lemma_ranks` +
   `lemma_rank_builds` from the wordfreq export resolved against the loaded
   kaikki tables.

Steps 2 and 3 end a local run by snapshotting all five reference tables
(`scripts/snapshot-reference-tables.ts` →
`scripts/.cache/wiktionary/wiktionary.dump`), which `pnpm db:reset` restores
after wiping — so a reset preserves the reference data and the scripts only
need re-running to pick up new upstream data or ranking-logic changes. In
prod, the kaikki load runs via the manually-triggered
`load-kaikki-prod.yaml` workflow; the lemma-ranks build is a separate manual
`doppler run --config prd -- npx tsx scripts/build-lemma-ranks.ts` step.
The load never trusts a COPY's clean exit: the loader requires the DB totals
to match the generated CSVs exactly and every loaded language to have rows
in all three wiktionary tables (`pnpm verify:kaikki-load` runs the same
check standalone, and the prod workflow re-runs it as a separate step on a
fresh connection). The DB scripts fall back to the dev-tunnel connection
only when run without Doppler — under a Doppler config that doesn't provide
`SUPABASE_CONNECTION_STRING` they abort instead of silently targeting the
local DB.

Each coverage repository response reads its manifest, mass totals, and
requested ranks or labels from one SQL statement snapshot. An atomic build
publication therefore cannot leave one response mixing positions from one
build with another build's version or denominator; the detail client keys its
top-lemma cache by that same build version.

### Per-track lemma profiles

The cached tokenization+resolution of one text track, consumed by the
personalized difficulty stat. Backend reads/writes only; RLS enabled with no
policies.

```
text_track_lemma_profiles
  text_track_id       uuid -> text_track.id (ON DELETE CASCADE)
  folded_token        text         -- pk (text_track_id, folded_token)
  token_count         int          -- occurrences in the track; CHECK > 0
  candidate_lemmas    text[]       -- ALL folded lemmas the matcher resolves
                                   -- the token to; deduped; CHECK non-empty
```

Token-level candidate GROUPS (not per-lemma counts) are stored so ambiguity
conserves mass: each token contributes `token_count × max(P(candidate))`
exactly once and coverage can never exceed 100%. Unresolved tokens (proper
nouns, numbers, typos) are omitted — resolution failure is the filter; the
difficulty denominator is matched tokens (`profile_matched_token_count`,
stored on the track next to `profile_word_token_count` for honesty).

Lifecycle: a `build_track_lemma_profile` job is enqueued at every prose-track
creation point (SRT upload, OpenSubtitles import, paste, extension
YouTube/streaming ingest, text import incl. the Telegram bot, book parts) when
the track has no profile yet; a partial unique index coalesces concurrent
enqueues to one live job per track. The build (service/lemma-profiles/)
batch-tokenizes segments with occurrence counts (same Intl.Segmenter ranges,
fold and digit-hyphen skip as the checkpoint tokenizer — the letter part of
«27-летний» is not an occurrence), resolves through the shared checkpoint
matcher, and swaps rows + bookkeeping in one transaction serialized by a
per-track advisory lock. The track is stamped with the builder's
`profile_version`; readiness serves an older-version profile as `available`
and enqueues a rebuild in the background (never after a terminal failure), so
a builder change reaches existing tracks without consumers flickering to
`pending`. Ad-hoc tracks (mutable, "headword — context" lines)
and lesson tracks (independent imported vocabulary items, non-narrative) are
never profiled — difficulty treats them as unsupported. Missing/stale
profiles at difficulty-read time re-enqueue and report `pending`; builds are
never run synchronously inside a request.

### Lemma lookups

Explicit gloss lookups as new-term demand (docs/SRS.md §4 "Lookups as
demand"). Backend reads/writes only; RLS enabled with no policies.

```
lemma_lookups
  user_id             uuid -> auth.users.id (ON DELETE CASCADE)
  target_language     text         -- pk (user_id, target_language, lemma)
  lemma               text         -- checkpoint_fold-folded, homograph-guarded
  lookup_count        int          -- collapsed episodes (1-hour window)
  credited_count      int          -- watermark: episodes already folded into a
                                   -- saved term's encounter_count; CHECK
                                   -- 0 <= credited_count <= lookup_count
  last_looked_up_at   timestamptz
```

Saved terms match lemmas through `public.user_headword_lemma_keys(headword,
lang)`, the SQL twin of `foldUserHeadwordCandidates` (en `to `, de `sich `,
fr `se `, es/pt reflexive strips on top of `checkpoint_fold`), pinned by a
SQL-vs-TS parity test. The watermark is what makes save-time crediting
idempotent: an enrichment retry or a re-save finds nothing uncredited.

### Capture demand events

Demand recorded from a "Translate & add" search (docs/SRS.md §4 "Capture
searches as demand"). One row per write, so each is visible and undoable.
Backend reads/writes only; RLS enabled with no policies.

```
capture_demand_events
  id                       uuid pk
  user_id                  uuid -> auth.users.id (ON DELETE CASCADE)
  user_lookup_id           uuid -> user_lookups.id (ON DELETE CASCADE)
  source                   'search' | 'edit_card' | 'move_up'
  counted                  bool         -- the encounter bump happened (false:
                                        -- collapsed into demand from the last hour)
  prev_last_demand_at      timestamptz  -- the values the bump replaced, restored
  prev_last_encountered_at timestamptz  -- by undo while still the event's own
  created_at               timestamptz  -- = the NOW() the bump wrote
  reverted_at              timestamptz? -- undone
```

`study_facets.boosted_at` / `boost_prev_due` (timestamptz?) hold a "Review
tomorrow" boost and the due date it replaced (docs/SRS.md §5).

### Book pins

The pinned book per (user, language) — docs/SRS.md §4 "Pinned book". Backend
reads/writes only; RLS enabled with no policies.

```
book_pins
  user_id             uuid -> auth.users.id (ON DELETE CASCADE)
  target_language     text         -- pk (user_id, target_language): one pin per language
  content_source_id   uuid -> content_sources.id (ON DELETE CASCADE)
  pinned_at           timestamptz
```

Pinning another book of the same language upserts the row. `books.remove`
deletes it in the same transaction as the session soft-delete (the source
survives removal for dedup). `study_facets.book_quota_source_id` (uuid? ->
content_sources, ON DELETE SET NULL) is stamped by both introduction guards
with the pinned book when the term was in its stream at introduction time;
the daily book quota counts today's stamped introductions, so it survives
pin changes. Undo of an introduction clears it.

### Book part lemma counts

Per-lemma occurrences for each book part — the input of the pinned-book
"occurrences ahead" priority (docs/SRS.md §4 "Pinned book").
Backend reads/writes only; RLS enabled with no policies.

```
book_part_lemma_counts
  text_track_id       uuid -> text_track.id (ON DELETE CASCADE)
  lemma               text         -- checkpoint_fold-folded; pk (text_track_id, lemma)
  occurrences         int          -- CHECK > 0
  primary_occurrences int?         -- ≤ occurrences; NULL on rows from builder < v3
  index (lemma, text_track_id)     -- lemma-driven lookups across a book's parts
```

Written by the profile build for book parts only, in the same transaction as
the profile swap (`book-lemma-counts.ts`): each token group runs through the
checkpoint homograph guard (`applyFrequencyAsymmetryGuard` with
`lemma_ranks`), then every surviving candidate is credited the group's FULL
token count — the question is "will I meet this word", so the equal-frequency
survivors each count rather than splitting. `primary_occurrences` credits the
group only to its most likely survivor (highest `freq_mass`, alphabetical on
ties) — the input of the book page's "Learn before you read" list
(docs/READER-SPEC.md), which shows words to a person and must list one reading
of an ambiguous form; readers fall back to `occurrences` while a stale row
awaits its rebuild. A `lemma_ranks` rebuild does not
re-trigger it (accepted: rank builds are rare, and a stale guard decision
costs ordering precision, not correctness).

### Book prelearn glosses

Short glosses for the "Learn before you read" list (docs/READER-SPEC.md), one
per word per occurrence. Backend reads/writes only; RLS enabled with no
policies.

```
book_prelearn_glosses
  content_source_id   uuid -> content_sources.id (ON DELETE CASCADE)
  lemma               text         -- checkpoint_fold-folded
  text_segment_id     uuid -> text_segments.id (ON DELETE CASCADE) -- the sentence glossed
  gloss_language      text         -- native language, or the target language when
                                   -- translation fields are hidden (a definition)
  gloss               text
  created_at          timestamptz
  pk (content_source_id, lemma, text_segment_id, gloss_language)
  index (text_segment_id)
```

The occurrence is part of the key because a book can use one word in several
senses: the gloss always describes the sentence a Learn card from the list
would be built from. Written once (ON CONFLICT DO NOTHING) by
`books.getPrelearnGlosses`.

### Known lemmas

The stateless known-vocabulary assertion layer (coverage proposal): one row =
"the user claims to know this lemma" — no facets, no FSRS state, no history,
which is what keeps every correction path a trivial write.

```
known_lemmas
  user_id             uuid -> auth.users.id (ON DELETE CASCADE)
  target_language     text         -- pk (user_id, target_language, lemma)
  lemma               text         -- checkpoint_fold-folded canonical key
  source              text         -- 'bulk_text' (the per-session sweep) |
                                   -- 'book_prelearn' (the book page list)
  source_id           uuid?        -- the sweeping session, or the book's
                                   -- content source; FIRST writer
                                   -- wins (ON CONFLICT DO NOTHING) — later
                                   -- overlapping sweeps don't take ownership
  sweep_batch_id      uuid?        -- one fresh uuid per sweep press; a batch
                                   -- only ever owns rows IT inserted, so
                                   -- delete-by-batch is a sweep-exact undo
  marked_at           timestamptz
```

Write paths: the book page's "Learn before you read" **Known** button
(`books.markPrelearnKnown`, one lemma, no batch id; its toast Undo is the
plain `unmarkKnownLemma` delete — the list only offers lemmas not yet known,
so the row it inserted is the only one); and the per-session "mark the rest as known" sweep
(`studySessions.markRemainingKnown`, preview via `getMarkKnownPreview`) —
per-token candidate lemmas (profile rows for the whole-text scope, live
resolution for the span scope) filtered to the CREDITABLE candidates
(`filter-creditable-candidates.ts`, membership read fresh against
`lemma_ranks`), minus studied headword-lemmas, minus already-known. Per
token: if any candidate is ranked, its unranked homograph siblings are
dropped ("because" never marks becuz); if none are ranked, all stay
creditable (sole-owner rare words, languages without a build); multi-word
candidates are always dropped. Refused for adhoc/lesson sessions and for
languages without BOTH kaikki data and a `lemma_rank_builds` manifest row
(the same supported gate as the difficulty stat), `pending` while the track
profile builds. Un-mark is a bare DELETE behind the gloss-sheet "Marked as
known" chip (`studySessions.unmarkKnownLemma`) — both gloss endpoints return
`knownLemmaCandidates` (the selection's resolved lemmas ∩ known_lemmas,
deliberately UNFILTERED: the intersection is self-limiting for new writes,
and rows marked before candidate filtering existed must stay reachable for
correction), and un-marking removes every candidate the chip reported. Bulk correction for sweep-created rows is
`studySessions.unmarkKnownBySession`: with the `sweepBatchId` the sweep
response returned it reverts exactly that press (the toast Undo — progressive
sweeps share `source_id` but never a batch id); without it, it clears every
mark the session's sweeps created (the difficulty-sheet action).
`getMarkKnownPreview.sessionMarkedCount` (computed for every preview status —
a span sweep can create marks while the whole-text profile is pending/failed)
tells the sheet when to offer it.

Correction is read-time precedence, never deletion: any live saved lookup
beats a known mark in the difficulty/coverage math (saving a marked-known
word is the signal the user does NOT know it); soft-deleting the lookup
falls back to known. The difficulty blend additionally ignores a known mark
on an UNRANKED candidate when its token group has a ranked one — marks
written before candidate filtering existed credited junk homographs, and
such a mark must not count a token fully covered while its real lemma is
still being studied. Consumers are the difficulty/coverage reads and the
gloss chip ONLY — ghost nominations must never read this table (suppressed
suggestions are invisible errors; coverage miscounts are visible ones).

### Coverage snapshots

Lazy per-day history of the whole-language coverage stat, written
fire-and-forget by `coverage.getCoverage` (`service/coverage/`) — the
response never waits on or fails from the write. Purpose: a future
progress-over-time chart needs history that a `lemma_ranks` rebuild can never
retroactively rewrite, so each row pins the build it was computed against. No
chart UI exists yet — this is history collection only. Backend-only; RLS
enabled with no policies.

```
coverage_snapshots
  user_id             uuid -> auth.users.id (ON DELETE CASCADE)
  target_language     text         -- pk (user_id, target_language, day)
  day                 date         -- UTC day of the compute; same-day
                                   -- recomputes update the row in place
  build_version       int          -- lemma_rank_builds.version at compute time
  denominator         int          -- lemma_rank_builds.row_count
  studied_count       int
  known_count         int
  mwe_count           int
  coverage_pct        double precision  -- binary blended token-mass %
                                        -- (studied ∪ known count as P=1)
  verified_pct        double precision  -- share backed by a live successful
                                        -- explicit-or-checkpoint meaning
                                        -- review (never the assertion lane)
  updated_at          timestamptz
```

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
for every chunk (dialect-split languages → the user's IPA dialect bucket —
en `ga`/`rp`, es `cas`/`lam`, pt `br`/`eu` — others →
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
