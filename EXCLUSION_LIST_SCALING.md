# Exclusion list scaling problem

## Context

When the basic-data pass runs for a session, it sends the LLM a list of every
`(headword, sense)` pair the user has already studied in the target language,
so the LLM can avoid re-suggesting them as new chunks. The list is built by
`listHeadwordSensesForLanguage` and grows monotonically with the user's
vocabulary.

This is the only mechanism gating LLM re-suggestion of known chunks — the
filter is LLM-judgment-based, not programmatic, by design (the SPEC notes
that distinct senses of the same headword should still surface as new
entries, which is a judgment a deterministic filter can't make).

## The problem

`listHeadwordSensesForLanguage` pulls **every** non-deleted `user_lookups`
row for the user/language. There is no `LIMIT`, no pagination, and no
`count > 0` filter. The full list is then flattened into the user message
of the basic-data prompt as one line per entry.

For a heavy user this list grows without bound. Each pass pays for it twice
— in raw token cost and in cache invalidation.

## Critical files

- `apps/backend/src/transport/database/user-lookups/user-lookups-repository.ts:22-33`
  — `listHeadwordSensesForLanguage`. The unbounded query.
- `apps/backend/src/service/processing/process-session.ts:115-118` — caller
  inside the basic-data pass entry point. Result passed straight through
  as `excludedHeadwordSenses`.
- `apps/backend/src/transport/third-party/anthropic/passes/basic-data-pass.ts:222-231`
  — where the list is flattened (`excludedLines`) and embedded in the user
  message of the prompt.
- `apps/backend/supabase/migrations/20260425215345_initial_schema.sql:517-518`
  — `idx_user_lookups_user_target` partial index on `(user_id, target_language)
  WHERE deleted_at IS NULL`. The DB query itself is fast; the cost is
  downstream in the LLM call.

## Concrete consequences at scale

For an active learner accumulating ~30–50 kept chunks per session:

| Vocab size | Approx prompt tail | Approx tokens |
|---|---|---|
| 1,000     | ~30 KB  | ~7k–10k   |
| 5,000     | ~150 KB | ~35k–50k  |
| 20,000    | ~600 KB | ~150k–200k |

At 20k entries the exclusion list alone could swallow most of Opus 4.x's
200k-token window, leaving little room for the SRT segments, highlights,
and structured output. The 1M-context tier survives this, but cost still
scales linearly with vocabulary size.

The exclusion block lives in the **user message**, not the cacheable system
prefix, and grows by addition every session. Prompt-cache hit rate on this
suffix is therefore low — every new keep effectively busts the cache for
this part of the prompt.

LLM judgment quality also degrades when fuzzy-matching a candidate against
thousands of pairs in a single pass.

This is not an immediate fire — 20k chunks in one language implies hundreds
of completed sessions — but the function is built in a way that quietly
breaks somewhere between a few thousand and ~10k entries before any user
notices.
