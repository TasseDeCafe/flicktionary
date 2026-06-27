import TabRegistry from '@/services/tab-registry'
import VideoHeartbeatHandler from '@/handlers/video/video-heartbeat-handler'
import ToggleSubtitlesHandler from '@/handlers/video/toggle-subtitles-handler'
import SyncHandler from '@/handlers/video/sync-handler'
import VideoToAsbplayerCommandForwardingHandler from '@/handlers/video/video-to-asbplayer-command-forwarding-handler'
import AsbplayerV2ToVideoCommandForwardingHandler from '@/handlers/asbplayerv2/asbplayer-v2-to-video-command-forwarding-handler'
import AsbplayerHeartbeatHandler from '@/handlers/asbplayerv2/asbplayer-heartbeat-handler'
import RefreshSettingsHandler from '@/handlers/popup/refresh-settings-handler'
import { CommandHandler } from '@/handlers/command-handler'
import AckTabsHandler from '@/handlers/asbplayerv2/ack-tabs-handler'
import OpenExtensionShortcutsHandler from '@/handlers/asbplayerv2/open-extension-shortcuts-handler'
import ExtensionCommandsHandler from '@/handlers/asbplayerv2/extension-commands-handler'
import OpenAsbplayerSettingsHandler from '@/handlers/video/open-asbplayer-settings-handler'
import CaptureVisibleTabHandler from '@/handlers/foreground/capture-visible-tab-handler'
import CopyToClipboardHandler from '@/handlers/video/copy-to-clipboard-handler'
import SettingsUpdatedHandler from '@/handlers/asbplayerv2/settings-updated-handler'
import { Command, ExtensionToVideoCommand, Message, ToggleVideoSelectMessage } from '@asbplayer-fork/common'
import { SettingsProvider } from '@asbplayer-fork/common/settings'
import { msg } from '@lingui/core/macro'
import { i18n, setupLingui } from '@/ui/lingui'
import VideoDisappearedHandler from '@/handlers/video/video-disappeared-handler'
import { ExtensionSettingsStorage } from '@/services/extension-settings-storage'
import LoadSubtitlesHandler from '@/handlers/asbplayerv2/load-subtitles-handler'
import { RequestingActiveTabPermissionHandler } from '@/handlers/video/requesting-active-tab-permission'
import AckMessageHandler from '@/handlers/video/ack-message-handler'
import { isFirefoxBuild } from '@/services/build-flags'
import { enqueueUpdateAlert } from '@/services/update-alert'
import RequestSubtitlesHandler from '@/handlers/asbplayerv2/request-subtitles-handler'
import RequestCurrentSubtitleHandler from '@/handlers/asbplayerv2/request-current-subtitle-handler'
import PageConfigHandler from '@/handlers/asbplayerv2/page-config-handler'
import FlicktionaryGlossHandler from '@/handlers/flicktionary/gloss-handler'
import SaveWordHandler from '@/handlers/saved-words/save-word-handler'
import FlicktionaryPairHandler from '@/handlers/flicktionary/flicktionary-pair-handler'
import FlicktionaryPairFinishedHandler from '@/handlers/flicktionary/flicktionary-pair-finished-handler'
import FlicktionaryStartPairingHandler from '@/handlers/flicktionary/start-pairing-handler'
import RegisterFlicktionarySubtitlesHandler from '@/handlers/flicktionary/register-subtitles-handler'
import SetFlicktionaryCefrHandler from '@/handlers/flicktionary/set-cefr-handler'
import LoadFlicktionarySavedHighlightsHandler from '@/handlers/flicktionary/saved-highlights-handler'
import DeleteFlicktionaryHighlightHandler from '@/handlers/flicktionary/delete-highlight-handler'
import UpdateFlicktionaryHighlightNoteHandler from '@/handlers/flicktionary/update-highlight-note-handler'
import GetFlicktionaryStudyTargetsHandler from '@/handlers/flicktionary/get-study-targets-handler'
import FlicktionarySavedGlossHandler from '@/handlers/flicktionary/saved-gloss-handler'
import ImportArticleHandler from '@/handlers/flicktionary/import-article-handler'
import { importArticleFromTab, importSelectionFromTab } from '@/services/flicktionary/import-text'
import { isVideoPlatformUrl } from '@/services/pages'
import SupadataGenerateHandler from '@/handlers/supadata/supadata-generate-handler'
import GetCachedTranscriptHandler from '@/handlers/video/get-cached-transcript-handler'
import ExportTranscriptCacheHandler from '@/handlers/video/export-transcript-cache-handler'
import ClearTranscriptCacheHandler from '@/handlers/video/clear-transcript-cache-handler'
import GetTranscriptCacheCountHandler from '@/handlers/video/get-transcript-cache-count-handler'

