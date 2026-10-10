#!/usr/bin/env node
// Interactive release driver for the browser extension (apps/extension).
//
// The release is tag-driven and the tag IS the version: pushing vX.Y.Z fires
// .github/workflows/release-extension.yaml, which stamps X.Y.Z into the
// extension's package.json for that build, creates a GitHub Release, and
// submits to both the Chrome Web Store and Firefox Add-ons (AMO). Nothing is
// committed to cut a release — the committed "version" is a 0.0.0 placeholder —
// so this script only validates the version against the tags already
// published, tags origin/main HEAD, and watches the run.
// Setup/credential problems are documented in apps/extension/RELEASING.md.
//
// Usage (from anywhere in the repo, any branch — needs `gh` auth):
//   pnpm release:extension X.Y.Z             # interactive: prompts before the tag push
//   pnpm release:extension X.Y.Z --watch     # just watch the latest run for the existing vX.Y.Z tag
//   pnpm release:extension X.Y.Z --recut     # move an existing tag whose run failed before releasing
//   pnpm release:extension X.Y.Z --confirm   # non-interactive stand-in for the "yes" prompt (agents:
//                                            # only after an explicit yes from the user — the tag push
//                                            # triggers LIVE store submissions)

import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const WORKFLOW = 'release-extension.yaml'

const fail = (message) => {
  console.error(`\nerror: ${message}`)
  process.exit(1)
}

const run = (cmd, args, { allowFailure = false } = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8' })
  if (result.error) fail(`failed to run ${cmd} — is it installed? (${result.error.message})`)
  if (result.status !== 0 && !allowFailure) {
    fail(`${cmd} ${args.join(' ')}\n${(result.stderr || result.stdout || '').trim()}`)
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// Long-running commands whose live output the user should see (git push, gh run watch).
const runVisible = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1

const interactive = process.stdin.isTTY && process.stdout.isTTY

const ask = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(question)).trim().toLowerCase()
  rl.close()
  return answer
}

// Irreversible actions gate on a typed "yes" (or --confirm when there is no TTY,
// which an agent may only pass after relaying the warning and getting a real yes).
const confirmed = async (message) => {
  console.log(`\n${message}`)
  if (flags.has('--confirm')) return true
  if (!interactive) {
    fail('no TTY to confirm on — re-run with --confirm once the user has explicitly agreed')
  }
  return (await ask('Type "yes" to proceed: ')) === 'yes'
}

const compareSemver = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

// Transient SSL_ERROR_SYSCALL on push is a known network blip (Cloudflare blackhole) — retry once.
const pushWithRetry = (args) => {
  if (runVisible('git', ['push', ...args]) === 0) return
  console.log('\nPush failed — retrying once (transient SSL/network blips are a known issue)…')
  if (runVisible('git', ['push', ...args]) === 0) return
  fail('push failed twice — if the error is SSL/network-related, try a VPN and re-run')
}

const findLatestRun = () => {
  const list = JSON.parse(
    run('gh', [
      'run',
      'list',
      '--workflow',
      WORKFLOW,
      '--limit',
      '10',
      '--json',
      'databaseId,headBranch,status,conclusion,url',
    ]).stdout
  )
  return list.find((r) => r.headBranch === tag) ?? null
}

// Signatures worth matching mechanically; anything else points at RELEASING.md → Troubleshooting.
const KNOWN_FAILURES = [
  [
    'invalid_grant',
    'The Chrome refresh token died (consent screen in Testing mode, revoked token, or deleted OAuth client). Redo the OAuth steps in RELEASING.md.',
  ],
  [
    'ITEM_NOT_UPDATABLE',
    `A previous Chrome Web Store submission is still in review. Wait for it to resolve, then re-run the failed job (gh run rerun <id> --failed) — no re-tag needed.`,
  ],
  [
    'messages.ts',
    "i18n catalogs weren't compiled — the workflow's own compile step should prevent this; if it fired, that step regressed.",
  ],
  [
    'Submit to Firefox Add-ons',
    'The AMO step failed — check AMO_JWT_ISSUER / AMO_JWT_SECRET, and that the manifest gecko id matches the AMO listing (reviewer notes come from amo-metadata.json).',
  ],
]

