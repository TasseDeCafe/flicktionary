import overlayCss from '../video-overlay/overlay.css?inline'
// sonner auto-injects this same CSS into document.head at runtime, but that copy
// never reaches a shadow root — so we fold it into the adopted sheet ourselves
// (raw string append, not an @import, to dodge Tailwind-v4 @import resolution).
// The head copy is then a harmless duplicate. The toaster host adopts this sheet.
import sonnerCss from 'sonner/dist/styles.css?inline'

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
    sheetCache.replaceSync(overlayCss + '\n' + sonnerCss)
  }
  return sheetCache
}
