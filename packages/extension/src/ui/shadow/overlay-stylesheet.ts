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

const overlayCssText = () => overlayCss + '\n' + sonnerCss

// Custom-property registrations (`@property`) are per-DOCUMENT, and Chromium
// ignores the at-rules when they arrive via a shadow-root stylesheet. Tailwind
// v4 leans on them hard: utilities like `border` emit
// `border-style: var(--tw-border-style)` whose `solid` lives in an @property
// initial-value (its universal fallback block is @supports-gated to browsers
// WITHOUT @property support, so Chrome never activates it). Unregistered, the
// var() goes invalid at computed-value time and the whole declaration is
// dropped — invisible borders, dead animate-in/out transitions. So walk the
// parsed sheet and re-register every @property imperatively through the
// document-global JS API.
const registerPropertyRules = (rules: CSSRuleList): void => {
  if (typeof CSSPropertyRule === 'undefined') {
    return
  }
  for (const rule of rules) {
    if (rule instanceof CSSPropertyRule) {
      try {
        CSS.registerProperty({
          name: rule.name,
          syntax: rule.syntax,
          inherits: rule.inherits,
          initialValue: rule.initialValue ?? undefined,
        })
      } catch {
        // Already registered — by another overlay surface, by the host page
        // using the same Tailwind vars, or by a browser that did honour the
        // @property rule. Identical definitions, safe to skip.
      }
    } else if ('cssRules' in rule) {
      // @property can sit inside @layer/@supports blocks; recurse.
      registerPropertyRules((rule as CSSGroupingRule).cssRules)
    }
  }
}

const overlaySheet = (): CSSStyleSheet => {
  if (!sheetCache) {
    sheetCache = new CSSStyleSheet()
    sheetCache.replaceSync(overlayCssText())
    registerPropertyRules(sheetCache.cssRules)
  }
  return sheetCache
}

// Apply the overlay styles to a shadow root. Prefer the shared adopted sheet,
// but Firefox content scripts can't assign a sandbox-created CSSStyleSheet
// through the page's Xray wrapper ("Accessing from Xray wrapper is not
// supported", https://bugzilla.mozilla.org/show_bug.cgi?id=1751346) — fall back
// to a <style> element there. The fallback duplicates the CSS text per shadow
// root, which is fine: these hosts are few and long-lived.
export const applyOverlayStyles = (shadowRoot: ShadowRoot): void => {
  try {
    shadowRoot.adoptedStyleSheets = [overlaySheet()]
  } catch {
    const style = document.createElement('style')
    style.textContent = overlayCssText()
    shadowRoot.appendChild(style)
    // The <style> fallback needs the same @property re-registration as the
    // adopted sheet (registrations are per-document either way).
    if (style.sheet) {
      registerPropertyRules(style.sheet.cssRules)
    }
  }
}
