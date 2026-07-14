---
name: release-extension
description: Cuts a browser-extension release given a target version. Drives the two-phase flow — bumps apps/extension/package.json + opens a PR when the version isn't on main yet, then (once merged) tags main and pushes so the release workflow publishes to the Chrome Web Store and Firefox Add-ons (AMO). Run when the user says "release the extension X.Y.Z" / "cut extension vX.Y.Z" / "publish the extension".
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git fetch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git tag:*), Bash(git rev-parse:*), Bash(git show:*), Bash(git ls-remote:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh run list:*), Bash(gh run watch:*), Bash(gh run view:*), Bash(node:*), Read, Edit
---

You are cutting a release of the browser extension (`apps/extension`). The release is tag-driven: pushing a `vX.Y.Z` tag fires `.github/workflows/release-extension.yaml`, which builds the zips, creates a GitHub Release, and **submits to both the Chrome Web Store and Firefox Add-ons (AMO)**. Each store step skips itself with a notice if its credentials aren't configured, so a missing AMO key never blocks the Chrome submission (or vice versa). The tag (minus `v`) must equal `apps/extension/package.json`'s `version` on the tagged commit, or the workflow's verify step fails.

`apps/extension/RELEASING.md` is the companion reference (one-time OAuth/secret setup, the secrets table, troubleshooting). This skill does **not** duplicate it — link to it when a setup/credential problem comes up.

## Inputs

The target version `X.Y.Z` (no leading `v`). If the user didn't give one, ask. Validate it is plain semver (`^[0-9]+\.[0-9]+\.[0-9]+$`) before doing anything.

## Step 1 — Detect state

Run in parallel, then reason about where things stand:

- `git status --short` (working tree must be clean — if dirty, stop and tell the user)
- `git fetch origin main --tags`
- Current version on main: `git show origin/main:apps/extension/package.json` → parse `.version` with `node -p`
- Does the tag exist? `git ls-remote --tags origin "refs/tags/v<X.Y.Z>"` (and `git tag -l v<X.Y.Z>` locally)

Decide:

- **Tag `vX.Y.Z` already exists on the remote** → the release was already cut. Don't re-tag silently. Report it, and offer either to **watch the latest run** (Step 4) or, if that run *failed* and the user wants to retry, the **re-cut path** (Step 5). Do not proceed past here without the user picking one.
- **main's version ≠ X.Y.Z** → **State A** (Step 2): the bump isn't on main yet.
- **main's version = X.Y.Z and no tag yet** → **State B** (Step 3): ready to tag.

Also sanity-check ordering: `X.Y.Z` must be **strictly greater** than the version currently on main (Chrome requires strictly increasing versions). If it's equal-but-no-tag that's State B; if it's *lower*, stop and flag it — the user probably mistyped.

## Step 2 — State A: bump + PR (then stop)

The version bump can't go straight to `main` (branch protection + the user's own review gate), so it ships as a PR.

1. First check whether a bump is already in flight: `gh pr list --base main --state open` — if an open PR already bumps the version to X.Y.Z (or a feature PR does), say so and stop rather than opening a duplicate. The user just needs to merge it, then re-run this skill.
2. From an up-to-date `main`, create a branch `chore/release-extension-v<X.Y.Z>`.
3. `Edit` `apps/extension/package.json` `version` → `X.Y.Z` (that one line only).
4. Commit following the repo's `commit` conventions: `chore(extension): bump extension version to X.Y.Z` (single-line subject, no body, no Co-Authored-By).
5. `git push -u origin <branch>` (the pre-push hook runs the full suite — expected; let it). If it fails on a transient network/SSL error, retry once.
6. Open the PR: `gh pr create --base main --title "chore(extension): bump extension version to X.Y.Z"` with a short body explaining that merging unlocks the release tag, ending with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line.
7. **Stop.** Report the PR URL and tell the user: review + merge it (your own checks run there), then re-invoke this skill with the same version to tag and publish. Do **not** merge for them.

