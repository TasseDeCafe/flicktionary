import { SettingsProvider } from '@asbplayer-fork/common/settings'
import { mountArticleHighlightHost, type ShadowHostHandle } from '@/ui/shadow/shadow-host'
import { ShadowUiProvider } from '@/ui/shadow/shadow-ui-provider'
import { ExtensionSettingsStorage } from '@/services/extension-settings-storage'
import { ArticleHighlightApp } from './ArticleHighlightApp'
import { ARTICLE_HOST_ATTR, articleActiveFlagKey } from '@/services/article-highlight/constants'

// The heavy dynamic-import boundary: pulling this module in pulls React,
// @flicktionary/ui, Tailwind, Lingui and (transitively, on demand) Readability.
// The always-injected content script only import()s this when the user actually
// toggles highlighting on, so every other page pays just the listener cost.

export interface ArticleHighlightController {
  destroy(): void
}

export interface StartArticleHighlightingOptions {
  // Called after a user-initiated close (× / Switch off) tears the host down, so
  // the content script can drop its controller reference — otherwise the next
  // toggle would only deactivate a stale handle and the user has to press twice.
  onClosed: () => void
}

export const startArticleHighlighting = async (
  options: StartArticleHighlightingOptions
): Promise<ArticleHighlightController> => {
  // Activate the user's interface locale (per-realm Lingui singleton) before
  // mounting, so the banner/popover strings render in the right language.
  const language = await new SettingsProvider(new ExtensionSettingsStorage()).getSingle('language')

  let handle: ShadowHostHandle | null = null

  const close = () => {
    if (!handle) return
    handle.unmount()
    handle = null
    try {
      sessionStorage.removeItem(articleActiveFlagKey(location.href))
    } catch {
      // sessionStorage can throw in sandboxed frames — the flag is best-effort.
    }
    options.onClosed()
  }

  handle = mountArticleHighlightHost({
    hostAttribute: ARTICLE_HOST_ATTR,
    // The banner/popover float over the page and are styled light; pin the
    // surface theme to 'light' regardless of the user's app theme.
    render: ({ portalContainer }) => (
      <ShadowUiProvider portalContainer={portalContainer} themeType='light' language={language}>
        <ArticleHighlightApp onClose={close} />
      </ShadowUiProvider>
    ),
  })

  try {
    sessionStorage.setItem(articleActiveFlagKey(location.href), '1')
  } catch {
    // best-effort (see above)
  }

  return { destroy: close }
}
