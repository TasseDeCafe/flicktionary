---
name: update-docs
description: Update SPEC.md and RESUME.md to reflect the work that just shipped in this conversation. Run this when the user is satisfied with the changes.
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Read, Edit
---

You are updating two top-level docs to reflect changes that just shipped:

- `SPEC.md` — the canonical product spec. Edit only when product behavior, data model, user flows, navigation chrome, settings, or LLM methodology actually changed. Pure refactors, bug fixes, dependency bumps, or internal-only changes do NOT belong here. Update the relevant fact **in place** — SPEC.md is not a changelog, never add dated entries to it. If nothing in the diff is spec-worthy, leave it untouched and say so.
- `RESUME.md` — the running build-status doc. Append to or extend the most recent dated subsection under "Status of the build (as of last session)" to reflect what just shipped. Match the existing voice: dense bullets, concrete file paths, "don't re-introduce …" callouts when a prior approach was replaced, and today's date on any new dated subheading. Today's date is in the system context.

Process:

1. Inspect what concretely changed: `git status`, then `git diff HEAD` for uncommitted work; if the tree is clean, use `git log --oneline -20` and `git diff main...HEAD` to see what's on the branch.
2. Read `SPEC.md` and `RESUME.md` in full before editing.
3. Decide per file whether an edit is warranted. Skip SPEC.md entirely when the changes are not spec-relevant — do not invent edits to look thorough.
4. Use `Edit` with surgical replacements. Don't rewrite whole sections when a few lines change. Don't reflow paragraphs you aren't actually changing.
5. End with a one-sentence summary per file (e.g. "SPEC.md: updated processing pipeline section to mention the pre-filter. RESUME.md: appended bullet under 2026-05-08 covering the chunk-keep fix.").

Tone for any prose you write into either file: terse, factual, file-path-anchored. Match the surrounding voice. No emojis. No marketing language. No "we now…" — the docs describe the system, not the journey.
