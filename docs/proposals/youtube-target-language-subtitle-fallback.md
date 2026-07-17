# YouTube target-language subtitle fallback

> **Status: proposal.** Open design, not implemented. Auto-load a target-language track on YouTube videos where the video-language auto-sync policy has no language signal.

## The edge case

The video-language auto-sync policy (spec: `apps/extension/EXTENSION-SPEC.md`; implementation in
`apps/extension/src/services/youtube-audio-track.ts` → `resolveVideoLanguage` and
`apps/extension/src/controllers/video-data-sync-controller.ts` → `_setSyncedData`) resolves the
video's language from five signals: dub xtags, sole ASR track, playing audio track's xtags lang,
default `audioTrackId`, single human track. When all five are absent/ambiguous it loads nothing,
silently, by design ("never guess a language the video is not in").

Narration-only videos defeat all five at once (observed on
[Azqnb4ccXwY](https://www.youtube.com/watch?v=Azqnb4ccXwY), a no-speech travel video whose
"narration" is its 16 human subtitle tracks):

- No speech → YouTube never generates ASR, killing the workhorse signal.
- Single unlabeled audio track → no xtags lang, no `audioTrackId` (verified: the web player
  response's `audioTracks[0]` has only `captionTrackIndices`/`hasDefaultTrack`).
- Many human tracks → the single-human-track heuristic doesn't fire.

Track discovery and srv3 fetching work fine on such videos; only the selection resolves to
"nothing". Manual loading via the track dialog works today.

## Proposal

When `resolveVideoLanguage` yields `undefined` (no signal — not when a signal exists but no track
matches it), fall back to the user's Flicktionary primary target language and auto-load a matching
track if one exists. This is user intent, not a guess about the video, so it doesn't violate the
no-guessing rule: on a signal-less video, the track the learner would pick manually is the one in
the language they study.

Sketch:

- `apps/extension/src/services/flicktionary/flicktionary-target-language.ts` already caches the
  primary target language in `browser.storage.local`. Add a storage-only reader (mirroring
  `getCachedFlicktionaryNativeLanguage`) so the content script can read it without a network call —
  content scripts must not hit the API directly, and `getFlicktionaryTargetLanguage` may fetch.
- In `_setSyncedData` (`video-data-sync-controller.ts`), where `selectVideoLanguageTrack` currently
  returns `undefined` and declines: when `this._syncedData.videoLanguage` is `undefined`, retry
  `selectVideoLanguageTrack(subtitles, cachedTargetLanguage)`. The existing ranking (human over
  ASR, exact code over primary subtag) applies unchanged; the pure selector stays pure.
- Still nothing matching (or no cached target language — unpaired) → decline as today.

## Decisions taken (revisit if implementing)

- **Only fire when the video language is unknown.** If the video is known to be in X and has no X
  track, loading target-language subs would mismatch the audio; keep the silent decline there.
- **Primary target language only**, not the remembered translation-target list
  (`streamingPages.youtube.targetLanguages`) — that list encodes "languages I translate *into*",
  which includes the native language and would auto-load native-language subs on every
  signal-less video.

## Rejected alternatives

- `captionsInitialState: CAPTIONS_INITIAL_STATE_ON_RECOMMENDED` — inconsistent across InnerTube
  clients (web said ON, ANDROID said OFF for the same video) and doesn't name a language.
- `defaultCaptionTrackIndex` — tracks the viewer's UI locale, not the video's language (observed:
  `hl=en` request → English default, bare request from a German IP → German default).

## Priority

Low. Narration-only videos are marginal for language learning (no audio to comprehend), and the
manual track dialog already covers them.
