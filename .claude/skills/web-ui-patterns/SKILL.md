---
name: web-ui-patterns
description: Opinionated UI idioms for apps/web — navigation patterns (tab view vs modal screen vs overflow tab), hover/press states, WizardShell, sticky CTAs, OptionCard, language pickers, mobile inputs, overlay sizing, and loading-state skeletons. Use whenever you add or edit a view, card, row, modal, form, or loading state in the web app.
---

The web app follows a few opinionated UI idioms. When adding a new view, mirror the existing canonical example rather than reinventing chrome — the design is intentionally close to a future Expo native app, so layouts should translate without rework.

## Navigation patterns (which chrome a view gets)

Every authenticated view is exactly one of three presentations. Pick one; don't invent a fourth (a view with no highlighted tab and no back affordance is an orphan — that's a bug, not a pattern):

1. **Tab view** — a top-level destination. Renders inside the app shell (`PageContainer` body, sidebar on desktop, `BottomTabBar` on mobile) with its tab/sidebar item highlighted. No back button; the nav itself is the way out. Canonical: `dashboard-view.tsx`, `practice-landing-view.tsx`.
2. **Full-view modal screen** — a task the user enters and leaves (wizards, the reader, focus/review, settings drill-ins like Account/Languages). The route sets `staticData: { hideAppChrome: true }` (no sidebar, no tab bar) and the view wraps itself in `ModalScreen` (`features/navigation/components/modal-screen.tsx`): top-left X (dismiss a task) or chevron (return to a parent). `onClose` on a single-entry screen navigates to a **fixed, known parent route** (canonical: `account-page.tsx`, chevron → `/more`). A screen with **several entry points** (e.g. the new-session wizard, reachable from `/sessions` and the dashboard checklist) uses `useModalScreenClose({ to: '/parent' })` (`features/navigation/hooks/use-modal-screen-close.ts`): it returns to the actual opener via router history and falls back to the fixed parent on deep links. Never call raw `history.back()` — deep links have no history to pop; the hook's `useCanGoBack` check is what makes going back safe. Three companion rules keep history clean so "back" never reopens something the user closed or completed:
   - **Flow-completion navigations use `replace: true`** — when a wizard succeeds and navigates to what it created (new-session wizard → the session, lesson import → the review list), the wizard's history entry is replaced, so back from the created screen goes to the wizard's opener, not the wizard. Same for the hook's deep-link fallback (built in).
   - **In-flow stepping uses `replace: true`** — paging that doesn't build a mental stack (focus view's card prev/next) replaces its entry, so close/back exits to the opener instead of walking every visited card.
   - **History owns origin; search params never encode it** — don't add `from`-style origin params to pick a close destination; the hook's history pop already returns to the actual opener, so an origin param would only ever affect deep links while taxing every opener with a threading contract. Search params carry only real screen state that a deep link must reproduce (canonical: the focus view's `scope: 'session' | 'language'`, which changes how the card *renders*, not where close goes). A fallback that legitimately depends on such state is just a conditional `NavigateOptions` argument (canonical: `focus-view.tsx` falls back to `/vocabulary` for `scope: 'language'`, the session review list otherwise).
3. **Overflow tab view** (the iOS More-tab convention) — a desktop sidebar destination with no slot in the 4-tab mobile bar (Stats, Sessions). It stays a tab view, but on mobile its **parent tab stays highlighted** and it gets the same header bar as a modal screen. Three pieces, always together:
   - add the route prefix to the parent tab's `matchPrefixes` in `bottom-tab-bar.tsx` (the sidebar config in `sidebar-nav.tsx` is separate and keeps the view's own item);
   - render `<OverflowTabHeader backTo='/parent' title={t`Page title`} />` (`features/navigation/components/overflow-tab-header.tsx`) as a sibling **above** `PageContainer` (fragment-wrap the view). It reuses `ModalScreenHeader`, so the mobile chrome is pixel-identical to a modal screen's chevron header; it's `md:hidden` and sticky, and its chevron uses `useModalScreenClose` internally — back to the actual opener, `backTo`'s fixed parent on deep links;
   - hide the in-page title on mobile (`<h1 className='hidden ... md:block'>`) — on mobile the title lives in the header bar, on desktop in the page body.

   Canonical: `stats-view.tsx` (parent = More), `sessions-list-view.tsx` (parent = Dashboard). If a view has several mobile entry points, `backTo` is still the single tab that owns it (Stats is reachable from Dashboard cards, but its home is More) — the header's history check handles returning to the actual opener.

