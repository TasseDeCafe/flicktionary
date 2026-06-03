import {
  ActiveProfileMessage,
  ConfirmedVideoDataSubtitleTrack,
  GetCachedTranscriptMessage,
  GetCachedTranscriptResponse,
  Message,
  OpenAsbplayerSettingsMessage,
  SerializedSubtitleFile,
  SettingsUpdatedMessage,
  SupadataGenerateMessage,
  SupadataGenerateResponse,
  TabToExtensionCommand,
  VideoData,
  VideoDataSubtitleTrack,
  VideoDataUiBridgeConfirmMessage,
  VideoDataUiBridgeOpenFileMessage,
  VideoDataUiModel,
  VideoDataUiOpenReason,
  VideoToExtensionCommand,
} from '@asbplayer-fork/common'
import { AsbplayerSettings, SettingsProvider } from '@asbplayer-fork/common/settings'
import { base64ToBlob, bufferToBase64 } from '@asbplayer-fork/common/base64'
import { createElement } from 'react'
import Binding from '../services/binding'
import { currentPageDelegate } from '../services/pages'
import { i18n, setupLingui } from '../ui/lingui'
import { msg } from '@lingui/core/macro'
import { ExtensionGlobalStateProvider } from '@/services/extension-global-state-provider'
import { isOnTutorialPage } from '@/services/tutorial'
import { mountModalHost, type ShadowHostHandle } from '@/ui/shadow/shadow-host'
import {
  ShadowVideoDataSyncApp,
  VideoDataModelChannel,
  type VideoDataCommands,
} from '@/ui/video-data-sync/ShadowVideoDataSyncApp'

// The in-realm model sink (the channel) exposes updateState; this minimal shape
// is what the rest of the controller drives.
interface VideoDataClient {
  updateState(state: Partial<VideoDataUiModel>): void
}

// Marker for the in-realm video-data-sync shadow host.
const VIDEO_DATA_SYNC_HOST_ATTR = 'data-asbplayer-video-data-sync-host'

declare global {
  function cloneInto(obj: any, targetScope: any, options?: any): any
}

interface ShowOptions {
  reason: VideoDataUiOpenReason
  fromAsbplayerId?: string
}

const fetchDataForLanguageOnDemand = (language: string): Promise<VideoData> => {
  return new Promise((resolve, reject) => {
    const listener = (event: Event) => {
      const data = (event as CustomEvent).detail as VideoData
      resolve(data)
      document.removeEventListener('asbplayer-synced-language-data', listener, false)
    }
    document.addEventListener('asbplayer-synced-language-data', listener, false)
    document.dispatchEvent(new CustomEvent('asbplayer-get-synced-language-data', { detail: language }))
  })
}

const globalStateProvider = new ExtensionGlobalStateProvider()

export default class VideoDataSyncController {
  private readonly _context: Binding
  private readonly _domain: string
  private readonly _settings: SettingsProvider

  private _autoSync?: boolean
  private _lastLanguagesSynced: { [key: string]: string[] }
  private _emptySubtitle: VideoDataSubtitleTrack
  private _syncedData?: VideoData
  private _wasPaused?: boolean
  private _fullscreenElement?: Element
  private _activeElement?: Element
  private _autoSyncAttempted: boolean = false
  private _dataReceivedListener?: (event: Event) => void
  private _isTutorial: boolean

  // The subtitle-track dialog renders in the content-script realm via a
  // fullscreen-aware modal shadow host. The model flows through `_channel`
  // (partial updateState pushes) and the UI commands route through
  // `_handleUiCommand`.
  private _channel?: VideoDataModelChannel
  private _shadowHandle?: ShadowHostHandle
  private _shadowOpen = false

  constructor(context: Binding, settings: SettingsProvider) {
    this._context = context
    this._settings = settings
    this._autoSync = false
    this._lastLanguagesSynced = {}
    this._emptySubtitle = {
      id: '-',
      language: '-',
      url: '-',
      label: i18n._(msg`Empty`),
      extension: 'srt',
    }
    this._domain = new URL(window.location.href).host
    this._isTutorial = isOnTutorialPage()
  }

