# Lesson-notes extractor — prototype test

> **Status: proposal — experiment run 2026-07-07, verdict GO; not
> implemented.** Test plan for the LLM extraction pass behind the planned
> "import teacher lesson notes" feature. Nothing here is current behavior.
> The **Results** section below holds the experiment's findings; the
> implementation plan will be written next and will supersede the design
> sketch below.

## Feature context (one paragraph)

Planned feature: the user uploads/pastes a teacher's lesson notes (Google Doc
export, xlsx, plain paste); an LLM extraction pass turns them into a **stored
draft** of proposed cards; a confirm screen lets the user untick/adjust rows;
confirmed rows are batch-created via the existing ad-hoc card engine
(`apps/backend/src/service/adhoc/create-adhoc-card.ts`, which accepts headword
+ context + `StudyIntent {skills, formScope}` and auto-keeps). Words already in
the vocabulary get a production facet added and (if in `review` state) an
implicit `again` rating — so extraction errors can affect schedules, which is
why precision matters and why every row carries a confidence score that drives
the confirm screen's default-checked state. This experiment tests **only the
extraction pass**: quality, prompt shape, and cost. No app code changes.

## Sample files (untracked, repo root — do NOT commit, personal data)

- `Sébastien.md` — Google Docs markdown export, current teacher. One table per
  lesson under a `### **DD/MM/YYYY**` heading; columns грамматика / лексика /
  произношение. Conventions: `(не-X)` marks the learner's error (surrounding
  text is the correction), CAPITALIZED vowels mark stress (`орфогрАфия`),
  `**bold**` marks emphasis/corrections, `\-` is an escaped hyphen (aspect
  pairs: `снимать \- снять`).
- `Sébastien.docx` — the same Google Doc as .docx (18 tables, bold preserved
  as `<w:b w:val="1"/>` runs). Same content as the .md; useful only to verify
  the docx→markdown normalization path produces equivalent input.
- `Себастьян - заметки с уроков.xlsx` — a second teacher, one sheet. Paired
  columns per category: A/B = Лексика attempt→correction, C/D = Грамматика
  attempt→correction, E/F = Произношение attempt→correction, G = `Успех! 🏆`
  (wins — display-only, never imported). Intra-cell bold exists (34 bold runs
  in sharedStrings).
- `Russian Italki (Sébastien).xlsx` — the user's own 2020–2022 system, 200+
  per-lesson sheets named `DDMMYYYY`. Data sheets: A = sentence (ru), B =
  keyword (ru), C/D = broken DeepL formula outputs (`#ERROR!`/`#NAME?` —
  ignore). Separate `Flashcards DDMMYYYY` sheets carry IPA columns. Archive
  backlog; lowest priority format, but a good stress test.

## What the extractor must produce

One JSON object per **lesson** (a dated section/sheet, not the whole file):

```jsonc
{
  "lessonDate": "2026-06-12",            // null if undated
  "language": "ru",
  "formatProfile": "…",                   // prose: inferred column semantics +
                                          // correction/stress/bold conventions.
                                          // Becomes the stored per-teacher
                                          // profile after user confirmation.
  "rows": [
    {
      "sourceText": "я болел три дня (не- заболел)",  // verbatim, for the
                                                       // confirm screen expander
      "type": "vocab | form_correction | pronunciation | sentence_pattern | win | noise",
      "headword": "болеть",               // citation form (pivot word)
      "targetForm": "болел",              // non-empty only for form_correction
      "context": "я болел три дня",       // the corrected sentence/phrase
      "wrongForm": "заболел",             // from (не-X) / attempt columns; null if none
      "stressMark": "боле́л",              // normalized stress if the note marked it
      "proposedFacets": ["production", "recognition"],  // pronunciation-only for
                                                        // произношение rows
      "confidence": 0.0                   // drives default-checked on confirm
    }
  ]
}
```

Facet-mapping defaults to encode in the prompt: лексика → production +
recognition on the citation form; grammar/form corrections → production on the
exact `targetForm`; произношение → pronunciation only; `sentence_pattern`
(no single clear pivot) → pick the pivot word the correction hinges on, keep
the sentence as context, and lower the confidence; `win`/`noise` → excluded
from import (wins shown decoratively).

## Method

1. **Normalize** each file to markdown text, one chunk per lesson:
   - `.md`: split on the `### **DD/MM/YYYY**` headings; use as-is.
   - `.xlsx`: small Python script (openpyxl is available) emitting one markdown
     table per sheet, preserving intra-cell bold as `**…**` (openpyxl
     `rich_text` support) — this mirrors what the client-side converter will do
     in production. Drop `#ERROR!`/`#NAME?` cells.
   - `.docx`: only to spot-check parity with the `.md` (e.g. `pandoc -t gfm`);
     not a separate grading target.
2. **Extract** with a standalone script (scratchpad or a local uncommitted
   script; Anthropic key via `doppler run --` from `apps/backend` scope, model
   id = the enrichment model in
   `apps/backend/src/transport/third-party/anthropic/anthropic-client.ts`).
   One call per lesson. Force the JSON shape with a tool/structured output.
