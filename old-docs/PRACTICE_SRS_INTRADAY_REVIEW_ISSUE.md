# Practice SRS Intraday Review Issue

## Problem

After completing a practice session, terms can show as due again within a few minutes.

Observed example: a Russian practice session was completed, then the Practice landing soon showed all 25 Russian terms as due again.

This feels wrong to the user because the session appears finished, but the landing page quickly suggests it was not really completed.

## Current Behavior

The backend currently uses `ts-fsrs` defaults directly in `apps/backend/src/service/practice/fsrs.ts`.

For a brand-new term, sampled default first-review due times are approximately:

- `Again`: due in 1 minute
- `Hard`: due in 6 minutes
- `Good`: due in 10 minutes
- `Easy`: due in 8 days

The Practice landing counts any term with `srs_due <= NOW()` as due. Therefore, terms rated `Hard` or `Good` during a session can reappear on the landing page minutes later.

## UX Mismatch

The app already has a strict `Again` loop inside the session:

- `Again` means the term is not completed yet and should keep resurfacing in-session.
- `Hard`, `Good`, and `Easy` count as completed for session progress.

Because of that model, users reasonably expect that once every term has been rated something other than `Again`, the session is done and those terms should not show as due again until at least tomorrow.

## Retention Tradeoff

The FSRS defaults are defensible for pure memory retention. Intraday learning steps are common for brand-new material because forgetting is fastest immediately after first exposure.

However, without a separate “learning queue” UI, mixing these intraday learning steps into the normal landing due count makes the app feel broken or demotivating:

- User finishes a session.
- User sees “All caught up.”
- A few minutes later the language has many due terms again.
