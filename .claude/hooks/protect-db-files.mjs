#!/usr/bin/env node
// PreToolUse guard for Edit/Write. Enforces two AGENTS.md rules deterministically:
// 1. Generated DB type files are never hand-edited (regenerate via the gen-types script).
// 2. Migrations are append-only: an already-tracked migration can't be edited, and new
//    migration files must be created by `supabase migration new` (which leaves them
//    untracked on disk), not written directly.
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()

const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  )
  process.exit(0)
}

let input = ''
for await (const chunk of process.stdin) input += chunk
const filePath = JSON.parse(input || '{}').tool_input?.file_path
if (!filePath) process.exit(0)

const absolute = resolve(projectDir, filePath)

if (/^database\.(public|auth)\.types\.ts$/.test(basename(absolute))) {
  deny(
    'This file is generated — never hand-edit it. Regenerate with: pnpm --filter @flicktionary/backend db:dev:tunnel:gen-types (dev-tunnel stack must be running). See the db-migrations skill.'
  )
}

// Resolve symlinks so the four env folders' supabase/migrations symlinks are
// caught too; for a not-yet-existing file, resolve its parent directory.
const real = existsSync(absolute)
  ? realpathSync(absolute)
  : existsSync(dirname(absolute))
    ? resolve(realpathSync(dirname(absolute)), basename(absolute))
    : absolute

const migrationsDir = resolve(projectDir, 'apps/backend/supabase/migrations')
if (real === migrationsDir || real.startsWith(migrationsDir + sep)) {
  if (!existsSync(real)) {
    deny(
      'Never create migration files directly. From apps/backend/supabase/supabase-dev-tunnel/, run `supabase migration new <name>` (correct timestamp prefix, lands in the canonical dir), then edit the file it created. See the db-migrations skill.'
    )
  }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', real], {
      cwd: projectDir,
      stdio: 'ignore',
    })
    deny(
      'Migrations are append-only: this migration is already tracked in git and must not be edited. Create a new migration with `supabase migration new <name>` from apps/backend/supabase/supabase-dev-tunnel/ instead. See the db-migrations skill.'
    )
  } catch {
    // untracked file inside the migrations dir = the one just created by
    // `supabase migration new` — editing it is the normal workflow
  }
}
