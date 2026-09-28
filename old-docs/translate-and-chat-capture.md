# Translate-and-add + vocabulary chat

> **Status: historical (archived 2026-09-28).** Implemented via
> https://github.com/TasseDeCafe/flicktionary/issues/497. The shipped behavior
> is specified in `docs/READER-SPEC.md` (Ad-hoc vocab entries, Vocabulary chat)
> and `docs/DATA-MODEL.md`; kept for the design rationale.

## Problem / motivation

Two capture workflows currently leave the app:

1. **"How do you say X?"** The learner knows the word in French or English but
   not in the target language. "Add a word" only accepts a target-language
   headword, so they translate in DeepL first, then paste the result in.
2. **"Teach me gym words."** The learner asks the Claude app for a small
   topical word list, then copies each useful term into "Add a word" one by
   one to get it into the review loop.

Both end in the same place — cards in the SRS — but they have different latency
needs. A translate lookup must feel instant; a topical conversation must be
accurate and can take a few seconds.

## Goals

- Enter a phrase in any language and get a card in the target language in two
  taps, without leaving the app.
- Hold a topical conversation about vocabulary and add the useful terms from it
  in bulk.
- Keep each conversation as history: a chat thread is a source, like a movie
  or lesson, with its cards grouped under it.

## Non-goals

- **Guest access.** Both lanes are signed-in only: an open-ended Opus chat is
  an LLM proxy, and even a one-shot Haiku translator is easy to abuse as a free
  translation API. Guests keep today's "Add a word" (target-language input
  only).
- **Chat quotas.** Signed-in chat turns don't count against any plan quota;
  a per-user rate limit is the only cap. Revisit when usage grows.
- **Editing or deleting existing cards from the general chat.** Per-card chat
  (`update_card_fields`) already owns editing. The general chat only creates.
- **An MCP connector** exposing Flicktionary tools to the Claude app. Good
  option for later; the capture flow stays in-app for now.
- **Translate-as-you-type on every keystroke.** Submit-on-Enter (plus a short
  debounce on desktop, if cheap enough) is enough.

## Overview: one surface, two lanes

"Add a word" (`+` overlay) becomes **Translate & add**. A single input takes
anything:

```
┌──────────────────────────────────────────────┐
│ [Russian ▾]                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ to fall asleep                           │ │
│ └──────────────────────────────────────────┘ │
│  засыпа́ть (impf) · заснуть (pf)      [+ Add] │
│    Я долго не мог заснуть.                   │
│  усну́ть (pf, colloquial)             [+ Add] │
│    Ребёнок наконец уснул.                    │
│                                              │
│  [Ask about this →]                          │
└──────────────────────────────────────────────┘
```

- **Fast lane (Haiku):** one-shot translation with 1–3 options.
- **Slow lane (Opus):** `Ask about this` opens a vocabulary chat thread, seeded
  with the query and the fast result.
- **Guests** see today's "Add a word" form unchanged, with a small sign-up
  prompt explaining that signing in unlocks translation and chat.

## Part 1 — Translate & add (fast lane)

### Behavior

1. The target-language picker defaults to `lastTargetLanguage` (same rule as
   today's "Add a word").
2. On submit, a Haiku call detects the input language and returns:
   - `inputLanguage`
   - if the input is **not** in the target language: 1–3 `options`, each with
     `headword` (clean headword per the language block conventions, e.g.
     aspect pair noted for Russian verbs), a short `note` (register / aspect /
     nuance, in the native language), and one short target-language
     `example`.
   - if the input **is** in the target language: no options. The UI falls
     back to today's direct add (headword + optional context), with a one-line
     gloss preview.
3. `+ Add` on an option calls the existing ad-hoc creation
   (`apps/backend/src/service/adhoc/create-adhoc-card.ts`) with the option's
   headword and its example as the context sentence. The card lands in the
   per-language "Personal vocabulary" source, exactly as today.
4. Added options switch to an `Added` state in place (no navigation, no
   toast), so several options can be added from one lookup. The current
   redirect to the focus view goes away for this flow; the card is reachable
   from Vocabulary.

### Why Haiku is enough

The Haiku output is only a *picker*. The card's content (translation,
definition, grammar, IPA) is produced by the existing basic-data pass and
Wiktionary grounding when the card is created. A mediocre Haiku option costs
the learner one skipped suggestion, not a bad card.

