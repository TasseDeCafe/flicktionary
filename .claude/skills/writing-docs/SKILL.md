---
name: writing-docs
description: Conventions for creating, labeling, locating, and retiring Markdown docs in this repo — the status-banner scheme, where each kind of doc lives, and how to archive a doc when it goes stale. Use whenever you create a new .md doc, move one, or decide a doc is out of date.
---

This repo keeps documentation trustworthy by making every doc's **status and scope** explicit, so a reader (especially a weaker model starting a fresh thread) never has to guess whether a doc reflects current behavior. Follow these rules whenever you add, move, or retire a Markdown doc. The canonical index of existing docs is the **Project docs map** in `AGENTS.md` — keep it in sync with anything you do here.

## Every doc gets a status banner

Immediately after the H1, add a one-line blockquote banner naming the doc's status and scope:

```markdown
# Title

> **Status: <status>.** <one line: what this doc is authoritative for, or why it's kept.>
```

The status vocabulary (use exactly these words so they stay greppable):

- **authoritative-spec** — tracks the code; the source of truth for its area. Edited in place (never a changelog). The set: `SPEC.md` (overview), `docs/READER-SPEC.md`, `docs/REVIEW-SPEC.md`, `docs/SRS.md`, `docs/DATA-MODEL.md`, `apps/extension/EXTENSION-SPEC.md`, `AGENTS.md`.
- **reference** — authoritative for its subject but **not** code-driven (vendored docs, publish copy, scoped READMEs, retained historical designs). Don't edit it to "keep current"; touch only when its subject changes.
- **proposal** — an open design not yet implemented. Lives in `docs/proposals/`. Never current behavior.
- **scratch** — generation prompts / working notes, not a spec. Lives in `docs/brand/` (or alongside what it generates). Ignore when reasoning about behavior.
- **historical** — archived, no longer maintained. Lives in `old-docs/`. Kept for history; never a current-state reference, never updated.

## Where docs live

- **Behavior specs** → repo root (`SPEC.md`, `AGENTS.md`) or `docs/` (`READER-SPEC.md`, `REVIEW-SPEC.md`, `SRS.md`, `DATA-MODEL.md`). Don't add new top-level `.md` files at the root casually — root is reserved for the few highest-traffic docs.
- **Reference docs** → `docs/` or next to the code they describe (`**/README.md`).
- **Proposals** → `docs/proposals/`.
- **Scratch / brand** → `docs/brand/`.
- **Archive** → `old-docs/`.

When unsure between `docs/` and a co-located README: if it describes one folder's mechanics, co-locate a README; if it's cross-cutting, put it in `docs/`.

## Creating a new doc

1. Pick the status and the location from the tables above.
2. Add the H1 + status banner.
3. Write in the house voice: terse, factual, file-path-anchored. No emojis, no marketing, no "we now…" — describe the system, not the journey.
4. If it's an authoritative-spec or a reference doc worth discovering, add a one-line entry to the **Project docs map** in `AGENTS.md`.

## Retiring a doc that's gone stale

Don't delete — archive, so the history and any "don't re-introduce X" context survives:

1. `git mv <doc> old-docs/<doc>`.
2. Change its status banner to **historical**, dated (`archived YYYY-MM-DD`), with a one-line reason and a pointer to the doc that supersedes it.
3. Remove its line from the Project docs map in `AGENTS.md`.
4. Grep the repo for references to its old path (`grep -rn <name>`) and fix or note any that now dangle.

A superseded **proposal** that shipped also moves to `old-docs/` (mark it historical, note the PRs that implemented it).
