---
name: dev-worktree
description: Creates a git worktree that's fully set up to run the local dev servers (deps + Doppler auth), or switches the running dev server from one worktree to another. Use this when the user wants an isolated checkout/branch for a feature (e.g. to open in a separate editor window) without disturbing the primary checkout, or asks how to run `pnpm dev:tunnel` from a worktree. NOT for plain branch switching in place.
disable-model-invocation: true
allowed-tools: Read, Bash(git:*), Bash(pnpm:*), Bash(doppler:*), Bash(railway:*), Bash(ls:*)
---

You are creating (or switching to) a git worktree set up for local development. A worktree is a second working directory backed by the same `.git`, on its own branch — ideal for a separate editor window with a clean context. The non-obvious snags this skill handles are **Doppler auth**, **gitignored codegen that doesn't carry into a worktree**, and **single-instance dev**.

## Why the naive approach fails (read before changing anything)

1. **Doppler auth is resolved by absolute path** (`~/.doppler/.doppler.yaml`), independent of the `--project/--config` flags the scripts pass. A fresh worktree path has no scope, so it falls back to a parent token that can't see this repo's projects → `Doppler Error: Could not find requested project '<x>'`.
2. **`DOPPLER_TOKEN` as an env var does NOT fix it for `dev:tunnel`.** Turbo runs in strict env mode and only passes through what's listed in `turbo.json` `globalPassThroughEnv`, so an exported `DOPPLER_TOKEN` is stripped before it reaches the per-package tasks. It also won't reach an editor "Run" configuration.
3. The fix is a **single token-only Doppler scope at the worktree root** — read from disk, so Turbo can't strip it and any launcher (editor button, terminal) works. The scripts' explicit `--project/--config` flags handle selection; the scope only supplies the auth token.

## Creating a dev worktree

Ask the user for a branch/feature name if they didn't give one. Then, from anywhere inside the current repo:

1. **Resolve the primary checkout** (the worktree that owns `.git` — needed to copy the Doppler token from a scope that works):

   ```bash
   PRIMARY="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
   echo "primary checkout: $PRIMARY"
   ```

2. **Create the worktree** on a new branch off `main`, as a sibling directory:

   ```bash
   git worktree add -b <branch> "../$(basename "$PRIMARY")-<name>" main
   cd "../$(basename "$PRIMARY")-<name>"
   ```

3. **Install deps** — each worktree has its own `node_modules` (pnpm hardlinks from the global store, so it's fast):

   ```bash
   pnpm install
   ```

4. **Generate gitignored build artifacts.** `git worktree add` only checks out *tracked* files, so codegen output the primary checkout has lying around from past runs is absent here. The one that breaks `dev:tunnel` first is the Lingui-compiled catalogs `packages/i18n/locales/{en,fr}/messages.ts` (gitignored; only the `.po` sources are tracked) — without them the extension build dies with `Rolldown failed to resolve import "@flicktionary/i18n/locales/en/messages.ts" from apps/extension/src/ui/lingui.ts`. Compile them once:

   ```bash
   pnpm --filter @flicktionary/i18n run lingui:compile
   ```

5. **Give the worktree the Doppler token by path** (run from the worktree root). This copies the token from the primary checkout's scope; no secret is written into the repo:

   ```bash
   doppler configure set token "$(cd "$PRIMARY" && doppler configure get token --plain)" --scope "$(pwd)"
   ```

6. **Verify auth resolves with no env var** before handing back (adjust project/config to this repo's actual values — check the dev scripts if unsure):

   ```bash
   env -u DOPPLER_TOKEN doppler secrets --project <root-project> --config <dev-config> --only-names >/dev/null && echo "doppler OK"
   ```

7. **Link the worktree to the Railway project** (run from the worktree root). The Railway CLI resolves its project context per-directory (walking up parents), and worktrees are *siblings* of the primary checkout, so a fresh worktree inherits nothing — `railway status`/`logs` there would either fail or, worse, resolve to an unrelated project via a stray parent-directory link:

   ```bash
   railway link --project Flicktionary --environment production --workspace "My Projects"
   ```

   Don't pass `--service` — the project has several ([`@flicktionary/backend`, `@flicktionary/web`, `@flicktionary/landing`]); pick one per command with `--service` when needed.

Then tell the user they can open the new folder in a separate editor window and run the dev command there.

## Running / switching the dev server

Only **one** worktree can run the full dev stack at a time when the project uses a single shared tunnel token and fixed ports (this repo: cloudflared token + backend `4002` / web vite `5174`). To switch:

1. In the worktree that's currently running it: `Ctrl-C` (the dev script's signal trap also tears down the tunnel).
2. In the target worktree: `pnpm dev:tunnel`.

Public URLs keep working — the tunnel ingress just points at whichever process now holds the local ports. Shared backing services (e.g. the Dockerized local DB) are shared across worktrees automatically; you do not restart them.

## Cleanup (after the branch is merged)

```bash
git worktree remove ../<worktree-dir>     # add --force if it has build artifacts / untracked files
git branch -d <branch>                     # -d works once merged
```

Use `git worktree remove`, not `rm -rf` (if you do delete manually, run `git worktree prune`). The Doppler scope entry for the deleted path lingers in `~/.doppler/.doppler.yaml`, and the Railway link for it lingers in `~/.railway/config.json` — both harmless (they're keyed to a path that no longer exists), but prune stale ones occasionally.

## Adapting this to another project

The mechanics are general; only the specifics change. When reusing elsewhere, re-derive:
- the project/config names the dev scripts pass to `doppler` (grep the scripts),
- whether the project even uses Doppler (if not, the Doppler steps drop away),
- which gitignored build artifacts the dev/build needs (grep `.gitignore` for generated output, or just run the build once and see what fails to resolve) — step 4 is this repo's instance,
- the deploy platform's per-directory link, if any (step 7 is Railway's; drop it if the project isn't on Railway),
- the "single-instance" constraint — it only applies if the project shares one tunnel token or binds fixed ports. Stateless dev servers can instead run on different ports in parallel.
