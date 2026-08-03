import type { StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const youtubeThumbnailUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

// The landscape image for a session, in specificity order: the TV episode's
// own still, the movie/show backdrop, the YouTube thumbnail. Sessions with
// none (texts, articles, lessons, pre-backdrop TMDB rows) get the letterform.
export const sessionMediaImageUrl = (
  session: Pick<StudySession, 'contentSourceStillUrl' | 'contentSourceBackdropUrl' | 'youtubeVideoId'>
): string | null =>
  session.contentSourceStillUrl ??
  session.contentSourceBackdropUrl ??
  (session.youtubeVideoId ? youtubeThumbnailUrl(session.youtubeVideoId) : null)
