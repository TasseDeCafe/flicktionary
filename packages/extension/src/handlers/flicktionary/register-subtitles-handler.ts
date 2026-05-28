import type { Browser } from 'wxt/browser';
import type {
    Command,
    Message,
    RegisterFlicktionarySubtitlesMessage,
    RegisterFlicktionarySubtitlesResponse,
} from '@asbplayer-fork/common';
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client';
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage';
import { storeFlicktionarySession } from '../../services/flicktionary/youtube-session-cache';
import { getFlicktionaryTargetLanguage } from '../../services/flicktionary/flicktionary-target-language';

// Receives the parsed subtitle payload at video-load time, creates (or fetches)
// the Flicktionary session, and caches the segment-index → text_segments.id
// map so subsequent saves don't need a round trip.
//
// Unpaired or save-disabled users still see the message arrive but get back
// `{ success: false }` so the binding can fall back to the local IndexedDB
// path without any extra plumbing.
export default class RegisterFlicktionarySubtitlesHandler {
    get sender(): string[] {
        return ['asbplayer-video', 'asbplayer-video-tab'];
    }

    get command(): string {
        return 'register-flicktionary-subtitles';
    }

    handle(
        command: Command<Message>,
        _sender: Browser.runtime.MessageSender,
        sendResponse: (response?: RegisterFlicktionarySubtitlesResponse) => void
    ) {
        const message = command.message as RegisterFlicktionarySubtitlesMessage;

        void (async () => {
            try {
                const auth = await getFlicktionaryAuth();
                if (!auth) {
                    sendResponse({ success: false, error: 'Not paired with Flicktionary' });
                    return;
                }
                const targetLanguage = await getFlicktionaryTargetLanguage();
                if (!targetLanguage) {
                    sendResponse({ success: false, error: 'Target language not configured' });
                    return;
                }

                const client = getFlicktionaryApiClient();
                const { data } = await client.studySessions.findOrCreateForYoutubeVideo({
                    youtubeVideoId: message.youtubeVideoId,
                    videoTitle: message.videoTitle,
                    videoUrl: message.videoUrl,
                    videoAudioLanguage: message.videoAudioLanguage,
                    targetLanguage,
                    subtitles: {
                        language: message.subtitleLanguage,
                        contentHash: message.contentHash,
                        segments: message.segments.map((s) => ({ ...s })),
                    },
                });

                const segmentIdByIndex: Record<string, string> = {};
                for (const segment of data.segments) {
                    segmentIdByIndex[String(segment.index)] = segment.id;
                }
                await storeFlicktionarySession(message.youtubeVideoId, message.contentHash, {
                    sessionId: data.sessionId,
                    textTrackId: data.textTrackId,
                    contentSourceId: data.contentSourceId,
                    segmentIdByIndex,
                });

                sendResponse({ success: true, sessionId: data.sessionId });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : 'register-flicktionary-subtitles failed',
                });
            }
        })();

        return true;
    }
}
