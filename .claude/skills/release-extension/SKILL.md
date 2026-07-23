---
name: release-extension
description: Cuts a browser-extension release given a target version. Thin wrapper around the interactive `pnpm release:extension` script, which drives the two-phase flow — bump PR when the version isn't on main yet, then (once merged) tag + push so the release workflow publishes to the Chrome Web Store and Firefox Add-ons (AMO). Run when the user says "release the extension X.Y.Z" / "cut extension vX.Y.Z" / "publish the extension".
disable-model-invocation: true
allowed-tools: Bash(node scripts/release-extension.mjs:*), Bash(pnpm release:extension:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh run list:*), Bash(gh run watch:*), Bash(gh run view:*), Read
---

You are cutting a release of the browser extension (`apps/extension`). All the mechanics live in `scripts/release-extension.mjs` — run it, don't re-implement it:

```bash
node scripts/release-extension.mjs <X.Y.Z>
```

The script detects the state itself and does the right thing:

- **Bump not on main yet** → creates `chore/release-extension-vX.Y.Z`, bumps `apps/extension/package.json`, pushes (full pre-push suite runs — expect minutes), opens the PR, and stops. Relay the PR URL; the user reviews + merges, then re-invokes this skill with the same version. **Never merge the PR for them.**
- **Bump on main, no tag** → tags and pushes, which triggers **live submissions to both the Chrome Web Store and Firefox Add-ons (AMO)**, then watches the run.
- **Tag already exists** → reports the state and exits; re-run with `--watch` (watch the latest run) or `--recut` (move a tag whose run failed before anything was published — the script refuses if a GitHub Release exists).

## The confirmation gate

The tag push (and a re-cut) is irreversible and triggers live store submissions. When the script runs without a TTY (i.e. when you run it), it **refuses to tag unless `--confirm` is passed**. The contract:

1. Run the script *without* `--confirm` first. If it stops asking for confirmation, relay its warning to the user verbatim — including the reminder not to cut while a previous CWS submission is still in review (`ITEM_NOT_UPDATABLE`).
2. Only after an explicit yes **in this conversation**, re-run the same command with `--confirm`. Never pass `--confirm` on the first attempt, and never infer consent from an earlier release.

## When the run fails

The script scans the failed logs for known signatures (`invalid_grant`, `ITEM_NOT_UPDATABLE`, version mismatch, missing i18n catalogs, AMO step failure) and prints the matching hint. The two store submissions are independent steps — one can fail or skip while the other succeeds. For anything it doesn't recognize, investigate the run logs yourself (`gh run view <id> --log-failed`) and consult `apps/extension/RELEASING.md` → Troubleshooting (also the reference for one-time OAuth/secret setup). On success, remind the user that store review is asynchronous — "submitted", not yet live.

If `gh` isn't authenticated, there's no remote, or the tree is dirty, the script fails fast with the reason — relay it and stop.
