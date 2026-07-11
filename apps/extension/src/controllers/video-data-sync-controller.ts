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
import { AsbplayerSettings, SettingsProvider, YOUTUBE_TARGET_LANGUAGE_LIMIT } from '@asbplayer-fork/common/settings'
import { base64ToBlob, bufferToBase64 } from '@asbplayer-fork/common/base64'
import { createElement } from 'react'
import Binding from '../services/binding'
import { currentPageDelegate } from '../services/pages'
import { i18n, setupLingui } from '../ui/lingui'
import { msg } from '@lingui/core/macro'
import { ExtensionGlobalStateProvider } from '@/services/extension-global-state-provider'
import { checkCurrentUserIsTestUser } from '@/services/flicktionary/test-users'
import { getCachedFlicktionaryNativeLanguage } from '@/services/flicktionary/flicktionary-target-language'
import {
  nativeTrackSelectionPlan,
  tripleForTrack,
  triplesEqual,
  type NativeTrackTriple,
} from '@/services/native-track-selection'
import { normalizeSyncedTracks, resolveSyncedTrackId } from '@/services/synced-track-resolution'
import { selectVideoLanguageTrack } from '@/services/video-language-track-selection'
import { mountModalHost, type ShadowHostHandle } from '@/ui/shadow/shadow-host'
import { ShadowVideoDataSyncApp, type VideoDataCommands } from '@/ui/video-data-sync/shadow-video-data-sync-app'
import { createVideoDataSyncStore, type VideoDataSyncStore } from '@/ui/video-data-sync/video-data-sync-store'

// The in-realm model sink (the store's updateState action) exposes updateState;
// this minimal shape is what the rest of the controller drives.
interface VideoDataClient {
  updateState(state: Partial<VideoDataUiModel>): void
}

// Marker for the in-realm video-data-sync shadow host.
const VIDEO_DATA_SYNC_HOST_ATTR = 'data-asbplayer-video-data-sync-host'