  // The clean human title for the current video as resolved by the site's
  // page-script (show + "S01E02" + episode title on Netflix, etc.). Undefined
  // for manually-loaded subtitle files. Used for the Flicktionary save title on
  // streaming sites, where document.title is often just the site name.
  get videoBasename(): string | undefined {
    return this._syncedData?.basename
  }

  private get lastLanguagesSynced(): string[] {
    return this._lastLanguagesSynced[this._domain] ?? []
  }

  private set lastLanguagesSynced(value: string[]) {
    this._lastLanguagesSynced[this._domain] = value
  }

  unbind() {
    if (this._dataReceivedListener) {
      document.removeEventListener('asbplayer-synced-data', this._dataReceivedListener, false)
    }

    this._dataReceivedListener = undefined
    this._syncedData = undefined

    this._shadowHandle?.unmount()
    this._shadowHandle = undefined
    this._channel = undefined
    this._shadowOpen = false
  }

  updateSettings({ streamingAutoSync, streamingLastLanguagesSynced }: AsbplayerSettings) {
    this._autoSync = streamingAutoSync
    this._lastLanguagesSynced = streamingLastLanguagesSynced

    const client = this._clientIfLoaded()
    if (client !== undefined) {
      this._context.settings.getSingle('themeType').then((themeType) => {
        const profilesPromise = this._context.settings.profiles()
        const activeProfilePromise = this._context.settings.activeProfile()
        Promise.all([profilesPromise, activeProfilePromise]).then(([profiles, activeProfile]) => {
          client.updateState({
            settings: {
              themeType,
              profiles,
              activeProfile: activeProfile?.name,
            },
          })
        })
      })
    }
  }

  async requestSubtitles() {
    if (!this._context.hasPageScript) {
      return
    }

    const pageDelegate = await currentPageDelegate()

    if (!pageDelegate?.isVideoPage()) {
      return
    }

    this._syncedData = undefined
    this._autoSyncAttempted = false

    if (!this._dataReceivedListener) {
      this._dataReceivedListener = (event: Event) => {
        const data = (event as CustomEvent).detail as VideoData
        this._setSyncedData(data)
      }
      document.addEventListener('asbplayer-synced-data', this._dataReceivedListener, false)
    }

    if (pageDelegate.config.key === 'youtube') {
      const targetTranslationLanguageCodes =
        (await this._settings.getSingle('streamingPages')).youtube.targetLanguages ?? []
      let payload = { targetTranslationLanguageCodes }
      if (typeof cloneInto === 'function') {
        payload = cloneInto(payload, document.defaultView)
      }
      document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data', { detail: payload }))
    } else {
      document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data'))
    }
  }

  async show({ reason, fromAsbplayerId }: ShowOptions) {
    const client = await this._client()
    const additionalFields: Partial<VideoDataUiModel> = {
      open: true,
      openReason: reason,
    }

    if (fromAsbplayerId !== undefined) {
      additionalFields.openedFromAsbplayerId = fromAsbplayerId
    }

    const model = await this._buildModel(additionalFields)
    this._prepareShow()
    client.updateState(model)
  }

  private async _getCachedTranscript(): Promise<string | undefined> {
    if (!(await this._isYouTube())) {
      return undefined
    }

    try {
      const videoUrl = window.location.href
      const messageId = `get-cached-${Date.now()}`

      const command: TabToExtensionCommand<GetCachedTranscriptMessage> = {
        sender: 'asbplayer-video-tab',
        message: {
          command: 'get-cached-transcript',
          messageId,
          videoUrl,
        },
      }
      // Promise-style sendMessage: Firefox's browser.runtime.sendMessage does
      // not accept a response callback (it throws), and Chrome MV3 returns a
      // promise when the callback is omitted.
      const response: GetCachedTranscriptResponse = await browser.runtime.sendMessage(command)

      return response.subtitles
    } catch (error) {
      console.error('Failed to get cached transcript:', error)
      return undefined
    }
  }

