# supabase-prod

Unlike the other three env folders, this local stack is never started. The
directory is the repo-side representation of the **hosted** prod project
(`uynwhkflqmryzkenccmd`):

- `supabase/config.toml` — source of truth for the hosted project's
  configuration (auth settings, email templates, API config). Applied with
  `supabase config push`: automatically by the `prod-config-push` GitHub
  workflow when a merge to main touches the config or templates, or manually
  with `pnpm --filter @flicktionary/backend db:prod:config:push`. Read the
  header comment in `config.toml` before editing — `config push` has sharp
  edges (auto-confirm, absent-key defaults, env() literals). Dashboard edits
  to the covered sections are drift and will be reverted on the next push;
  edit the file instead. Secrets are the exception: they are set once in the
  dashboard and never live in the file (empty string = leave untouched).
- `supabase/templates/` — the auth email templates `config.toml` points at.
- `supabase/migrations` — symlink to the canonical `../../migrations` like
  every env folder. Prod migrations are NOT applied from here or by our own
  CI: the Supabase GitHub integration (dashboard → Settings → Integrations,
  working directory `apps/backend`) applies the canonical migrations
  directory when a PR merges to main.

Note that running a production build locally does not use this config — it
connects straight to the remote production instance.
