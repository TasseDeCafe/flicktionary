import overlayCss from '../video-overlay/overlay.css?inline'

// One adopted stylesheet shared across every overlay shadow root in this
// document/realm. Tailwind's generated CSS is identical for every Binding/host,
// so a single read-only CSSStyleSheet is enough — and the same object can be
// assigned to `adoptedStyleSheets` on multiple shadow roots.
//
// This is the px-pinned `@theme` block (see overlay.css) that immunises the
// overlay chrome against the host page's `<html>` font-size. MUI surfaces don't
// adopt it by default (emotion + CssBaseline own their styling); it's opt-in for
// any net-new Tailwind chrome.
let sheetCache: CSSStyleSheet | undefined

export const overlaySheet = (): CSSStyleSheet => {
  if (!sheetCache) {
    sheetCache = new CSSStyleSheet()
    sheetCache.replaceSync(overlayCss)
  }
  return sheetCache
}
