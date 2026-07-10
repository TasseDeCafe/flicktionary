# Reusing YouTube's native player UI for subtitle control

> **Status: proposal.** Tracks the two-slice effort to reuse YouTube's native player controls (CC button, gear→Subtitles/CC menu) as the extension's subtitle UI, Language Reactor-style. Slice 1 shipped (PR #233) — its behavior is specced in `apps/extension/EXTENSION-SPEC.md` § "Native caption control", which is authoritative. Slice 2 is an open design; nothing in it is current behavior.

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

## Slice 2 — gear-menu track selection (open)

Sketch, to be refined before implementation:

- **Detection**: page script registers a `PerformanceObserver` for
  `/api/timedtext` resource entries; on a hit, read the `(lang, kind, tlang)`
  triple from the URL and confirm against `getOption('captions', 'track')`.
  Publish a `track-selected` event to the content script.
- **Mapping**: the triple maps onto the already-published track list —
  `trackMergeKey` is `language:asr|manual` and auto-translate corresponds 1:1
  to the existing `tlang` machine-translation synthesis (`L_from_base`
  tracks). Feed the match into the existing `VideoDataSyncController` load
  path (srv3 fetch, POT token, ASR re-chunking all reused).
- **Write-back**: on dialog confirm / auto-sync, `setOption` the primary track
  into the player so the native menu shows a checkmark on what is actually
  loaded (avoids LR's "menu says Off while subs show" drift).
- **Guards**: ignore timedtext fetches the extension itself triggers
  (write-back and initial reveal cause native fetches); dedupe against the
  currently loaded track; decide behavior when the selected native track has
  no match (e.g. a language the track list lacks — likely load it anyway via a
  synthesized URL).

Open questions:

- Does the second subtitle track survive a native track switch (probably yes:
  only slot 1 changes), and how does that interact with remembered tracks?
- `m.youtube.com` and Shorts: different chrome; slice 1 already degrades
  gracefully there (no CC button found → overlay toggle), slice 2 should keep
  that property.
- Whether a native track switch should update `streamingLastLanguagesSynced`
  (remembered choices) or stay session-local.
