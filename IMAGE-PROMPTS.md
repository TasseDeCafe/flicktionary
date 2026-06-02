# Image prompts — Flicktionary brand imagery

The **logo** is finalized: a flat black-and-yellow **projector light-beam** mark —
black wing-shapes + three bold motion rays on the left, a central ring (lens) with
a bright yellow core, a yellow triangular beam cone on the right. Transparent
background. Master at `assets/brand/flicktionary-icon.png`.

All icons/favicons are already generated from that master. The prompts below are
for the **designed marketing images** that the logo downscale can't produce. Run
them through the image model, then drop the results in the noted paths and ping me
to wire them up.

> **Text caveat:** image models render wordmarks unreliably. If a prompt includes
> the word "Flicktionary" and it comes out garbled, generate the *background +
> logo* only and add the wordmark as real text in a vector/design tool — or send
> me the clean image and I'll note where text should overlay.

---

## 1. Social / Open Graph image — `apps/web/public/opengraph-image.png` (1200×630)
*(An interim version, logo-on-white, is shipping now — replace when ready.)*

> A clean 1200×630 social banner for a language-learning app called Flicktionary.
> Centered-left: the Flicktionary projector light-beam logo (flat black-and-yellow,
> a ring/lens emitting a yellow cone of light to the right). To its right, the
> wordmark "Flicktionary" in a friendly bold geometric sans-serif, dark text, with
> a short tagline beneath in lighter weight: "Learn languages from movies and texts."
> Background a soft warm off-white with subtle large faint yellow beam rays echoing
> the logo. Flat, modern, lots of negative space, no clutter, high contrast, crisp.

Dark-variant option (if you prefer a dark share card):
> …same layout but on a deep charcoal/near-black background, the logo's beam glowing
> warm yellow, wordmark in white. Cinematic, minimal.

---

## 2. Chrome Web Store — small promo tile — `assets/store/promo-440x280.png` (440×280)

> A 440×280 promotional tile for a browser extension called Flicktionary. The
> projector light-beam logo (black-and-yellow) on the left, the wordmark
> "Flicktionary" to the right in a bold geometric sans-serif. Background a warm
> off-white with one faint diagonal yellow beam sweeping across. Flat vector style,
> generous margins, nothing near the edges, legible when small.

## 3. Chrome Web Store — marquee promo — `assets/store/promo-1400x560.png` (1400×560)

> A wide 1400×560 marquee banner for the Flicktionary browser extension. Left third:
> logo + "Flicktionary" wordmark + tagline "Turn any video or article into a
> language lesson." Right two-thirds: a stylized, abstract illustration of a film/
> subtitle frame with a few words gently highlighted in yellow, beams of warm light
> connecting them. Flat, modern, cinematic-but-clean, deep-charcoal or warm-white
> background, yellow as the single accent. No realistic faces, no readable body text.

---

## 4. (Optional) Landing hero — `assets/brand/hero.png` (~1600×900, transparent or bg)

> A friendly flat-illustration hero image for a language-learning web app: a laptop
> or browser window showing a paused movie with a subtitle line where one phrase is
> swept with a yellow highlighter, and a small side panel showing its translation.
> Warm, minimal, lots of whitespace, yellow accent matching the logo, soft shapes,
> no readable real text, no logos other than space to place the Flicktionary mark.

---

## Notes / conventions
- **Palette:** black `#111`-ish, yellow `~#FACC15` (the logo's yellow), warm off-white,
  optional deep charcoal for dark variants. Yellow is the single accent — don't introduce other hues.
- **Style:** flat vector, bold shapes, no gradients/glow (matches the logo), generous negative space.
- **Avoid:** readable body text (model will garble it), busy detail that dies at small sizes, stocky 3D renders.
- Suggested home for store/marketing assets not served by the app: `assets/store/` and `assets/brand/`.