## Step 3 — State B: tag + push (gated)

The bump is on `main`. Now publish.

1. Be on `main`, up to date: `git checkout main`, confirm `git rev-parse HEAD` == `git rev-parse origin/main` (pull if behind), working tree clean.
2. Re-verify `apps/extension/package.json` on the checked-out `main` reads `X.Y.Z` — never tag a commit whose version doesn't match.
3. Capture the commit being tagged: `git rev-parse --short HEAD`.
4. **Confirm before the irreversible action.** Tell the user plainly: this tags `vX.Y.Z` on `<short-sha>` and pushes it, which triggers **live submissions to both the Chrome Web Store and Firefox Add-ons (AMO)** (each auto-publishes when its review passes). Also remind: don't cut a new tag while a previous CWS submission is still in review (the API returns `ITEM_NOT_UPDATABLE`). **Wait for an explicit yes.** Never push the tag without it.
5. `git tag v<X.Y.Z>` then `git push origin v<X.Y.Z> --no-verify`.
   - `--no-verify` is intentional and safe: a tag push carries no new code, but the pre-push hook would still run the entire lint/typecheck/test/build suite (minutes) for nothing, and the workflow re-runs all checks anyway. (The hook now *allows* tag pushes; `--no-verify` is purely to skip the redundant local run.)
6. Go to Step 4.

## Step 4 — Watch the run and report

1. `gh run watch $(gh run list --workflow=release-extension.yaml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status` (give the run a moment to register first; re-list if it doesn't appear).
2. On success: report that both the Chrome and Firefox/AMO submissions went through (review is asynchronous — "submitted", not yet "live"; and either store step may have skipped with a notice if its credentials aren't set — check the step logs) and link the run + the GitHub Release.
3. On failure: name the failing step and surface the relevant log lines. The two store submissions are independent steps, so one can fail or skip while the other succeeds. Map common causes to `RELEASING.md` → Troubleshooting:
   - `invalid_grant` (Chrome) → refresh token died (consent screen in Testing mode, revoked token, deleted client).
   - `ITEM_NOT_UPDATABLE` (Chrome) → a prior submission is still in review; re-run the failed job later, no re-tag needed.
   - AMO step fails or skips → `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` missing or invalid, or the add-on id in the manifest's `browser_specific_settings.gecko.id` doesn't match the AMO listing; reviewer notes come from `amo-metadata.json`.
   - `Cannot find module .../messages.ts` → i18n catalogs weren't compiled (should be fixed by the workflow's compile step; if it regressed, that's the cause).
   - version-match failure → the tag and `package.json` on the tagged commit disagree (wrong commit tagged).

## Step 5 — Re-cut path (a prior tag's run failed)

Only with explicit user go-ahead, and only when the existing tag's run failed *before* publishing (the workflow creates the GitHub Release **after** typecheck/build, so an early failure means nothing was published — verify there's no Release for the tag first). Move the tag to the current `main` HEAD:

```
git tag -d v<X.Y.Z>
git push origin :refs/tags/v<X.Y.Z> --no-verify   # delete remote tag — does NOT re-trigger the workflow
git checkout main && git pull
git tag v<X.Y.Z>
git push origin v<X.Y.Z> --no-verify              # re-triggers the workflow
```

Confirm before the recreate-and-push (same live-submission gate as Step 3), then watch the run (Step 4). If a GitHub Release for the tag already exists, stop — re-cutting would need a fresh patch version instead, not a tag move.

## Notes

- Never merge a PR. Never push a tag without explicit confirmation in the same conversation.
- Refuse to stage anything that looks like a secret; stage files by name.
- If `gh` isn't authenticated or there's no remote, stop and tell the user.
- Transient `SSL_ERROR_SYSCALL` on push is a known network blip (Cloudflare blackhole) — retry, and suggest a VPN if it persists.
