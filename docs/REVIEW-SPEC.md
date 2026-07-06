# Review screen (web)

> **Status: authoritative-spec.** The two-layer review UI over a session's kept terms:
> the session-vocabulary list (layer 1) and the focus view (layer 2) — card editing,
> grammar provenance, study targets + per-form editor, per-card chat, the session recap
> quiz, scope-aware removal. Split out of `SPEC.md`, which keeps the product overview and
> user flows.

Terminology note: this doc uses "chunk" for the internal domain concept and "term" when
quoting user-facing strings — see `SPEC.md` → Terminology.

Two-layer UI.

## Layer 1 — Session vocabulary list (default landing)

Saving a highlight while reading is already an explicit commit, so there is no
separate Keep step: a card **auto-keeps** the moment it has basic flashcard data
(see "Auto-keep" under `docs/READER-SPEC.md` → Processing pipeline). This screen is therefore a
review-and-prune list of the session's kept terms, not a keep/reject queue.

- One list of the session's terms: literal manual selections and adopted ghost
  suggestions (adopting a ghost creates a real highlight before enrichment). The
  list client-filters to `status ∈ {kept, needs_data}`; `removed` rows never
  show. Legacy `highlight_id = null` rows are no longer produced, so there is no
  separate "LLM-suggested" section.
- Each row: chunk surface form, a 1-line gloss preview, a tap target (opens the
  focus view), and a single **Remove** (trash) control. **Remove = unkeep this
  card** (`cards.removeFromSession` → `removed`): non-destructive — it survives in
  Vocabulary if kept elsewhere, the "added N×" badge decrements, and the last
  keep takes `count` to 0 so it leaves Vocabulary naturally. No `deleted_at`, no
  cross-session nuking, no warning. Because the optimistic cache flips status in
  place, a Remove drops the row from the list immediately (no refetch).
- **Note-only "needs data" rows.** A note-only card (created via **Save note**)
  has no `translation` / `definition` / `target_example`, so it stays `needs_data`
  and shows here as a "needs data — open to generate" row (it still has a
  Remove). Opening it and running **Generate full exploration** (or generating
  data via chat) fills its basic data and **auto-keeps it** — the on-demand
  exploration mints the session context blob lazily on first use even though the
  note-only session never ran an `enrich_highlight` job.
- Filter and search across the single list. There is no bulk Keep all / Reject
  all and no generic card-status mutation: cards keep themselves once they gain
  basic data, so the only user-driven transition is `cards.removeFromSession`.
- Reader-saved highlights materialize as `needs_data` cards (the enrichment job
  inserts cards in `needs_data`; user highlights bypass the CEFR floor) and then
  auto-keep once basic data lands. Vocabulary membership and the recognition
  floor happen on the keep transition, which is now automatic.
- **Floor guard:** a **kept** term (`count > 0`, not deleted) must always keep ≥1 enabled facet — `chunks.setFacetEnabled` rejects (409) a disable that would zero out its last enabled facet (delete the term instead). Pre-keep terms keep their freedom to drop to zero. The focus view's per-target last-skill lock is the friendly UI front for this invariant; the backend guard is the authoritative safety net.
- The enriching/failed **placeholder rows** + status polling stay (a highlight
  still being enriched has no card yet), and a **retry** affordance for failed
  enrichment.
