---
name: clean-kindle-vocab
description: Clean up Russian vocabulary CSV exports from Kindle vocabulary extensions (like Kindle Cloud Companion). Use when the user asks to process or clean up a Kindle vocabulary CSV file.
---

# Clean Kindle Vocabulary Exports

Transform vocabulary exports from Kindle reading sessions into flashcards for recognition practice.

## Input Format

CSV with 4 columns:
- `word` - the highlighted word/phrase
- `previous` - the sentence before the highlighted word
- `current` - the sentence containing the highlighted word
- `next` - the sentence after the highlighted word

## Examples

See the `examples/` directory:
- **Raw input**: `examples/kindle-raw.csv`
- **Cleaned output**: `examples/kindle-cleaned.csv`

## Card Purpose

These cards are for **recognition** (passive vocabulary), not production:
- **Front**: Russian word + example sentence
- **Back**: English translation

Use `--mode recognition` when creating the deck:
```bash
python3 create_deck.py --mode recognition cleaned.csv -o passive.apkg
```

**Important**: Do NOT automatically create the deck after generating the CSV. The user often wants to review and edit the CSV first. Ask the user if they want to create the deck.

## CSV Output Format

5 columns, comma-separated:

| Column | Content |
|--------|---------|
| 1 | Russian word/phrase with stress marks |
| 2 | **Single** English translation (context-specific) |
| 3 | Example sentence in Russian |
| 4 | English translation of example |
| 5 | Tags (space-separated, e.g., `book harry_potter`) |

### Single Translation Rule

**Always provide exactly ONE translation** that matches the meaning in the original context. Do NOT list multiple translations separated by "/" or "or".

- ❌ `nonsense / rubbish` — too many options
- ✅ `nonsense` — one clear translation

- ❌ `to stare / to gaze` — confusing for flashcards
- ✅ `to stare` — matches the context

This makes flashcards easier to process mentally. If a word has multiple meanings, choose the one that fits the book's context.

## Processing Rules

### 1. Split Merged Selections

Amazon's Kindle sometimes merges adjacent highlights into a single entry. When the `word` column contains multiple unrelated words, **split them into separate cards**.

Signs of merged selections:
- Two or more words that don't form a natural collocation
- Words from different parts of the sentence (e.g., "зато усатый" where зато="but" and усатый="mustachioed")
- Multiple verbs or adverbs that are grammatically unrelated

**Examples of merged selections to split:**
```
"зато усатый" → two cards: "зато" and "усатый"
"неподвижно неотрывно" → two cards: "неподви́жно" and "неотры́вно"
"скривилась разжевала" → two cards: "скри́виться" and "разжева́ть"
```

**Examples of genuine collocations to keep together:**
```
"дрожь бросало при мысли" → "дрожь брос́ает при мы́сли" (idiom: to shudder at the thought)
"задним ходом" → "за́дним хо́дом" (in reverse)
"шло своим чередом" → "идти́ свои́м чередо́м" (to take its course)
```

Use your judgment: if the words form a meaningful phrase, expression, or collocation, keep them together. If they're clearly unrelated words that Amazon merged by mistake, split them.

### 2. Use the Current Sentence as Context

The `current` column contains the sentence where the word appears. Use this for:
- Understanding the meaning in context
- Creating a simpler example sentence if needed
- Verifying correct translation

### 3. Stress Marks (Column 1 Only)

- Add stress mark (´) on the stressed vowel for multisyllabic words
- Skip monosyllables
- Skip words with ё (always stressed)
- Only add stress marks in column 1, not in example sentences

### 4. Gender for Soft Sign Nouns

- For nouns ending in soft sign (ь), indicate gender with `(m.)` if masculine
- Most soft-sign nouns are feminine, so only mark masculine ones
- Examples: `день (m.)` — day, `гость (m.)` — guest, `дождь (m.)` — rain

### 5. Verb Pairs

- When the word is a verb, include both the perfective and imperfective forms
- When the verb is used with a preposition in the context, include that preposition and the case used
- Format: `imperfective/perfective` (e.g., `ви́деть/уви́деть`)

### 6. Create Simpler Example Sentences

The book sentences are often:
- Too long or literary for flashcards
- Contain proper nouns or context-specific references

Create a **simpler, clearer sentence** that:
- Uses the word with the same meaning as in the book
- Is short enough for a flashcard (under 15 words ideally)
- Is grammatically complete

### 7. Tags (Column 5)

Add tags to help filter vocabulary by source:
- Always include `book` as the first tag
- Add a short identifier for the book (lowercase, underscores for spaces)
- Example: `book harry_potter` or `book master_margarita`

The user should specify what tags to use for the book when invoking this skill.

### 8. CSV Quoting

Wrap any field containing commas in double quotes.

## Example Transformation

**Raw** (from `examples/kindle-raw.csv`):
```csv
word,previous,current,next
"чепухи","Глава первая...","Трудно было вообразить, что они окажутся замешаны в делах необычных или загадочных - они не признавали всякой там чепухи.","Мистер Дурслей работал директором..."
"зато усатый","Мистер Дурслей работал директором...","Он был большой, грузный мужчина почти без шеи, зато невероятно усатый.","У Дурслеев имелся сынок..."
```

**Cleaned output** (see `examples/kindle-cleaned.csv`):
```csv
чепуха́,nonsense,Он не признаёт всякой чепухи.,He doesn't accept any nonsense.,book harry_potter
за́то,but,У него нет опыта. Зато он быстро учится.,He has no experience. But he learns fast.,book harry_potter
уса́тый,mustachioed,Мой дед был высокий и усатый.,My grandfather was tall and had a mustache.,book harry_potter
```

Note: "зато усатый" was split into two separate cards because they are unrelated words.
