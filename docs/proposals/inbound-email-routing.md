# Inbound email routing for flicktionary.app

> **Status: proposal.** Not yet set up — until it is, mail sent *to* @flicktionary.app addresses bounces.

## Problem

`flicktionary.app` has no MX record at the apex (the only MX is Resend's on `send.flicktionary.app`,
which handles bounce feedback, not inbound mail). Consequences:

- The contact form (`apps/backend/src/transport/third-party/resend/send-contact-email/send-contact-email.ts`)
  sends submissions **to `support@flicktionary.app`** — with the Resend key live in prod since
  2026-07-27, those sends now succeed and then bounce, so contact-form messages are lost.
- Replies to auth emails (`login@flicktionary.app`) vanish.

## Proposal: Cloudflare Email Routing

Free, and DNS is already on Cloudflare. It adds its own apex MX records
(`route1-3.mx.cloudflare.net`) and an apex SPF TXT — no conflict with Resend's records
(`send.*`, `resend._domainkey`) or the `_dmarc` policy; outbound sending is unaffected.

Setup (Cloudflare dashboard → flicktionary.app zone → Email → Email Routing):

1. Add `sebastien.stecker@gmail.com` as a destination address; click the verification link
   Cloudflare emails there.
2. Routes: `support@` → Gmail, `login@` → Gmail.
3. Catch-all: enable → Gmail (loses nothing if someone guesses `hello@`/`info@`; modest extra spam
   exposure). Alternative: catch-all → drop.
4. Accept the DNS changes the wizard proposes (apex MX + SPF TXT).

Verify by emailing `support@flicktionary.app` from an external account and submitting the prod
contact form.

## Optional

Reply *as* `support@flicktionary.app` from Gmail: Gmail → Settings → "Send mail as", SMTP
`smtp.resend.com:465`, username `resend`, password = a Resend API key (sending-only, scoped to the
domain — mint a separate key rather than reusing an existing one).
