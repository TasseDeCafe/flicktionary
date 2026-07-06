# Flicktionary — Logo Generation Prompts

> **Status: scratch.** Brand-asset generation prompts, not a spec. Not code-driven;
> ignore when reasoning about app behavior.

**Flicktionary** is a language-learning app. From any source — pasted text, ad-hoc
words, subtitles, YouTube videos, and (soon) books — you **highlight the chunks you
don't understand**, each becomes a structured deep-dive card, and you **review them
over time with SRS**. The source is incidental; the core loop is *highlight → understand
→ remember*.

So the logo should lean on the universal action — **highlighting/extracting a piece of
language** and **recall/memory** — rather than any one source (don't over-index on film).
It must stay legible as a tiny app icon (16–32px).

Each prompt below is a distinct concept. Concepts 1–5 are one-liners for image
generators (Midjourney, DALL·E, Ideogram, etc.); Concept 6 is a full brief for
long-prompt design tools (e.g. Claude Design).

---

## Concept 1 — Highlighted word/phrase
*(the core action across every source — strongest)*

> Minimalist app icon logo: a short bold text underline bar with one segment swept over by a thick highlighter stroke in a bright accent color, as if marking a word. Flat vector, two flat colors, high contrast, generous negative space, no readable text, no gradients. Centered in a rounded-square icon frame. Designed to stay legible at 16px favicon size.

## Concept 2 — Speech bubble with a highlight
*(language + the highlight action, no medium implied)*

> Minimalist app icon: a rounded speech bubble containing a single bold highlighted line, suggesting a marked phrase in any language. Flat vector, geometric, two flat colors, thick clean strokes, no gradients, no text. Strong contrast, lots of negative space, rounded-square framing, must read clearly when scaled down to a small icon.

## Concept 3 — Card with a spark of understanding
*(the deep-dive card + memory / SRS angle)*

> Minimalist app icon: a single rounded study card with one highlighted line and a small four-point spark in the corner, suggesting insight and memory. Flat vector, bold simple shapes, two or three flat colors, no gradients, no lettering. Even margins in a rounded square, optimized to remain recognizable at tiny icon sizes.

### Variants

The first generation (deep-blue rounded square, tilted white card, three lines with the
middle one highlighted yellow, four-point spark top-right, a second card stacked behind)
works well. These variants each change **one axis** so they can be compared. Palette
default: deep blue ground, white card, yellow accent — restate or swap as you like.

**3a — Simplified for small sizes** *(fewer elements, reads at 16px)*
> Minimalist app icon: a single tilted rounded white study card on a deep blue rounded-square background, showing just two text lines — the lower one swept with a bold yellow highlight — and one small yellow four-point spark in the top-right corner. No second card. Flat vector, three flat colors, thick clean strokes, no gradients, no readable text, generous negative space. Optimized to stay crisp and legible at 16px.

**3b — Highlighter swipe, not a solid bar** *(emphasizes the marking action)*
> Minimalist app icon: a tilted white study card on a deep blue rounded square, with three short text lines; the middle line is overswept by a translucent yellow highlighter stroke that extends slightly past the text, like a real marker pass. Small yellow four-point spark in the corner. Flat vector, bold shapes, no gradients, no readable text. Crisp at small icon sizes.

**3c — Bigger, bolder deck** *(leans into the SRS / review-stack idea)*
> Minimalist app icon: a neat stack of three rounded study cards fanned slightly, the top card showing two lines with one highlighted in yellow, a yellow four-point spark above it. Deep blue rounded-square background, clear offset between cards so the stack reads even when small. Flat vector, three flat colors, thick edges, no gradients, no readable text. Recognizable at tiny sizes.

**3d — Spark as the hero** *(insight-forward, card recedes)*
> Minimalist app icon: a large bold yellow four-point spark centered over a single simple white study card with one highlighted line, on a deep blue rounded-square background. The spark is the dominant shape; the card is secondary. Flat vector, three flat colors, no gradients, no readable text, lots of negative space. Designed to pop at 16–32px.

**3e — Straight-on, centered** *(calmer, more iconic, less playful)*
> Minimalist app icon: a single centered, upright rounded white study card on a deep blue rounded-square background, two text lines with the lower one highlighted yellow, and a small yellow four-point spark in the top-right corner. Symmetrical, balanced, flat vector, three flat colors, no gradients, no readable text. Clean and legible at small icon sizes.

**3f — Palette explorations** *(same composition, swap the ground/accent)*
> Same tilted-card-with-spark composition as above, generated in these palettes — try each: (1) warm coral ground / cream card / teal highlight; (2) deep green ground / white card / amber highlight; (3) near-black ground / white card / bright lime highlight; (4) violet ground / white card / yellow highlight. Flat vector, three flat colors, no gradients, no readable text, crisp at small sizes.

## Concept 4 — Bookmark / tab marking a chunk
*(extracting and keeping a piece of language)*

> Minimalist app icon: a bold bookmark or tab shape clipped over a couple of abstract text lines, marking one of them. Pure geometric vector, flat two-tone, thick edges, no gradients, no readable text. Centered with generous negative space in a rounded square, designed for crisp rendering at small sizes.

## Concept 5 — Monogram "F"
*(clean, source-agnostic brand mark)*

> Minimalist monogram app icon: a single bold geometric letter "F" with one horizontal arm rendered as a thick highlighter stroke in a contrasting accent color. Flat solid colors, heavy stroke weight, no gradients, no outline noise, no extra text. Balanced in a rounded-square icon, must stay clear and crisp at 16–32px.

---

## Concept 6 — F built from text lines (full design brief)

*(the `logo-concepts-v2/` C direction — an F emerging from abstract text lines. Unlike
the one-liners above, this is a full brief for design tools that take long prompts
(e.g. Claude Design), not for image generators. If the tool accepts reference files,
attach `logo-concepts-v2/c-flines.svg` + `c-flines-small.svg` as "my draft".)*

> Design a logo + app icon for "Flicktionary" (flicktionary.app), a language-learning app.
>
> What the app is: from any content — pasted text, subtitles, YouTube videos, articles,
> soon books — you highlight the words you don't understand, each becomes a rich
> explanation card, and you review them over time with spaced repetition. The source is
> incidental; the core loop is highlight → understand → remember. Think LingQ, not
> Netflix: do NOT use movie/film imagery (no clapperboards, tickets, film strips, play
> buttons).
>
> Concept direction to explore (I have a rough draft I like but it's not there yet):
> a geometric letter "F" that emerges from lines of text — horizontal rounded bars that
> read simultaneously as abstract text lines and as the brand letter. In my draft, the
> F's two arms continue to the right as faded "ghost" line fragments, plus one extra
> faded line below the middle arm, so the whole tile reads as a paragraph with an F
> embedded in it. Push this idea further and better: vary the number and rhythm of ghost
> lines, try one line carrying a highlight accent (highlighting a word is the app's
> signature gesture), try uppercase-bar vs. more lowercase/humanist F constructions, try
> a negative-space F cut out of a text block. Give me 4–6 genuinely distinct takes, not
> one take in six colors.
>
> Deliverables per take:
> 1. Detailed app icon: the mark on a rounded-square (squircle, ~23% corner radius) tile.
> 2. Simplified favicon variant: the same idea reduced to survive 16 px — typically just
>    the F bars, no ghost lines. It must stay recognizable in a browser tab on both
>    white and dark tab backgrounds.
> 3. Horizontal wordmark lockup: mark + "flicktionary" in a rounded geometric sans
>    (the app uses Nunito ExtraBold).
>
> Style constraints:
> - Flat vector, bold rounded geometry, generous negative space. No 3D, no drop
>   shadows, no thin strokes, no readable body text.
> - Palettes: (a) sky-blue gradient tile #4AC7FA → #0E9DE0 with a white mark;
>   (b) sunset gradient #FF8A4C → #FF4E7A with a white mark. You may propose one more
>   palette of your own, but avoid generic-SaaS violet. Amber #FFC233 is available as
>   the highlight accent color.
> - Tone: friendly but clean — consumer learning app, not enterprise dev tool, not
>   childish.
>
> Present every icon at 128 px, 32 px, and 16 px on both a light and a dark background
> so small-size legibility can be judged honestly.

---

## Concept 7 — Open brief, no prescribed direction (full design brief)

*(same long-prompt format as Concept 6, but the concept space is left wide open —
use this when you want the model to propose directions instead of executing one)*

> Design a logo + app icon for "Flicktionary" (flicktionary.app), a language-learning app.
>
> What the app is: from any content — pasted text, subtitles, YouTube videos, articles,
> soon books — you highlight the words you don't understand, each becomes a rich
> explanation card, and you review them over time with spaced repetition. The source is
> incidental; the core loop is highlight → understand → remember. Think LingQ, not
> Netflix: do NOT use movie/film imagery (no clapperboards, tickets, film strips, play
> buttons). Ideas worth mining if you want them: the act of highlighting, words/text as
> raw material, understanding clicking into place, memory and recall, collecting a
> personal vocabulary, any-content-in / knowledge-out. But don't feel bound to any of
> these — a great abstract or letterform mark that just *feels* right also wins.
>
> You choose the concepts: give me 5–6 genuinely different directions, not one idea in
> six colors. Vary the type of mark across the set — e.g. at least one letterform/
> monogram, at least one pictorial metaphor, at least one abstract/geometric mark.
> For context, directions already explored in-house (avoid simply reproducing them,
> though a fresh reinterpretation is fair game): movie tickets/clapperboards, a text
> block with one highlighted word, a bold asterisk as a "there's a definition here"
> gloss mark, an F built out of text lines, a speech bubble containing a page, a fan
> of flashcards, a firefly jar.
>
> Deliverables per direction:
> 1. Detailed app icon: the mark on a rounded-square (squircle, ~23% corner radius) tile.
> 2. Simplified favicon variant: the same idea reduced to survive 16 px. It must stay
>    recognizable in a browser tab on both white and dark tab backgrounds.
> 3. Horizontal wordmark lockup: mark + "flicktionary" in a rounded geometric sans
>    (the app uses Nunito ExtraBold).
>
> Style constraints:
> - Flat vector, bold shapes, generous negative space. No 3D, no drop shadows, no thin
>   strokes, no readable body text inside the mark.
> - Color is yours to propose — pick a distinct palette per direction and say why it
>   fits. Territories we've liked so far, as a hint not a rule: warm highlighter amber
>   (#FFC233), sunset orange→pink gradients, sky blues. Avoid generic-SaaS violet.
> - Tone: friendly but clean — consumer learning app, not enterprise dev tool, not
>   childish.
>
> Present every icon at 128 px, 32 px, and 16 px on both a light and a dark background
> so small-size legibility can be judged honestly. For each direction, one sentence on
> the idea behind it.

---

## Tips for whichever you generate

- Add `--no text, gradient, photorealism, drop shadow, 3D` (or your tool's negative-prompt equivalent) to keep it flat and icon-safe.
- Ask for it **on a transparent or solid flat background** so you can drop it into the rounded-square app frame yourself.
- Generate at large size, then **preview at 32px** before committing — if the highlight, spark, or letter blurs together, simplify further (fewer colors, thicker strokes).
- A two-color palette reads best as a favicon. Pick one strong brand accent + one neutral.