  private async _buildModel(additionalFields: Partial<VideoDataUiModel>) {
    let subtitleTrackChoices = [...(this._syncedData?.subtitles ?? [])]
    const isYouTube = await this._isYouTube()

    // On YouTube, check for cached Whisper subtitles and add to track list
    const cachedTranscript = await this._getCachedTranscript()
    if (isYouTube && cachedTranscript) {
      const cachedTrack: VideoDataSubtitleTrack = {
        id: 'cached-whisper',
        language: 'whisper',
        url: 'cached',
        label: 'Generated (Whisper)',
        extension: 'srt',
      }
      // Add at the beginning so it appears first
      subtitleTrackChoices = [cachedTrack, ...subtitleTrackChoices]
    }

    const subs = this._matchLastSyncedWithAvailableTracks(subtitleTrackChoices)
    const autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks

    // If cached track exists, pre-select it
    let autoSelectedTrackIds: string[]
    if (this._isTutorial) {
      // '1' is the ID of the non-empty track in the tutorial
      // See asbplayer-tutorial-page.ts
      autoSelectedTrackIds = ['1', '-', '-']
    } else if (cachedTranscript) {
      // Pre-select the cached Whisper track
      autoSelectedTrackIds = ['cached-whisper', '-', '-']
    } else {
      autoSelectedTrackIds = autoSelectedTracks.map((subtitle) => subtitle.id || '-')
    }

    const defaultCheckboxState = !this._isTutorial && subs.completeMatch
    const themeType = await this._context.settings.getSingle('themeType')
    const profilesPromise = this._context.settings.profiles()
    const activeProfilePromise = this._context.settings.activeProfile()
    const hasSeenFtue = (await globalStateProvider.get(['ftueHasSeenSubtitleTrackSelector']))
      .ftueHasSeenSubtitleTrackSelector
    const hideRememberTrackPreferenceToggle = this._isTutorial || (await this._pageHidesTrackPrefToggle())
    const transcriptServerUrl =
      (await this._context.settings.getSingle('transcriptServerUrl')) || 'https://asbplayer-production.up.railway.app'
    const supadataApiKeyConfigured = !!transcriptServerUrl
    return this._syncedData
      ? {
          isLoading: this._syncedData.subtitles === undefined,
          suggestedName: this._syncedData.basename,
          selectedSubtitle: autoSelectedTrackIds,
          subtitles: subtitleTrackChoices,
          error: this._syncedData.error,
          defaultCheckboxState: defaultCheckboxState,
          openedFromAsbplayerId: '',
          settings: {
            themeType: themeType,
            profiles: await profilesPromise,
            activeProfile: (await activeProfilePromise)?.name,
          },
          hasSeenFtue,
          hideRememberTrackPreferenceToggle,
          isYouTube,
          supadataApiKeyConfigured,
          ...additionalFields,
        }
      : {
          isLoading: this._context.hasPageScript,
          suggestedName: document.title,
          selectedSubtitle: autoSelectedTrackIds,
          error: '',
          showSubSelect: true,
          subtitles: subtitleTrackChoices,
          defaultCheckboxState: defaultCheckboxState,
          openedFromAsbplayerId: '',
          settings: {
            themeType: themeType,
            profiles: await profilesPromise,
            activeProfile: (await activeProfilePromise)?.name,
          },
          hasSeenFtue,
          hideRememberTrackPreferenceToggle,
          isYouTube,
          supadataApiKeyConfigured,
          ...additionalFields,
        }
  }

