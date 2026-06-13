# Flashcard Data Guidelines

Recommendations for clean chunk data, based on issues found when matching Anki entries against book text using pymorphy3.

## Core Principle

The main field (chunk) should contain exactly one form — the canonical lemma, nothing else. All annotations, accents, grammar notes, and aspect pairs go in separate fields.

## Rules

### 1. No accent marks in the chunk field

Accent marks cause matching problems: mixing combining accents (`\u0301`) with precomposed Latin lookalikes (`á`), and `ё`/`е` inconsistencies. Store the accented form in a separate `display` field.

- `курлыкать` not `курлы́кать`
- `упихивать` not `упи́хивать`

### 2. One aspect per chunk

Store imperfective and perfective as separate chunks with a link between them. The matching issue: `курлыкать` (impf) doesn't match `курлыкнул` (perf of `курлыкнуть`) because the lemmatizer treats them as different lemmas.

- `упихивать` not `упихивать/упихать`
- `вломиться` not `вломаться/вламываться`

### 3. Use the lemma form that the lemmatizer actually produces

Test your entry against pymorphy3: if `morph.parse("вломился")[0].normal_form` returns `вломиться`, store `вломиться`, not `вломаться`. The chunk must match what the lemmatizer outputs when it encounters inflected forms in text.

### 4. Metadata in separate fields

Grammar info (`+ acc`, `pf.`, `m.`, `colloquial`), accent pattern, aspect pair link, register — all go in separate structured fields, never inline.

- `ухватиться` not `ухвáтываться/ухвати́ться за + acc`
- `дрожь бросает при мысли о` not `дрожь броса́ет при мы́сли о (+ prep.)`

### 5. Normalize ё consistently

Always use `ё` where correct in the chunk field (it's the canonical form). Normalize to `е` at match time in the app.

### 6. Expressions: only the words that matter

Keep the expression clean. Preposition/case notes go in metadata.

- `дрожь бросает при мысли` — not `дрожь бросает при мысли о (+ prep.)`

## Suggested Schema

| Field | Example | Notes |
|---|---|---|
| `chunk` | `упихивать` | Clean lemma, no accents, no annotations |
| `display` | `упи́хивать` | Accented form for UI display |
| `translation` | `to shove in` | English meaning |
| `example_target` | `Она упихивала вещи в чемодан.` | Example in target language |
| `example_en` | `She was shoving things into the suitcase.` | English translation of example |
| `aspect` | `impf` | `impf`, `perf`, or `null` |
| `aspect_pair_id` | (link to `упихнуть`) | Links to the other aspect |
| `meta` | `{register: "colloquial"}` | Gender, case government, register, etc. |

## Issues Found in Practice

| Problem | Example | Root Cause |
|---|---|---|
| Accent character mismatch | `щупловáтый` (Latin `á`) vs Cyrillic | Mixed Unicode encodings for stress marks |
| Aspect pair not matching | `курлыкать` vs book's `курлыкнул` | Lemmatizer returns `курлыкнуть`, a different lemma |
| Inline annotations breaking match | `ухватиться за + acc` | `+ acc` gets included in the search |
| Lemmatizer ambiguity | `дуло` → `дуть` instead of noun `дуло` | pymorphy3 picks the wrong parse |
| `ё`/`е` mismatch | `шёпоток` vs book's `шепоток` | Inconsistent usage across sources |
| Different lemma form | `вломаться` vs pymorphy's `вломиться` | Card uses a form the lemmatizer doesn't produce |