Special case: `/user-guide` is public (the extension links to it). Signed-in users get it wrapped in a chevron `ModalScreen` closing via `useModalScreenClose` (fallback `/more`); signed-out visitors get the bare page — no back affordance into the sign-in wall.

## Hover and press (active) states on tappable surfaces

Every tappable card / row / list item that has a `hover:` transition MUST pair it with the matching `active:` press state and `transition-colors`. Touch devices have no hover, so without `active:` there is zero feedback when the user taps — the row looks dead on mobile. The two are a set; never ship a `hover:` on an interactive surface without its `active:` sibling.

Use the standard treatments rather than inventing per-view colors:

- **Plain cards / rows** (white-ish surface on the page background): `transition-colors hover:bg-gray-50 active:bg-gray-100`. Canonical examples: `session-card.tsx`, `vocabulary-row.tsx`, `triage-row.tsx`, `more-list-row.tsx`, `overlay-action-row.tsx`.
- **Selection cards using the accent treatment** (`OptionCard`, `LanguageSelectField`): `transition-colors hover:border-foreground/40 hover:bg-accent/40 active:bg-accent/60`.

Don't use a border-color-only hover (e.g. `hover:border-yellow-300`) for the press affordance — it's invisible on touch and diverges from every other card in the app.

## Wizards and modal flows

Use `WizardShell` from `apps/web/src/components/ui/wizard-shell.tsx` for any modal/flow that has steps (or even just one form-on-modal). It handles: progress bar (auto-hidden when `totalSteps <= 1`), X-on-first-step vs chevron-back, centered `max-w-md md:max-w-lg` column, and the sticky bottom action bar.

- Primary CTA is full-width `size='xl'`. Don't render your own bottom buttons inside the body — pass them as the `primary`/`secondary` props.
- Compute `totalSteps` dynamically when steps are conditional (e.g. CEFR step only fires when missing). Canonical example: `apps/web/src/features/sessions/components/new-session-wizard.tsx` (`requiresCefrStep` → 4 or 5 steps). Hardcoding `totalSteps={2}` when the second step is conditional leaves the bar stuck at "1/2" forever.
- Step headings: use `<WizardStepHeading title subtitle={...} />` from the same file — never an ad-hoc `<h2>`.
- Body content sits flat on the page background. **No inner `border rounded-xl shadow-sm` card wrappers** — that's the old idiom. See `practice-session-view.tsx` for an example of a flattened article.

## Sticky bottom CTA outside wizards

When a non-wizard view needs a bottom CTA (e.g. triage list, "all caught up" empty state), match the WizardShell recipe so it lines up visually:

```tsx
<div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
  <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
    <Button size='xl' className='w-full' ...>...</Button>
  </div>
</div>
```

Canonical examples: `triage-list-view.tsx` and the `done` branch of `practice-session-view.tsx`. Avoid `Button` default size and avoid `md:w-auto` floats — full-width xl on mobile and desktop both.

## OptionCard (Workouts-style radio / nav card)

`apps/web/src/components/ui/option-card.tsx` — use it for ANY "pick one of N" UI. Two variants:

- `variant='radio'` (default): keeps the selection visible with a ring, surfaces a trailing radio dot. Use when the user needs to confirm via a Continue button (e.g. CEFR level, language list).
- `variant='navigation'`: trailing chevron-right, no selected state. Use when tapping should immediately advance the flow (e.g. subtitle-source step, TMDB results, OpenSubtitles tracks). Saves the user one tap.

Don't fall back to inline `<div className='flex items-center gap-2 rounded-md border p-3'>` patterns — that ships before option-card existed.

## Language pickers

Two shared building blocks; choose based on whether the picker has room to be inline:

- **`LanguageOptionList`** (`apps/web/src/components/language-option-list.tsx`) — searchable radio-card list of all SUPPORTED_LANGUAGES. Use when the picker IS the entire screen body (movie wizard step 1, onboarding step 1). Pass `pinnedCode` to hoist the user's last-used language to the top.
- **`LanguageSelectField`** (`apps/web/src/components/language-select-field.tsx`) — "tap-to-edit summary card with pencil icon" that opens a `ResponsiveOverlay` containing `LanguageOptionList`. Use inline within forms (text-paste wizard, add-a-word) where a full list would balloon the UI.