  private _matchLastSyncedWithAvailableTracks(subtitleTrackChoices?: VideoDataSubtitleTrack[]) {
    const tracks_list = subtitleTrackChoices ?? this._syncedData?.subtitles ?? []
    let tracks = {
      autoSelectedTracks: [this._emptySubtitle, this._emptySubtitle, this._emptySubtitle],
      completeMatch: false,
    }

    const emptyChoice = this.lastLanguagesSynced.some((lang) => lang !== '-') === undefined

    if (!tracks_list.length && emptyChoice) {
      tracks.completeMatch = true
    } else {
      let matches: number = 0
      for (let i = 0; i < this.lastLanguagesSynced.length; i++) {
        const language = this.lastLanguagesSynced[i]
        for (let j = 0; j < tracks_list.length; j++) {
          if (language === '-') {
            matches++
            break
          } else if (language === tracks_list[j].language) {
            tracks.autoSelectedTracks[i] = tracks_list[j]
            matches++
            break
          }
        }
      }
      if (matches === this.lastLanguagesSynced.length) {
        tracks.completeMatch = true
      }
    }

    return tracks
  }

  private _defaultVideoName(basename: string | undefined, subtitleTrack: VideoDataSubtitleTrack) {
    if (subtitleTrack.url === '-') {
      return basename ?? ''
    }

    if (basename) {
      return `${basename} - ${subtitleTrack.label}`
    }

    return subtitleTrack.label
  }

  private async _setSyncedData(data: VideoData) {
    this._syncedData = data

    if (this._syncedData?.subtitles !== undefined && (await this._canAutoSync())) {
      if (!this._autoSyncAttempted) {
        this._autoSyncAttempted = true

        // On YouTube, check for cached Whisper subtitles first
        const cachedTranscript = await this._getCachedTranscript()
        if (cachedTranscript) {
          const cachedTrack: VideoDataSubtitleTrack = {
            id: 'cached-whisper',
            language: 'whisper',
            url: 'cached',
            label: 'Generated (Whisper)',
            extension: 'srt',
          }
          await this._syncData([cachedTrack, this._emptySubtitle, this._emptySubtitle])

          if (!this._isHidden()) {
            this._hideAndResume()
          }
          return
        }

        const subs = this._matchLastSyncedWithAvailableTracks()

        if (subs.completeMatch) {
          const autoSelectedTracks: VideoDataSubtitleTrack[] = subs.autoSelectedTracks
          await this._syncData(autoSelectedTracks)

          if (!this._isHidden()) {
            this._hideAndResume()
          }
        } else {
          const shouldPrompt = await this._settings.getSingle('streamingAutoSyncPromptOnFailure')

          if (shouldPrompt) {
            await this.show({ reason: VideoDataUiOpenReason.failedToAutoLoadPreferredTrack })
          }
        }
      }
    } else {
      const client = this._clientIfLoaded()
      if (client !== undefined) {
        client.updateState(await this._buildModel({}))
      }
    }
  }

  private async _canAutoSync(): Promise<boolean> {
    const page = await currentPageDelegate()

    if (page === undefined) {
      return this._autoSync ?? false
    }

    return this._autoSync === true && page.canAutoSync(this._context.video)
  }

  private async _pageHidesTrackPrefToggle() {
    return (await currentPageDelegate())?.config?.hideRememberTrackPreferenceToggle ?? false
  }

  private async _isYouTube(): Promise<boolean> {
    const pageDelegate = await currentPageDelegate()
    return pageDelegate?.config?.key === 'youtube'
  }

