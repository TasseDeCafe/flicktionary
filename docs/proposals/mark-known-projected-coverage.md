# Projected coverage on the mark-known preview

> **Status: proposal.** Shelved 2026-07-20 — the reader's sweep surfaces ship with word counts only; revisit if the coverage-delta payoff feels missing.

## Idea

Return a `projectedCoveragePercent` field from
`studySessions.getMarkKnownPreview` (both span and whole-text variants): the
session's expected coverage *after* the previewed sweep would run. Coverage is
token-weighted (Σ P(known) over matched tokens / matched-token count —
docs/READER-SPEC.md), so the client cannot derive the post-sweep value from the
lemma count it already gets; the server computes it where the span is already
being tokenized.

## What it unlocks

- **Delta copy on sweep CTAs** — "Coverage ~70% → ~74%" next to the mark-known
  buttons (dock panel, end card, difficulty sheet), making the payoff visible
  before the press.
- **The coverage meter's striped tail** — the reader's header meter rendering
  read-but-unclaimed progress as a striped segment between current and
  projected coverage (from the Claude Design "Sweep System Combined" concept).
  Without this field the tail could only be faked from lemma counts, which
  disagrees with the token-weighted solid fill after sweeping — worse than no
  tail.

## Sketch

- Extend the preview service to accumulate the token weight of markable lemmas
  during the existing span/whole tokenization pass and recompute the coverage
  sum with those lemmas at P(known)=1.
- Contract: optional `projectedCoveragePercent: number | null` (null while the
  profile is pending/failed, mirroring the current preview statuses).
- Cost: no extra queries — piggybacks on the pass the preview already runs.