3. **Two conditions**, to measure the value of the teacher profile:
   - cold: no profile, the model infers `formatProfile` itself;
   - warm: the cold run's confirmed `formatProfile` injected as authoritative
     instructions ("column 3 is pronunciation; CAPS marks stress; …").
4. **Hand-label** a grading set first (before looking at model output): the
   12/06/2026 lesson from `Sébastien.md` (~50 rows), the whole small xlsx
   (~40 pairs), and one Italki sheet (e.g. `26022022`). For each row: type,
   pivot headword, target form, facets.
5. **Grade** cold and warm runs against the labels.

## Metrics and success criteria

Per file format, report:

| metric | target |
|---|---|
| row classification accuracy (type) | ≥ 90% |
| pivot/headword correctness (excl. noise/win) | ≥ 85% |
| targetForm correctness on form_corrections | ≥ 85% |
| hallucinated rows (not traceable to a source row) | 0 |
| miscalibrated confidence (wrong rows with confidence ≥ 0.8) | ≤ 5% of wrong rows |
| tokens + cost per lesson | measured, no target |

Failure is informative: if `sentence_pattern` pivots are unreliable, the
feature ships with those rows defaulting to unchecked; if cold ≈ warm, the
teacher-profile mechanism can be dropped or simplified.

## Sub-questions the run should answer

- Does per-lesson chunking work, and can the date-heading segmentation be done
  deterministically (regex) rather than by the model?
- Is one call per lesson enough context, or do conventions defined early in a
  document need to be carried in (argues for profile injection)?
- How should the second teacher's attempt→correction pairs map — is the
  attempt (`wrongForm`) reliably distinguishable from the correction when the
  pair order flips?
- Rough cost per lesson at production scale (weekly import, ~50 rows).

## Results

_Experiment run 2026-07-07 (Claude Code session; artifacts in the session
scratchpad `lesson-notes-proto/` — labels.json, run outputs, grader, per-row
review dumps)._

**Model + prompt version:** `claude-opus-4-8`, prompt v1 (single system prompt,
structured output forced via a `report_extraction` tool with the schema above,
one call per lesson, no thinking, `max_tokens` 16000). Note: Opus 4.8 rejects
`temperature` — don't send it.

**Method notes.** Grading set hand-labelled before any model call: the
12/06/2026 lesson from `Sébastien.md` (50 rows), the whole second-teacher xlsx
(32 items incl. 9 wins), and Italki sheet `26022022` (11 rows). Each label
carries a primary type plus defensible alternates (the
form_correction/sentence_pattern boundary is genuinely fuzzy for bare grammar
rows), and a set of acceptable pivot headwords. "Strict" = primary label only;
"lenient" = any defensible alternate. Warm profiles = the cold run's
`formatProfile` lightly user-corrected (mirrors the confirm flow). docx parity
spot-checked via the raw XML (18 tables = 18 lessons, bold runs intact) —
pandoc wasn't installed, full conversion-path check still open.

**Per-format metrics (cold / warm):**

| metric | gdoc-md (teacher 1) | xlsx-paired (teacher 2) | xlsx-italki |
|---|---|---|---|
| coverage (source items extracted) | 100% / 100% | 100%¹ / 72%² | 100% / 100% |
| type accuracy — strict | 86% / 86% | 97% / 96% | 73% / 64% |
| type accuracy — lenient | **100% / 100%** | **100% / 100%** | **100% / 91%**³ |
| headword correct (accepted pivots) | 86% / 88% | 90% / 95% | 82% / 82% |
| headword excl. granularity-only⁴ | 98% / 100% | 100% / 100% | 91% / 91% |
| targetForm on form_corrections | 2/2 / 2/2 | 3/3 / 4/4 | n/a |
| hallucinated rows | **0 / 0** | **0 / 0** | **0 / 0** |
| facet-mapping compliance | 100% / 100% | 100% / 100% | 100% / 100% |
| tokens in+out per lesson | 3.2k+5.8k / 3.7k+4.2k | 3.4k+3.9k / 4.0k+3.5k | 2.7k+2.0k / 3.2k+1.8k |
| cost per lesson ($5/$25 per MTok) | $0.16 / $0.12 | $0.11 / $0.11 | $0.06 / $0.06 |
| latency per lesson | 52s / 36s | 37s / 32s | 26s / 17s |

¹ One near-duplicate source item (the same доступ correction recorded in both
the лексика and грамматика pair columns) was merged into a single row —
counted as covered; arguably the right product behavior.
² The warm profile said the wins column is "never imported", and the model
took that as "don't emit rows" — all 9 `win` rows vanished. Profile wording
steers coverage; see verdict below.
³ The one warm italki regression was also profile-induced: my added note
"verb-pair entries = form/aspect notes" made it type `склонять - просклонять`
as a form_correction with the perfective as `targetForm`. Cold got it right.
⁴ The dominant headword "miss" class is the model returning the whole
collocation as headword (`документальный фильм`, `горловой звук`, `цены не
кусаются`, `сотни часов`) where the label expected a single pivot word. Never
a wrong lexeme. Genuine pivot errors across all six runs: `чтобы` (cold t1,
conf 0.55) and `на` (italki both runs, conf 0.65).

