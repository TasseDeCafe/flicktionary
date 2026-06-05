#!/usr/bin/env node
// Manage the internal test-user (admin) allow-list across all Doppler projects.
//
// The list is not stored in the codebase: the backend holds the plaintext
// emails (EMAILS_OF_TEST_USERS), every frontend ships only sha256 hashes of
// them (sha256(email.toLowerCase().trim()), matching checkIsTestUser in
// apps/web and apps/extension). This script keeps all of them identical, in
// EVERY config of every project — dev and prd must never drift.
//
// Usage (from the repo root, needs `doppler login`):
//   pnpm test-users               # list emails + per-project sync status
//   pnpm test-users add a@b.com   # add email(s) and sync everywhere
//   pnpm test-users remove a@b.com# remove email(s) and sync everywhere
//   pnpm test-users sync          # rewrite every target from the backend list
//
// Values are written to every config individually (root `dev`/`prd` AND the
// `dev_personal` branch config) rather than relying on Doppler branch-config
// inheritance: an explicit write everywhere is idempotent and self-heals the
// exact drift we once hit (a value set only on the branch config, with the
// root `dev` config left empty).

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// The backend's plaintext list is the source of truth; the hashed targets are
// derived from it.
const PLAINTEXT_TARGET = { project: 'backend', secret: 'EMAILS_OF_TEST_USERS' }
const HASHED_TARGETS = [
  { project: 'web', secret: 'VITE_HASHED_EMAILS_OF_TEST_USERS' },
  { project: 'extension', secret: 'WXT_PUBLIC_HASHED_EMAILS_OF_TEST_USERS' },
  { project: 'native', secret: 'EXPO_PUBLIC_HASHED_EMAILS_OF_TEST_USERS' },
]
const AUTHORITATIVE_CONFIG = 'prd'

const doppler = (args, { allowFailure = false } = {}) => {
  const result = spawnSync('doppler', args, { encoding: 'utf8' })
  if (result.error) {
    fail(`failed to run doppler — is the CLI installed and logged in? (${result.error.message})`)
  }
  if (result.status !== 0 && !allowFailure) {
    fail(`doppler ${args.join(' ')}\n${result.stderr.trim()}`)
  }
  return result.status === 0 ? result.stdout : null
}

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const hashEmail = (email) => createHash('sha256').update(email.toLowerCase().trim()).digest('hex')

const parseList = (raw) =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const listConfigs = (project) =>
  JSON.parse(doppler(['configs', '--project', project, '--json'])).map((config) => config.name)

const getSecret = (project, config, secret) => {
  const raw = doppler(['secrets', 'get', secret, '--project', project, '--config', config, '--plain'], {
    allowFailure: true, // missing secret → treat as empty
  })
  return raw === null ? null : raw.trim()
}

const setSecret = (project, config, secret, value) => {
  doppler(['secrets', 'set', `${secret}=${value}`, '--project', project, '--config', config, '--silent'])
}

const readAuthoritativeEmails = () => {
  const raw = getSecret(PLAINTEXT_TARGET.project, AUTHORITATIVE_CONFIG, PLAINTEXT_TARGET.secret)
  return parseList(raw).map((email) => email.toLowerCase())
}

const writeEverywhere = (emails) => {
  const plaintextValue = emails.join(',')
  const hashedValue = emails.map(hashEmail).join(',')
  const targets = [
    { ...PLAINTEXT_TARGET, value: plaintextValue },
    ...HASHED_TARGETS.map((target) => ({ ...target, value: hashedValue })),
  ]

  for (const { project, secret, value } of targets) {
    for (const config of listConfigs(project)) {
      setSecret(project, config, secret, value)
      console.log(`  set ${project}/${config} ${secret}`)
    }
  }
}

const listStatus = () => {
  const emails = readAuthoritativeEmails()
  console.log(`Test users (source of truth: ${PLAINTEXT_TARGET.project}/${AUTHORITATIVE_CONFIG}):`)
  for (const email of emails) {
    console.log(`  ${email}`)
  }
  if (emails.length === 0) console.log('  (none)')

  const expected = {
    plaintext: emails.join(','),
    hashed: emails.map(hashEmail).join(','),
  }
  const targets = [
    { ...PLAINTEXT_TARGET, expected: expected.plaintext },
    ...HASHED_TARGETS.map((target) => ({ ...target, expected: expected.hashed })),
  ]

  let drifted = false
  console.log('\nSync status:')
  for (const { project, secret, expected: expectedValue } of targets) {
    for (const config of listConfigs(project)) {
      const actual = getSecret(project, config, secret)
      const ok = actual !== null && parseList(actual).join(',') === expectedValue
      if (!ok) drifted = true
      console.log(`  ${ok ? 'ok     ' : actual === null ? 'MISSING' : 'DRIFT  '} ${project}/${config} ${secret}`)
    }
  }

  if (drifted) {
    console.log('\nRun `pnpm test-users sync` to rewrite every target from the backend list.')
    process.exit(1)
  }
}

const validateEmail = (email) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" does not look like an email address`)
  return email.toLowerCase().trim()
}

const [command = 'list', ...rest] = process.argv.slice(2)
const emailArgs = rest.map(validateEmail)

switch (command) {
  case 'list': {
    listStatus()
    break
  }
  case 'add': {
    if (emailArgs.length === 0) fail('usage: pnpm test-users add <email> [email…]')
    const emails = readAuthoritativeEmails()
    const merged = [...new Set([...emails, ...emailArgs])]
    console.log(`Adding ${emailArgs.join(', ')} → ${merged.length} test user(s). Writing all targets:`)
    writeEverywhere(merged)
    break
  }
  case 'remove': {
    if (emailArgs.length === 0) fail('usage: pnpm test-users remove <email> [email…]')
    const emails = readAuthoritativeEmails()
    const missing = emailArgs.filter((email) => !emails.includes(email))
    if (missing.length > 0) fail(`not in the list: ${missing.join(', ')}`)
    const remaining = emails.filter((email) => !emailArgs.includes(email))
    console.log(`Removing ${emailArgs.join(', ')} → ${remaining.length} test user(s). Writing all targets:`)
    writeEverywhere(remaining)
    break
  }
  case 'sync': {
    const emails = readAuthoritativeEmails()
    console.log(`Syncing ${emails.length} test user(s) from ${PLAINTEXT_TARGET.project}/${AUTHORITATIVE_CONFIG}:`)
    writeEverywhere(emails)
    break
  }
  default:
    fail(`unknown command "${command}" — use list, add, remove, or sync`)
}
