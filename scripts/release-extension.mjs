#!/usr/bin/env node
// Interactive release driver for the browser extension (apps/extension).
//
// The release itself is tag-driven: pushing vX.Y.Z fires
// .github/workflows/release-extension.yaml, which builds the zips, creates a
// GitHub Release, and submits to both the Chrome Web Store and Firefox
// Add-ons (AMO). This script automates everything around that tag: detecting
// where the release stands, shipping the version bump as a PR (main is
// branch-protected), tagging once the bump is merged, and watching the run.
// Setup/credential problems are documented in apps/extension/RELEASING.md.
//
// Usage (from the repo root, needs `gh` auth):
//   pnpm release:extension X.Y.Z             # interactive: detects state, prompts before the tag push
//   pnpm release:extension X.Y.Z --watch     # just watch the latest run for the existing vX.Y.Z tag
//   pnpm release:extension X.Y.Z --recut     # move an existing tag whose run failed before releasing
//   pnpm release:extension X.Y.Z --confirm   # non-interactive stand-in for the "yes" prompt (agents:
//                                            # only after an explicit yes from the user — the tag push
//                                            # triggers LIVE store submissions)

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const WORKFLOW = 'release-extension.yaml'
const PKG_PATH = 'apps/extension/package.json'

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

// Long-running commands whose live output the user should see (pre-push hook, gh run watch).
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
    'does not match apps/extension/package.json',
    'The tag and package.json on the tagged commit disagree — the wrong commit was tagged.',
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

const dirty = run('git', ['status', '--porcelain']).stdout.trim()
if (dirty) fail(`working tree is not clean — commit or stash first:\n${dirty}`)

console.log('Fetching origin/main and tags…')
run('git', ['fetch', 'origin', 'main', '--tags'])
const mainVersion = JSON.parse(run('git', ['show', `origin/main:${PKG_PATH}`]).stdout).version
const tagOnRemote = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).stdout.trim() !== ''
console.log(
  `Target ${version} · origin/main is at ${mainVersion} · tag ${tag} ${tagOnRemote ? 'EXISTS' : 'not cut yet'}`
)

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
    // artifacts (and possibly store submissions) are out — bump a fresh patch instead.
    if (releaseExists)
      fail(`a GitHub Release already exists for ${tag} — cut a new patch version instead of moving the tag`)
    if (latestRun && latestRun.conclusion !== 'failure') {
      fail(`the latest run for ${tag} is ${latestRun.status}/${latestRun.conclusion} — only re-cut after a failed run`)
    }
    if (mainVersion !== version)
      fail(`origin/main is at ${mainVersion}, not ${version} — re-cutting would tag the wrong version`)
    const ok = await confirmed(
      `Re-cut ${tag}: delete the tag, recreate it on current origin/main HEAD, and push — this re-triggers the release\n` +
        'workflow and its LIVE submissions to the Chrome Web Store and Firefox Add-ons (AMO).'
    )
    if (!ok) fail('aborted — nothing was changed')
    run('git', ['tag', '-d', tag], { allowFailure: true })
    // Deleting the remote tag does NOT re-trigger the workflow; only the push below does.
    run('git', ['push', 'origin', `:refs/tags/${tag}`, '--no-verify'])
    run('git', ['checkout', 'main'])
    run('git', ['pull', '--ff-only'])
    run('git', ['tag', tag])
    pushWithRetry(['origin', tag, '--no-verify'])
    await watchRun()
  } else {
    console.log('\nNothing done. Re-run with --watch or --recut (or pick interactively).')
    process.exit(action === 'q' ? 0 : 1)
  }
  process.exit(0)
}

// --- Sanity: the target must be strictly greater than main -------------------

const order = compareSemver(version, mainVersion)
if (order < 0) {
  fail(
    `${version} is LOWER than the ${mainVersion} already on main — Chrome requires strictly increasing versions (typo?)`
  )
}

// --- State A: the bump isn't on main yet → ship it as a PR, then stop --------

if (order > 0) {
  const openPrs = JSON.parse(
    run('gh', ['pr', 'list', '--base', 'main', '--state', 'open', '--json', 'number,title,headRefName,url']).stdout
  )
  const existing = openPrs.find((pr) => pr.title.includes(version) || pr.headRefName.includes(version))
  if (existing) {
    fail(
      `an open PR already carries ${version}: #${existing.number} — ${existing.url}\nMerge it, then re-run this script.`
    )
  }

  const branch = `chore/release-extension-${tag}`
  console.log(`\nVersion bump not on main yet — opening a PR from ${branch}.`)
  run('git', ['checkout', '-b', branch, 'origin/main'])
  const pkg = readFileSync(PKG_PATH, 'utf8')
  const bumped = pkg.replace(/"version": "[^"]+"/, `"version": "${version}"`)
  if (bumped === pkg) fail(`could not find a "version" field to bump in ${PKG_PATH}`)
  writeFileSync(PKG_PATH, bumped)
  run('git', ['add', PKG_PATH])
  run('git', ['commit', '-m', `chore(extension): bump extension version to ${version}`])
  console.log('Pushing — the pre-push hook runs the full suite, this takes a few minutes…\n')
  pushWithRetry(['-u', 'origin', branch])
  const body =
    `Bumps \`${PKG_PATH}\` to ${version}. Merging this unlocks cutting the \`${tag}\` release tag, which triggers ` +
    'the release workflow (GitHub Release + Chrome Web Store + Firefox AMO submissions).\n\n' +
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
  const prUrl = run('gh', [
    'pr',
    'create',
    '--base',
    'main',
    '--title',
    `chore(extension): bump extension version to ${version}`,
    '--body',
    body,
  ]).stdout.trim()
  console.log(`\n✅ Bump PR opened: ${prUrl}`)
  console.log(
    `Review and merge it (your checks run there), then re-run \`pnpm release:extension ${version}\` to tag and publish.`
  )
  process.exit(0)
}

// --- State B: main carries the version → tag + push (gated) ------------------

run('git', ['checkout', 'main'])
run('git', ['pull', '--ff-only'])
const localVersion = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version
if (localVersion !== version) fail(`checked-out main reads ${localVersion}, expected ${version} — refusing to tag`)
const sha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()

const ok = await confirmed(
  `About to tag ${tag} on ${sha} and push it. This triggers LIVE submissions to both the Chrome Web Store and\n` +
    'Firefox Add-ons (AMO) — each auto-publishes when its review passes. Do NOT proceed if a previous CWS\n' +
    'submission is still in review (the API rejects with ITEM_NOT_UPDATABLE).'
)
if (!ok) fail('aborted — nothing was tagged or pushed')

// A stale local tag here was never pushed (the remote check above said so) — recreate it fresh.
if (run('git', ['tag', '-l', tag]).stdout.trim() !== '') run('git', ['tag', '-d', tag])
run('git', ['tag', tag])
// --no-verify skips the pre-push hook: a tag push carries no new code, and the workflow re-runs all checks anyway.
pushWithRetry(['origin', tag, '--no-verify'])
await watchRun()