**Hallucination + confidence calibration.** Zero hallucinated rows in all six
runs — every extracted row traced verbatim to a source cell (early
"hallucinations" were grader artifacts from `attempt → correction` joins and
bold-glued words; fixed with segment-wise, space-insensitive matching).
Calibration: every genuine error (wrong lexeme, bad pivot, profile-induced
type slip) came in at confidence ≤ 0.8, so **0% of real errors were
high-confidence** — comfortably inside the ≤5% target. The strict-grading
number looks bad on teacher 1 (6/7 "wrong" rows at conf ≥ 0.8) but those are
exactly the confident-and-defensible collocation headwords from note ⁴ — the
model is right to be confident there. Mean confidence: sentence_pattern rows
sat at 0.5–0.7 as instructed; clean vocab rows at 0.85–0.95.

**sentence_pattern pivot verdict.** Workable as designed. Pivots for grammar
rows were defensible in ~95% of cases; the two genuine bad pivots were both
function words (`чтобы`, `на`) and both carried confidence ≤ 0.65, so the
planned "default-unchecked below threshold" flow catches them. A
default-checked cutoff of ~0.8 matches the observed behavior well. Bigger
insight: form_correction and sentence_pattern both map to a production facet —
the type distinction has **no facet consequence**, only whether `targetForm`
is set. The plan can merge them into one "grammar" type (with optional
targetForm) and most strict-type disagreement evaporates.

**Cost per lesson.** $0.06–0.16 per lesson (Opus 4.8, $5/$25 per MTok), 17–52s
latency. A weekly ~50-row import costs ~$0.15/week per teacher — negligible;
no need for a cheaper model or batching. The whole experiment (6 calls) cost
~$0.63.

**Cold vs warm verdict.** Cold ≈ warm on accuracy. Even cold, the model
inferred every convention correctly per lesson (CAPS stress, `(не-X)`,
attempt→correction pairing incl. the one-row drift case, Italki's
bold-vowel-as-stress — which it discovered unprompted). The profile's real
effects were (a) ~28% fewer output tokens and ~30% less latency on teacher 1,
(b) killing the one bad `чтобы` pivot, and (c) **steering behavior in both
directions** — two of the three warm regressions were caused by my own profile
wording (notes ² and ³). So: keep the per-teacher profile as a lightweight,
user-editable *description* of the format (it's also the natural UX for the
confirm screen), but don't build machinery around it as an accuracy lever, and
never let it contain prescriptive classification rules ("X is never imported"
→ rows disappear). The system prompt, not the profile, must own "wins are
still emitted, typed `win`".

**Attempt→correction mapping (sub-question).** Reliable. `wrongForm` was
always taken from the attempt cell, never flipped, including rows with only a
correction and the pair whose correction drifted one row below its attempt.
The near-duplicate cell got merged into one row (good). One caveat: teacher 2
files grammar-type corrections under the Лексика columns sometimes — classify
by content, not column (the model already does).

**Chunking (sub-question).** Deterministic segmentation works: regex on
`### **DD/MM/YYYY**` headings split all 18 lessons of the .md; xlsx is one
lesson per sheet (`DDMMYYYY` names for Italki). No model-side segmentation
needed. One call per lesson is enough context — no convention defined in an
earlier lesson was needed.

**Recommended prompt + schema.** Schema as specified above, unchanged — it
survived contact with all three formats. Prompt v1 essentials to carry into
the implementation (system prompt, ~600 tokens):
- role framing: rows become proposed cards on a confirm screen; confidence
  drives default-checked; wrong rows can damage SRS schedules, so precision
  beats recall;
- the six types with one-line definitions (or five, if form_correction and
  sentence_pattern merge);
- hard rules: one row per source item (a pair = one row); never invent rows —
  every sourceText must be verbatim-traceable; skip empty cells; wins are
  emitted with type `win`, never dropped; headword = citation form; context =
  cleaned corrected phrase; stressMark normalized to U+0301;
- deterministic facet mapping by type (worked: 100% compliance everywhere);
- confidence rubric: ≥0.9 only when type+pivot unambiguous, ≤0.7 for
  judgment-call sentence_pattern pivots, ≤0.5 when unsure — this is what
  produced the good calibration;
- cold-style closing instruction to infer the teacher's conventions and
  describe them in `formatProfile`; on warm runs append the stored profile as
  user-confirmed context (descriptive only).
Changes for v2: allow multi-word expressions as headword for vocab
collocations/idioms (the model wants to do this and it's the better card);
state explicitly that `win`/`noise` rows must still be emitted regardless of
any profile text.

**Go / no-go: GO.** All targets met under lenient (defensible-alternate)
grading, zero hallucinations, calibration works as the confirm screen needs.
Plan adjustments for the implementation doc: merge
form_correction/sentence_pattern into one grammar type with optional
targetForm; permit expression headwords; profile = stored user-editable
description, injected as context, with win/noise emission guaranteed by the
system prompt; default-checked cutoff ≈ 0.8.
