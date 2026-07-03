# Session recap v2 — better questions, still zero-LLM

> **Status: proposal — not implemented.** Follow-up to the shipped v1 session
> recap (the client-side quiz behind the session-vocabulary footer's "Quiz your
> terms" button). Everything here stays inside v1's boundaries: zero LLM calls,
> zero FSRS writes, questions built client-side. `SPEC.md` describes what ships
> today. Ideas that break those boundaries live in
> `session-recap-v3.md`.

## v1 recap (what exists)

The recap builds a local queue from the session's kept cards
(`apps/web/src/features/practice/utils/build-recap-questions.ts`, rendered by
`session-recap-view.tsx` + `recap-mc-exercise.tsx` / `recap-typed-exercise.tsx`):
MC meaning questions (own example with the term highlighted → pick the gloss,
distractors sampled from the session's other terms) alternating with typed
recall (gloss → type the term, graded by the shared
`@flicktionary/core/utils/typed-answer-grading` helpers). Misses and skips
redrill once at the end in the other form. No SRS writes anywhere.

## Known v1 weaknesses this addresses

- **Small sessions degrade.** MC needs ≥2 usable distractor glosses from the
  same session; below that it silently falls back to typed-only, and 2
  distractors produce a 3-option MC. A 3-term session is mostly typing.
- **One recall direction.** Both forms test gloss↔term in isolation; there is
  no "given the meaning, recognize the term among others" step between the
  easy MC and the hard typed recall.
- **No round-trip.** The completion screen is terminal; re-quizzing means
  navigating out and back.

## Proposed changes

### 1. Cross-session distractor pool

When the session's own terms can't fill an MC's 3 distractor slots (after the
normalized-gloss dedupe and same-POS preference in `tryBuildMc`), top up from
the user's **whole vocabulary in that language** instead of degrading.

- Data: one extra read of `(gloss-source fields, grammar.pos)` for the user's
  non-deleted kept terms in the language. Candidates: reuse the Vocabulary
  tab's `chunks.listChunks` cache when warm, else a slim query. The builder
  stays pure — the view resolves glosses (same `useTermMeaning` rules) and
  passes a second `poolTerms: RecapTerm[]` argument.
- Sampling rules unchanged (normalized-dedupe, never the correct gloss,
  same-POS only when it fills all slots), session terms preferred before pool
  terms so the quiz still feels session-scoped.
- Result: every MC is a 4-option question even in a 2-term session; the
  typed-only fallback remains solely for users with a tiny total vocabulary.

### 2. Reverse MC (production-direction recognition)

New question kind `mc_term`: show the gloss → pick the correct **term** among
4 headwords. The inverse of the existing MC with the same determinism-safety
property: options are terms (not target-language sentences), POS-matched, so
grammar can't disqualify distractors.

- Builder: `tryBuildReverseMc` mirroring `tryBuildMc` but sampling headwords;
  distractor headwords deduped by `normalizeTypedAnswer` and never one whose
  gloss matches the prompt gloss.
- Placement: slot it into the kind rotation (e.g. mc → reverse-mc → typed by
  index modulo 3), and use it as the redrill form for a missed typed question
  — a gentler retry than typing the same word again, and a step up from the
  meaning MC.
- Component: `recap-reverse-mc-exercise.tsx`, a thin variant of
  `recap-mc-exercise.tsx` (prompt = gloss, options = headwords).

### 3. Completion + interaction polish

- **Quiz again** on the completion screen: rebuild the queue from the same
  terms (fresh shuffle/distractors — the builder is already rng-injectable)
  without leaving the route.
- **Keyboard shortcuts**: `1`–`4` select MC options, `Enter` advances from an
  answered state (typed already submits on Enter). Mirror the focus view's
  key-handling pattern.
- **Typed hint**: opt-in `Hint` button on typed questions revealing the first
  letter + length (`п _ _ _ _ _ _`), styled like the practice exercises' Hint
  (lightbulb, `variant='outline'`). Free — the recap has no gates to protect.

## Non-goals (v2)

Matching-pairs grid, round structure for large sessions, any SRS/backend
coupling (completion records, miss-ordered warm-up), and non-session entry
points — all deferred to `session-recap-v3.md`.

## Open questions

- Cross-session pool freshness: is a stale Vocabulary cache acceptable for
  distractors (probably yes — they're wrong answers), or should the recap
  always fetch?
- Kind rotation weights: equal thirds, or bias toward MC forms for large
  sessions (typing 40 words is a chore)?
- Should reverse MC show the term's example after answering (nice reinforcement,
  slightly busier feedback area)?
