// The maximum 32-bit signed integer, used as the stacking z-index for injected
// overlays so they sit above any site content.
//
// NB: this constant only covers JS/DOM-style usages. The equivalent `z-[2147483647]`
// Tailwind classes (CefrPicker/GlossTooltip) and the `!important` rules in
// video.content/video.css are kept literal — Tailwind's JIT only extracts static
// class strings, so they can't reference this value and must be updated by hand.
export const MAX_Z_INDEX = 2147483647

// YouTube-ONLY stacking z-index for the persistent video overlays (subtitle text
// + controls pill). Everywhere else they stay at MAX_Z_INDEX — Prime Video and
// Netflix players use high-z chrome that hides a low overlay. YouTube is the
// exception: its masthead and search autocomplete live around z-index ~2022, so
// an always-on overlay at the max int covers them. ~1000 clears in-player
// controls (z-index in the tens) while staying under YouTube's page UI. The host
// gate lives in shadow-host.ts (controls pill) and a `html.asbplayer-youtube`
// marker class set by the video content script (subtitle CSS).
//
// MAX_Z_INDEX is reserved for intentional, transient surfaces the user just
// invoked (modals, toasts, the gloss tooltip/CEFR picker), which stay on top
// everywhere. The matching subtitle override lives in video.content/video.css
// (kept literal at 999 — one below this so the controls pill wins on overlap;
// see the NB above re: Tailwind/CSS not reading this value).
export const YOUTUBE_OVERLAY_Z_INDEX = 1000
