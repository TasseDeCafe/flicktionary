# Word-family hints and guess-before-reveal in the reader

> **Status: proposal — v1, v2, extension popovers and flashcard backs implemented; other languages open.** Design for surfacing a tapped word's structure and its known relatives in the web reader's gloss sheet, with the translation held back until the reader has had a chance to infer it. Shipped for `ru`: the deterministic line + guess-before-reveal (v1), the per-lemma LLM insight (v2), the extension's hover/saved popovers (no guess-before-reveal there) and the line on practice flashcard backs, with insights warmed at queue compose. `docs/READER-SPEC.md`, `docs/SRS.md`, `docs/DATA-MODEL.md` and `apps/extension/EXTENSION-SPEC.md` describe the current behavior. Still open: other languages (coverage results below; German needs case-sensitive folding + a compound splitter), and practice hints from family clues (#516 recognition, #517 production).

Tracking: https://github.com/TasseDeCafe/flicktionary/issues/494 (prerequisite coverage check: https://github.com/TasseDeCafe/flicktionary/issues/495).

## Problem

Reading a hard text (a Russian novel) produces hundreds of lookups per chapter, and nearly every lookup becomes a card (the Harry Potter sample below: 237 highlights, 236 kept cards). Many of those words are transparent derivations of words the reader already has — *замёрзший* ← *замёрзнуть* ← *за-* + *мёрзнуть*, *жареный* ← *жарить* — but the gloss sheet shows only the translation, so the reader never practices decoding them and the deck keeps growing.

Goal: improve **recognition while reading** (not new exercises) by showing how the word is built and which relatives the reader already knows, and by giving the reader a moment to guess before the translation appears.

## Evidence (maintainer's data, 2026-09-28)

One book in progress (3 parts), 236 kept cards, checked against the Kaikki `ru` data and the reader's own vocabulary (2,778 `known_lemmas` + 4,008 saved `user_lookups`):

| Link to the reader's vocabulary | Terms | Examples |
|---|---|---|
| Parent (form-of / etymology parent) known or saved | 82 (35%) | врезаться ← резать, угасать ← гаснуть, сквозняк ← сквозь, рассмешить ← смешить |
| Shared non-affix ancestor with a known/saved word | 36 (15%) | укрыть ~ закрываться (крыть), вырываться ~ взрыв (рыть), залиться ~ слиться (лить) |
| Only via `related` / `derived` lists | 52 (22%) | рукав ~ рука, вязка ~ вязать, насквозь ~ сквозь; noisy: хижина ~ ратуша, халат ~ одежда, ступня ~ нога |
| Nothing | 66 (28%) | opaque roots (пламя, пихта, щедрый), multi-word expressions (вслед за), Kaikki gaps (ожог ← жечь, поучительно ← учить) |

Other observations:

- The book reuses its own families: 29 ancestors are shared by two or more of its lookups (стать → доставать / доставаться / расставаться; лить → заливаться / подливать / подливка).
- The affixes met are a short list: prefixes у- 11, за- 8, по-/с-/на- 7, про-/от- 6, вы-/под-/раз- 5; suffixes -ся 29, -ивать/-ывать 20, -ный 10, -ка 8.

Kaikki coverage of `etymology_templates` for `ru` lemma entries (inflected-form entries excluded): verbs 85%, adjectives 77%, nouns 64%, adverbs 59%.

## Behavior

Scope: the **web reader's** preview gloss sheet (`session-gloss-sheet.tsx`), **`ru` only**. Other Kaikki languages have been measured (see the coverage results below) but are deferred until they can be tested by hand; the setting is unavailable for them. The extension popover follows once the web version settles.

### Word-family line

A single line in the sheet header, under the term:

```
замерзшие
participle of замёрзнуть · за- + мёрзнуть
you know: мороз · saved: мёрзнуть
[ Show translation ]
adj  literary
```

