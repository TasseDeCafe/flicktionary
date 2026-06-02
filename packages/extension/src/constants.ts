// The maximum 32-bit signed integer, used as the stacking z-index for injected
// overlays so they sit above any site content.
//
// NB: this constant only covers JS/DOM-style usages. The equivalent `z-[2147483647]`
// Tailwind classes (SaveToast/CefrPicker/GlossTooltip) and the `!important` rules in
// video.content/video.css are kept literal — Tailwind's JIT only extracts static
// class strings, so they can't reference this value and must be updated by hand.
export const MAX_Z_INDEX = 2147483647
