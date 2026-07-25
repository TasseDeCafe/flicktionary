# History-first navigation origin — retire the `from` search params

> **Status: proposal — not implemented.** A design for making router history
> the single "where does close take you?" mechanism in the web app, deleting
> the `from`/`practice*` origin search params where their only job is picking a
> close destination, and renaming what remains to what it actually encodes
> (editing scope, not origin). Not current behavior; the close conventions that
> ship today are documented in the `web-ui-patterns` skill.

## Problem

The web app answers "where should close take you?" with two mechanisms at
once:

1. **Router history** — `useModalScreenClose`
   (`../apps/web/src/features/navigation/hooks/use-modal-screen-close.ts`) pops
   back to the actual opener via `useCanGoBack`, falling back to a fixed
   parent on deep links. Zero obligations at call sites: any new link into a
   modal screen gets correct close-to-origin behavior for free.
2. **Origin search params** — the opener encodes where it is in the URL
   (`from: 'vocabulary'` on the session route, `from: 'practice'` plus a
   `practice*` cluster on the focus-card route), and the receiving view
   navigates to a reconstruction of that origin on close.

Mechanism 2 predates mechanism 1 and is now demoted to the deep-link fallback:
in-app, `canGoBack` is always true (every opener creates a history entry, and
the router's history index survives same-tab reloads via `history.state`), so
the params only fire when a URL is opened in a fresh tab. But they still carry
their full maintenance contract:

- Five-plus call sites must remember to set them
  (`vocabulary-list-view.tsx` ×2, `term-actions-overlay.tsx`,
  `reading-mode-view.tsx`, `per-form-card-editor.tsx`,
  `new-adhoc-card-wizard.tsx`).
- `focus-view.tsx` must thread the whole cluster through `goPrev`/`goNext` so
  params survive card paging; forgetting one navigation silently breaks the
  fallback.
- Anyone touching navigation must reason about both models and their
  interaction — the class of confusion behind the close-goes-to-the-wrong-place
  bugs fixed in the 2026-07 navigation pass.

The goal: one rule — **history owns origin; params encode only state that is
not origin**.

## Inventory — every current consumer

### `/sessions/$sessionId` (`app/routes/_authenticated/_app/sessions/$sessionId/index.tsx`)

`from: z.enum(['vocabulary']).optional()`

| Consumer | Role |
| --- | --- |
| `session-view.tsx` `closeToSessions` fallback | Close destination + `getSavedVocabularySearch()` restore. **Navigation-only.** |
| Setters: `vocabulary-list-view.tsx` `handleOpenSource`, `per-form-card-editor.tsx` `SourceContextBlock` link (via `fromVocabulary` prop) | Thread the flag in. |

### `/sessions/$sessionId/review/$cardId` (`app/routes/_authenticated/_app/sessions/$sessionId/review/$cardId.tsx`)

`from: z.enum(['vocabulary', 'practice'])`, `source: z.enum(['available'])`,
`practiceLang`, `practicePool`, `practiceMode`, `practiceStudySessionId`,
`practiceSessionHard`, `practiceFilter`, `practiceMix`.

| Consumer (`focus-view.tsx`) | Role |
| --- | --- |
| `closeToSessionVocabulary` fallback (vocabulary / `backToPractice` / review branches) | Close destination + practice-resume payload. **Navigation-only.** |
| `shouldLoadSessionScope = (!fromVocabulary && !fromPractice) \|\| source === 'available'` | Gates loading the session card list, the prev/next cursor, and `useGetStudySession`. **Semantic.** |
| `isLanguageWideEntry = fromVocabulary \|\| fromPractice` | Hides keep/reject toggles and the per-session position counter; forces `isKeptTerm`. **Semantic.** |
| `fromVocabulary` prop → `per-form-card-editor.tsx` → `SourceContextBlock` | Only re-threads `from: 'vocabulary'` into the Open-source link to the session view. **Navigation-only.** |
| `search` object threaded through `goPrev`/`goNext` | Keeps all of the above alive across card paging. |

### `saved-search.ts` (`apps/web/src/features/vocabulary/saved-search.ts`)

Module-level in-memory stash of the Vocabulary tab's sort/filter state, read
only by the two close fallbacks. Since the history pass, the fallbacks fire
only in a fresh tab — where module state is at its `{}` default. **The restore
is a no-op in the only case it runs; the module is dead weight today.**

## Key insight

`from` conflates two unrelated things:

- **Navigation origin** — where close should land. History now owns this.
- **Editing scope** — is this card being edited as part of its session
  (keep/reject, position counter, session context) or as a language-wide
  vocabulary entry? This is real product semantics and must survive in the
  URL (a deep-linked card must render the same way).

The unification is therefore not "delete all params" but "delete the origin
half, rename the scope half so it stops looking like origin".

## Target design

### Session route

- Drop `from` from `sessionSearchSchema`. `closeToSessions` becomes
  `useModalScreenClose({ to: '/sessions' })` — no function fallback.
- `vocabulary-list-view.tsx` `handleOpenSource` and `SourceContextBlock` stop
  setting it; the `fromVocabulary` prop chain through `per-form-card-editor.tsx`
  is deleted.
- In-app behavior is unchanged (history pops back to Vocabulary with live
  search state). A deep-linked session URL closes to `/sessions`, as today.

### Focus-card route

- Replace `from` with `scope: z.enum(['session', 'language']).optional()`
  (absent = `'session'`, the natural parent). Vocabulary and practice openers
  pass `scope: 'language'`.
- `source: 'available'` keeps its current meaning alongside `scope`.
- Derivations become `shouldLoadSessionScope = scope !== 'language' || source === 'available'`
  and `isLanguageWideEntry = scope === 'language'`.
- Delete the entire `practice*` cluster from the schema, the
  `term-actions-overlay.tsx` / `reading-mode-view.tsx` setters (their props
  slim down accordingly), and `backToPractice`.
- Close fallback matrix (deep links only — in-app always pops history):

  | `scope` | Fallback |
  | --- | --- |
  | `'session'` (absent) | the session's review list (today's default) |
  | `'language'` | `/vocabulary` |

