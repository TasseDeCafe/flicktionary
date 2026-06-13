# Web app — future ideas & open questions

> **Status: proposal — not implemented.** A backlog of post-MVP ideas and
> undecided design questions for the web app. None of this is current behavior;
> the authoritative description of what ships today is `SPEC.md`. Pull an item
> here into `SPEC.md` only when it actually ships.

## Open questions / TBD

These are tuning/design questions left open in the MVP — defaults that exist in
the code but were never validated, or model choices deferred.

- Exact target count for difficult-words pass — start at 25, tune.
- Per-card chat token budget and prompt cache strategy depend on chosen model.
- Whether `user_lookup` is exclusion-only or also informs the difficulty model ("user has seen N B1 words → bar moves up").
- Auto-rejection threshold relative to CEFR (one level below? two?).

## v2 / out-of-scope ideas worth not forgetting

- Books and articles as additional `content_source.type`s (pasted text already shipped — books/articles need their own ingestion path but reuse the rest of the pipeline).
- Multi-headword merge UX inside the Vocabulary tab (collapse two senses into one without manual re-export).
- `.apkg` Anki export with audio + images.
- Inline subtitle player with sync, for users who actually want it.
- User-customizable methodology prompt for advanced users (the gf use case). The MVP already has per-target-language instructions hardcoded in `language-instructions.ts` — a future version promotes them to a DB-backed, per-user editable field.
- Multi-deck organization (per language pair, or by tag).
- Spaced-repetition history pulled back from Anki to close the loop.
- Practice pre-generation and coverage: pre-generation pipeline (queue 2–3 texts ahead of the user), coverage-guarantee + cleanup pass for chunks the LLM persistently fails to fit naturally, custom FSRS parameters, audio TTS for generated texts, and richer flashcard options such as audio or typed answers. (The browseable "my vocabulary" list shipped as the Vocabulary tab — Delete there is the "remove from practice" affordance.)
- Production-oriented active drills. Partially shipped: the Strengthen surface now delivers typed production cloze, MC cloze/comprehension, and LLM-graded use-in-a-sentence — but only for leech-rehab gates and post-session again/hard bonus terms (see "Strengthen exercises + leech rehab" in `SPEC.md`). A future version generalizes those exercise formats into the main active-drill loop (prompted recall, dictation/typing as a first-class drill mode) so the active label cashes out as a different exercise rather than the same exercise over a different pool. Also plausible: a Strengthen CTA on the reading-mode completion screen (currently flashcards-only) and tunable leech thresholds.
