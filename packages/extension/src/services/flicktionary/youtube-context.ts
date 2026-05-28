import type { IndexedSubtitleModel } from '@asbplayer-fork/common';

// Minimal video-level metadata the Flicktionary backend needs to identify a
// YouTube content_source. We sniff this from the page (URL + document.title)
// since the binding doesn't carry a dedicated YouTube data model.
export interface FlicktionaryYoutubeVideoMetadata {
    readonly youtubeVideoId: string;
    readonly videoTitle: string;
    readonly videoUrl: string;
}

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com']);

export const isYoutubeWatchPage = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (!YOUTUBE_HOSTS.has(window.location.hostname)) return false;
    return getYoutubeVideoId() !== null;
};

export const getYoutubeVideoId = (): string | null => {
    try {
        const params = new URLSearchParams(window.location.search);
        const v = params.get('v');
        if (v && /^[A-Za-z0-9_-]{6,32}$/.test(v)) return v;
    } catch {
        // ignore
    }
    return null;
};

// Best-effort title scrub. YouTube's `document.title` is `Video Title - YouTube`;
// we trim the suffix so the saved content_source.title is the bare video name.
export const getYoutubeVideoTitle = (): string => {
    const raw = (typeof document !== 'undefined' ? document.title : '') || '';
    return raw.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'YouTube video';
};

export const getCurrentYoutubeMetadata = (): FlicktionaryYoutubeVideoMetadata | null => {
    const videoId = getYoutubeVideoId();
    if (!videoId) return null;
    return {
        youtubeVideoId: videoId,
        videoTitle: getYoutubeVideoTitle(),
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
};

// SHA-256 hex digest of the JSON serialization of the (offset-corrected,
// filter-applied) segments we send to the backend. Same content → same hash →
// same text_track row server-side, so re-opening the video is idempotent.
export const computeSubtitlesContentHash = async (
    segments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
): Promise<string> => {
    const json = JSON.stringify(segments);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return hex;
};

// Project the in-memory subtitle array (already offset-corrected and filtered
// by asbplayer's SubtitleReader) into the canonical wire shape — index/text
// verbatim, integer millisecond timestamps clamped to nonneg. Empty / image-
// only subtitles are dropped: text_segments.text is NOT NULL.
export const toFlicktionarySegments = (subtitles: IndexedSubtitleModel[]) => {
    return subtitles
        .filter((s) => s.text && s.text.trim().length > 0)
        .map((s) => ({
            index: s.index,
            text: s.text,
            startMs: Math.max(0, Math.round(s.start)),
            endMs: Math.max(0, Math.round(s.end)),
        }));
};
