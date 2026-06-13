# Chrome Web Store listing

Canonical copy for the CWS dashboard listing. The dashboard is the only place
this text lives at publish time (CI only uploads the zip) — edit here first,
then paste into the dashboard, so the listing stays reviewable in git.

## ⚠️ Keyword-spam policy (rejection 2026-06, ref "Yellow Argon")

The first draft was rejected for "excessive keywords in the item's
description": the `SUPPORTED SITES` section listing all ~19 platforms by name.
CWS policy allows naming sites an extension works with only **woven into
natural sentences, about five at most** — never as a list. The intro sentence
("YouTube, Netflix, Prime Video, Disney+ and most major streaming sites") is
the compliant form; keep it that way in every locale. The full platform list
belongs in `EXTENSION-SPEC.md`, not the listing.

## Detailed description (en)

```
Flicktionary turns the shows you already watch into language lessons. It makes subtitles interactive on YouTube, Netflix, Prime Video, Disney+ and most major streaming sites: point at a word you don't know, see what it means instantly, and save it to your personal vocabulary — without leaving the video.

HOW IT WORKS

1. Watch anything with subtitles in the language you're learning. The extension picks up the site's subtitle tracks automatically, or you can load your own subtitle file.

2. Hover over a word in the subtitles to get an instant gloss: a one-line meaning, part of speech, register, and pronunciation (IPA) — in your native language, tuned to your level.

3. Save words and phrases. Right-click a word, or select a longer expression, to save it. Flicktionary builds a full study card for it in the background: meaning in this exact context, examples, and usage notes.

4. Review until it sticks. Everything you save lands in your Flicktionary account, where spaced repetition schedules your reviews. Words captured while watching join the same vocabulary you build while reading on flicktionary.app.

ALSO IN THE EXTENSION

• Import any article: one click extracts the readable text of the page you're on — no ads, no clutter — and opens it as a reading session in Flicktionary.
• Bring your own subtitles: load .srt, .vtt, .ass, .dfxp or .ttml2 files for any video — including sites without native subtitle support.
• Subtitle timing and appearance controls.

LANGUAGES

Learn any of 20 languages, including Spanish, French, German, Japanese, Korean, Chinese, Russian, Portuguese, Arabic, Turkish and Vietnamese. The subtitle language is detected automatically — if you watch a Russian video, the words go into your Russian vocabulary.

GETTING STARTED

The extension is a companion to flicktionary.app. Create an account there, pair the extension with one click, and start watching.

Flicktionary is not affiliated with or endorsed by any of the streaming services listed.
```

## Short description / summary

Matches the manifest (`_locales/*/messages.json` → `extensionDescription`):

- en: `Enhance streaming video for language-learning.`
- fr: `Améliorer la vidéo en streaming pour l'apprentissage des langues.`