const watchRun = async () => {
  console.log('\nWaiting for the release run to register…')
  let found = null
  for (let attempt = 0; attempt < 12 && !found; attempt++) {
    found = findLatestRun()
    if (!found) await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (!found) fail(`no ${WORKFLOW} run found for ${tag} — check the Actions tab`)
  console.log(`Watching ${found.url}\n`)
  const status = runVisible('gh', ['run', 'watch', String(found.databaseId), '--exit-status'])
  if (status === 0) {
    console.log(
      `\n✅ ${tag} released. Store submissions are asynchronous reviews — "submitted", not yet live — and either\n` +
        'store step may have skipped with a notice if its credentials are unset (check the step logs).\n' +
        `Release: https://github.com/${repo}/releases/tag/${tag}`
    )
    return
  }
  console.log('\n❌ The release run failed. Scanning the failed logs for known causes…')
  const logs = run('gh', ['run', 'view', String(found.databaseId), '--log-failed'], { allowFailure: true }).stdout
  const hints = KNOWN_FAILURES.filter(([signature]) => logs.includes(signature))
  for (const [signature, hint] of hints) console.log(`\n• Matched "${signature}":\n  ${hint}`)
  if (hints.length === 0)
    console.log('No known signature matched — read the run logs and RELEASING.md → Troubleshooting.')
  console.log(`\nRun: ${found.url}`)
  console.log('The two store submissions are independent steps — one can fail while the other succeeded.')
  process.exit(1)
}

// --- Parse arguments -------------------------------------------------------

const [versionArg, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
if (!versionArg || !/^\d+\.\d+\.\d+$/.test(versionArg)) {
  fail('usage: pnpm release:extension X.Y.Z [--watch] [--recut] [--confirm]')
}
const version = versionArg
const tag = `v${version}`

// --- Preflight + state detection -------------------------------------------

run('gh', ['auth', 'status'])
const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner']).stdout).nameWithOwner

console.log('Fetching origin/main and tags…')
run('git', ['fetch', 'origin', 'main'])
// The remote is the source of truth for what was released: a local tag may never have been pushed.
const releasedVersions = run('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'])
  .stdout.split('\n')
  .map((line) => line.match(/refs\/tags\/v(\d+\.\d+\.\d+)$/)?.[1])
  .filter(Boolean)
  .sort(compareSemver)
const latestReleased = releasedVersions.at(-1) ?? null
const tagOnRemote = releasedVersions.includes(version)
const sha = run('git', ['rev-parse', '--short', 'origin/main']).stdout.trim()
console.log(
  `Target ${version} · latest released is ${latestReleased ?? 'none'} · tag ${tag} ${tagOnRemote ? 'EXISTS' : 'not cut yet'}`
)

// Tags origin/main HEAD directly, so the release never depends on (or touches) the local checkout.
const tagAndPush = () => {
  // -f: a stale local tag was either never pushed or just deleted from the remote — recreate it fresh.
  run('git', ['tag', '-f', tag, 'origin/main'])
  // --no-verify skips the pre-push hook: a tag push carries no new code, and the workflow re-runs its own checks.
  pushWithRetry(['origin', tag, '--no-verify'])
}

// --- Tag already exists: watch or re-cut ------------------------------------

if (tagOnRemote) {
  const releaseExists = run('gh', ['release', 'view', tag], { allowFailure: true }).status === 0
  const latestRun = findLatestRun()
  console.log(
    `\nThe ${tag} release was already cut.` +
      `\n  GitHub Release: ${releaseExists ? 'exists' : 'none'}` +
      `\n  Latest run: ${latestRun ? `${latestRun.status} (${latestRun.conclusion || 'running'}) — ${latestRun.url}` : 'none found'}`
  )

  let action = flags.has('--watch') ? 'w' : flags.has('--recut') ? 'r' : null
  if (!action && interactive) action = await ask('\n[w]atch the latest run, [r]e-cut the tag, or [q]uit? ')
  if (action === 'w') {
    await watchRun()
  } else if (action === 'r') {
    // Re-cutting is only safe while nothing was published: the workflow creates
    // the GitHub Release after typecheck/build, so an existing Release means
    // artifacts (and possibly store submissions) are out — cut a fresh patch instead.
    if (releaseExists)
      fail(`a GitHub Release already exists for ${tag} — cut a new patch version instead of moving the tag`)
    if (latestRun && latestRun.conclusion !== 'failure') {
      fail(`the latest run for ${tag} is ${latestRun.status}/${latestRun.conclusion} — only re-cut after a failed run`)
    }
    const ok = await confirmed(
      `Re-cut ${tag}: delete the tag, recreate it on current origin/main HEAD (${sha}), and push — this re-triggers the\n` +
        'release workflow and its LIVE submissions to the Chrome Web Store and Firefox Add-ons (AMO).'
    )
    if (!ok) fail('aborted — nothing was changed')
    // Deleting the remote tag does NOT re-trigger the workflow; only the push in tagAndPush does.
    run('git', ['push', 'origin', `:refs/tags/${tag}`, '--no-verify'])
    tagAndPush()
    await watchRun()
  } else {
    console.log('\nNothing done. Re-run with --watch or --recut (or pick interactively).')
    process.exit(action === 'q' ? 0 : 1)
  }
  process.exit(0)
}

// --- New release: validate, tag origin/main, push (gated) -------------------

if (latestReleased && compareSemver(version, latestReleased) < 0) {
  fail(
    `${version} is LOWER than the ${latestReleased} already released — Chrome requires strictly increasing versions (typo?)`
  )
}

const range = latestReleased ? `v${latestReleased}..origin/main` : 'origin/main'
const commits = run('git', ['log', '--oneline', range, '--', 'apps/extension', 'packages'], { allowFailure: true })
  .stdout.trim()
  .split('\n')
  .filter(Boolean)
if (latestReleased) {
  console.log(`\n${commits.length} commit(s) touching apps/extension or packages since v${latestReleased}:`)
  for (const line of commits.slice(0, 20)) console.log(`  ${line}`)
  if (commits.length > 20) console.log(`  … and ${commits.length - 20} more`)
}

const ok = await confirmed(
  `About to tag ${tag} on origin/main HEAD (${sha}) and push it. This triggers LIVE submissions to both the Chrome\n` +
    'Web Store and Firefox Add-ons (AMO) — each auto-publishes when its review passes. Do NOT proceed if a previous\n' +
    'CWS submission is still in review (the API rejects with ITEM_NOT_UPDATABLE).'
)
if (!ok) fail('aborted — nothing was tagged or pushed')

tagAndPush()
await watchRun()
