// Marker attribute on the article-highlight shadow host, used to ignore pointer
// events that originate inside our own banner/popover (composedPath check).
export const ARTICLE_HOST_ATTR = 'data-flicktionary-article-highlight-host'

// Per-tab sessionStorage flag (keyed by URL) recording that highlighting is
// active on this page, so a reload auto-reactivates and repaints from the
// server. Cleared on toggle-off; sessionStorage clears on tab close, matching
// the ephemeral-paint stance.
export const articleActiveFlagKey = (href: string): string => `flicktionary.article-highlight-active:${href}`