- Sticky footer: `Quiz your terms` button (full-width on mobile, right-aligned
  on desktop) that launches the **session recap** — a zero-LLM, fully
  client-side quiz over ALL of the session's kept terms
  (`/practice/recap/$targetLanguage?studySessionId=`) — rather than any SRS
  surface. The recap **never touches FSRS** (no introductions, no ratings, no
  parking, no backend writes), so it covers the whole session regardless of the
  daily new-term cap; spaced onboarding still happens at the composed Practice
  queue's own pace. Questions are built client-side from the already-loaded
  card list (`build-recap-questions.ts`): eligibility = `kept` cards whose
  gloss resolves non-empty under the language-mode rules (translation vs
  definition via the `useTermMeaning` resolver), deduped by chunk. Two forms
  alternate by parity over a shuffled order — **MC meaning** (the card's own
  `target_example` with the term highlighted → pick the gloss among distractors
  sampled from the session's other terms: normalized-deduped, never the correct
  gloss, same-POS pool only when it fills all 3 slots, 3-option MC allowed at
  exactly 2 distractors, typed fallback below that) and **typed recall** (gloss
  + the example with the term blanked → type it; accepted forms = headword +
  surface form, graded with the shared accent-insensitive 1-typo-tolerant
  helpers from `@flicktionary/core/utils/typed-answer-grading`). When the term
  can't be located in its example by case-insensitive substring (surface form,
  then headword), MC shows a headword-only prompt and typed **hides the
  sentence entirely** (it contains the answer). A miss or **Skip** (no reveal,
  no correct-credit) re-appends the term once at the end of the queue in the
  other form; a missed redrill is dropped. Position counter shown (`N / M`; the
  total grows by one at the moment of a miss — bounded and attributable, unlike
  the composed queue's async redrills). Completion shows `X of Y correct`;
  close/back returns to the session-vocabulary list. Button disabled when no
  cards are kept; a session whose kept terms have no resolvable glosses gets a
  "Nothing to quiz yet" empty state.
  Per-session CSV export is gone from this screen — exports happen from the
  Vocabulary tab instead.
- No chat here. This layer is for fast review.

## Layer 2 — Focus view (modal screen pushed above the tab navigator)

- Modal header: chevron-back to the session-vocabulary list, position counter
  (`Card N of M`), and a chat toggle button carrying the unread indicator (see
  the per-card chat bullet below). There is **no keep/reject bottom bar** — cards
  auto-keep on basic data; removal is a single scope-aware affordance inline in
  the card body (see the next-to-last bullet in this section).
- Prev/next navigation uses two fixed, viewport-mid-height circular buttons
  pinned to the left and right edges so they stay reachable on long cards;
  the `Open in subtitles` deep-link still lives inside the collapsible
  `Context` block.
- Card section: each basic column gets its own labeled input — `Headword`,
  `Target example`, plus `Translation` + `Native example` (and optional
  `Definition`) when L1 ≠ L2 and the Show-translations pref is on, or just
  `Definition` when L1 = L2 or that pref is off. Every input
  debounces a partial PATCH to `cards.updateFields`; the basic columns are
  the single source of truth (no more `front_override` / `back_override`).
  Above the inputs: compact grammar chips (`m.` / `f.` / `c.`, `impf.` /
  `perf.`, `↔ <pair>`, `+ acc`, `pl. tantum`, `indecl.`, `refl.`) for the
  high-signal keys, glanceable. Below the inputs: a collapsible `Grammar`
  panel (selects for enums, text inputs for headword pointers / government /
  display_form where the target language supports it, checkboxes for
  booleans, an add/remove list editor for `notable_forms`, plus read-only
  Wiktionary IPA when `grammar.ipa` has a displayable bucket). Both chips and
  panel filter the visible keys by the
  session's `target_language` — the per-language allowlist + label /
  placeholder hints live in
  `packages/core/src/constants/language-grammar.ts` (explicit configs for
  `en`, `es`, `ru`, `fr`, `pt`; other supported languages fall through to a
  conservative default of `pos` / `display_form` / `government` /
  `number_only` / `notable_forms` / `notes`; English intentionally omits
  editable `display_form`). Same debounced-PATCH path, with `grammarPatch`
  shallow-merged into the JSONB column server-side; hidden fields' stored
  values are preserved untouched. Provenance is **per field**, not per card
  (the old card-level grounding badge is gone; the external Wiktionary link
  chip stays): each grammar field whose value matches the stored
  `grounding_patch` snapshot shows a small check icon ("Verified by
  Wiktionary"), a field edited away from its snapshot shows a pencil whose
  popover (desktop) / bottom sheet (mobile) reveals the original value and a
  one-tap **Revert** (revert writes through the same local-state +
  debounced-save path as typing — never a direct mutation), and the IPA field
  alone shows an amber "Unverified" warning when it has a displayed value
  that isn't grounded (hallucinated IPA is the one silently-harmful case; for
  other ungrounded/LLM fields the absence of an icon is the default state).
  Form-facet fields get the same treatment against the facet's
  `generated_payload` snapshot (pencil + revert when edited away from what
  the Opus pass generated; no Wiktionary/unverified states). Indicators only
  appear for kaikki-enabled languages (citation grammar) or facets with a
  generation snapshot; legacy grounded rows without a `grounding_patch`
  snapshot claim nothing until the backfill re-grounds them. Content fields
  on the citation card (translation/examples/definition) are always
  LLM-or-user-authored and carry no indicator.
- Below the card: a collapsed `Context` block showing ±2 surrounding source
  segments. Open it with the chevron when needed.
- Full exploration: rendered when `exploration_extras` has data. Otherwise
  shows a `Generate full exploration` button that triggers the on-demand
  enrichment pass.
- Per-card chat thread, scoped to that chunk, opened on demand from the
  header chat icon (not inline in the card scroll). On mobile it's a
  full-screen slide-up sheet; on desktop a right-side panel laid out beside
  the card column (non-modal — the card stays scrollable and prev/next stay
  reachable while it's open). The header icon carries an unread indicator with
  three states: amber pulse while a seeded answer is generating, solid green
  when an unread assistant answer is ready, red when seed generation failed;
  opening the panel marks the chat read. Read-state is persisted server-side
  (`card_chat_read_state`, keyed by card) so the indicator survives reload and
  is cross-device; the `cards.*` read paths return a derived `hasUnreadChat`
  (true when the newest assistant turn is newer than `last_read_at`). The chat
  tool can call `update_card_fields` to patch any basic column or merge into
  `exploration_extras` / `grammar` server-side; the assistant body gets a
  `_Updated: …_` italic line and the focus view re-fetches the card. An
  unqualified request to fill / create / generate the card's data populates
  only the basic fields (translation, definition, target/native example) plus
  core grammar — `extras_patch` (the full-exploration bag: frequency, register,
  collocations, etymology, l1_notes, …) is reserved for an explicit
  full / deep-exploration request or a named extra, so casual "make this card"
  asks no longer dump a whole exploration.
- **Scope-aware Remove (no keep/reject bar).** There is no bottom action bar.
  Removal is a single inline affordance in the card body, chosen by entry scope:
  - **From a session** (session-vocabulary list / focus-view-from-session):
    **Remove from session** → `cards.removeFromSession` (status `removed`,
    unkeep). Non-destructive (survives in Vocabulary if kept elsewhere; no
    `deleted_at`, no confirm). After removing, it advances to the next card via
    the cursor, or closes back to the session-vocabulary list if it was the last.
  - **From vocabulary / practice** (`?from=vocabulary` / `?from=practice` over
    already-kept chunks, i.e. `isLanguageWideEntry`): **Delete term** →
    `chunks.deleteChunk` (term-level soft-delete, behind a confirm). Unchanged.
  - A data-less `needs_data` note-only stub opened from a session has no keep
    button — generating its data auto-keeps it, and **Remove from session**
    discards the stub.
- The card section always shows the **study-target selector + unified editor**
  (the editor lets the learner set up forms/skills and edit content; keeping a
  card just enables recognition, which now happens automatically on basic data).
  The prev/next pager is gated on having a session cursor, so session entries
  page through their cards and language-wide entries (which don't load the
  session card list) don't.
  - **Form selector** (`form-selector.tsx`): a chip-per-target row at the top —
    one **Citation** chip (the headword), one chip per **form** target, and a
    **"+ Add a form"** chip. Selecting a chip sets which target the editor below
    edits (local navigation, no popover). A chip is accented (★) when Production
    is on, dashed/Sparkles when a form is `pending_data`, and muted when the
    target is **dormant** (zero enabled skills — in vocabulary but queued
    nowhere).
  - **Skills** for the selected target render inline beneath the chips on desktop
    and behind a pencil→sheet on mobile (`useIsMobile`): **Recognition** and
    **Production** toggle `(skill, '<targetForm>')` via `chunks.setFacetEnabled`;
    **Pronunciation** toggles `(pronunciation, '')` for citation (greyed "No
    pronunciation data yet" without displayable IPA — `hasDisplayableIpa`) and is
    greyed "coming soon" for forms. **Recognition is deselectable** — unchecking
    every skill leaves the target dormant (disable ≠ delete; SRS history kept).
    Removal is explicit: **Remove form** (`chunks.deleteFacet` for the target's
    facets) on a form, **Delete term** (`chunks.deleteChunk`) for the citation.
  - **Unified editor** (`per-form-card-editor.tsx`): Citation edits the lemma's
    canonical content (translation / examples / definition / grammar on
    `user_lookups`, via `chunks.updateContent` + `chunks.rename`); a form edits
    that form facet's own full content in its `study_facets.payload`
    (`chunks.setFacetPayload`). Both reuse `editable-card-fields.tsx` +
    `editable-grammar-panel.tsx` through injected save adapters; the form payload
    `grammar` is always written **complete** (the JSONB merge replaces the whole
    sub-object). A form added from **"+ Add a form"** (encountered surface forms
    from `getStudyTargets.candidateForms`) is born `pending_data`; the editor body
    offers **Generate** (an Opus pass, `chunks.generateFacetData`, which seeds the
    example from the encountered sentence and runs under the per-language
    instructions block, so the form's `grammar` carries a stress-marked
    `display_form` like the lemma's — Russian stressed, English unset) or **Enter
    manually** — either fills the payload, flips the facet to `ready`, and swaps
    in the full editable field set (a skeleton shows while generation is in
    flight). The form-target chips themselves render the form **without** the
    stress mark (matching the unstressed citation chip); the stressed spelling
    still shows in the FORM heading + editor.
  - **Context** block per target: the most-recent kept occurrence backing the
    selected target (`getStudyTargets` `facet.source` — the form's own inflection,
    the lemma's for citation), with an "Open source" deep-link; hidden when the
    target has no kept occurrence / source. The selector + editor read facet
    state + readiness + source lazily via `chunks.getStudyTargets`. Edits keep the
    user on the focus view; the chevron closes back to the originating surface
    (`?from=practice` carries `practiceLang` + `practicePool` + `practiceMode` —
    `read` (default) for a reading text, `flashcards` for the flashcard reviewer's
    actions menu — so close lands on the right review screen, scope reset to
    `mixed`).
- Keyboard: `←`/`→` (and `j`/`k`, with OS key-repeat so holding scans) drive
  prev/next, `C` toggles the chat panel. All three header buttons carry a small
  corner keycap badge on desktop (`←` / `→` / `C`, the shared `Kbd` component's
  corner variant — inline badges would double an icon-only button's width);
  keys go inert while the mobile chat sheet is open and never fire while an
  editable field has focus.

Per-card chat seed prompt = methodology + `(L1, target, CEFR)` + source context blob (cached) + chunk + 10 surrounding segments + the card's current basic data + grammar (if populated) + extras (if populated, including any per-chunk L1 notes). The user's question is the only dynamic turn.

