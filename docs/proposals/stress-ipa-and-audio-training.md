# Stress, IPA, and audio pronunciation training

> **Status: proposal — not implemented.** Research notes and options for training
> lexical stress (Russian first; English later), IPA/vowel reduction, and general
> pronunciation through TTS audio and shadowing. Nothing here is decided; `docs/SRS.md` and
> `docs/READER-SPEC.md` describe what ships. Related: `pronunciation-warmup.md` (an
> exercise-graded pronunciation pool) — overlapping, not superseded.

## Problem

Reading Russian aloud breaks down on stress placement. Well-known words are fine; the
failures are rarer **inflected forms** where stress moves (ру́ки / руки́, пи́ли / пила́) and
**homographs** where context decides (за́мок / замо́к, все / всё). The existing pronunciation
facet is one flashcard per (term, form). It has too little volume to build the skill, and
until PR #538 it was almost never introduced (only the Learn-new preset served never-rated
opt-in facets).

The same problem exists in English (PHOtograph / phoTOGraphy / photoGRAPHic, read / read).
French has no lexical stress; its hard parts are liaison and silent letters. Shadowing
applies to every language.

## What the codebase already has

- **Stressed inflection tables.** `wiktionary_entries.data` stores the verbatim Kaikki JSON
  line, including stressed `forms[]`, `sounds[].ipa`, and `head_templates`
  (`apps/backend/scripts/load-kaikki.ts`). `wiktionary_forms` keeps only **stress-stripped**
  forms (`stripStress`), so per-form stress exists only inside the jsonb, never extracted.
- **Stressed headwords and IPA on cards.** `grammar.display_form` (U+0301, rules in
  `language-instructions.ts`), `grammar.ipa` (basic-data pass, grounded from Kaikki via
  `extract/ipa.ts`), and per-form `display_form` / `ipa` (`generate-form-data.ts`).
- **Rendering.** `strip-stress-marks.ts` hides stress on card fronts; Noto Sans everywhere
  because Inter breaks U+0301.
- **No audio anywhere.** Kaikki `sounds[]` audio URLs are not read; `flashcard-face.tsx`
  notes audio playback as roadmap.
- **Session text** lives in `text_segment.text` with no stressed variant; `segment-row.tsx`
  is where a stressed render would go.

Earlier pronunciation work deliberately chose IPA-only, no audio. Adding TTS reverses that
decision and needs to be explicit.

## Stress placement: dictionary first, LLM as arbiter

Generating stress freely with an LLM is the wrong default. No published benchmark exists for
Claude or GPT on Russian stress, and anecdotal failures cluster on exactly the cases that
matter: mobile-stress forms, rare words, homographs, and U+0301 landing on the wrong
character. Proposed per-token tiers:

1. **Unambiguous dictionary hit** (most tokens). The unstressed form maps to one stressed
   spelling across the Kaikki forms tables. Look it up; no LLM. This covers rare inflected
   forms, the main pain point.
2. **Ambiguous** (homographs, ё-ambiguity). The LLM picks among the **dictionary
   candidates** given the sentence: a small, verifiable choice, a few percent of tokens.
3. **Out of vocabulary.** A neural accentuator or the LLM, flagged low-confidence in the UI.

Prerequisite: extract stressed forms into a queryable shape (e.g. a `stressed_form` column on
`wiktionary_forms`, or a sibling table keyed by the unstressed form) instead of digging
through jsonb at read time.

### Off-the-shelf accentuators (checked 2026-10)

| tool | license / runtime | reported accuracy | notes |
|---|---|---|---|
| RUAccent (Den4ikAI) | MIT (v1, per README), ONNX + HF tokenizers | 0.972 non-homograph; 0.964 homographs (turbo3) — COLING 2025, author's own test set | homograph resolver + ё restoration; no JS port, but ONNX makes `onnxruntime-node` plausible (untested) |
| Silero Stress | MIT, PyTorch, ~50 MB | 100% on ~4M dictionary forms; 0.92 F1 on ~2.2K homographs; 60–70% unknown words | ~0.5 ms/word on 1 CPU thread |
| StressRNN, Russtress, russian_g2p | various | much weaker (StressRNN 0.058 on homographs) | not recommended |