- **Structure:** the form-of chain (for participles, gerunds, passives) and the etymology breakdown of the resolved lemma.
- **Anchors:** relatives found in the reader's vocabulary. Known lemmas and saved terms (any age) both count. Order: parent, then shared root, then filtered related; within a tier, known before saved, then most frequent first (`lemma_ranks`). Capped at 2–3 so the line never wraps into a paragraph.
- Shown whenever there is an informative structure, **with or without anchors** — a breakdown helps memorization even when nothing is known. Structures that say nothing on their own (a bare `X + -ся`) are suppressed when there is no anchor.

### Guess before reveal

- When the setting is on and **at least one anchor exists**, the translation line is replaced by a `Show translation` button. Everything else in the sheet (POS/register chips, study-target picker, Save, Add note, right-click save) behaves as today.
- Reveal: the button, Space on desktop, or a second tap on the same word.
- The fast gloss is still fetched immediately, so the reveal is instant.
- Without an anchor, the translation shows as usual.
- The reveal is ephemeral: nothing is persisted, and no new interaction is recorded.

### Setting

A per-target-language pref (next to `show_translations_enabled` on `user_target_language_prefs`), **default on**, shown only for Kaikki languages. Turning it off hides the whole feature: no family line and no guess-first hold.

## v1: deterministic, no LLM

1. **Resolve the lemma** of the tapped surface form. This reuses the existing path the fast gloss already uses for IPA and known-lemma candidates, with the fast gloss's POS to pick between homographs. Family data rides on the **same `glosses.fastGloss` response**, so the sheet renders once. A separate request would make the translation flash and then hide.
2. **Ancestors.** Walk `senses[].form_of` and the `af` / `affix` / `surf` / `surface analysis` / `compound` / `prefix` / `suffix` / `deverbal` / `back-form` etymology templates of the lemma, up to depth 3. Components starting or ending with `-` are affixes; the rest are ancestors. Parser requirements found during the coverage check:
   - **Parse the unified `{{ety}}` template.** It is the most common etymology template on de/fr/es/pt lemmas. Its args are keyword segments (`:af`, `:af<surf>`, `:deverbal`, `:inh`, `:bor`…), each followed by its components. Take components only from the structural keywords, and skip components prefixed with another language code (`la:cantāns`).
   - Strip inline modifiers (`Haus<t:house>`, `-ed<id:past participle>`) from components in every template.
   - **Follow `form_of` only for participle / gerund / passive / nominalization senses.** Plain inflection links are homograph traps: German *Schiene* would inherit *scheinen* through the subjunctive *schiene*.
   - Skip `clipping` and `blend` edges. They are the main English noise (*stab* ← *stabilizer*, *tab* ← *tablet*).
3. **Reference table.** Precompute it at Kaikki load time, like `wiktionary_form_redirects`: `(target_language, lemma, ancestor, kind, depth)` plus the reverse index `ancestor → lemmas`. That makes "shared root" queries cheap. Fold like the loader: NFC first, then strip only the non-composable acute, so Romance accents survive (*obstáculo*, *avô*); fold ё→е for `ru`. **Keep German case-sensitive** (*Schiene* ≠ *schiene*, *Bergen* ≠ *bergen*). Note that `known_lemmas` and `lemma_ranks` store German lemmas lowercased, so the personal intersection must match every case variant of a lowercased lemma.
   - **Anchors must be content words:** a noun, verb or adjective lemma of at least 3 letters that isn't a prefix or particle. Otherwise *ab*, *vor*, *mit* and *ver* surface as "you know" anchors for every separable verb.
4. **Related lists** (`related` / `derived`) count as anchors only when both words share a ≥3-letter stem after removing known prefixes. That keeps рукав ~ рука and drops synonyms and hypernyms.
5. **Personal intersection.** One indexed query against `known_lemmas` ∪ live `user_lookups` for the user and language.

Expected guess-first rate on the sample: about 50% of taps (parent + shared root), about 65% with filtered related lists.

## v2: word-specific meanings with an LLM

