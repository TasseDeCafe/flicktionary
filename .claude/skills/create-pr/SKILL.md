---
name: create-pr
description: Ship the work from this conversation as a pull request — create a branch, make one or more conventional commits, sync the behavior specs, push with gh, and open a PR with a detailed description. Stops before merge. Run this when the user is satisfied with the work and wants it turned into a PR.
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh repo view:*), Read, Edit
---

You are turning the work that just shipped in this conversation into a GitHub pull request. The end state is an open PR on a feature branch, pushed to the remote, with a clear description — **never a merge**. Do not merge unless the user explicitly tells you to in a later message (they run their own checks first).

## Process

1. **Survey the work.** In parallel: `git status`, `git diff HEAD`, `git log --oneline -10` (to match the prevailing commit style), and `git branch --show-current`.

2. **Branch.** If the current branch is `main`, create a feature branch before committing — never commit straight to `main`. Name it `<type>/<short-kebab-desc>` matching the primary change (e.g. `feat/right-click-toggle`, `fix/gloss-cache-auth`, `docs/doc-map`). If already on a feature branch, stay on it.

3. **Sync the behavior specs.** Before committing, follow the `update-docs` skill to update `SPEC.md` / `apps/extension/EXTENSION-SPEC.md` / `docs/SRS.md` for any behavior or structure the diff changed (in place — not changelogs). Skip specs whose area the diff doesn't touch; if nothing is spec-worthy, note that. This step is the green light to edit those specs. Do **not** touch reference/artifact docs or anything in `old-docs/` / `docs/proposals/`.

4. **Commit.** Follow the `commit` skill's conventions exactly — `<type>(<scopes>): <description>`, single-line subject, comma-separated scopes in order `web,backend,native,root,packages`, imperative lowercase description, **no body, no `Co-Authored-By` trailer**. Prefer **several focused commits** over one giant commit when the work splits into logical units (e.g. one commit for the feature, one for the spec/doc update, one for a refactor). Stage files by name (never `git add -A`); refuse to stage anything that looks like a secret. Don't use `--no-verify` — if the pre-push/pre-commit hooks fail, fix the cause and recommit. (The lingui husky hook may re-extract/translate and auto-commit catalogs — expect that.)

5. **Push.** `git push -u origin <branch>`.

6. **Open the PR** with `gh pr create --base main`. Write the title in the same conventional-commit form as the commits' primary change. Body structure (match the house style — see any recent merged PR):
   - A one-sentence summary of what the PR accomplishes.
   - Sections grouped by area (`## Web`, `## Extension`, `## Backend`, etc.) with **bold lead-ins** on each bullet describing the concrete change and the why.
   - A line noting which specs/docs were updated (e.g. "EXTENSION-SPEC.md updated alongside; lingui catalogs re-extracted").
   - A `## Tests` section: what you ran (`check:types`, `pnpm lint`, `test:run` counts) and what remains manual (Firefox smoke, golden paths) — be honest about what's verified vs pending.
   - End the body with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
   Pass the body via a HEREDOC or `--body-file` so multi-line markdown is preserved.

7. **Report** the PR URL and stop. Do not merge. If the user later says to merge, confirm CI/checks first.

## Notes

- If the diff spans multiple unrelated concerns, say so and suggest splitting into more than one PR rather than bundling — don't silently cram everything into one.
- If `gh` isn't authenticated or there's no remote, stop and tell the user rather than guessing.
- Contract edits: if the diff touched an oRPC contract, rebuild `@flicktionary/api-client` before relying on a clean typecheck (see AGENTS.md).