Taking a dictionary and a model together and keeping only their agreements reached 0.998
precision / 0.826 coverage on 1,000 hand-stressed Wiktionary sentences in one project
(targum PR #183). The same trick works with our Kaikki data as the dictionary.

Sources: https://github.com/Den4ikAI/ruaccent · https://aclanthology.org/2025.coling-main.444/ ·
https://github.com/snakers4/silero-stress · https://github.com/DLangellotti/targum/pull/183

## IPA: rules over stressed text

Russian IPA is close to deterministic once stress and ё are known: vowel reduction
(akanye/ikanye), palatalization, final devoicing, and voicing assimilation are rules.
Exceptions need lists: hard consonant before е in loans (темп), -ого → [əvə], сч/зж,
silent consonants. Wiktionary's `Module:ru-pron` (Lua) is the reference rule set, with a
Python port in wikt2pron. espeak-ng gets Russian stress wrong outside its dictionary, so
feed it pre-stressed text if used at all.

So whole-text IPA is a rules pass after stress placement, not additional LLM calls.
English: CMUdict/ipa-dict plus POS for homographs. French: liaison is the main G2P risk.

## Pedagogy constraints

- **Stress marks alone don't seem to teach stress.** Hacking & Hayes: marking stress in
  writing did not help learners associate stress with new word forms. Marks are a reading
  aid; learning needs active recall and audio.
- **High-variability phonetic training** (HVPT; meta-analysis of 79 studies): medium-to-large
  perceptual gains (g ≈ 0.92 pre/post, 0.67 vs controls) that are retained. Transfer to
  production is small-to-medium. More talkers and more sessions help.
- **Russian stress mobility** is concentrated in a fairly small set of high-frequency
  words; most words have fixed stress. Teaching mobility as word-family / paradigm patterns
  is expert consensus, not experimentally shown. No controlled evidence that teaching
  Zaliznyak a/b/c paradigms beats exposure.
- **Existing apps** are native-speaker ЕГЭ orthoepy drills ("pick the stressed vowel" on an
  isolated word). None is audio-first or L2-oriented.

Sources: HVPT meta-analysis https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/high-variability-phonetic-training-hvpt-a-metaanalysis-of-l2-perceptual-training-studies/6ABB8C1F32D88D53EA8D05A4565E76F6/core-reader ·
https://pollang.sitehost.iu.edu/Basics%20of%20Russian%20stress_2015_latest.pdf ·
https://aatseel.org/100111/pdf/abstracts/850/HackingHayesAbstract.pdf

## Exercise ideas

Ordered roughly by cost.

1. **Stressed-text toggle in the reader.** Render a session's segments with stress marks
   (and optionally IPA on tap). Cheap once the stress layer exists, and directly useful for
   reading aloud, but passive (see pedagogy).
2. **"Tap the stress" drill from a session.** Show a sentence unmarked and tap the stressed
   vowel on each target token. About 2 s per item, so dozens per minute: the volume the
   flashcard facet lacks. Targets: mobile-stress forms, rare inflected forms, homographs,
   and previously missed tokens. Doesn't need a facet per form. It can be a drill stream
   that logs errors per (lemma, form) to choose future targets, outside FSRS.
3. **Paradigm contrast pairs.** Forms of the same lemma whose stress differs, served
   together (ру́ки / руки́). Ties into word-family hints.
4. **Listening discrimination.** Hear a form in context and pick the stressed syllable.
   Multiple voices to match HVPT.
5. **Reduction / IPA drills.** "How is this о pronounced here?" (молоко́ → [məlɐˈko]).
   This is where IPA actually helps an English or French speaker.
6. **Shadowing.** Segment audio with word-level highlighting; record, play back, compare.
   Optional automatic feedback (below).

## ElevenLabs (checked 2026-10-06)

| | |
|---|---|
| **Models** | Eleven v4 (`eleven_v4`) and v4 Turbo (`eleven_v4_turbo`), launched 2026-09-28. 90+ languages incl. ru/fr/en; one voice speaks all languages with a native accent. v4 called via the Text to Dialogue API (plain `/v1/text-to-speech` support for v4 unverified). v4 up to 10k chars/request; Turbo ~100 ms median inference. Older: `eleven_v3`, `eleven_multilingual_v2` (29 langs, stable long-form), `eleven_flash_v2.5`. |
| **Price** | API list per 1k chars: v4 $0.08, v4 Turbo $0.04 (a 72%-off launch promo ran until 2026-10-12). Plans: Starter $6/30k credits … Scale $299/1.8M, Business $990/6M. |
| **Timestamps** | TTS-with-timestamps returns per-character start/end times (`alignment` + `normalized_alignment`); the WebSocket stream returns them per chunk. Enough for karaoke highlighting. |
| **Forced alignment** | Align existing audio to text → char + word timings and a per-word `loss`. Supports ru/fr/en; billed like Speech to Text. |
| **Pronunciation control** | SSML `<phoneme>` only on `eleven_flash_v2`. v4 accepts inline IPA in slashes (`/ˌbaɪoʊˈkemɪstri/`), "significantly improved" IPA, but every documented example is English. Pronunciation dictionaries (PLS): alias rules on all models, phoneme rules on Flash v2 / v4 only. **No official support for U+0301 or `+` stress marks in Russian.** A Habr tip claims `+` before the stressed vowel works; another Habr test saw stress marks ignored. |
| **Speech to text** | Scribe v2: Russian WER ≤ 5%, word timestamps. No phonemes, no pronunciation scoring. ElevenLabs has no pronunciation-assessment product. |
| **Licensing** | Paid plans include commercial rights, kept after cancellation; free plan has none. Caching/storing generated audio appears allowed but is unverified against the actual ToS. |

Sources: https://elevenlabs.io/blog/eleven-v4 · https://elevenlabs.io/docs/overview/models ·
https://elevenlabs.io/pricing/api · https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps ·
https://elevenlabs.io/docs/overview/capabilities/forced-alignment ·
https://elevenlabs.io/docs/product/prompting/pronunciation · https://habr.com/ru/articles/994354 ·
https://habr.com/ru/articles/911524

**Main risk: TTS that misplaces stress teaches the wrong stress.** Gate any audio feature
on a spike. Take ~200 tricky Russian sentences (mobile stress, homographs, rare forms), synthesize
with v4 three ways (plain text, U+0301 / `+`, inline IPA for the hard tokens), and listen to
a sample. Pick a strategy only if stress fidelity is near-perfect with our stressed text as
input.

**Cost shape.** Audio generated on demand per segment and cached (object storage keyed by
text + voice + model). A 3,000-char session ≈ $0.24 on v4 list. Whole books add up, so
never auto-generate for a full book.

### Scoring the learner's voice

| service | Russian | stress / prosody |
|---|---|---|
| Azure Pronunciation Assessment | ru-RU: phoneme / word / full-text accuracy, fluency, completeness (IPA) | prosody and syllable scores **en-US only** |
| SpeechAce | no Russian | phoneme, syllable, word-stress for en/fr/es |
| SpeechSuper | lists Russian | stress-level feedback unverified |
| ElevenLabs forced alignment | per-word `loss` | not designed for assessment; a rough "did you say this" signal at best |

Nothing verified scores **Russian stress** automatically today. Shadowing feedback for
Russian would be self-assessment (play back side by side) plus optional phoneme accuracy
from Azure.

Sources: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment ·
https://api-docs.speechace.com/llms-full.txt

## Suggested sequencing

1. ~~Introduce opt-in pronunciation/form facets in everyday practice~~ (PR #538).
2. **Spikes, in parallel:**
   - Stress accuracy: Kaikki dictionary + LLM arbiter vs Silero vs RUAccent on real session
     text, hand-checked.
   - ElevenLabs v4 Russian stress fidelity (above).
3. **Stress layer:** extract stressed forms from Kaikki, add a per-segment stressed-text
   cache, add the reader toggle and the "tap the stress" drill.
4. **IPA:** a rules pass (port of ru-pron) over stressed text; reduction drills.
5. **Audio:** segment TTS + highlighting, shadowing, listening discrimination.

## Open questions

- Should the stress drill be a standalone quick mode, a Daily Mix slot, or both? Should it
  write to FSRS, or log errors only?
- Accentuator runtime: port ONNX models to Node, run a small Python sidecar, or rely on
  dictionary + LLM only?
- Where stressed text is computed: eagerly in the enrichment pipeline (cost on every
  session) or lazily on first open of the toggle/drill?
- Audio storage and per-user cost caps; which voice(s) per language; whether multiple
  voices are worth the cost for HVPT.
- English: is the same stress drill worth it, or is shadowing enough there?