Never use the popover-based `LanguagePicker` for new flows — iOS Safari opens the popover upward and the keyboard hides the search input.

## Inputs on mobile

Use `text-base` (16px+) on `<input>` / `<textarea>` to prevent iOS Safari from zooming on focus. `text-sm` triggers the zoom. The shared `LanguageOptionList` search input already does this — follow the pattern.

## Transitions: no `transition-all` on elements whose content swaps

Never use `transition-all` on an element whose text/children change together with a state-driven class change — the classic case is a CTA doing `{busy ? t`Saving…` : t`Confirm`}` while `disabled` flips `opacity`. `transition-all` includes opacity, and animating opacity makes iOS Safari promote the element to a compositing layer built from a stale snapshot of its contents; when the label swapped in the same frame, old and new text render blended on top of each other for the transition's duration. Use `transition-colors` (or an explicit property list) instead. The shared `Button` (`packages/ui/src/components/button.tsx`) deliberately transitions only `color,background-color,border-color,box-shadow` for this reason — don't "simplify" it back to `transition-all`.

## Sticky search/header inside an overlay

When a search bar must stay visible while the list scrolls (e.g. in `LanguageOptionList`), wrap the input in a sticky `bg-background` container — don't put the bg on the input wrapper directly:

```tsx
<div className='bg-background sticky top-0 z-10 -mx-3 px-3 pb-2'>
  <div className='border rounded-md ...'>... actual input ...</div>
</div>
```

`-mx-3 px-3` extends the opaque background into the parent's padding on both sides, so a selected card's `ring-2` (rendered 2px outside its border) doesn't peek around the bar. `pb-2` covers the gap below.

## ResponsiveOverlay sizing

For overlays that host a scrollable list (`LanguageSelectField` is the canonical case):

- **Mobile (Drawer)**: pin a fixed height like `h-[85svh]` so the sheet doesn't shrink as the user types and filters the list — otherwise the on-screen keyboard ends up covering it.
- **Desktop (Dialog)**: `sm:max-h-[80vh] sm:overflow-y-auto` caps the height and lets the dialog scroll internally.

Combined: `className='h-[85svh] sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:overflow-y-auto'`.

## Loading states (skeletons)

We do **not** use a skeleton library — the value of a skeleton is matching the
real content's layout, which is bespoke per view, so a dependency saves almost
nothing. Build from the shared primitives in
`packages/ui/src/components/skeleton.tsx`:

- **`Skeleton`** — the atom: `animate-pulse rounded-md bg-muted`. One bar; size it with `className` (`h-5 w-32`).
- **`SkeletonList`** — repeats N keyed placeholders so views don't re-implement the `Array.from(...).map()` + `key` boilerplate. Pass only `count` + `className` for a list of plain bars; pass `renderItem={() => <FooRowSkeleton />}` to repeat a composite row.

The convention:

- **Co-locate a `*Skeleton` next to the component it stands in for**, shaped like the real thing (same bars, same dimensions, same row chrome) so there's no layout jump when data lands. Canonical example: `TriageRowSkeleton` in `apps/web/src/features/review/components/triage-row.tsx` mirrors `TriageRow`.
- **Render skeletons on the FIRST load only** — branch on the query's `isLoading` (true until the first response), not `isFetching` (true on every background refetch). A skeleton that flashes on every poll/refetch is worse than none.
- **Gate "failure-looking" UI behind the query that proves it.** A retry/empty/error affordance must only render once the query that determines it has actually returned — until then show the skeleton (or a neutral loading state), never the failure. This is the class of bug the triage view had: an uncarded highlight defaulted to a `missing` → Start/Retry row while the status query was still loading, so a freshly-opened triage briefly looked like every enrichment had failed. The fix was to treat "status unknown" as the enriching shimmer, not the retry affordance.
- Size the skeleton count to what you expect (e.g. a cached count) when you have it, else a small constant — `SkeletonList count={Math.min(highlights?.length || 4, 8)} ...`.

Two existing full-screen loaders cover the non-skeleton cases: `FullViewLoader` (`packages/ui`, a centered spinner) and `PracticeLoader` (`apps/web/.../practice`, a labeled Sparkles pulse for LLM generation). Prefer a layout-matching skeleton over a bare spinner for list/content views; reserve spinners for genuinely shapeless waits (full-view route boot, an LLM call with no list to mirror).
