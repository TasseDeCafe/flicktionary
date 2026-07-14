---
name: update-docs
description: Updates the behavior specs (SPEC.md, docs/READER-SPEC.md, docs/REVIEW-SPEC.md, docs/SRS.md, docs/DATA-MODEL.md, EXTENSION-SPEC.md) to reflect the work that just shipped in this conversation. Run this when the user is satisfied with the changes, or as the doc step of the create-pr skill.
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Read, Edit
---

You are syncing the **behavior specs** to changes that just shipped. These docs track the code; keep them honest. They are edited **in place** — none of them is a changelog, so never add dated entries.

Which spec owns what (only edit the ones the diff actually touches):

- `SPEC.md` — the product overview: per-area summaries + pointers, navigation chrome, settings, LLM methodology prompt, user flows. Edit only when overview-level behavior changed; area behavior goes in the area spec, not the summary.
- `docs/READER-SPEC.md` — sources (movie/TV/text/ad-hoc ingestion), the in-session reader (gloss sheet, highlights, ghosts), the enrichment pipeline, tap-to-translate. Edit when reader/source/pipeline behavior changed.
- `docs/REVIEW-SPEC.md` — the session-vocabulary list + focus view (card editing, provenance, study targets, card chat, session recap). Edit when either layer changed.
- `docs/DATA-MODEL.md` — the annotated schema + card content tiers (basic data, grammar bag, exploration extras, export front/back). Edit when the schema or card shape changed.
- `apps/extension/EXTENSION-SPEC.md` — the browser extension: behavior, architecture, fork lineage, removed-subsystem / donor-model policy. Edit when extension behavior or structure changed.
- `docs/SRS.md` — the practice / spaced-repetition system (web): scheduler, queue, study facets, leeches, daily budgets, rating flow. Edit when practice/SRS behavior changed.

What does NOT belong in any of them: pure refactors, bug fixes, dependency bumps, formatting, or internal-only changes with no behavior/structure impact. If the diff isn't spec-worthy, leave the specs untouched and say so.

Do NOT touch the reference/artifact docs here (`docs/DOPPLER_CLI.md`, `apps/extension/CHROME-WEB-STORE-LISTING.md`, `apps/extension/AMO-LISTING.md`, READMEs, `DISABLED.md`) — they aren't code-driven. Do NOT touch anything in `old-docs/` or `docs/proposals/`. (See the Project docs map in `AGENTS.md`.)

Process:

1. Inspect what concretely changed: `git status`, then `git diff HEAD` for uncommitted work; if the tree is clean, use `git log --oneline -20` and `git diff main...HEAD` to see what's on the branch.
2. From the changed paths, decide which spec(s) are even in scope — `apps/extension/**` → EXTENSION-SPEC; practice/SRS backend or `apps/web` practice feature → SRS.md; reader/sources/enrichment → READER-SPEC.md; session-vocab list / focus view → REVIEW-SPEC.md; migrations or card shape → DATA-MODEL.md; overview-level product behavior (nav, settings, flows) → SPEC.md.
3. Read each in-scope spec in full before editing it. Skip any spec whose area the diff doesn't touch — do not invent edits to look thorough.
4. Use `Edit` with surgical replacements. Don't rewrite whole sections when a few lines change. Don't reflow paragraphs you aren't actually changing.
5. End with a one-sentence summary per spec you touched (e.g. "SPEC.md: updated processing-pipeline section to mention the pre-filter. SRS.md: untouched — change was an internal refactor."). Name the specs you deliberately left alone and why.

Tone for any prose you write: terse, factual, file-path-anchored. Match the surrounding voice. No emojis. No marketing language. No "we now…" — the docs describe the system, not the journey.
