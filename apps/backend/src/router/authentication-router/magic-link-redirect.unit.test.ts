import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMagicLinkRedirectUrl } from './magic-link-redirect'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const templateEnvs = ['supabase-prod', 'supabase-dev', 'supabase-dev-tunnel', 'supabase-test']
const templatePath = (env: string) =>
  join(backendRoot, 'supabase', env, 'supabase', 'templates', 'magic-link-verification.html')

describe('buildMagicLinkRedirectUrl', () => {
  it('ends with ? when there is no post-login redirect, so the template can append token_hash directly', () => {
    const url = buildMagicLinkRedirectUrl('https://app.flicktionary.app')
    expect(url).toBe('https://app.flicktionary.app/login/email/verify?')
  })

  it('ends with & when carrying a post-login redirect', () => {
    const url = buildMagicLinkRedirectUrl('https://app.flicktionary.app', '/extension-pair?nonce=abc')
    expect(url).toBe('https://app.flicktionary.app/login/email/verify?redirect=%2Fextension-pair%3Fnonce%3Dabc&')
  })

  it('produces a well-formed link once the template appends its query string', () => {
    for (const redirect of [undefined, '/extension-pair?nonce=abc']) {
      const emailed = new URL(
        `${buildMagicLinkRedirectUrl('https://app.flicktionary.app', redirect)}token_hash=xyz&type=magiclink`
      )
      expect(emailed.pathname).toBe('/login/email/verify')
      expect(emailed.searchParams.get('token_hash')).toBe('xyz')
      expect(emailed.searchParams.get('type')).toBe('magiclink')
      expect(emailed.searchParams.get('redirect')).toBe(redirect ?? null)
    }
  })
})

describe('magic-link email templates', () => {
  // The templates concatenate token_hash directly onto {{ .RedirectTo }} with no separator; the URL
  // built above supplies the trailing ?/&. If either side changes shape, sign-in links 404 in
  // production with no compile error — this is the only guard.
  it.each(templateEnvs)('%s template appends token_hash with no separator of its own', (env) => {
    const html = readFileSync(templatePath(env), 'utf8')
    expect(html).toContain('href="{{ .RedirectTo }}token_hash={{ .TokenHash }}')
    expect(html).not.toContain('{{ .RedirectTo }}?')
  })
})
