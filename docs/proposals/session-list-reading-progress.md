# Session-list reading-progress bar

> **Status: proposal.** Not implemented — a session-card enhancement parked while the reader's mark-known sweep system ships.

## Idea

Show how far through a text/track the user is on each card in the sessions list: a
thin position bar (Netflix continue-watching style) driven by
`furthest_read_segment_index / <track segment count>`.

## What it needs

- The session-list DTO doesn't carry the inputs today. Add
  `furthestReadSegmentIndex` and the track's segment count (or a precomputed
  `readingProgressPercent`) to the list query in the study-sessions repository +
  router mapper + contract.
- A bar on the session card, likely under the meta line.

## Design constraint

Keep it visually distinct from the reader's in-session coverage meter (solid
known-coverage + striped read-but-unclaimed tail). The card bar measures
*position through the text*, not vocabulary coverage — a shared visual language
would invite misreading ~40%-through as ~40%-coverage. Use a plain neutral
solid fill, no stripes, no coverage colors.

## Open questions

- Hide at 0% and/or 100%, or always show?
- Text sources vs. video sources: same treatment?
