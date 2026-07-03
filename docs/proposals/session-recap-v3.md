# Session recap v3 — games, SRS signal, and generalized entry points

> **Status: proposal — not implemented.** Idea storage for the recap's third
> iteration, written before v2 (`session-recap-v2.md`) has shipped or been
> used in anger. Expect this to go stale: which of these matter depends
> heavily on how v2 plays with real sessions. Treat as a parts bin, not a
> plan. `SPEC.md` describes what ships today.

## Premise

v1/v2 keep two hard boundaries: zero LLM and zero SRS/backend writes. v3 is
where those boundaries get selectively relaxed — each idea below names which
boundary it bends and why that might be worth it.

## 1. Matching pairs + rounds (still zero-LLM, new UI surface)

A Quizlet-style match grid: 5 headwords ↔ 5 glosses, tap to pair, pairs clear
on match. The form that makes a 100-term session feel like a game instead of
100 sequential questions.

- Wholly new component (grid layout, pair-selection state, mismatch shake) —
  the reason it has stayed out of v1/v2.
- Natural companion: **round structure**. Chunk big sessions into rounds of
  ~10 terms (one match grid + a few MC/typed from v2's kinds), mini-tally
  between rounds, misses roll into the next round. Replaces the single long
  counter with per-round progress — also sidesteps the growing-total counter
  question entirely.
- Timer/score per grid is optional flavor; skip until asked.

## 2. SRS signal coupling (bends "no backend writes" — carefully)

The recap produces a signal currently thrown away: which terms were missed or
skipped. Two uses that stay well short of FSRS ratings (massed same-day quiz
results must never write `srs_*` state):

- **Miss-ordered warm-up parking.** The composed queue's auto-warm-up parks
  oldest-added-first (`listEligibleNewCitationFacets`). Recap misses could
  bump those terms to the front of that ordering for the language — pure
  prioritization of work that was already going to happen. Mechanism options:
  a tiny endpoint stashing `(userLookupId, missedAt)` rows with a short TTL,
  or client-side storage read at compose time (weaker: per-device only).
- **Completion record.** One row per finished recap
  (`study_session_id, finished_at, correct, total`) enabling "Last recapped ·
  12/15" on the session row / session-vocabulary header, a re-entry nudge,
  and later streak surfaces. Write-only-on-completion keeps it trivial.

Decision gate before building either: evidence that recap misses actually
predict warm-up/flashcard struggle. If they don't, this is coupling for its
own sake — the v1 design deliberately separated these systems.

## 3. Generalized entry points (the builder is already term-set-agnostic)

`buildRecapQuestions` is pure (`RecapTerm[] in, questions out`), so the quiz
can be pointed at any term set. Candidates, each mostly a route + an
eligibility query:

- **Vocabulary-tab selection**: "Quiz these terms" over the current
  sort/filter result (or an explicit multi-select). Biggest scope question:
  language-wide quizzing overlaps conceptually with flashcard practice —
  needs a clear story for when to use which.
- **Show-level recap**: all episodes' terms from the TV show detail screen.
- **Today's saves**: cross-session recap of everything saved today in a
  language — a natural end-of-day ritual.
- Naming falls out of this: if the recap generalizes beyond sessions,
  "Session recap" becomes just "Quiz".

## 4. Smaller ideas (unsorted)

- **Word-bank typed mode on mobile**: assemble the answer from a small tile
  bank instead of typing — Cyrillic/German typing on phones is the main
  friction with the typed form. Tiles = the term's letters (+ decoys) or, for
  multi-word chunks, its words.
- **Browser-TTS listen button** (`speechSynthesis`, zero-cost, quality varies
  by language): hear the term after answering. A pronunciation *question* form
  is out of scope — no grading story without recording.
- **Adaptive kind selection**: within a session, serve the harder kinds
  (typed) for terms the user got right fast, easier kinds (MC) after misses.
  Purely local, no SRS needed.
- **Recap from the reader**: a mid-session "quick check" over the last N
  highlights without leaving the reading view (sheet instead of a route).

## Explicit non-goals

LLM-generated recap questions (the whole point is unbounded coverage at zero
marginal cost — the Strengthen exercise bank already covers the
LLM-verified-quality niche), and FSRS ratings from recap answers (see §2's
boundary).
