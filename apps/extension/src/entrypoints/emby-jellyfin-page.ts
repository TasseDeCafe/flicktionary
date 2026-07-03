import { VideoData, VideoDataSubtitleTrack } from '@asbplayer-fork/common'
import { trackFromDef } from '@/pages/util'

// Emby/Jellyfin's page global — a minimal structural view of the parts of the
// client API this script touches; the shapes are unofficial.
interface EmbyMediaStream {
  IsTextSubtitleStream?: boolean
  DisplayTitle: string
  Language?: string
  Index: number
}

interface EmbySession {
  PlayState: { MediaSourceId?: string }
  NowPlayingItem: {
    Id: string
    Path?: string
    FileName?: string
    Name?: string
    MediaStreams: EmbyMediaStream[]
  }
}

declare const ApiClient:
  | {
      deviceId(): string
      serverAddress(): string
      getSessions(options: { deviceId: string }): Promise<EmbySession[]>
    }
  | undefined

export default defineUnlistedScript(() => {
  document.addEventListener(
    'asbplayer-get-synced-data',
    async () => {
      const response: VideoData = { error: '', basename: '', subtitles: [] }
      if (!ApiClient) {
        response.error = 'ApiClient is undefined'
        return document.dispatchEvent(
          new CustomEvent('asbplayer-synced-data', {
            detail: response,
          })
        )
      }

      const deviceID = ApiClient.deviceId()

      let session
      for (let attempt = 0; attempt < 5; attempt++) {
        const sessions = await ApiClient.getSessions({ deviceId: deviceID })
        session = sessions[0]
        if (session.PlayState.MediaSourceId) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      if (!session || !session.PlayState.MediaSourceId) {
        response.error = 'Failed to retrieve a valid MediaSourceId after 5 attempts'
        return document.dispatchEvent(
          new CustomEvent('asbplayer-synced-data', {
            detail: response,
          })
        )
      }

      const mediaID = session.PlayState.MediaSourceId
      const nowPlayingItem = session.NowPlayingItem
      const path = nowPlayingItem.Path
      response.basename = nowPlayingItem.FileName ?? (path ? path.split(/[\\/]/).pop() : nowPlayingItem.Name) ?? ''

      const subtitles: VideoDataSubtitleTrack[] = []
      nowPlayingItem.MediaStreams.filter((stream) => stream.IsTextSubtitleStream).forEach((sub) => {
        const extension = 'srt'
        var url =
          ApiClient.serverAddress() +
          '/Videos/' +
          nowPlayingItem.Id +
          '/' +
          mediaID +
          '/Subtitles/' +
          sub.Index +
          '/Stream.' +
          extension
        subtitles.push(
          trackFromDef({
            label: sub.DisplayTitle,
            language: sub.Language || '',
            url: url,
            extension,
          })
        )
      })

      response.subtitles = subtitles

      document.dispatchEvent(
        new CustomEvent('asbplayer-synced-data', {
          detail: response,
        })
      )
    },
    false
  )
})