- `goPrev`/`goNext` thread only `{ scope, source }`.

### Deletions

- `saved-search.ts` and its `setSavedVocabularySearch` mirror in
  `vocabulary-list-view.tsx`.
- `backToPractice` and the route-schema comment block describing the resume
  payload.

## What changes for the user

Nothing in-app — history already handles every in-app path, including the
practice-resume detours (popping back re-enters the identical route+search
entry, which is exactly what the session-snapshot matching in
`exercise-session-snapshot.ts` needs).

The only behavioral delta is deep links / fresh tabs:

- A pasted card URL from a practice surface closes to `/vocabulary` instead of
  re-entering the practice route. Acceptable: a fresh tab has no stashed
  session snapshot, so today's "resume" fallback composes a fresh queue anyway
  — the current behavior only looks smarter than it is.
- A pasted card URL from Vocabulary closes to `/vocabulary` with default
  filters instead of "restored" filters that are already `{}` in a fresh tab —
  no observable change.

## Risks / verification checklist

- Confirm `practice*` params have no consumers beyond `backToPractice` and the
  threading (grep at implementation time; `term-actions-overlay.tsx` receives
  them as props from serving surfaces — those props chains shrink too).
- Confirm nothing branches on `fromVocabulary` vs `fromPractice`
  *individually* except the close fallback (today `isLanguageWideEntry` and
  `shouldLoadSessionScope` treat them identically, which is what makes the
  single `scope` value sufficient).
- The `scope` rename touches URLs users may have bookmarked with
  `?from=vocabulary`; the zod schema drops unknown keys, so old links degrade
  to `scope: 'session'` rendering (position counter + keep/reject visible on a
  language-wide entry). Rare and cosmetic; accept, don't shim.
- Middle-click / cmd-click opens a fresh tab (no history): verify the fallback
  matrix reads sensibly for every opener surface.

## Implementation sketch

Single PR, mechanical once the design is fixed:

1. Focus route: schema swap (`from`+`practice*` → `scope`), derivation
   renames, fallback matrix, threading slim-down.
2. Setter sites: vocabulary list, term-actions overlay, reading mode, ad-hoc
   wizard, per-form card editor prop chain.
3. Session route: drop `from`; simplify `closeToSessions`.
4. Delete `saved-search.ts`; run `pnpm knip` for stragglers.
5. Update the `web-ui-patterns` skill (close conventions section) to state the
   single rule and remove the function-fallback example that referenced the
   vocabulary search restore.
