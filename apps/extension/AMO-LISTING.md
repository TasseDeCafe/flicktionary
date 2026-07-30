# Firefox Add-ons (AMO) submission

Canonical copy + reviewer instructions for the addons.mozilla.org dashboard.
The dashboard is the only place this text lives at publish time, so edit here
first, then paste in — keeps the listing reviewable in git. The Chrome Web
Store equivalent is [`CHROME-WEB-STORE-LISTING.md`](./CHROME-WEB-STORE-LISTING.md); the release
mechanics are in [`RELEASING.md`](./RELEASING.md).

Keep the same keyword-spam discipline as the Chrome listing: name at most ~5
streaming sites, woven into sentences, never as a list.

## Summary (max 250 chars)

```
Turn the shows you watch into language lessons. Flicktionary makes subtitles interactive on YouTube, Netflix, Prime Video and most streaming sites: hover a word for an instant meaning, save it, and review it later with spaced repetition.
```

Tighter alternative (174 chars):

```
Flicktionary makes subtitles interactive on YouTube, Netflix, Prime Video and most streaming sites: hover a word for an instant meaning, save it, and review it with spaced repetition.
```

## Privacy Policy

Check **"This add-on has a Privacy Policy"**. The field is a text area (AMO
hosts the text), so paste the actual policy — not just a URL. Required because
the manifest declares `data_collection_permissions`
(`websiteContent` + `personallyIdentifyingInfo`).

The pasted policy must cover the extension specifically:

- **What's collected:** the subtitle text / phrases the user selects, plus
  their account email and name on sign-in.
- **Why:** to generate word meanings and study cards, and tie saved vocabulary
  to the account.
- **Where it goes:** Flicktionary's own backend (and Supabase for auth) — not
  sold or shared with third parties.

This is the plain-text version of the canonical policy at
`apps/landing/src/pages/privacy-policy.astro` (its section 3 already covers the
extension). Keep the two in sync — edit the `.astro` file first, then refresh
this block. Update the "Last updated" date to match the source on each change.

```
Flicktionary Privacy Policy

Last updated: July 30, 2026

1. Introduction

Flicktionary ("we", "us") is a language-learning service consisting of the web app at flicktionary.app and a companion browser extension. We are committed to protecting your privacy. This policy explains what data we collect, how we use it, and the choices you have.

2. Information we collect

- Account information. Your email address and, depending on how you sign in (Google, Apple, or email), your name. Authentication is handled by our infrastructure provider Supabase; we never see or store your passwords for third-party sign-in providers.
- Learning content. The words and phrases you save, the notes and highlights you make, the text you import or paste (for example subtitles of a video you watch or an article you import), titles and URLs of the videos and articles you save words from, your native language, the languages you study, and your proficiency levels.
- Usage data. How you interact with the service (pages viewed, features used) collected through analytics, and diagnostic data such as error reports. We also use session replay, which records how the app's interface is used (clicks, scrolling, navigation between screens) so we can understand and improve the experience. Replay recordings are masked by default: the text you type and the text shown on screen — including your learning content — is replaced with placeholders before the recording leaves your browser, and authentication tokens are stripped from recorded URLs.
- Payment information. If you purchase a subscription, payment is processed by Stripe. We receive your subscription status but never see or store your card details.
- Cookies and local storage. Used to keep you signed in and to remember your settings. We do not use advertising cookies.

3. The browser extension

The Flicktionary browser extension only transmits data when you explicitly use one of its features: when you look up or save a subtitle word or phrase, it sends the selected text, the surrounding subtitle line, and the video's title and URL to our servers; when you import an article, it sends that article's text and URL. The extension stores your settings and your session token locally in your browser. It does not track your browsing history, does not read pages you visit beyond the features described above, and collects nothing without an explicit action from you.

4. How we use your information

- To provide the service: the content you save is processed, including by AI language-model providers (such as Anthropic), to generate the definitions, explanations, and study material you request.
- To personalize the service to your languages, level, and preferences.
- To process payments and manage subscriptions.
- To understand how the service is used and improve it.
- To respond to your support requests and send you information relating to the service.

5. Third-party service providers

We use a small number of service providers to operate Flicktionary: Supabase (authentication, database, and hosting), Stripe (payments), Anthropic (AI processing of the learning content you submit), PostHog (product analytics, session replay, and error monitoring), and Resend (transactional email). These providers process data only to provide their services to us and are bound by their own confidentiality and data-protection obligations. We do not sell your personal data to anyone.

6. Transfer of data

Your information may be transferred to and processed on servers located outside of your state, province, or country, where data protection laws may differ from those in your jurisdiction. We take steps to ensure your data is treated securely and in accordance with this policy wherever it is processed.

7. Disclosure of data

We may disclose your personal data where required to do so by law or in response to valid requests by public authorities.

8. Security

We use industry-standard measures to protect your data, including encryption in transit, access controls, and monitoring. No method of transmission or storage is 100% secure, but we work to protect your personal data proportionately to its sensitivity.

9. Data retention

We retain your data for as long as your account exists or as needed to provide the service and comply with our legal obligations. When you delete your account, your personal data is permanently removed.

10. Your rights

You can access and update your learning content and settings directly in the app at any time. You can delete your account from your profile settings, which permanently and irreversibly removes your account information and learning data. Depending on where you live, you may also have rights to request access to, correction of, or a copy of your personal data — contact us and we will honor these requests.

11. Changes to this policy

We may update this policy from time to time. We will post any changes on this page and update the "Last updated" date above.

12. Contact us

Questions about this policy or your data? Email us at support@flicktionary.app.
```

