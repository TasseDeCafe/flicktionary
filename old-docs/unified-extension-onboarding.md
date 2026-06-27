# Unify extension-first onboarding through web onboarding

> **Status: historical — implemented and archived.** This proposal shipped: the
> extension pairing tab now runs web onboarding for not-onboarded accounts and
> the popup's inline native-language picker is retired in favor of a "Finish
> setup" CTA. Current behavior lives in `SPEC.md` and
> `apps/extension/EXTENSION-SPEC.md`. Kept for design history only.

## Problem

Onboarding has two divergent paths:

- **Web-first:** the user hits the onboarding gate
  (`apps/web/src/features/navigation/components/app-shell-layout.tsx`) and
  completes `OnboardingView`, which calls `completeOnboarding`
  (`apps/backend/src/transport/database/users/users-repository.ts:119`) — the
  only place that sets `is_onboarded = TRUE`.
- **Extension-first:** the extension never runs web onboarding. It collects the
  required values just-in-time instead:
  - native language via `FlicktionaryFinishSetupSection` (popup `<Select>`,
    shown while `nativeLanguage === null`, calls `userPrefs.setNativeLanguage`),
  - CEFR via the in-video `CefrPicker` when a save returns `MISSING_CEFR`.

So an extension-first user becomes fully functional in the extension while
`is_onboarded` stays `false`, and native language is collected by a second,
parallel UI. The moment onboarding grows past "native language" (a likely
near-term change), this drifts: extension-first users will have skipped the new
steps, and the web gate will (correctly) wall them — but only the web side knows
the new requirements. **One onboarding surface, used by everyone, removes the
drift.**

## Current pairing flow (as-built, for reference)

1. Popup "Sign in with Flicktionary" opens `/extension-pair?nonce=…` in a tab
   created with `openerTabId` set to the streaming tab.
2. `extension-pair-view.tsx` mints a session token
   (`extensionAuth.mintSession`) and `postMessage`s `{tokenHash,email,nonce}`.
3. The pairing content script forwards it; `flicktionary-pair-handler.ts`
   (background) runs `verifyOtp({type:'magiclink'})`, persists the session in
   `flicktionary.auth.v1`, acks `ok:true`, and **auto-closes the pairing tab
   after `PAIRING_TAB_CLOSE_DELAY_MS = 1500`** (the browser refocuses the
   streaming tab via `openerTabId`).
4. No web onboarding is ever shown; there is no web→extension "done" handshake.

## Proposed design

Make web onboarding the single onboarding surface, run **at pairing time**, then
return the user to the streaming platform.

1. **Make the tab close signal-driven, not timer-driven.**
   `flicktionary-pair-handler.ts` keeps acking `ok:true` but no longer schedules
   `tabs.remove`. Add a small `flicktionary-pair-finished` message (+ content
   script forward + a background handler) that closes `sender.tab?.id`. This
   removes the magic 1.5s and lets the web page decide *when* pairing is done.

2. **The pairing page orchestrates onboarding.** After the ack
   (`status === 'sent'`), `extension-pair-view.tsx` reads `useGetUserPrefs()`:
   - onboarded → post `flicktionary-pair-finished` immediately (today's UX).
   - not onboarded → render the **same `OnboardingView`** in an `extensionPair`
     variant; on completion, post `flicktionary-pair-finished` (tab closes →
     back to streaming). The X/escape still routes to `/more` (the pairing tab
     is a normal web-app tab where the user can sign out / delete their account)
     — consistent with the web escape hatch.

3. **Drive both flows from one component.** Give `OnboardingView` a
   `variant: 'web' | 'extensionPair'` (or `onComplete` / `onExit` callbacks) so
   there is no second onboarding implementation. Default `'web'`: completion →
   `/sessions`, X → `/more`. `'extensionPair'`: completion → post the finished
   message, X → `/more`.

4. **Retire the duplicate native-language collection.** Replace
   `FlicktionaryFinishSetupSection`'s inline `<Select>` with a **"Finish setup"
   CTA that opens web onboarding** (covers users paired before this change or who
   closed the pairing tab early). The web gate already routes a not-onboarded
   user to `/onboarding` on any visit, so the button only needs to open the web
   app. CEFR stays the in-video JIT picker — it is per-target-language and
   genuinely contextual, not part of global onboarding.

5. **Docs:** when this ships, update `apps/extension/EXTENSION-SPEC.md` (pairing
   + "Native language & CEFR" sections) and `SPEC.md` (onboarding/extension
   coupling) in place, and move this proposal to `old-docs/` (mark historical,
   note the PR).

## Risks / testing notes

Touches the extension background, a content script, and the popup — areas with
known traps (Firefox content-script quirks, MV3 service-worker lifecycle, the
shadow-DOM overlay). Requires a manual Chrome **and** Firefox smoke:

- Pair with a not-onboarded account from a streaming tab → onboarding shows in
  the pairing tab → complete → tab closes, focus returns to streaming, saving a
  word works (CEFR picker still appears for a new target language).
- Pair with an already-onboarded account → tab closes immediately.
- Legacy paired-but-not-onboarded state → popup "Finish setup" CTA opens web
  onboarding.