declare global {
  // Firefox-only Xray helper available in content scripts; structured-clones the
  // object into the target scope and returns the clone.
  function cloneInto<T>(obj: T, targetScope: object | null, options?: { cloneFunctions?: boolean }): T
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
  // Slot-ordered tracks last synced for THIS video (_emptySubtitle for empty
  // slots). Reopening the dialog must reflect what is actually loaded — the
  // remembered-language match alone shows Empty while subtitles play, and
  // confirming that Empty selection unloads them (and, with the remember
  // toggle on, silently clears the per-site language preference). Full tracks,
  // not just ids: a track id embeds the signed timedtext URL, and the page
  // republishes the same logical tracks with fresh URLs (new ids), so resolving
  // a recorded track against the current list needs the stable fields too.
  private _lastSyncedTracks?: VideoDataSubtitleTrack[]
  private _wasPaused?: boolean
  private _fullscreenElement?: Element
  private _activeElement?: Element
  private _autoSyncAttempted: boolean = false
  private _dataReceivedListener?: (event: Event) => void
  private _trackSelectedListener?: (event: Event) => void
  // Serialization of native gear-menu selections (see
  // _handleNativeTrackSelected): the triple currently being loaded, and the
  // latest different selection that arrived while it was loading (latest wins;
  // intermediate picks are intentionally dropped).
  private _nativeTrackSyncInFlight?: NativeTrackTriple
  private _pendingNativeTriple?: NativeTrackTriple

  // The subtitle-track dialog renders in the content-script realm via a
  // fullscreen-aware modal shadow host. The model flows through `_store`
  // (partial pushes via the store's updateState action) and the UI commands
  // route through `_handleUiCommand`.
  private _store?: VideoDataSyncStore
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

    if (this._trackSelectedListener) {
      document.removeEventListener('asbplayer-native-captions-track-selected', this._trackSelectedListener, false)
    }

    this._dataReceivedListener = undefined
    this._trackSelectedListener = undefined
    this._nativeTrackSyncInFlight = undefined
    this._pendingNativeTriple = undefined
    this._syncedData = undefined
    this._lastSyncedTracks = undefined

    this._shadowHandle?.unmount()
    this._shadowHandle = undefined
    this._store = undefined
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
    // New video context — what was loaded for the previous one is irrelevant,
    // and pending native-menu work must not leak across the navigation.
    this._lastSyncedTracks = undefined
    this._nativeTrackSyncInFlight = undefined
    this._pendingNativeTriple = undefined

    if (!this._dataReceivedListener) {
      this._dataReceivedListener = (event: Event) => {
        const data = (event as CustomEvent).detail as VideoData
        this._setSyncedData(data)
      }
      document.addEventListener('asbplayer-synced-data', this._dataReceivedListener, false)
    }

    if (!this._trackSelectedListener) {
      this._trackSelectedListener = (event: Event) => {
        const triple = (event as CustomEvent).detail as NativeTrackTriple | undefined
        if (triple && typeof triple.lang === 'string') {
          void this._handleNativeTrackSelected(triple)
        }
      }
      document.addEventListener('asbplayer-native-captions-track-selected', this._trackSelectedListener, false)
    }

    if (pageDelegate.config.key === 'youtube') {
      const targetTranslationLanguageCodes =
        (await this._settings.getSingle('streamingPages')).youtube.targetLanguages ?? []
      this._dispatchGetSyncedData(targetTranslationLanguageCodes)
    } else {
      document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data'))
    }
  }

  private async _rememberTranslationLanguages(codes: string[]) {
    const streamingPages = await this._settings.getSingle('streamingPages')
    const existing = streamingPages.youtube.targetLanguages ?? []
    const merged = [...codes, ...existing.filter((code) => !codes.includes(code))].slice(
      0,
      YOUTUBE_TARGET_LANGUAGE_LIMIT
    )
    if (merged.length === existing.length && merged.every((code, i) => code === existing[i])) {
      return
    }
    await this._settings
      .set({
        streamingPages: {
          ...streamingPages,
          youtube: { ...streamingPages.youtube, targetLanguages: merged },
        },
      })
      .catch(() => {})
  }

  private _dispatchGetSyncedData(targetTranslationLanguageCodes: string[]) {
    let payload = { targetTranslationLanguageCodes }
    if (typeof cloneInto === 'function') {
      payload = cloneInto(payload, document.defaultView)
    }
    document.dispatchEvent(new CustomEvent('asbplayer-get-synced-data', { detail: payload }))
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

    let autoSelectedTrackIds: string[]
    if (this._lastSyncedTracks !== undefined) {
      // Subtitles are already loaded for this video: reflect them (resolved
      // against the available tracks) rather than the remembered-language
      // match, so reopening the dialog and pressing OK is a no-op.
      autoSelectedTrackIds = this._lastSyncedTracks.map((track) => resolveSyncedTrackId(track, subtitleTrackChoices))
    } else if (cachedTranscript) {
      // Pre-select the cached Whisper track
      autoSelectedTrackIds = ['cached-whisper', '-', '-']
    } else {
      autoSelectedTrackIds = autoSelectedTracks.map((subtitle) => subtitle.id || '-')
    }

    const defaultCheckboxState = subs.completeMatch
    const themeType = await this._context.settings.getSingle('themeType')
    const profilesPromise = this._context.settings.profiles()
    const activeProfilePromise = this._context.settings.activeProfile()
    const hasSeenFtue = (await globalStateProvider.get(['ftueHasSeenSubtitleTrackSelector']))
      .ftueHasSeenSubtitleTrackSelector
    const hideRememberTrackPreferenceToggle = await this._pageHidesTrackPrefToggle()
    const transcriptServerUrl =
      (await this._context.settings.getSingle('transcriptServerUrl')) || 'https://asbplayer-production.up.railway.app'
    // Whisper generation is test-user only for now: the transcript server uses
    // the developer's own YouTube credentials (yt-dlp), so exposing the button
    // to everyone risks a YouTube ban. The background handler enforces the same
    // gate; this one just keeps the button honest. (The button is YouTube-only,
    // so the check's secure-context requirement is always met where it shows.)
    const canGenerateTranscripts = !!transcriptServerUrl && (await checkCurrentUserIsTestUser())
    const availableTranslationLanguages = isYouTube ? (this._syncedData?.translationLanguages ?? []) : []
    // Dropdown default: last machine-translated language (targetLanguages is
    // most-recent-first), else the paired user's native language. The native
    // language is a cached storage read only — absent until the first
    // save/register has run bootstrapPrefs in the background.
    const lastTranslationLanguage = isYouTube
      ? (await this._context.settings.getSingle('streamingPages')).youtube.targetLanguages?.[0]
      : undefined
    const defaultTranslationLanguage = isYouTube
      ? (lastTranslationLanguage ?? (await getCachedFlicktionaryNativeLanguage()) ?? undefined)
      : undefined
    const translationMode = isYouTube ? await this._context.settings.getSingle('streamingTranslationMode') : undefined
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
          canGenerateTranscripts,
          availableTranslationLanguages,
          defaultTranslationLanguage,
          translationMode,
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
          canGenerateTranscripts,
          availableTranslationLanguages,
          defaultTranslationLanguage,
          translationMode,
          ...additionalFields,
        }
  }

  private _matchLastSyncedWithAvailableTracks(subtitleTrackChoices?: VideoDataSubtitleTrack[]) {
    const tracks_list = subtitleTrackChoices ?? this._syncedData?.subtitles ?? []
    let tracks = {
      autoSelectedTracks: [this._emptySubtitle, this._emptySubtitle, this._emptySubtitle],
      completeMatch: false,
    }

    // Entries are slot-wise: '-' means "leave this slot empty". A remembered
    // list with no real language in it (never remembered, or remembered with
    // every slot Empty) can't auto-load anything: when the video has tracks on
    // offer it must NOT count as a complete match — '-' matches anything, so
    // it would silently sync nothing and suppress the prompt-on-failure dialog
    // on every video. With no tracks available it does count as complete, so
    // subtitle-less videos don't nag.
    const hasRealChoice = this.lastLanguagesSynced.some((lang) => lang !== '-')

    if (!hasRealChoice) {
      tracks.completeMatch = tracks_list.length === 0
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

        // Video-language policy (YouTube): auto-load the track matching the
        // video's own language — human over ASR — so switching between videos
        // in different languages just works, with no per-site remembering.
        // Nothing matching (or no language signal) loads nothing, SILENTLY:
        // popping the dialog on every casually-browsed video would be noise,
        // and it stays reachable via the overlay/toolbar. Remembered-language
        // matching and prompt-on-failure do not apply on such pages.
        const page = await currentPageDelegate()
        if (page?.config?.autoSyncVideoLanguage) {
          const track = selectVideoLanguageTrack(this._syncedData.subtitles, this._syncedData.videoLanguage)

          if (track !== undefined) {
            await this._syncData([track, this._emptySubtitle, this._emptySubtitle])

            if (!this._isHidden()) {
              this._hideAndResume()
            }
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
        const languages = confirmMessage.data
          .map((track) => track.language)
          .filter((language): language is string => language !== undefined)
        // All-Empty choices would otherwise be stored as ['-','-'], which
        // matches every video and silently suppresses the track dialog forever
        // (see _matchLastSyncedWithAvailableTracks). Treat "remember nothing"
        // as clearing the per-site preference instead.
        this.lastLanguagesSynced = languages.some((language) => language !== '-') ? languages : []
        await this._context.settings.set({ streamingLastLanguagesSynced: this._lastLanguagesSynced }).catch(() => {})
      }

      // A confirmed machine-translation track (language `L_from_base`) records
      // L in streamingPages.youtube.targetLanguages (most-recent-first): the
      // page script then publishes the `>> L` variants on future videos, which
      // is what lets remembered track choices auto-sync, and the dialog uses
      // the head of the list as its dropdown default.
      const machineTranslationCodes = confirmMessage.data
        .map((track) => track.language)
        .filter((language): language is string => language !== undefined && language.includes('_from_'))
        .map((language) => language.split('_from_')[0])
      if (machineTranslationCodes.length > 0) {
        await this._rememberTranslationLanguages(machineTranslationCodes)
      }

      // Persist the toggle choice so the dialog reopens with it.
      if (confirmMessage.translationMode !== undefined) {
        const currentMode = await this._settings.getSingle('streamingTranslationMode')
        if (currentMode !== confirmMessage.translationMode) {
          await this._settings.set({ streamingTranslationMode: confirmMessage.translationMode }).catch(() => {})
        }
      }

      const data = confirmMessage.data as ConfirmedVideoDataSubtitleTrack[]

      dataWasSynced = await this._syncDataArray(data, confirmMessage.syncWithAsbplayerId)
    } else if ('openFile' === message.command) {
      const openFileMessage = message as VideoDataUiBridgeOpenFileMessage
      const subtitles = openFileMessage.subtitles as SerializedSubtitleFile[]

      try {
        await this._syncSubtitles(subtitles, false, true)
        // Loaded files aren't in the page's track list — the reopened dialog
        // can't represent them, so fall back to the auto-match.
        this._lastSyncedTracks = undefined
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
      onConfirm: (data, shouldRememberTrackChoices, translationMode, syncWithAsbplayerId) =>
        void this._handleUiCommand({
          command: 'confirm',
          data,
          shouldRememberTrackChoices,
          translationMode,
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
    if (!this._store) {
      this._store = createVideoDataSyncStore()
    }
    if (this._shadowHandle) {
      return
    }
    // Activate the user's locale for this realm before mounting (formerly the
    // iframe's loc script).
    const language = await this._settings.getSingle('language')
    setupLingui(language)
    const store = this._store
    const commands = this._shadowCommands()
    this._shadowHandle = mountModalHost({
      hostAttribute: VIDEO_DATA_SYNC_HOST_ATTR,
      // Radix/Tailwind surface: adopt the shared overlay sheet (tokens +
      // utilities) instead of emotion.
      adoptTailwind: true,
      render: ({ shadowRoot, portalContainer }) =>
        createElement(ShadowVideoDataSyncApp, { store, shadowRoot, portalContainer, language, commands }),
    })
  }

  // The active model sink (the store's stable actions), or undefined before
  // mount. zustand actions are stable across setState, so the snapshot's
  // updateState is safe to hold.
  private _clientIfLoaded(): VideoDataClient | undefined {
    return this._store?.getState()
  }

  // Whether the dialog is currently hidden.
  private _isHidden(): boolean {
    return !this._shadowOpen
  }

  private async _client(): Promise<VideoDataClient> {
    await this._ensureShadowMounted()
    this._shadowOpen = true
    return this._store!.getState()
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

    this._store?.getState().updateState({ open: false })
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

  private async _syncData(data: VideoDataSubtitleTrack[], userRequested = false) {
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
        data.some((track) => typeof track.url === 'object'),
        userRequested
      )
      this._recordSyncedTracks(data)
      return true
    } catch (error) {
      if (typeof (error as Error).message !== 'undefined') {
        await this._reportError(`Data Sync failed: ${(error as Error).message}`)
      }

      return false
    }
  }

  // A track selection made in the site's native subtitle menu (YouTube's gear
  // → Subtitles/CC, forwarded by the page script as a (lang, asr, tlang?)
  // triple). The native menu owns slot 1 only; the second/third tracks
  // survive. Deliberately session-local: it never writes the remembered
  // per-site tracks (the dialog's remember toggle stays the only writer) —
  // but a picked auto-translate target IS recorded, like a dialog confirm,
  // so future videos publish its `>> code` variants.
  private async _handleNativeTrackSelected(triple: NativeTrackTriple) {
    if (!this._context.nativeCaptionsController.controllingDisplay || !this._isHidden()) {
      return
    }

    // Every eligible <video> gets its own binding and all of them hear this
    // document event — only the binding for the main player may react, or a
    // Shorts/preview binding could hijack the selection.
    if (document.getElementById('movie_player')?.contains(this._context.video) !== true) {
      return
    }

    if (this._syncedData?.subtitles === undefined) {
      return
    }

    if (this._nativeTrackSyncInFlight !== undefined) {
      if (!triplesEqual(this._nativeTrackSyncInFlight, triple)) {
        this._pendingNativeTriple = triple
      }
      return
    }

    const plan = nativeTrackSelectionPlan({
      triple,
      availableTracks: this._syncedData.subtitles,
      loadedTracks: this._lastSyncedTracks,
      inFlightTriple: undefined,
      emptyTrack: this._emptySubtitle,
    })

    if (plan === undefined) {
      return
    }

    this._nativeTrackSyncInFlight = triple

    try {
      const synced = await this._syncData(plan.slots, true)

      if (synced) {
        // Without this merge the reopened dialog cannot represent a freshly
        // synthesized translation (it resolves loaded tracks against the
        // published list only) and confirming it would unload the subtitles.
        if (plan.synthesizedTrack !== undefined && this._syncedData?.subtitles !== undefined) {
          const synthesizedId = plan.synthesizedTrack.id
          if (!this._syncedData.subtitles.some((track) => track.id === synthesizedId)) {
            this._syncedData.subtitles.push(plan.synthesizedTrack)
          }
        }

        if (triple.tlang !== undefined) {
          await this._rememberTranslationLanguages([triple.tlang])
        }
      }
    } finally {
      this._nativeTrackSyncInFlight = undefined
      const pending = this._pendingNativeTriple
      this._pendingNativeTriple = undefined

      if (pending !== undefined) {
        void this._handleNativeTrackSelected(pending)
      }
    }
  }

  // Remember the slot-ordered tracks just synced so the reopened dialog shows
  // them (see services/synced-track-resolution.ts), and mirror slot 1 into the
  // site's native subtitle menu so its checkmark shows what is actually loaded.
  private _recordSyncedTracks(data: VideoDataSubtitleTrack[]) {
    this._lastSyncedTracks = normalizeSyncedTracks(data, this._emptySubtitle)
    this._writeBackNativeTrackSelection(this._lastSyncedTracks[0])
  }

  // Push the loaded primary track into the site's native subtitle menu (the
  // page script applies it via the player API). Self-negotiating like the rest
  // of the native-captions protocol: sites without a page-script
  // implementation never listen. Tracks that don't exist in the site's own
  // menu (local files, generated transcripts, Empty) are skipped and the
  // native menu left alone.
  private _writeBackNativeTrackSelection(track: VideoDataSubtitleTrack) {
    const triple = tripleForTrack(track)

    if (triple === undefined) {
      return
    }

    let payload: NativeTrackTriple = triple
    if (typeof cloneInto === 'function') {
      payload = cloneInto(payload, document.defaultView)
    }
    document.dispatchEvent(new CustomEvent('asbplayer-native-captions-select-track', { detail: payload }))
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
        true,
        syncWithAsbplayerId
      )
      this._recordSyncedTracks(data)
      return true
    } catch (error) {
      if (typeof (error as Error).message !== 'undefined') {
        await this._reportError(`Data Sync failed: ${(error as Error).message}`)
      }

      return false
    }
  }

  // `userRequested` distinguishes explicit loads (dialog confirm, Open Files,
  // Generate) from the silent auto-sync path — explicit loads force a native
  // caption control ON so the user sees what they just loaded, while auto-sync
  // adopts the native control's own persisted state.
  private async _syncSubtitles(
    serializedFiles: SerializedSubtitleFile[],
    flatten: boolean,
    userRequested: boolean,
    syncWithAsbplayerId?: string
  ) {
    const files: File[] = await Promise.all(
      serializedFiles.map(async (f) => new File([base64ToBlob(f.base64, 'text/plain')], f.name))
    )
    // Awaited so callers only record/write back tracks once the load has
    // actually succeeded — and so the native caption control is bound (from
    // _updateSubtitles, inside this promise) before any write-back fires.
    await this._context.loadSubtitles(files, flatten, userRequested, syncWithAsbplayerId)
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

        await this._syncSubtitles(subtitleFiles, false, true)
        // The generated track isn't in the page's track list — see openFile.
        this._lastSyncedTracks = undefined
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
