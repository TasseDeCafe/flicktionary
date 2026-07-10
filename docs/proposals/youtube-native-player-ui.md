# Reusing YouTube's native player UI for subtitle control

> **Status: implemented.** Both slices of the effort to reuse YouTube's native player controls (CC button, gear→Subtitles/CC menu) as the extension's subtitle UI, Language Reactor-style, have shipped. Slice 1 (PR #233) is specced in `apps/extension/EXTENSION-SPEC.md` § "Native caption control"; slice 2 in § "Native track mirroring" — the spec is authoritative, this doc is kept as design history only.

## Goal

On YouTube, the extension's subtitle controls should be the player's own,
already-familiar UI instead of parallel extension chrome:

1. **CC button** toggles the extension's subtitles (slice 1 — shipped).
2. **Gear → Subtitles/CC menu** (including Auto-translate) selects the track
   the extension loads (slice 2 — open).

The Select Subtitles dialog stays either way: the native menu can express only
one track, while the dialog owns the second track, human-translation pairing,
Open Files, Generate (Whisper), video name, and remember-per-site. The native
surfaces are the fast path, the dialog the full-control path.

## Verified player facts (live-probed 2026-07-10)

The watch-page `#movie_player` element exposes the captions module with the
same shape as the documented iframe player API. Facts slice 2 depends on:

- `getOption('captions', 'track')` returns the current selection including
  `translationLanguage` when Auto-translate is active — but returns `{}` while
  captions are toggled off. Any track mirroring must remember the last track
  itself, never read it lazily.
- `setOption('captions', 'track', { languageCode, translationLanguage? })`
  works for both plain tracks and auto-translate (usable for write-back so the
  native menu reflects dialog choices).
- `onApiChange` fires on captions-module load/unload only — **not** on CC
  toggles or track changes. Toggle detection is a MutationObserver on
  `.ytp-subtitles-button[aria-pressed]` (shipped in slice 1).
- Every native track change fires a `/api/timedtext` request carrying exactly
  `lang`, `kind` (`asr` or absent) and `tlang` (auto-translate target).
  Patching `window.fetch` misses these (YouTube captures its network functions
  at boot; a content-script-injected patch lands too late), but a
  **`PerformanceObserver` on `resource` entries sees every timedtext load
  regardless of transport** — no monkey-patching, no timing dependence.

## Slice 1 — CC button as the subtitle toggle (shipped, PR #233)

See `EXTENSION-SPEC.md` § "Native caption control" for the authoritative
behavior: the self-negotiating `asbplayer-native-captions-*` CustomEvent
protocol, the `displaySubtitlesOverride` per-video visibility layer, the
adopt-vs-reveal rule (auto-sync adopts YouTube's persisted CC state so the
toggle survives reloads; explicit loads force it on), native caption-rendering
suppression, and the overlay toggle hiding while the native control is in
charge.

Design decisions fixed there that slice 2 inherits:

- The native control is **video-local**: it never writes the global
  `streamingDisplaySubtitles` setting, so YouTube CC presses cannot affect
  other tabs or sites.
- The protocol is site-agnostic; only `youtube-page.ts` implements it. Other
  sites keep the overlay toggle without any per-site flag.

## Slice 2 — gear-menu track selection (shipped)

See `EXTENSION-SPEC.md` § "Native track mirroring" for the authoritative
behavior: PerformanceObserver detection of `/api/timedtext` triples, the
(lang, asr, tlang?) mapping onto the published track list (with synthesis for
never-published auto-translate targets), `setOption` write-back so the native
menu tracks what's loaded, per-video arming, and the echo/serialization
guards.

The open questions above were resolved as:

- The second subtitle track survives a native switch (the menu owns slot 1
  only); the dialog's translation-toggle overlay track does not (it's tied to
  the previous primary; `streamingTranslationMode` reconstructs it on the next
  dialog confirm).
- `m.youtube.com`/Shorts keep slice 1's graceful degradation (per-video
  arming + a `#movie_player` containment guard on the content side).
- A native pick is session-local — it never writes
  `streamingLastLanguagesSynced` — but a picked auto-translate target is
  recorded into `streamingPages.youtube.targetLanguages`, exactly like a
  dialog confirm (that list offers variants, it never auto-loads).
