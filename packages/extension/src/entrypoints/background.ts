import TabRegistry from '@/services/tab-registry'
import VideoHeartbeatHandler from '@/handlers/video/video-heartbeat-handler'
import ToggleSubtitlesHandler from '@/handlers/video/toggle-subtitles-handler'
import SyncHandler from '@/handlers/video/sync-handler'
import HttpPostHandler from '@/handlers/video/http-post-handler'
import VideoToAsbplayerCommandForwardingHandler from '@/handlers/video/video-to-asbplayer-command-forwarding-handler'
import AsbplayerToVideoCommandForwardingHandler from '@/handlers/asbplayer/asbplayer-to-video-command-forwarding-handler'
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
import { fetchSupportedLanguages, primeLocalization } from '@/services/localization-fetcher'
import VideoDisappearedHandler from '@/handlers/video/video-disappeared-handler'
import { ExtensionSettingsStorage } from '@/services/extension-settings-storage'
import LoadSubtitlesHandler from '@/handlers/asbplayerv2/load-subtitles-handler'
import { RequestingActiveTabPermissionHandler } from '@/handlers/video/requesting-active-tab-permission'
import AckMessageHandler from '@/handlers/video/ack-message-handler'
import { isFirefoxBuild } from '@/services/build-flags'
import RequestModelHandler from '@/handlers/mobile-overlay/request-model-handler'
import CurrentTabHandler from '@/handlers/mobile-overlay/current-tab-handler'
import UpdateMobileOverlayModelHandler from '@/handlers/video/update-mobile-overlay-model-handler'
import { isMobile } from '@asbplayer-fork/common/device-detection/mobile'
import { enqueueUpdateAlert } from '@/services/update-alert'
import RequestSubtitlesHandler from '@/handlers/asbplayerv2/request-subtitles-handler'
import RequestCurrentSubtitleHandler from '@/handlers/asbplayerv2/request-current-subtitle-handler'
import MobileOverlayForwarderHandler from '@/handlers/mobile-overlay/mobile-overlay-forwarder-handler'
import PageConfigHandler from '@/handlers/asbplayerv2/page-config-handler'
import { DictionaryDB } from '@asbplayer-fork/common/dictionary-db/dictionary-db'
import DictionaryHandler from '@/handlers/dictionary/dictionary-handler'
import FlicktionaryGlossHandler from '@/handlers/flicktionary/gloss-handler'
import SaveWordHandler from '@/handlers/saved-words/save-word-handler'
import FlicktionaryPairHandler from '@/handlers/flicktionary/flicktionary-pair-handler'
import RegisterFlicktionarySubtitlesHandler from '@/handlers/flicktionary/register-subtitles-handler'
import SetFlicktionaryCefrHandler from '@/handlers/flicktionary/set-cefr-handler'
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

  const startListener = async () => {
    primeLocalization(await settings.getSingle('language'))
  }

  const installListener = async (details: Browser.runtime.InstalledDetails) => {
    if (details.reason !== browser.runtime.OnInstalledReason.INSTALL) {
      return
    }

    const defaultUiLanguage = browser.i18n.getUILanguage()
    const supportedLanguages = await fetchSupportedLanguages()

    if (supportedLanguages.includes(defaultUiLanguage)) {
      await settings.set({ language: defaultUiLanguage })
      primeLocalization(defaultUiLanguage)
    }

    if (isMobile) {
      // Set reasonable defaults for mobile
      await settings.set({
        subtitleSize: 18,
        subtitlePositionOffset: 25,
        topSubtitlePositionOffset: 25,
        subtitlesWidth: 100,
      })
    }

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
  browser.runtime.onStartup.addListener(startListener)

  const tabRegistry = new TabRegistry(settings)
  const dictionaryDB = new DictionaryDB()

  const handlers: CommandHandler[] = [
    new VideoHeartbeatHandler(tabRegistry),
    new ToggleSubtitlesHandler(settings, tabRegistry),
    new SyncHandler(tabRegistry),
    new HttpPostHandler(),
    new OpenAsbplayerSettingsHandler(),
    new CopyToClipboardHandler(),
    new DictionaryHandler(dictionaryDB),
    new VideoDisappearedHandler(tabRegistry),
    new RequestingActiveTabPermissionHandler(),
    new LoadSubtitlesHandler(tabRegistry),
    new RequestSubtitlesHandler(),
    new RequestCurrentSubtitleHandler(),
    new AckMessageHandler(tabRegistry),
    new UpdateMobileOverlayModelHandler(),
    new RefreshSettingsHandler(tabRegistry, settings),
    new VideoToAsbplayerCommandForwardingHandler(tabRegistry),
    new AsbplayerToVideoCommandForwardingHandler(),
    new AsbplayerHeartbeatHandler(tabRegistry),
    new AckTabsHandler(tabRegistry),
    new SettingsUpdatedHandler(tabRegistry, settings),
    new OpenExtensionShortcutsHandler(),
    new ExtensionCommandsHandler(),
    new PageConfigHandler(),
    new AsbplayerV2ToVideoCommandForwardingHandler(),
    new CaptureVisibleTabHandler(),
    new RequestModelHandler(),
    new CurrentTabHandler(),
    new MobileOverlayForwarderHandler(),
    new FlicktionaryGlossHandler(),
    new SaveWordHandler(),
    new FlicktionaryPairHandler(),
    new RegisterFlicktionarySubtitlesHandler(),
    new SetFlicktionaryCefrHandler(),
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

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus?.create({
      id: 'load-subtitles',
      title: browser.i18n.getMessage('contextMenuLoadSubtitles'),
      contexts: ['page', 'video'],
    })
  })

  browser.contextMenus?.onClicked.addListener((info) => {
    if (info.menuItemId === 'load-subtitles') {
      const toggleVideoSelectCommand: ExtensionToVideoCommand<ToggleVideoSelectMessage> = {
        sender: 'asbplayer-extension-to-video',
        message: {
          command: 'toggle-video-select',
        },
      }
      tabRegistry.publishCommandToVideoElementTabs((tab): ExtensionToVideoCommand<Message> | undefined => {
        if (info.pageUrl !== tab.url) {
          return undefined
        }

        return toggleVideoSelectCommand
      })
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

  const defaultAction = (tab: Browser.tabs.Tab) => {
    if (isMobile) {
      if (tab.id !== undefined) {
        const extensionToVideoCommand: ExtensionToVideoCommand<ToggleVideoSelectMessage> = {
          sender: 'asbplayer-extension-to-video',
          message: {
            command: 'toggle-video-select',
          },
        }
        browser.tabs.sendMessage(tab.id, extensionToVideoCommand)
      }
    } else {
      action.openPopup()
    }
  }

  if (isFirefoxBuild) {
    let hasHostPermission = true

    browser.permissions.contains({ origins: ['<all_urls>'] }, (result) => {
      hasHostPermission = result

      if (hasHostPermission && !isMobile) {
        action.setPopup({
          popup: 'popup-ui.html',
        })
      }
    })

    action.onClicked.addListener(async (tab) => {
      if (hasHostPermission) {
        defaultAction(tab)
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
    if (!isMobile) {
      action.setPopup({
        popup: 'popup-ui.html',
      })
    }

    action.onClicked.addListener(defaultAction)
  }
})
