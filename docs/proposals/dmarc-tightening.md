# DMARC tightening for flicktionary.app

> **Status: proposal.** Planned DNS policy change, not yet applied. Revisit a few weeks after 2026-07-27.

## Current state (since 2026-07-27)

Email for `flicktionary.app` is sent through Resend (region `eu-west-1`): Supabase auth emails
(`login@flicktionary.app`, custom SMTP on the prod project) and the backend contact form
(`support@flicktionary.app`, `RESEND_API_KEY` in Doppler `backend/prd`). DNS lives on Cloudflare:

- `send` MX + SPF TXT and `resend._domainkey` DKIM TXT — Resend's verification records.
- `_dmarc` TXT = `v=DMARC1; p=none;` — monitoring mode. Receivers deliver mail that fails
  SPF/DKIM alignment normally; the record only declares the domain DMARC-aware.

With `p=none`, anyone can spoof `From: login@flicktionary.app` and still reach inboxes.

## Proposed change

Edit the `_dmarc` TXT record on Cloudflare to:

```
v=DMARC1; p=quarantine;
```

Receivers then spam-folder mail claiming to be from `flicktionary.app` that fails DMARC. Legitimate
Resend sends are DKIM-signed with the `resend._domainkey` key and pass, so they are unaffected.
Later, once `quarantine` has run clean for a while, `p=reject` is the end state (refuse instead of
spam-folder).

## Preconditions before flipping

- A few weeks of real sends (magic links + contact form) with no deliverability complaints.
- Spot-check 2–3 recent emails in Gmail "Show original": SPF, DKIM, and DMARC all `PASS`.
- Resend dashboard → Emails shows no bounce/complaint anomalies.

## Optional at the same time

Add aggregate reporting to the record (`rua=mailto:...`) to see who is sending as the domain before
moving to `p=reject`. Needs a mailbox or a free DMARC report aggregator; skip if the volume doesn't
justify it.
