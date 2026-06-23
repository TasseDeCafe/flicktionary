# Let the per-card chat generate exact-form cards

> **Status: proposal — not implemented.** A design for giving the per-card chat
> a tool to create/populate an exact-form (form-facet) study target, not just
> edit the citation/lemma card. Not current behavior; `SPEC.md` and
> `docs/SRS.md` describe what ships today. Surfaced while building the note-only
> highlight lane (where "generate this card's data via chat" became a
> first-class path).

## Problem / motivation

The per-card chat can edit the **citation (lemma) card** but cannot create an
**exact-form** card (a `study_facets` form facet with its own `payload`). Its
only tool, `update_card_fields` (`apps/backend/src/service/chat/run-card-chat.ts`),
splits its patch across exactly two writes:

- `surface_form` → the card row (`cardsRepository.updateFields`)
- `headword` / `sense` / `translation` / `definition` / `target_example` /
  `native_example` / `extras_patch` / `grammar_patch` → the canonical lemma row
  (`userLookupsRepository.updateContent` / `renameKey`)

Nothing touches `study_facets`. So if a learner saves an inflected surface form
(e.g. Russian `некоторых`) and asks the chat to "make a card for this exact
form," the chat normalizes it to the lemma (`некоторый`) and tucks the form into
`grammar.notable_forms` — a lemma card, not a scheduled form facet.

Exact-form cards are created only via:
- the study-target picker → **Exact form** scope at save time
  (`applyStudyIntent` → `generateStudyIntentFormData`), or
- the focus view's form selector **"+ Add a form" → Generate**
  (`chunks.generateFacetData` → `generateFormFacetData` /
  `chunks.setFacetPayload`).

This is mostly a deliberate split (see "Design tension"), but it's a friction
point for the note-only / chat-driven flow: the learner is already in the chat,
reasoning about the exact inflected form, and has to leave for the focus view's
form selector to actually schedule it.

## What already exists (and would be reused)

- **`generateFormFacetData`** (the service behind `chunks.generateFacetData`,
  `apps/backend/src/router/chunks-router/chunks-router.ts:251`) takes
  `{ chunkId, userId, skill, targetForm }` plus deps
  `{ userLookupsRepository, usersRepository, userTargetLanguagePrefsRepository }`
  and runs the per-language Opus pass that fills a form facet's payload
  (translation / examples / grammar with a stress-marked `display_form`), then
  flips it `pending_data → ready`.
- **The chat's deps already include those three repos** (`RunCardChatDependencies`),
  so the generation pass itself is callable from chat with no new wiring.

## What would need building

1. **A new chat tool** — e.g. `create_form_card({ surface_form })` (distinct from
   `update_card_fields` so the existing lemma-edit semantics stay clean). The
   model calls it when the learner asks to study a specific inflected form.
2. **Ensure-the-facet step.** `generateFormFacetData` fills a facet that must
   already exist as `pending_data`. The "+ Add a form" UI ensures the facet
   first; chat would need the same. That needs **`studyFacetsRepository`** (its
   `ensureFacet`), which is **not** in `RunCardChatDependencies` today — one new
   dependency threaded through `chatDependencies` in `app.ts`.
3. **A skill-enablement decision.** A form facet with zero enabled skills is
   *dormant* (in vocabulary, queued nowhere). The picker/form-selector let the
   user toggle Recognition/Production explicitly; the chat would have to either
   default to enabling Recognition or ask. (Floor-guard / 0-skill semantics from
   `docs/SRS.md` apply.)
4. **Collapse-to-lemma + idempotency.** `normalizeTargetForm`; collapse `'form'`
   to the citation when the surface IS the headword (server-side rule already in
   `applyStudyIntent`); re-running the tool on an existing form facet should
   refresh, not duplicate.
5. **Reply + UI refresh semantics.** The assistant body's `_Updated: …_` line and
   the focus view's `chunks.getStudyTargets` re-fetch so the new form chip
   appears; read-state handling.
6. **Tests + docs** — unit tests mirroring the existing chat-tool tests, plus
   `SPEC.md` (focus-view / chat sections) and `docs/SRS.md` updates.

Rough size: medium — one new tool + one new dep + the ensure/enable/idempotency
logic + tests + docs. Not a one-file patch.

## Design tension (the real reason this is a proposal, not a patch)

`SPEC.md` is explicit that **study-target structure is edited in the focus /
term view alone** — the saved gloss sheet and extension popover both *lock* the
study-target picker read-only post-save, precisely because "switching scope
post-enrich means creating/deleting durable form facets, which the compact sheet
can't represent." The per-card chat is also scoped to "refining understanding of
one chunk," not mutating its study-target structure.

Letting chat *create* form facets expands the chat's mandate and overlaps the
form selector. That's a legitimate product choice — the chat is arguably the
most natural place to say "yes, schedule this exact form" — but it should be a
conscious decision, not a silent capability that contradicts the locked-picker
principle.

## Open questions

- Should chat create form facets at all, or only ever *suggest* "open the form
  selector to add `некоторых` as an exact form"? (A softer middle ground: the
  chat tool enqueues the form as a candidate the focus view surfaces, rather than
  generating + enabling directly.)
- Default skill on a chat-created form: Recognition only, or mirror the lemma's
  enabled skills?
- Does this also apply on the extension (no focus view there), making chat the
  *only* way to add a form for extension-first users — a stronger argument for
  building it?

## Recommendation

Defer until there's demand. The note-only flow is fully usable without it (chat
generating the **lemma** card already unblocks Keep). If we build it, resolve the
"create vs suggest" question and the skill-default first — those drive the whole
shape.