A static affix table would be vague: *за-* alone marks onset, completion, going behind, and more. v2 adds an LLM pass that, **for this word**, returns:

- what each part contributes (*за-* here: "into the state of", i.e. becoming frozen);
- missing parents Kaikki lacks (ожог ← жечь, почерк ← черкать);
- a verdict per link on whether a learner can actually see it (drop понимать ← иметь, тонкий ← тянуть);
- optionally, native-language cognates as anchors (дюжина ≈ fr. *douzaine*).

Cache the result globally per `(target_language, lemma)`, and per native language for the explanation text. Generate it lazily on first tap and fill it in asynchronously: the v1 deterministic line renders first and the richer text replaces it when ready. The guess-first decision stays on deterministic anchors, so the button never appears late.

## Decided

- The setting hides both the family line and guess-first.
- Anchors are plain text, not tappable.
- Multi-word expressions are skipped.
- Anchor order within a tier (parent, then shared root, then filtered related): known lemmas before saved terms, then most frequent first by `lemma_ranks`. Example: укрыть matches закрываться, покрывать, открываться and вскрываться through крыть; only the top 2–3 by this order are shown.

## Prerequisite: per-language coverage check

Tracked in https://github.com/TasseDeCafe/flicktionary/issues/495. Before implementation, measure `de`, `fr`, `es`, `pt` (and `en`) the way `ru` was measured above. For each language:
- share of lemma entries with usable etymology templates (`af` / `affix` / `compound` / `prefix` / `suffix` / `surf`) and `form_of` links;
- a manual spot-check of about 30 derived links for learner usefulness (German compounds should do well; Romance-language etymologies often point at Latin, which isn't a useful anchor);
- the anchor rate against a real account's vocabulary where one exists.

Languages below a usable threshold ship with the setting unavailable, like other Kaikki-only features for non-Kaikki languages.

### Results (2026-09-28)

Measured against the local Kaikki load with the v1 rules above: depth 3, the content-word anchor filter, and filtered related lists with a ≥3-letter stem after prefix stripping, or compound containment.

**Coverage.** Share of lemma entries (noun/verb/adj/adv, inflected-form entries excluded) with a same-language, non-affix ancestor. "Foreign only" means the entry's only etymology points at another language (Latin, Middle High German…).

| Lang | All lemmas | Top-10k lemmas | Top-10k foreign only |
|---|---|---|---|
| ru | 54% (verbs 77%, adj 72%, nouns 34%) | 49% | 30% |
| de | 60% (verbs 65%, adj 57%, nouns 60%) | 42% | 35% |
| en | 50% | 30% | 55% |
| fr | 35% | 26% | 52% |
| es | 32% | 26% | 56% |
| pt | 28% | 27% | 52% |

Frequent words are naturally underived (*Haus*, *gehen*). That is why the top-10k rate is lower everywhere, and why the anchor rate below is the metric that matters.

**Spot-check.** 30 random links per language, lemmas ranked 2k–20k:

| Lang | Useful | Bad or weak examples |
|---|---|---|
| de | ~29/30 | weakest: *erregen* ← *regen* (Nachbarschaft ← Nachbar, Löwenzahn = Löwe + Zahn, Rätsel ← raten) |
| fr | ~26/30 | *paille* ← *pailler*, *poisse* ← *poisser*, *bif* ← *bifton* |
| es | ~26/30 | *muesca* ← *moscar*, *complutense* ← *compluto* |
| pt | ~28/30 | *excepcional* ← Latin *exceptio*, *leal* ← *lei*; *arrombamento* ← *mento* is a parser leak |
| en | ~22/30 | homographs and clippings: *Bonnie* ← *bonfire*, *stab* ← *stabilizer*, *Jerry* ← *german*, *iggy* |

Romance links are clean when they exist. The Romance problem is coverage: half of the frequent vocabulary only points at Latin. The Latin links don't produce bad anchors, they just leave words without any.

**Anchor rate on real vocabulary** (maintainer's prod account, unique live lookups):

| Lang | Lookups | Parent | Shared root | Derivative known | Filtered related | Structure only | Nothing | MWE |
|---|---|---|---|---|---|---|---|---|
| ru (all lookups) | 3,659 | 32% | 11% | 6% | 7% | 7% | 18% | 12% |
| de | 98 | 21% | 14% | 2% | 4% | 20% | 24% | 10% |
| en | 186 | 11% | 0% | 2% | 5% | 8% | 28% | 36% |
| es | 36 | 11% | — | — | 6% | 17% | 36% | 31% |

The ru row calibrates the method against the book sample above: 32% vs 35% parent, 11% vs 15% shared. The related tier is lower (7% vs 22%) because the stem filter now drops the synonym noise.

German examples:
- Parent: Vergabe ← geben, beängstigend ← Angst, auffällig ← auffallen ← fallen.
- Shared root: Ansatz ~ Einsatz (Satz), entnehmen ~ Unternehmen (nehmen), Zerschlagung ~ fehlschlagen (schlagen).

The English account is a near-native vocabulary (7.3k known lemmas) whose lookups are opaque rarities (*dirge*, *varlet*, *culvert*) and idioms. It says little about an English learner. pt (4 lookups) and fr (none) have no usable real data.

**Synthetic learner** (knows the top 3,000 ranked lemmas, taps 400 random lemmas ranked 3k–15k), for a like-for-like comparison:

| Lang | Parent + shared | + filtered related |
|---|---|---|
| ru | 35% | 43% |
| de | 43% | 45% |
| en | 31% | 39% |
| fr | 21% | 29% |
| es | 20% | 30% |
| pt | 19% | 28% |

Quality of the filtered related tier:
- fr, es: good (*chiot* ~ *chien*, *signataire* ~ *signature*, *brevedad* ~ *breve*). Some misses: *merced* ~ *mercado*, *chin* ~ *china*.
- pt: noisy, about 7/12 (*dureza* ~ *durante*, *extinguir* ~ *distinguir*, *ingrediente* ~ *ingresso*).

**German compound gap.** About half of the German "nothing" bucket is compounds with no Wiktionary entry: *Baumaßnahme*, *Vergabeverfahren*, *Treibhausgaskonzentration*, *Biergarnitur*. A dictionary splitter over Kaikki lemmas (noun head, optional linking *-s-/-n-/-en-/-e-/-es-/-er-*, best split by rank) recovers 12 of the 13 on the account. It agrees with Wiktionary on 86% of known two-part compounds. However, it also fires on 25% of single-parent derivations and gives some false splits (*Radikalismus* → Radikal + Ismus, *Meineid* → meinen + Eid). Use it for the structure line only, with a head of at least 4 letters and a suffix blocklist. It should never create a guess-first anchor by itself.

**Decision: v1 ships for `ru` only.** The other languages are deferred because there is no bandwidth to test them by hand, not because the data failed. When one is picked up, the assessment below is the starting point. The parser requirements in v1 step 2–3 (`{{ety}}`, case-sensitive German, accent-safe folding) are still worth building into the reference table from the start, so enabling a language later is a flag flip plus testing.

**Per-language assessment (deferred):**
- **de: strongest candidate for the next language.** Coverage and link quality are the best measured, and the anchor rate on real data is 35–41%. Add the compound-splitter fallback.
- **fr / es: usable.** About 1 in 4–5 taps gets an anchor, and the anchors are good. The feature degrades gracefully: without an anchor, the translation shows as usual. The bigger Romance lever is v2's native-language cognates. Many "nothing" words are transparent to an English or French speaker (*stabilité*, *castidad*, *constelação*).
- **pt:** as fr/es for parents, but drop or tighten the filtered related tier.
- **en:** enable only with clipping/blend edges excluded. The structure and parents work, but English homographs make it the noisiest language, and there is no learner data to judge it.

## Out of scope

New exercise types and prefix/suffix practice cards. Session-focused LLM exercises are tracked separately in #493.
