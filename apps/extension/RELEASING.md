# Releasing the extension

Store listing text (the dashboard description fields) is maintained in
[`CHROME-WEB-STORE-LISTING.md`](./CHROME-WEB-STORE-LISTING.md) — edit there, then paste into the
dashboard. It also records the CWS keyword-spam constraint that got a draft
rejected.

## Normal release flow

The `/release-extension X.Y.Z` skill drives this end to end (bump → PR → tag →
watch the run). The manual steps below are what it automates — follow them by
hand if you're not using the skill.

1. Bump `version` in `apps/extension/package.json` (Chrome requires strictly increasing versions).
2. Tag and push — the tag (minus `v`) must match the package version:

   ```bash
   git tag v0.0.2 && git push origin v0.0.2
   ```

3. `.github/workflows/release-extension.yaml` then: typechecks, builds both zips under
   `doppler run` (project `extension`, config `prd` — the real prod env vars), creates a
   GitHub release with the zips attached, and uploads + submits the Chrome zip to the
   Chrome Web Store for review. Publishing happens automatically when CWS review passes.

**Don't tag while a previous CWS submission is still in review** — the API rejects
uploads with `ITEM_NOT_UPDATABLE` until the pending review resolves (including the very
first manual submission).

## Secrets

All CI secrets live in Doppler, project **`root`**, config **`prd`**, which is synced to
the GitHub repo's Actions secrets. Set values there, never in GitHub directly:

```bash
doppler secrets set NAME --project root --config prd   # prompts for the value
```

| Secret | What it is |
| --- | --- |
| `CHROME_EXTENSION_ID` | The CWS item ID (visible in the dashboard / store URL) |
| `CHROME_CLIENT_ID` | OAuth client ID (see below) |
| `CHROME_CLIENT_SECRET` | OAuth client secret (see below) |
| `CHROME_REFRESH_TOKEN` | Long-lived token minted from that client (see below) |
| `AMO_JWT_ISSUER` | addons.mozilla.org API key (Tools → Manage API Keys → JWT issuer). Used by `web-ext sign` for Firefox |
| `AMO_JWT_SECRET` | The matching AMO API JWT secret (shown once when the key is created) |
| `EXTENSION_PRD_DOPPLER_TOKEN` | Read-only Doppler service token for `extension`/`prd`, so CI builds get the `WXT_PUBLIC_*` env vars (`flicktionary-config.ts` throws at runtime without them) |

If `EXTENSION_PRD_DOPPLER_TOKEN` ever needs recreating:

```bash
doppler configs tokens create ci-github-release --project extension --config prd --plain \
  | doppler secrets set EXTENSION_PRD_DOPPLER_TOKEN --project root --config prd
```

## Generating the Chrome Web Store OAuth credentials

One-time setup (redo only if the OAuth client is deleted or the refresh token is
revoked). Documented because every step has a trap.

Heads-up: `npx publish-browser-extension init` canNOT do this for you — its
refresh-token step still uses Google's out-of-band (OOB) redirect flow, which Google
shut down in 2023 (`Error 400: invalid_request`). Use the manual flow below, which
follows the official docs: <https://developer.chrome.com/docs/webstore/using-api#setup>.

1. **Google Cloud project** (console.cloud.google.com), signed in as the Google account
   that owns the CWS developer dashboard. Enable the **Chrome Web Store API**
   (APIs & Services → Library).
2. **Consent screen → In production.** Google Auth Platform → **Audience** → Publishing
   status → **Publish app**. ⚠️ If left in *Testing*, refresh tokens silently expire
   after **7 days** and releases start failing with `invalid_grant`. No Google
   verification is actually required — the `chromewebstore` scope isn't sensitive; the
   only consequence is an "unverified app" interstitial during consent.
3. **OAuth client.** Google Auth Platform → Clients → Create client:
   - Application type: **Web application** (not "Chrome Extension" — that type is for
     `chrome.identity` *inside* an extension)
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
   - Save the **client ID** and **client secret**.
4. **Refresh token** via <https://developers.google.com/oauthplayground>:
   - Gear icon (top right) → check **Use your own OAuth credentials** → paste client
     ID + secret.
   - Step 1: enter scope `https://www.googleapis.com/auth/chromewebstore` → **Authorize
     APIs** → sign in with the dashboard account. At the "Google hasn't verified this
     app" screen: **Advanced → Go to … (unsafe)** — it's our own client.
   - Step 2: **Exchange authorization code for tokens** → copy the **`refresh_token`**
     (ignore the `access_token`, it expires in an hour).
5. Store all three in Doppler `root`/`prd` (table above) and delete any local copies.

### Verifying credentials without submitting anything

```bash
cd apps/extension
doppler run --project extension --config prd -- pnpm exec wxt zip
doppler run --project root --config prd -- \
  npx -y publish-browser-extension@4.0.5 --dry-run --chrome-zip .output/*-chrome.zip
```

"Getting an access token" succeeding means the client ID/secret/refresh token are valid.
`--dry-run` never uploads or submits — store submissions only ever happen from a tag.

## Troubleshooting

- **`invalid_grant` at release time** — the refresh token died: consent screen was in
  Testing mode (7-day expiry), the token was revoked (e.g. Google password change with
  "sign out of all sessions"), or the OAuth client was deleted. Redo step 4 (and 2 if
  applicable).
- **`ITEM_NOT_UPDATABLE`** — a previous submission is still in review. Wait for it to
  resolve, then re-run the failed job from the Actions UI (no need to re-tag).
- **CWS rejects the zip because the manifest contains `key`** — should not happen (the
  Chrome `key` is emitted only for `mode === 'development'` in `wxt.config.ts`); if it
  reappears, that regressed.
- **Firefox/AMO submission fails / is skipped** — the workflow signs via
  `web-ext sign --channel listed` (not `publish-browser-extension`, which cannot
  attach reviewer notes). It needs `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`; without
  them the step skips with a notice. The reviewer notes and source-build
  instructions come from [`amo-metadata.json`](./amo-metadata.json)
  (`version.approval_notes`) — keep it in sync with the human mirror in
  [`AMO-LISTING.md`](./AMO-LISTING.md). web-ext reads the add-on id from the
  manifest's `browser_specific_settings.gecko.id`.