### Sense hint

The original query (`to fall asleep`) is the strongest disambiguation signal
the learner gives us. Pass it to `createAdhocCard` as an optional
`intendedMeaning` hint and thread it into the basic-data pass for that
highlight, so the pass picks the matching sense of a polysemous headword. It is
a hint only; it is not stored as the card's translation.

### Backend surface

- New oRPC procedure `vocabChat.translate({ text, targetLanguage })`
  → `{ inputLanguage, candidates[] }`. `MODEL_TRANSLATE` (Haiku by default,
  `TRANSLATE_MODEL` env override), strict tool output, native language from
  user prefs. Warm latency ~1.5-3s; Sonnet 5 renders idioms more naturally at
  ~1-2s more.
- The "Looks like German" hint is folded into this call (it already detects
  the input language): it shows when the input is in another language the
  learner studies, never for their native language.
- Per-user rate limit (300 translations/hour). No moderation: the input is a
  short lookup and nothing is stored until a candidate is added.

## Part 2 — Vocabulary chat (slow lane)

### Entry points

- `Ask about this` from the translate box (seeded thread).
- `New chat` in the translate box, for starting from a blank topic ("gym
  words").
- Reopening an existing thread from the Sessions list.

### Thread = source

Each thread is a new `content_source` with `type = 'chat'` (enum addition),
plus its `study_session` and a text track, following the pattern of
`get-or-create-lesson-session.ts`:

- **One target language per thread**, fixed at creation from the picker.
  Sessions are single-language everywhere else; a thread is no exception.
- **Title** generated by Haiku after the first exchange ("Gym vocabulary").
  Until then (and if generation fails) the title is the first message.
- **Created with its first message** (`vocabChat.start`), so an abandoned
  blank chat never becomes a session; a failed first turn deletes the thread
  again.
- **`context_blob`**: a short generic blob (like `ADHOC_CONTEXT_BLOB`) plus the
  thread title, so per-card chat and `Generate full exploration` work on
  chat-born cards unchanged.
- **Sessions list**: chat sources appear alongside other sources with a chat
  icon; a type filter keeps a heavy chat user's list manageable. (The list
  currently excludes only `adhoc` in
  `study-sessions-repository.ts`; `chat` stays included.)