  // Handle a command coming back from the UI — shared by the iframe onMessage
  // path and the in-realm command callbacks (so both transports run identical
  // logic).
  private async _handleUiCommand(message: Message) {
    if ('openSettings' === message.command) {
      const openSettingsCommand: VideoToExtensionCommand<OpenAsbplayerSettingsMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'open-asbplayer-settings',
        },
        src: this._context.video.src,
      }
      browser.runtime.sendMessage(openSettingsCommand)
      return
    }

    if ('activeProfile' === message.command) {
      const activeProfileMessage = message as ActiveProfileMessage
      await this._context.settings.setActiveProfile(activeProfileMessage.profile)
      const settingsUpdatedCommand: VideoToExtensionCommand<SettingsUpdatedMessage> = {
        sender: 'asbplayer-video',
        message: {
          command: 'settings-updated',
        },
        src: this._context.video.src,
      }
      browser.runtime.sendMessage(settingsUpdatedCommand)
      return
    }

    if ('dismissFtue' === message.command) {
      globalStateProvider.set({ ftueHasSeenSubtitleTrackSelector: true }).catch(console.error)
      return
    }

    if ('generateSupadata' === message.command) {
      this._handleSupadataGeneration()
      return
    }

    let dataWasSynced = true

    if ('confirm' === message.command) {
      const confirmMessage = message as VideoDataUiBridgeConfirmMessage

      if (confirmMessage.shouldRememberTrackChoices) {
        this.lastLanguagesSynced = confirmMessage.data
          .map((track) => track.language)
          .filter((language) => language !== undefined) as string[]
        await this._context.settings.set({ streamingLastLanguagesSynced: this._lastLanguagesSynced }).catch(() => {})
      }

      const data = confirmMessage.data as ConfirmedVideoDataSubtitleTrack[]

      dataWasSynced = await this._syncDataArray(data, confirmMessage.syncWithAsbplayerId)
    } else if ('openFile' === message.command) {
      const openFileMessage = message as VideoDataUiBridgeOpenFileMessage
      const subtitles = openFileMessage.subtitles as SerializedSubtitleFile[]

      try {
        await this._syncSubtitles(subtitles, false)
        dataWasSynced = true
      } catch (e) {
        if (e instanceof Error) {
          await this._reportError(e.message)
        }
      }
    }

    if (dataWasSynced) {
      this._hideAndResume()
    }
  }

  // The in-realm command callbacks: each constructs the same message shape the
  // iframe used to post and routes it through the shared handler above.
  private _shadowCommands(): VideoDataCommands {
    return {
      onOpenSettings: () => void this._handleUiCommand({ command: 'openSettings' }),
      onCancel: () => void this._handleUiCommand({ command: 'cancel' }),
      onConfirm: (data, shouldRememberTrackChoices, syncWithAsbplayerId) =>
        void this._handleUiCommand({
          command: 'confirm',
          data,
          shouldRememberTrackChoices,
          syncWithAsbplayerId,
        } as VideoDataUiBridgeConfirmMessage),
      onOpenFile: (subtitles) =>
        void this._handleUiCommand({ command: 'openFile', subtitles } as VideoDataUiBridgeOpenFileMessage),
      onSetActiveProfile: (profile) =>
        void this._handleUiCommand({ command: 'activeProfile', profile } as ActiveProfileMessage),
      onDismissFtue: () => void this._handleUiCommand({ command: 'dismissFtue' }),
      onGenerateSupadata: () => void this._handleUiCommand({ command: 'generateSupadata' }),
    }
  }

  private async _ensureShadowMounted() {
    if (!this._channel) {
      this._channel = new VideoDataModelChannel()
    }
    if (this._shadowHandle) {
      return
    }
    // Activate the user's locale for this realm before mounting (formerly the
    // iframe's loc script).
    const language = await this._settings.getSingle('language')
    setupLingui(language)
    const channel = this._channel
    const commands = this._shadowCommands()
    this._shadowHandle = mountModalHost({
      hostAttribute: VIDEO_DATA_SYNC_HOST_ATTR,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowVideoDataSyncApp, { channel, shadowRoot, portalContainer, language, commands }),
    })
  }

  // The active model sink (the in-realm channel), or undefined before mount.
  private _clientIfLoaded(): VideoDataClient | undefined {
    return this._channel
  }

  // Whether the dialog is currently hidden.
  private _isHidden(): boolean {
    return !this._shadowOpen
  }

  private async _client(): Promise<VideoDataClient> {
    await this._ensureShadowMounted()
    this._shadowOpen = true
    return this._channel!
  }

  private _prepareShow() {
    this._wasPaused = this._wasPaused ?? this._context.video.paused
    this._context.pause()

    if (document.fullscreenElement) {
      this._fullscreenElement = document.fullscreenElement
      document.exitFullscreen()
    }

    if (document.activeElement) {
      this._activeElement = document.activeElement
    }

    this._context.keyBindings.unbind()
    this._context.subtitleController.forceHideSubtitles = true
    this._context.videoOverlayController.forceHide = true
  }

  private _hideAndResume() {
    this._context.keyBindings.bind(this._context)
    this._context.subtitleController.forceHideSubtitles = false
    this._context.videoOverlayController.forceHide = false

    this._channel?.updateState({ open: false })
    this._shadowOpen = false

    if (this._fullscreenElement) {
      this._fullscreenElement.requestFullscreen()
      this._fullscreenElement = undefined
    }

    if (this._activeElement) {
      if (typeof (this._activeElement as HTMLElement).focus === 'function') {
        ;(this._activeElement as HTMLElement).focus()
      }

      this._activeElement = undefined
    } else {
      window.focus()
    }

    if (!this._wasPaused) {
      this._context.play()
    }

    this._wasPaused = undefined
  }

  private async _syncData(data: VideoDataSubtitleTrack[]) {
    try {
      let subtitles: SerializedSubtitleFile[] = []

      for (let i = 0; i < data.length; i++) {
        const { extension, url, language, localFile } = data[i]
        const subtitleFiles = await this._subtitlesForUrl(
          this._defaultVideoName(this._syncedData?.basename, data[i]),
          language,
          extension,
          url,
          localFile
        )
        if (subtitleFiles !== undefined) {
          subtitles.push(...subtitleFiles)
        }
      }

      this._context.setFlicktionarySubtitleLanguageHint(data.find((track) => track.language)?.language)
      await this._syncSubtitles(
        subtitles,
        data.some((track) => typeof track.url === 'object')
      )
      return true
    } catch (error) {
      if (typeof (error as Error).message !== 'undefined') {
        await this._reportError(`Data Sync failed: ${(error as Error).message}`)
      }

      return false
    }
  }

  private async _syncDataArray(data: ConfirmedVideoDataSubtitleTrack[], syncWithAsbplayerId?: string) {
    try {
      let subtitles: SerializedSubtitleFile[] = []

      for (let i = 0; i < data.length; i++) {
        const { name, language, extension, url, localFile } = data[i]
        const subtitleFiles = await this._subtitlesForUrl(name, language, extension, url, localFile)
        if (subtitleFiles !== undefined) {
          subtitles.push(...subtitleFiles)
        }
      }

      this._context.setFlicktionarySubtitleLanguageHint(data.find((track) => track.language)?.language)
      await this._syncSubtitles(
        subtitles,
        data.some((track) => typeof track.url === 'object'),
        syncWithAsbplayerId
      )
      return true
    } catch (error) {
      if (typeof (error as Error).message !== 'undefined') {
        await this._reportError(`Data Sync failed: ${(error as Error).message}`)
      }

      return false
    }
  }

  private async _syncSubtitles(
    serializedFiles: SerializedSubtitleFile[],
    flatten: boolean,
    syncWithAsbplayerId?: string
  ) {
    const files: File[] = await Promise.all(
      serializedFiles.map(async (f) => new File([base64ToBlob(f.base64, 'text/plain')], f.name))
    )
    this._context.loadSubtitles(files, flatten, syncWithAsbplayerId)
  }

  private async _subtitlesForUrl(
    name: string,
    language: string | undefined,
    extension: string,
    url: string | string[],
    localFile: boolean | undefined
  ): Promise<SerializedSubtitleFile[] | undefined> {
    if (url === '-') {
      return [
        {
          name: `${name}.${extension}`,
          base64: '',
        },
      ]
    }

    if (url === 'lazy') {
      if (language === undefined) {
        await this._reportError('Unable to determine language')
        return undefined
      }

      const data = await fetchDataForLanguageOnDemand(language)

      if (data.error) {
        await this._reportError(data.error)
        return undefined
      }

      const lazilyFetchedUrl = data.subtitles?.find((t) => t.language === language)?.url

      if (lazilyFetchedUrl === undefined) {
        await this._reportError('Failed to fetch subtitles for specified language')
        return undefined
      }

      url = lazilyFetchedUrl
    }

    if (url === 'cached') {
      // Load from cached Whisper transcript
      const cachedSrt = await this._getCachedTranscript()
      if (!cachedSrt) {
        await this._reportError('Cached subtitles not found')
        return undefined
      }

      const encoder = new TextEncoder()
      const srtBytes = encoder.encode(cachedSrt)
      const base64 = bufferToBase64(srtBytes.buffer)

      return [
        {
          name: `${name}.${extension}`,
          base64,
        },
      ]
    }

    if (typeof url === 'string') {
      const response = await fetch(url)
        .catch((error) => this._reportError(error.message))
        .finally(() => {
          if (localFile) {
            URL.revokeObjectURL(url)
          }
        })

      if (!response) {
        return undefined
      }

      if (!response.ok) {
        throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`)
      }

      return [
        {
          name: `${name}.${extension}`,
          base64: response ? bufferToBase64(await response.arrayBuffer()) : '',
        },
      ]
    }

    // `url` is an array

    const firstUri = url[0]
    const partExtension = firstUri.substring(firstUri.lastIndexOf('.') + 1)
    const fileName = `${name}.${partExtension}`
    const promises = url.map((u) => fetch(u))
    const tracks = []
    let totalPromises = promises.length
    let finishedPromises = 0

    for (const p of promises) {
      const response = await p

      if (!response.ok) {
        throw new Error(`Subtitle Retrieval failed with Status ${response.status}/${response.statusText}...`)
      }

      ++finishedPromises
      this._context.subtitleController.notification(
        `${fileName} (${Math.floor((finishedPromises / totalPromises) * 100)}%)`
      )

      tracks.push({
        name: fileName,
        base64: bufferToBase64(await response.arrayBuffer()),
      })
    }

    return tracks
  }

  private async _reportError(error: string) {
    const client = await this._client()

    this._prepareShow()

    // Note: the legacy call also passed a top-level `themeType` here, but the UI
    // only reads `settings.themeType`, so it was a no-op — dropped to satisfy the
    // typed updateState (behaviour unchanged).
    return client.updateState({
      open: true,
      isLoading: false,
      showSubSelect: true,
      error,
    })
  }

  private async _handleSupadataGeneration() {
    const client = this._clientIfLoaded()
    if (!client) {
      return
    }

    // Update UI to loading state
    client.updateState({ isGeneratingSupadata: true, error: '' })

    try {
      const videoUrl = window.location.href
      const messageId = `supadata-${Date.now()}`

      const command: TabToExtensionCommand<SupadataGenerateMessage> = {
        sender: 'asbplayer-video-tab',
        message: {
          command: 'supadata-generate',
          messageId,
          videoUrl,
        },
      }
      // Promise-style sendMessage — see _getCachedTranscript for the Firefox rationale.
      const response: SupadataGenerateResponse = await browser.runtime.sendMessage(command)

      if (response.error) {
        await this._reportError(response.error)
        client.updateState({ isGeneratingSupadata: false })
        return
      }

      if (response.subtitles) {
        // Convert SRT content to base64 and sync
        const encoder = new TextEncoder()
        const srtBytes = encoder.encode(response.subtitles)
        const base64 = bufferToBase64(srtBytes.buffer)

        const videoName = this._syncedData?.basename || document.title
        const subtitleFiles: SerializedSubtitleFile[] = [
          {
            name: `${videoName} - Generated.srt`,
            base64,
          },
        ]

        await this._syncSubtitles(subtitleFiles, false)
        client.updateState({ isGeneratingSupadata: false })
        this._hideAndResume()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this._reportError(errorMessage)
      client.updateState({ isGeneratingSupadata: false })
    }
  }
}
