// Shared article extraction: the import flow and the on-page highlight flow both
// need to segment a page identically. The live↔segment mapper (article-highlight)
// matches live block elements to the backend-returned segment strings byte for
// byte, so it MUST use the exact same block selector and trim rule the extractor
// feeds the backend. Keeping that logic here — single source of truth — is what
// makes `segment.text === liveBlock.textContent.trim()` provable.
//
// Readability is dynamically imported by callers' content scripts so its ~30KB
// only loads on demand; this module is import()'d from those scripts too, so it
// stays out of the always-injected static bundle.

// Stable codes the content script returns instead of localized prose, so the
// always-injected content bundle never pulls in the Lingui catalog. The
// background maps them to localized messages.
export type ArticleExtractionErrorCode = 'no-readable-article' | 'extract-failed'

// Result an extraction request returns.
export type ArticleExtractionResult =
  | { ok: true; title: string; text: string }
  | { ok: false; errorCode: ArticleExtractionErrorCode }

// The block selector the backend's segmentation is fed from. The live-DOM mapper
// queries the SAME selector against the page so its blocks line up with segments.
export const ARTICLE_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre'

// Build readable, paragraph-segmented plain text from Readability's sanitized
// HTML: one line per block element so the backend's line-based parser yields one
// segment per paragraph (rather than one giant blob). Falls back to the flat
// textContent if block extraction comes up empty.
export const extractArticle = async (): Promise<ArticleExtractionResult> => {
  try {
    const { Readability } = await import('@mozilla/readability')
    // Readability mutates the document it parses, so always hand it a clone.
    const documentClone = document.cloneNode(true) as Document
    const article = new Readability(documentClone).parse()

    const flatText = article?.textContent?.trim() ?? ''
    if (!article || flatText.length === 0) {
      return { ok: false, errorCode: 'no-readable-article' }
    }

    let body = flatText
    if (article.content) {
      const container = document.createElement('div')
      container.innerHTML = article.content
      const blocks = container.querySelectorAll(ARTICLE_BLOCK_SELECTOR)
      const lines = Array.from(blocks)
        .map((block) => block.textContent?.trim() ?? '')
        .filter((line) => line.length > 0)
      if (lines.length > 0) {
        body = lines.join('\n')
      }
    }

    const title = (article.title || document.title || 'Imported article').trim()

    // Readability captures the title separately and strips it (and the
    // standfirst/dek) from `content`, so on its own the title is neither part of
    // the reading text nor highlightable. Prepend it as the first block-line so
    // it's imported, and — because `article.title` matches the page's <h1> on
    // most article sites — highlightable too (the segment-DOM mapper maps the
    // live <h1>, which is already in ARTICLE_BLOCK_SELECTOR). Guard against the
    // rare site that already includes the title as its first block.
    const firstLine = body.split('\n', 1)[0]
    const text = title && title !== firstLine ? `${title}\n${body}` : body

    return { ok: true, title, text }
  } catch {
    return { ok: false, errorCode: 'extract-failed' }
  }
}