- **Opening a chat source** opens the chat view, not the reader. Its
  session-vocabulary list (the review layer's first layer) is reachable from
  the chat header, so the grouped cards and the session recap quiz work as for
  any other source.

### Messages

New table `vocab_chat_messages` (`id`, `study_session_id`, `role`,
`content`, `proposal jsonb`, `new_thread_suggestion jsonb`, `created_at`). The existing
`card_chat_messages` is keyed on `card_id` and cannot hold a thread with no
card. Context-window handling mirrors `run-card-chat.ts` (last N turns verbatim,
older turns summarized).

### Model and prompt

- `MODEL_OPUS`, same methodology prompt and per-language instruction block as
  the other heavy passes (cacheable prefix), with the target language, native
  language, and CEFR level filled in.
- A chat-specific instruction block: answer language questions for this target
  language; prefer a small number of high-value terms over long lists; when
  suggesting terms to learn, call `propose_cards` instead of listing them in
  prose.
- Non-streaming, like per-card chat: the repo has no oRPC streaming path yet,
  and a turn is one to three Opus calls behind a "Thinking…" state (~5-20s).
  Streaming is the first follow-up if the wait feels long.

### Tools

- **`propose_cards`** — `{ items: [{ headword, note, example }] }`. Writes
  nothing. Rendered as a checklist card under the message: each row shows
  headword, note, example, and an "Already in your vocabulary" badge when
  applicable; one `Add N` button adds the checked rows. Rows default to
  checked except the ones already in vocabulary.
- **`search_vocabulary`** — `{ headwords[] }` → per headword, whether it is in
  the user's vocabulary / known, from `user_lookups`. Lets the model avoid
  re-proposing terms the learner already has and answer "do I already have
  this?".
- **`add_proposed_cards`** — `{ proposalMessageId, itemIndexes[] }`. For a
  typed request ("add them all", "add the first three"). Only adds items from
  an earlier `propose_cards` result in the same thread — the model cannot add
  a headword it never showed as a proposal — and skips items already in
  vocabulary. The checklist updates to the added state, so the result is
  visible exactly as if the user had clicked.
- **`suggest_new_thread`** — `{ language, message }`. Called when the learner
  asks about a language other than the thread's (see Language switch below).

Both the `Add` click and `add_proposed_cards` go through one procedure (e.g.
`vocabChat.addProposedCards({ messageId, itemIndexes })`). It
mirrors `lesson-import/confirm-batch.ts`: in one transaction, append one
`text_segment` per accepted item (the item's example sentence), a highlight on
the headword, and an `enrich_highlight` job. Card creation and LLM work then run
in the standard background enrichment pipeline, and the checklist rows show the
same enriching state as a lesson import. The segment gives each card real
provenance: the focus view shows the example sentence and links back to the
thread.

### Language switch mid-thread

A thread keeps its one target language. When the learner asks about another
one ("how do you say that in Spanish?"), the model calls `suggest_new_thread`
instead of answering in the other language. The UI renders an inline notice
under the message, not a blocking dialog:

> This chat is for Russian. **Continue in a new Spanish chat →**

The button creates a Spanish thread seeded with that message, so the learner
doesn't retype it. The model decides, not a language detector: a question
*written* in English about Russian, or a comparison ("is this like Polish
X?"), stays in the thread; only a request for vocabulary in another target
language triggers the notice. If the learner ignores the notice and keeps
going, the model answers briefly but proposes no cards in the other language,
since those cards would land in the wrong source.

### Gating

- Both the translate lane and the chat are rejected for anonymous users at the
  router.
- Per-user rate limit (`fixed-window-counter.ts`) on chat turns and on
  translate calls. No plan quota.
- User messages go through the ingest moderation gate like other
  user-authored inputs.

## Phasing

1. **Translate & add** — `vocabChat.translate`, the new input UI replacing
   "Add a word" for signed-in users, the `intendedMeaning` hint. Self-contained; fixes workflow 1.
2. **Chat backend** — `chat` source type migration, `vocab_chat_messages`,
   the chat service with its four tools, `addProposedCards`, integration tests.
3. **Chat UI** — chat view (reusing `chat-panel.tsx` where it fits), proposal
   checklist, entry points, streaming.
4. **Sessions integration** — list icon + filter, auto-title, vocabulary list
   from the chat header.

## Spec touchpoints when this ships

- `SPEC.md`: the "Not a free-form chatbot" non-goal becomes "no general-purpose
  chatbot; the vocabulary chat is scoped to capturing target-language terms";
  `+` overlay copy; user flows.
- `docs/READER-SPEC.md`: the ad-hoc entries section (translate lane) and a new
  chat source type.
- `docs/DATA-MODEL.md`: `content_source_type = 'chat'`, `vocab_chat_messages`.
- `docs/REVIEW-SPEC.md`: provenance for chat-born cards.

## Decisions

- **Typed "add them all" adds directly**, through `add_proposed_cards`, limited
  to items the thread already proposed.
- **Another language mid-thread → new thread**, offered by an inline notice
  with a one-tap handoff that carries the message over.
- **Signed-in only for both lanes**; guests keep today's "Add a word".
- **No plan quota on chat turns** for now; per-user rate limit only.
