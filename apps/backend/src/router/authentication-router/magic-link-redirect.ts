// The magic-link email template (apps/backend/supabase/*/supabase/templates/magic-link-verification.html,
// mirrored into the Supabase dashboard for prod) builds its link as `{{ .RedirectTo }}token_hash=...`,
// concatenating the query string directly onto this URL with no separator of its own. The trailing
// `?`/`&` here is therefore load-bearing — magic-link-redirect.unit.test.ts guards both sides of that
// contract.
export const buildMagicLinkRedirectUrl = (webUrl: string, redirect?: string): string => {
  const redirectParam = redirect ? `redirect=${encodeURIComponent(redirect)}&` : ''
  return `${webUrl}/login/email/verify?${redirectParam}`
}
