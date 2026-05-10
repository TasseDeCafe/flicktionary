---
name: commit
description: Commit the changes from this session using the project's conventional-commit style. Run this when the user is satisfied with the work and wants it committed.
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*)
---

You are creating a single commit for the work that just shipped in this conversation. Match the project's commit style exactly — single-line subject, conventional-commit prefix, comma-separated scopes, no body, no `Co-Authored-By` trailer.

Format: `<type>(<scopes>): <description>`

- **type**: `feat` (new feature), `fix` (bug fix), `chore` (tooling/config/deps), `style` (formatting only), `refactor` (no behavior change), `docs` (docs only). Pick the one that best describes the *primary* change — don't chain multiple types.
- **scopes**: comma-separated list of the top-level areas that changed, in this order if multiple apply: `web,backend,native,root,packages`. Mapping:
  - `apps/web/**` → `web`
  - `apps/backend/**` → `backend`
  - `apps/native/**` → `native`
  - `packages/**` → `packages`
  - top-level files (`SPEC.md`, `RESUME.md`, `package.json`, `pnpm-lock.yaml`, `turbo.json`, `scripts/**`, `.github/**`, etc.) → `root`
- **description**: short, lowercase-leading, imperative mood, no trailing period. Focus on the *what* — concise like `add pre-filter for chunk processing` or `handle vocabulary edits for removed source sessions`. If a single sentence can't capture it, the commit is probably doing too much; flag that to the user instead of writing a vague message.

Process:

1. Run in parallel:
   - `git status` to see all untracked/modified files (never use `-uall`).
   - `git diff HEAD` to see the actual changes.
   - `git log --oneline -10` to confirm the prevailing message style.
2. Decide the type and scopes from the file paths and diff content. If the change spans multiple unrelated concerns, ask the user whether to split into multiple commits before staging anything.
3. Refuse to stage files that look like secrets (`.env`, `*credentials*`, key files) unless the user explicitly asked. Warn and stop.
4. Draft the commit message. Show it to the user only if you are uncertain about type/scope; otherwise proceed.
5. Stage the relevant files by name (avoid `git add -A` / `git add .` so untracked junk doesn't sneak in) and create the commit. Pass the message via `-m` directly — single line, no HEREDOC needed since there's no body.
6. Run `git status` after the commit and report the resulting commit hash + subject in one line.

Do not:

- Add a `Co-Authored-By` trailer or any other footer — the project's history doesn't use them.
- Amend a previous commit. Always create a new one.
- Push to the remote. The user will push themselves.
- Use `--no-verify` or skip hooks. If a hook fails, fix the underlying issue and create a new commit.