## Notes to Reviewer

The release workflow submits these notes automatically: `web-ext sign
--amo-metadata` reads them from [`amo-metadata.json`](./amo-metadata.json)
(`version.approval_notes`) and attaches the source archive via
`--upload-source-code`. This block is the human-readable mirror — edit both
together. When submitting by hand instead, upload
`flicktionaryextension-<version>-sources.zip` (produced by `wxt zip`) when AMO
asks for source code, then paste:

```
This add-on is built with WXT (https://wxt.dev) from a pnpm monorepo. The
source archive is the whole workspace; the extension lives in apps/extension.

Toolchain: Node.js 24, pnpm 11.5.0 (via corepack).

Build steps (from the extracted source archive root):

  corepack enable
  pnpm install
  cd apps/extension
  WXT_PUBLIC_API_HOST=https://api.flicktionary.app \
  WXT_PUBLIC_WEB_URL=https://app.flicktionary.app \
  WXT_PUBLIC_SUPABASE_PROJECT_URL=https://uynwhkflqmryzkenccmd.supabase.co \
  WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_c2POkVRSGxYEikXcoQU0fg_wJBw-bSj \
  WXT_PUBLIC_HASHED_EMAILS_OF_TEST_USERS=121768eea757bc3ab2ce0349a040ae39f21a0116914f5f621d8f15d1cef5a8fa \
  pnpm exec wxt build -b firefox

The built add-on is written to apps/extension/.output/firefox-mv2/.

The WXT_PUBLIC_* values above are public configuration (API host, web URL,
Supabase project URL and anon/publishable key, and SHA-256 hashes that gate an
internal admin tab) — they ship in the public bundle and are normally injected
at build time via Doppler; they are inlined here so the build is reproducible
without our secret manager.

Testing the add-on requires a free account at https://app.flicktionary.app:
sign in there, open the extension popup, and click "Pair" (one click). Then play
any video with subtitles in a supported language (e.g. a YouTube video with
captions) and hover/right-click a subtitle word to save it.
```

The inlined `WXT_PUBLIC_*` values are the production build-time config; keep
them in sync with Doppler project `extension`, config `prd` (see
`RELEASING.md`).