export default defineBackground(() => {
  if (!isFirefoxBuild) {
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  }

  const settings = new SettingsProvider(new ExtensionSettingsStorage())

  const installListener = async (details: Browser.runtime.InstalledDetails) => {
    if (details.reason !== browser.runtime.OnInstalledReason.INSTALL) {
      return
    }

    // No install-time language write: the 'system' default resolves the
    // browser locale at runtime, which keeps following it if it changes.
    browser.tabs.create({ url: browser.runtime.getURL('/ftue-ui.html'), active: true })
  }

  const updateListener = async (details: Browser.runtime.InstalledDetails) => {
    if (details.reason !== browser.runtime.OnInstalledReason.UPDATE) {
      return
    }

    enqueueUpdateAlert()
  }

  browser.runtime.onInstalled.addListener(installListener)
  browser.runtime.onInstalled.addListener(updateListener)

  const tabRegistry = new TabRegistry(settings)

  const handlers: CommandHandler[] = [
    new VideoHeartbeatHandler(tabRegistry),
    new ToggleSubtitlesHandler(settings, tabRegistry),
    new SyncHandler(tabRegistry),
    new OpenAsbplayerSettingsHandler(),
    new CopyToClipboardHandler(),
    new VideoDisappearedHandler(tabRegistry),
    new RequestingActiveTabPermissionHandler(),
    new LoadSubtitlesHandler(tabRegistry),
    new RequestSubtitlesHandler(),
    new RequestCurrentSubtitleHandler(),
    new AckMessageHandler(tabRegistry),
    new RefreshSettingsHandler(tabRegistry, settings),
    new VideoToAsbplayerCommandForwardingHandler(tabRegistry),
    new AsbplayerHeartbeatHandler(tabRegistry),
    new AckTabsHandler(tabRegistry),
    new SettingsUpdatedHandler(tabRegistry, settings),
    new OpenExtensionShortcutsHandler(),
    new ExtensionCommandsHandler(),
    new PageConfigHandler(),
    new AsbplayerV2ToVideoCommandForwardingHandler(),
    new CaptureVisibleTabHandler(),
    new FlicktionaryGlossHandler(),
    new SaveWordHandler(),
    new FlicktionaryPairHandler(),
    new FlicktionaryPairFinishedHandler(),
    new FlicktionaryStartPairingHandler(),
    new RegisterFlicktionarySubtitlesHandler(),
    new SetFlicktionaryCefrHandler(),
    new LoadFlicktionarySavedHighlightsHandler(),
    new DeleteFlicktionaryHighlightHandler(),
    new UpdateFlicktionaryHighlightNoteHandler(),
    new GetFlicktionaryStudyTargetsHandler(),
    new FlicktionarySavedGlossHandler(),
    new ImportArticleHandler(),
    new SupadataGenerateHandler(settings),
    new GetCachedTranscriptHandler(),
    new ExportTranscriptCacheHandler(),
    new ClearTranscriptCacheHandler(),
    new GetTranscriptCacheCountHandler(),
  ]

  browser.runtime.onMessage.addListener((request: Command<Message>, sender, sendResponse) => {
    for (const handler of handlers) {
      if (
        (typeof handler.sender === 'string' && handler.sender === request.sender) ||
        (typeof handler.sender === 'object' && handler.sender.includes(request.sender))
      ) {
        if (handler.command === null || handler.command === request.message.command) {
          if (handler.handle(request, sender, sendResponse) === true) {
            return true
          }

          break
        }
      }
    }
  })

  // Context-menu titles render through Lingui (the same en/fr catalog as the
  // rest of the UI), not browser.i18n. They follow the in-app `language` setting
  // rather than the browser UI language.
  let currentMenuLanguage: string | undefined
  // Serialize every (re)build through a single in-flight promise: a burst of
  // storage changes must not interleave a removeAll() between another run's
  // removeAll() and create() — that race would leave the menus missing.
  let menuSetupPromise: Promise<void> = Promise.resolve()

  // The article/selection import menus are meaningless on streaming platforms
  // (where the popup shows the subtitle UI instead), so hide them there. Matched
  // at host level via the same registry the popup uses. Visibility resets to the
  // created default on every rebuild, so this is re-applied at the end of
  // setupContextMenus and whenever the active tab changes.
  const updateImportMenuVisibility = async (url: string | undefined): Promise<void> => {
    if (!browser.contextMenus) {
      return
    }
    const visible = !(await isVideoPlatformUrl(url))
    try {
      await browser.contextMenus.update('flicktionary-import-article', { visible })
      await browser.contextMenus.update('flicktionary-import-selection', { visible })
    } catch {
      // The menus may not exist yet (mid-rebuild) — the rebuild re-applies this.
    }
  }

  const setupContextMenus = (): Promise<void> => {
    menuSetupPromise = menuSetupPromise.then(async () => {
      // Activate the locale even when context menus are unavailable (Firefox
      // can lack the permission) so background-originated toasts still localize.
      currentMenuLanguage = await settings.getSingle('language')
      setupLingui(currentMenuLanguage)
      if (!browser.contextMenus) {
        return
      }
      await browser.contextMenus.removeAll()
      browser.contextMenus.create({
        id: 'load-subtitles',
        title: i18n._(msg`Load Subtitles`),
        contexts: ['page', 'video'],
      })
      // Import the whole article (Readability) when right-clicking the page…
      browser.contextMenus.create({
        id: 'flicktionary-import-article',
        title: i18n._(msg`Import article to Flicktionary`),
        contexts: ['page'],
      })
      // …or just the highlighted text when right-clicking a selection.
      browser.contextMenus.create({
        id: 'flicktionary-import-selection',
        title: i18n._(msg`Add selection to Flicktionary`),
        contexts: ['selection'],
      })
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true })
      await updateImportMenuVisibility(activeTab?.url)
    })
    return menuSetupPromise
  }

  // Keep the import menus' visibility in sync with the foreground tab.
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((tab) => updateImportMenuVisibility(tab.url))
      .catch(() => {})
  })
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
      void updateImportMenuVisibility(changeInfo.url)
    }
  })

  // MV3 doesn't persist context menus across browser restarts, so (re)build them
  // on install/update and on every startup.
  browser.runtime.onInstalled.addListener(() => void setupContextMenus())
  browser.runtime.onStartup.addListener(() => void setupContextMenus())

  // When the in-app language changes (settings live in storage.local), relabel
  // the menus. Re-read the setting rather than parsing `changes` directly — the
  // key may be profile-prefixed (e.g. `<profile>.language`).
  browser.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'local') {
      return
    }
    void (async () => {
      const language = await settings.getSingle('language')
      if (language === currentMenuLanguage) {
        return
      }
      await setupContextMenus()
    })()
  })

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'load-subtitles') {
      const toggleVideoSelectCommand: ExtensionToVideoCommand<ToggleVideoSelectMessage> = {
        sender: 'asbplayer-extension-to-video',
        message: {
          command: 'toggle-video-select',
        },
      }
      tabRegistry.publishCommandToVideoElementTabs((videoTab): ExtensionToVideoCommand<Message> | undefined => {
        if (info.pageUrl !== videoTab.url) {
          return undefined
        }

        return toggleVideoSelectCommand
      })
      return
    }

    if (info.menuItemId === 'flicktionary-import-article' && tab) {
      void importArticleFromTab(tab)
      return
    }

    if (info.menuItemId === 'flicktionary-import-selection' && tab) {
      void importSelectionFromTab(tab, info.selectionText ?? '')
      return
    }
  })

  browser.commands?.onCommand.addListener((command) => {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      switch (command) {
        case 'toggle-video-select':
          for (const tab of tabs) {
            if (typeof tab.id !== 'undefined') {
              const extensionToVideoCommand: ExtensionToVideoCommand<ToggleVideoSelectMessage> = {
                sender: 'asbplayer-extension-to-video',
                message: {
                  command: 'toggle-video-select',
                },
              }
              browser.tabs.sendMessage(tab.id, extensionToVideoCommand)
            }
          }
          break
        default:
          throw new Error('Unknown command ' + command)
      }
    })
  })

  const action = browser.action || browser.browserAction

  if (isFirefoxBuild) {
    let hasHostPermission = true

    browser.permissions.contains({ origins: ['<all_urls>'] }, (result) => {
      hasHostPermission = result

      if (hasHostPermission) {
        action.setPopup({
          popup: 'popup-ui.html',
        })
      }
    })

    action.onClicked.addListener(async () => {
      if (hasHostPermission) {
        action.openPopup()
      } else {
        try {
          const obtainedHostPermission = await browser.permissions.request({ origins: ['<all_urls>'] })

          if (obtainedHostPermission) {
            hasHostPermission = true
            browser.runtime.reload()
          }
        } catch (e) {
          console.error(e)
        }
      }
    })
  } else {
    action.setPopup({
      popup: 'popup-ui.html',
    })

    action.onClicked.addListener(() => action.openPopup())
  }
})
