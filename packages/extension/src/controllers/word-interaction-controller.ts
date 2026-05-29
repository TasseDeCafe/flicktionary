import {
    TabToExtensionCommand,
    FlicktionaryGlossMessage,
    FlicktionaryGlossResponse,
    FlicktionaryGlossIpa,
    SaveWordMessage,
    SaveWordResponse,
    SaveWordFlicktionaryVideoContext,
} from '@asbplayer-fork/common';
import { v4 as uuidv4 } from 'uuid';
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom';

// The structured gloss rendered in the hover tooltip — mirrors the web app's
// fast-gloss popover (selection + IPA + gloss + POS/register).
interface GlossData {
    gloss: string;
    pos: string | null;
    register: string | null;
    ipa: FlicktionaryGlossIpa | null;
}

interface SegmentInfo {
    readonly startSegmentIndex: number;
    readonly endSegmentIndex: number | undefined;
    readonly startCharOffset: number;
    readonly endCharOffset: number;
}

// Read the (data-segment-index, data-char-start, data-char-end) trio the
// tokenizer stamped onto each token span. These are the canonical coordinates
// the Flicktionary save path uses to resolve the clicked occurrence to a real
// `text_segments.id`. Missing values (e.g. on non-Flicktionary subtitles or
// the offset notification overlay) collapse to `undefined`.
const readSegmentRange = (first: HTMLElement, last: HTMLElement): SegmentInfo | undefined => {
    const startIdxRaw = first.dataset.segmentIndex;
    const endIdxRaw = last.dataset.segmentIndex;
    const startOffsetRaw = first.dataset.charStart;
    const endOffsetRaw = last.dataset.charEnd;
    if (
        startIdxRaw === undefined ||
        endIdxRaw === undefined ||
        startOffsetRaw === undefined ||
        endOffsetRaw === undefined
    ) {
        return undefined;
    }
    const startSegmentIndex = Number.parseInt(startIdxRaw, 10);
    const endSegmentIndex = Number.parseInt(endIdxRaw, 10);
    const startCharOffset = Number.parseInt(startOffsetRaw, 10);
    const endCharOffset = Number.parseInt(endOffsetRaw, 10);
    if (![startSegmentIndex, endSegmentIndex, startCharOffset, endCharOffset].every(Number.isFinite)) {
        return undefined;
    }
    return {
        startSegmentIndex,
        endSegmentIndex: endSegmentIndex === startSegmentIndex ? undefined : endSegmentIndex,
        startCharOffset,
        endCharOffset,
    };
};

interface SelectionState {
    isSelecting: boolean;
    startWord: HTMLElement | null;
    selectedWords: HTMLElement[];
    sentence: string;
}

export default class WordInteractionController {
    private readonly video: HTMLMediaElement;
    private readonly getVideoTitle: () => string;
    private readonly getVideoUrl: () => string;
    private readonly getFlicktionaryVideoContext: () => SaveWordFlicktionaryVideoContext | undefined;
    // Returns a reason string when saving is disabled for the current video
    // (e.g. its subtitles are in an unsupported language), or undefined when
    // saving is allowed. Hover-gloss stays available regardless.
    private readonly getFlicktionarySaveDisabledReason: () => string | undefined;

    private tooltip: HTMLElement | null = null;
    private tooltipWordElement: HTMLElement | null = null;
    // The word span the pointer is currently over (null when over anything
    // else). Updated from `mouseover`, which bubbles — unlike mouseenter/leave,
    // which don't and are unreliable when delegated through YouTube's overlays.
    private hoveredWordElement: HTMLElement | null = null;
    private tooltipCleanup: (() => void) | null = null;
    private hoverTimeout: NodeJS.Timeout | null = null;
    private selectionState: SelectionState = { isSelecting: false, startWord: null, selectedWords: [], sentence: '' };
    private tooltipSentence: string = '';
    private selectionOverlay: HTMLElement | null = null;
    private cachedGlosses: Map<string, GlossData> = new Map();
    private boundVideoTimeUpdate: (() => void) | null = null;
    private boundVideoPlaying: (() => void) | null = null;
    private boundHandlers: {
        mouseEnter: (e: Event) => void;
        mouseLeave: (e: Event) => void;
        mouseOver: (e: Event) => void;
        contextMenu: (e: Event) => void;
        mouseDown: (e: Event) => void;
        mouseMove: (e: Event) => void;
        mouseUp: (e: Event) => void;
    };
    private enabled: boolean = false;

    constructor(
        video: HTMLMediaElement,
        getVideoTitle: () => string,
        getVideoUrl: () => string,
        getFlicktionaryVideoContext: () => SaveWordFlicktionaryVideoContext | undefined = () => undefined,
        getFlicktionarySaveDisabledReason: () => string | undefined = () => undefined
    ) {
        this.video = video;
        this.getVideoTitle = getVideoTitle;
        this.getVideoUrl = getVideoUrl;
        this.getFlicktionaryVideoContext = getFlicktionaryVideoContext;
        this.getFlicktionarySaveDisabledReason = getFlicktionarySaveDisabledReason;

        this.boundHandlers = {
            mouseEnter: this._handleMouseEnter.bind(this),
            mouseLeave: this._handleMouseLeave.bind(this),
            mouseOver: this._handleMouseOver.bind(this),
            contextMenu: this._handleContextMenu.bind(this),
            mouseDown: this._handleMouseDown.bind(this),
            mouseMove: this._handleMouseMove.bind(this),
            mouseUp: this._handleMouseUp.bind(this),
        };
    }

    bind() {
        if (this.enabled) return;
        this.enabled = true;

        // Clean up any stale tooltip/overlay elements from previous script reloads
        document.querySelectorAll('.asbplayer-translation-tooltip').forEach((el) => el.remove());
        document.querySelectorAll('.asbplayer-selection-overlay').forEach((el) => el.remove());

        // Use event delegation on the document
        document.addEventListener('mouseenter', this.boundHandlers.mouseEnter, true);
        document.addEventListener('mouseleave', this.boundHandlers.mouseLeave, true);
        document.addEventListener('mouseover', this.boundHandlers.mouseOver, true);
        document.addEventListener('contextmenu', this.boundHandlers.contextMenu, true);
        document.addEventListener('mousedown', this.boundHandlers.mouseDown, true);
        document.addEventListener('mousemove', this.boundHandlers.mouseMove, true);
        document.addEventListener('mouseup', this.boundHandlers.mouseUp, true);

        // Listen to video timeupdate to clear selection/tooltip when subtitle changes
        this.boundVideoTimeUpdate = () => {
            this._checkAndClearStaleUI();
        };
        this.video.addEventListener('timeupdate', this.boundVideoTimeUpdate);

        // Clear tooltip when video starts playing (e.g., after pause-on-hover ends)
        this.boundVideoPlaying = () => {
            this._hideTooltip();
            this._clearSelection();
        };
        this.video.addEventListener('playing', this.boundVideoPlaying);
    }

    private _checkAndClearStaleUI() {
        // Check if selection is stale
        if (this.selectionState.selectedWords.length > 0) {
            const firstWord = this.selectionState.selectedWords[0];
            const container = firstWord.closest('.asbplayer-subtitles, .asbplayer-fullscreen-subtitles');
            const currentSentence = firstWord.dataset.sentence || '';
            const isStale = !firstWord.isConnected ||
                            !container ||
                            !document.body.contains(container) ||
                            (this.selectionState.sentence && currentSentence !== this.selectionState.sentence);
            if (isStale) {
                this._clearSelection();
            }
        }

        // Check if tooltip is stale
        if (this.tooltipWordElement) {
            const container = this.tooltipWordElement.closest('.asbplayer-subtitles, .asbplayer-fullscreen-subtitles');
            const currentSentence = this.tooltipWordElement.dataset.sentence || '';
            const isStale = !this.tooltipWordElement.isConnected ||
                            !container ||
                            !document.body.contains(container) ||
                            (this.tooltipSentence && currentSentence !== this.tooltipSentence);
            if (isStale) {
                this._hideTooltip();
            }
        }
    }

    unbind() {
        if (!this.enabled) return;
        this.enabled = false;

        document.removeEventListener('mouseenter', this.boundHandlers.mouseEnter, true);
        document.removeEventListener('mouseleave', this.boundHandlers.mouseLeave, true);
        document.removeEventListener('mouseover', this.boundHandlers.mouseOver, true);
        document.removeEventListener('contextmenu', this.boundHandlers.contextMenu, true);
        document.removeEventListener('mousedown', this.boundHandlers.mouseDown, true);
        document.removeEventListener('mousemove', this.boundHandlers.mouseMove, true);
        document.removeEventListener('mouseup', this.boundHandlers.mouseUp, true);

        if (this.boundVideoTimeUpdate) {
            this.video.removeEventListener('timeupdate', this.boundVideoTimeUpdate);
            this.boundVideoTimeUpdate = null;
        }

        if (this.boundVideoPlaying) {
            this.video.removeEventListener('playing', this.boundVideoPlaying);
            this.boundVideoPlaying = null;
        }

        this._hideTooltip();
        this._clearSelection();

        // Remove selection overlay from DOM
        if (this.selectionOverlay) {
            this.selectionOverlay.remove();
            this.selectionOverlay = null;
        }
    }

    private _isWordElement(target: EventTarget | null): target is HTMLElement {
        return target instanceof HTMLElement && target.classList.contains('asbplayer-word');
    }

    private _handleMouseEnter(e: Event) {
        const target = e.target;
        if (!this._isWordElement(target)) return;

        // Clear any existing timeout
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
        }

        // Debounce the tooltip show
        this.hoverTimeout = setTimeout(() => {
            // Don't show if the video resumed (pause-on-hover ended) or the
            // pointer has already moved off this word during the debounce. The
            // live `hoveredWordElement` is the source of truth — mouseleave is
            // unreliable here, so we can't trust the timer not to outlive the hover.
            if (!this.video.paused || this.hoveredWordElement !== target) {
                return;
            }

            // Check if hovering over a selected word - if so, show chunk translation
            if (this.selectionState.selectedWords.length > 1 &&
                this.selectionState.selectedWords.includes(target)) {
                const words = this.selectionState.selectedWords.map((el) => el.dataset.word || '').join(' ');
                const sentence = this.selectionState.selectedWords[0]?.dataset.sentence || '';
                const lastWord = this.selectionState.selectedWords[this.selectionState.selectedWords.length - 1];
                this._showTooltip(lastWord, words, sentence);
            } else {
                const word = target.dataset.word;
                const sentence = target.dataset.sentence;
                if (word && sentence) {
                    this._showTooltip(target, word, sentence);
                }
            }
        }, 300);
    }

    private _handleMouseLeave(e: Event) {
        const target = e.target;
        if (!this._isWordElement(target)) return;

        // Clear pending hover timeout
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }

        // For chunk selections, only hide tooltip when leaving ALL selected words
        // (handled by mousemove checking if we're still over a selected word)
        if (this.selectionState.selectedWords.length > 1) {
            // Don't hide here - let mousemove handle it when we leave all selected words
            return;
        }

        // For single word tooltips, hide when leaving the word
        if (this.tooltipWordElement === target) {
            this._hideTooltip();
        }
    }

    // Authoritative pointer tracking. `mouseover` bubbles (so document-level
    // delegation is reliable, unlike mouseenter/leave) and fires on every
    // element the pointer enters — including the empty video area. We use it to
    // (a) know which word is under the pointer for the async render guard and
    // (b) dismiss the tooltip the moment the pointer leaves its word.
    private _handleMouseOver(e: Event) {
        const node = e.target;
        const word =
            node instanceof Element ? (node.closest('.asbplayer-word') as HTMLElement | null) : null;
        this.hoveredWordElement = word;

        if (!this.tooltipWordElement) return;

        // Keep the tooltip while the pointer is over its word, or over any word
        // in an active multi-word selection (chunk tooltip).
        if (word === this.tooltipWordElement) return;
        const overSelectedWord =
            this.selectionState.selectedWords.length > 1 &&
            word !== null &&
            this.selectionState.selectedWords.includes(word);
        if (overSelectedWord) return;

        this._hideTooltip();
    }

    // Is the pointer still over the word a tooltip is anchored to — or, for a
    // chunk tooltip, any word in the active selection? Mirrors the keep-logic in
    // `_handleMouseOver` so the async render guard agrees with live dismissal.
    private _pointerStillOnTarget(wordElement: HTMLElement): boolean {
        if (this.hoveredWordElement === wordElement) return true;
        return (
            this.selectionState.selectedWords.length > 1 &&
            this.hoveredWordElement !== null &&
            this.selectionState.selectedWords.includes(this.hoveredWordElement)
        );
    }

    private _handleContextMenu(e: Event) {
        const target = e.target;
        if (!this._isWordElement(target)) return;

        e.preventDefault();
        e.stopPropagation();

        // Check if there's a selection
        if (this.selectionState.selectedWords.length > 0) {
            this._saveSelectedWords();
        } else {
            // Save single word
            const word = target.dataset.word;
            const sentence = target.dataset.sentence;
            if (word && sentence) {
                const translation = this.cachedGlosses.get(`${word}::${sentence}`)?.gloss || '';
                this._saveWord(word, sentence, translation, readSegmentRange(target, target));
            }
        }
    }

    private _handleMouseDown(e: Event) {
        const target = e.target;
        if (!this._isWordElement(target)) return;
        if ((e as MouseEvent).button !== 0) return; // Only left click

        this._clearSelection();
        this.selectionState.isSelecting = true;
        this.selectionState.startWord = target;
        this.selectionState.selectedWords = [target];
        this.selectionState.sentence = target.dataset.sentence || '';
        this._updateSelectionOverlay();
    }

    private _handleMouseMove(e: Event) {
        const target = e.target;

        // If tooltip is showing but mouse is not over the tooltip's word element, hide it
        // This handles cases where mouseLeave doesn't fire (e.g., element removed from DOM)
        if (this.tooltipWordElement && target !== this.tooltipWordElement) {
            // Don't hide if we're hovering over another word in the current selection
            const isOverSelectedWord = this.selectionState.selectedWords.length > 1 &&
                target instanceof HTMLElement &&
                this.selectionState.selectedWords.includes(target);

            if (!isOverSelectedWord) {
                // Check if target is a descendant of tooltipWordElement (shouldn't happen, but be safe)
                if (!(target instanceof Node) || !this.tooltipWordElement.contains(target)) {
                    this._hideTooltip();
                }
            }
        }

        if (!this.selectionState.isSelecting) return;

        if (!this._isWordElement(target)) return;

        // Get all words between start and current
        const startWord = this.selectionState.startWord;
        if (!startWord) return;

        // Find all words in the same subtitle container
        const container = startWord.closest('.asbplayer-subtitles, .asbplayer-fullscreen-subtitles');
        if (!container) return;

        const allWords = Array.from(container.querySelectorAll('.asbplayer-word'));
        const startIndex = allWords.indexOf(startWord);
        const currentIndex = allWords.indexOf(target);

        if (startIndex === -1 || currentIndex === -1) return;

        // Select all words between start and current (inclusive)
        const minIndex = Math.min(startIndex, currentIndex);
        const maxIndex = Math.max(startIndex, currentIndex);
        const newSelection = allWords.slice(minIndex, maxIndex + 1) as HTMLElement[];

        this.selectionState.selectedWords = newSelection;
        this._updateSelectionOverlay();
    }

    private _handleMouseUp(_e: Event) {
        if (!this.selectionState.isSelecting) return;
        this.selectionState.isSelecting = false;
    }

    private _updateSelectionOverlay() {
        if (this.selectionState.selectedWords.length === 0) {
            this._hideSelectionOverlay();
            return;
        }

        const firstWord = this.selectionState.selectedWords[0];
        const lastWord = this.selectionState.selectedWords[this.selectionState.selectedWords.length - 1];

        // Find the subtitle container to append overlay to
        const container = firstWord.closest('.asbplayer-subtitles, .asbplayer-fullscreen-subtitles') as HTMLElement;
        if (!container) {
            this._hideSelectionOverlay();
            return;
        }

        // Create overlay if it doesn't exist or if it's in a different container
        if (!this.selectionOverlay || this.selectionOverlay.parentElement !== container) {
            if (this.selectionOverlay) {
                this.selectionOverlay.remove();
            }
            this.selectionOverlay = document.createElement('div');
            this.selectionOverlay.className = 'asbplayer-selection-overlay';
            container.appendChild(this.selectionOverlay);
        }

        // Get container's position for relative calculations
        const containerRect = container.getBoundingClientRect();
        const firstRect = firstWord.getBoundingClientRect();
        const lastRect = lastWord.getBoundingClientRect();

        // Calculate the combined bounding box relative to container
        const top = Math.min(firstRect.top, lastRect.top) - containerRect.top;
        const bottom = Math.max(firstRect.bottom, lastRect.bottom) - containerRect.top;
        const left = Math.min(firstRect.left, lastRect.left) - containerRect.left;
        const right = Math.max(firstRect.right, lastRect.right) - containerRect.left;

        // Position and size the overlay relative to container
        Object.assign(this.selectionOverlay.style, {
            display: 'block',
            top: `${top - 2}px`,
            left: `${left - 2}px`,
            width: `${right - left + 4}px`,
            height: `${bottom - top + 4}px`,
        });
    }

    private _hideSelectionOverlay() {
        if (this.selectionOverlay) {
            this.selectionOverlay.style.display = 'none';
        }
    }

    private _clearSelection() {
        this.selectionState.selectedWords = [];
        this.selectionState.startWord = null;
        this.selectionState.isSelecting = false;
        this.selectionState.sentence = '';
        this._hideSelectionOverlay();
    }

    private async _showTooltip(wordElement: HTMLElement, word: string, sentence: string) {
        const cacheKey = `${word}::${sentence}`;

        // Track the word element + sentence the tooltip is attached to. Used as
        // the staleness check after the async gloss fetch resolves.
        this.tooltipWordElement = wordElement;
        this.tooltipSentence = sentence;

        const cached = this.cachedGlosses.get(cacheKey);
        if (cached) {
            this._renderTooltip(wordElement, word, { kind: 'ready', data: cached });
            return;
        }

        // Show a loading shell immediately (the hover is only triggered while the
        // video is paused, so this is safe), then fill it in when the gloss lands.
        this._renderTooltip(wordElement, word, { kind: 'loading' });

        let response: FlicktionaryGlossResponse;
        try {
            response = await this._requestGloss(word, sentence);
        } catch {
            response = { error: 'Could not fetch a translation.' };
        }

        // Bail if the user moved on while we were fetching: video resumed, the
        // word left the DOM, or the pointer is no longer over this word. The
        // last check (against the live pointer position) is what prevents an
        // orphaned tooltip when the gloss resolves after the mouse has left.
        if (!this.video.paused || !wordElement.isConnected || !this._pointerStillOnTarget(wordElement)) {
            return;
        }

        if (response.gloss !== undefined) {
            const data: GlossData = {
                gloss: response.gloss,
                pos: response.pos ?? null,
                register: response.register ?? null,
                ipa: response.ipa ?? null,
            };
            this.cachedGlosses.set(cacheKey, data);
            this._renderTooltip(wordElement, word, { kind: 'ready', data });
        } else {
            this._renderTooltip(wordElement, word, { kind: 'error', message: response.error || 'No translation available' });
        }
    }

    private _renderTooltip(
        wordElement: HTMLElement,
        word: string,
        content: { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: GlossData }
    ) {
        // Clean up any prior autoUpdate before re-rendering (loading -> ready).
        if (this.tooltipCleanup) {
            this.tooltipCleanup();
            this.tooltipCleanup = null;
        }

        if (!this.tooltip) {
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'asbplayer-translation-tooltip';
            document.body.appendChild(this.tooltip);
        }

        this.tooltip.replaceChildren();
        this.tooltip.classList.toggle('asbplayer-translation-tooltip--loading', content.kind === 'loading');

        const title = document.createElement('div');
        title.className = 'asbplayer-gloss-title';
        title.textContent = word;
        this.tooltip.appendChild(title);

        if (content.kind === 'loading') {
            const loading = document.createElement('div');
            loading.className = 'asbplayer-gloss-loading';
            this.tooltip.appendChild(loading);
        } else if (content.kind === 'error') {
            const error = document.createElement('div');
            error.className = 'asbplayer-gloss-error';
            error.textContent = content.message;
            this.tooltip.appendChild(error);
        } else {
            const { data } = content;
            const ipaLabel = this._pickIpa(data.ipa);
            if (ipaLabel) {
                const ipa = document.createElement('div');
                ipa.className = 'asbplayer-gloss-ipa';
                ipa.textContent = ipaLabel;
                this.tooltip.appendChild(ipa);
            }

            const gloss = document.createElement('div');
            gloss.className = 'asbplayer-gloss-text';
            gloss.textContent = data.gloss || 'No translation available';
            this.tooltip.appendChild(gloss);

            if (data.pos || data.register) {
                const badges = document.createElement('div');
                badges.className = 'asbplayer-gloss-badges';
                if (data.pos) {
                    const pos = document.createElement('span');
                    pos.className = 'asbplayer-gloss-badge';
                    pos.textContent = data.pos;
                    badges.appendChild(pos);
                }
                if (data.register) {
                    const register = document.createElement('span');
                    register.className = 'asbplayer-gloss-badge asbplayer-gloss-badge--register';
                    register.textContent = data.register;
                    badges.appendChild(register);
                }
                this.tooltip.appendChild(badges);
            }
        }

        // Use `important` to match the stylesheet's `display: flex !important`
        // base rule — otherwise `_hideTooltip`'s plain inline `display: none`
        // loses to that `!important` declaration and the popover never hides.
        this.tooltip.style.setProperty('display', 'flex', 'important');

        // Use Floating UI for positioning with auto-update
        const updatePosition = () => {
            if (!this.tooltip || !this.tooltipWordElement) return;

            computePosition(wordElement, this.tooltip, {
                placement: 'top',
                middleware: [
                    offset(8),
                    flip({ fallbackPlacements: ['bottom', 'top'] }),
                    shift({ padding: 5 }),
                ],
            }).then(({ x, y }) => {
                if (this.tooltip) {
                    Object.assign(this.tooltip.style, {
                        left: `${x}px`,
                        top: `${y}px`,
                        transform: '',
                    });
                }
            });
        };

        // Set up autoUpdate to handle scroll/resize and keep tooltip positioned
        this.tooltipCleanup = autoUpdate(wordElement, this.tooltip, updatePosition);
    }

    // Prefer General American, then Received Pronunciation, then an untagged
    // entry — matching the fields the backend's GrammarIpaBag exposes.
    private _pickIpa(ipa: FlicktionaryGlossIpa | null): string | null {
        if (!ipa) return null;
        return ipa.ga ?? ipa.rp ?? ipa.untagged ?? null;
    }

    private _hideTooltip() {
        this.tooltipWordElement = null;
        this.tooltipSentence = '';

        // Clean up Floating UI autoUpdate
        if (this.tooltipCleanup) {
            this.tooltipCleanup();
            this.tooltipCleanup = null;
        }

        if (this.tooltip) {
            // `important` is required to override the stylesheet's
            // `display: flex !important` base rule (a plain inline value loses).
            this.tooltip.style.setProperty('display', 'none', 'important');
        }
    }

    private async _requestGloss(word: string, sentence: string): Promise<FlicktionaryGlossResponse> {
        const message: TabToExtensionCommand<FlicktionaryGlossMessage> = {
            sender: 'asbplayer-video-tab',
            message: {
                command: 'flicktionary-gloss',
                messageId: uuidv4(),
                selectionText: word,
                contextLine: sentence,
            },
        };

        return await browser.runtime.sendMessage(message);
    }

    // Show a styled toast from outside the controller (e.g. the binding's
    // video-load handler surfacing an "unsupported language" notice).
    showNotice(text: string, isError = false) {
        this._showNotification(text, isError);
    }

    private async _saveWord(
        word: string,
        sentence: string,
        translation: string,
        segmentInfo?: SegmentInfo
    ) {
        const saveDisabledReason = this.getFlicktionarySaveDisabledReason();
        if (saveDisabledReason) {
            this._showNotification(saveDisabledReason, true);
            this._clearSelection();
            return;
        }

        const message: TabToExtensionCommand<SaveWordMessage> = {
            sender: 'asbplayer-video-tab',
            message: {
                command: 'save-word',
                messageId: uuidv4(),
                word,
                sentence,
                translation,
                videoTitle: this.getVideoTitle(),
                videoUrl: this.getVideoUrl(),
                segmentIndex: segmentInfo?.startSegmentIndex,
                endSegmentIndex: segmentInfo?.endSegmentIndex,
                startCharOffset: segmentInfo?.startCharOffset,
                endCharOffset: segmentInfo?.endCharOffset,
                flicktionaryVideo: this.getFlicktionaryVideoContext(),
            },
        };

        const response: SaveWordResponse = await browser.runtime.sendMessage(message);

        if (response.success) {
            this._showNotification(`Saved: ${word}`);
        } else {
            console.error('Failed to save word:', response.error);
            this._showNotification(response.error || 'Could not save to Flicktionary.', true);
        }

        this._clearSelection();
    }

    private async _saveSelectedWords() {
        if (this.selectionState.selectedWords.length === 0) return;

        // Combine selected words into a phrase
        const words = this.selectionState.selectedWords.map((el) => el.dataset.word || '').join(' ');
        const sentence = this.selectionState.selectedWords[0]?.dataset.sentence || '';

        // Pass along the hovered gloss if we happen to have one cached. The
        // Flicktionary save path discards it (the server re-glosses with full
        // context), so there's no need to fetch one just for the save.
        const translation = this.cachedGlosses.get(`${words}::${sentence}`)?.gloss ?? '';

        const first = this.selectionState.selectedWords[0];
        const last = this.selectionState.selectedWords[this.selectionState.selectedWords.length - 1];
        await this._saveWord(words, sentence, translation, readSegmentRange(first, last));
    }

    private _showNotification(text: string, isError = false) {
        const notification = document.createElement('div');
        notification.className = isError
            ? 'asbplayer-save-notification asbplayer-save-notification--error'
            : 'asbplayer-save-notification';
        notification.textContent = text;
        // Errors linger longer so the user can read what to fix; this timeout
        // is matched to the CSS animation duration for each variant.
        const durationMs = isError ? 3500 : 1500;
        document.body.appendChild(notification);

        // Position near bottom center of video
        const videoRect = this.video.getBoundingClientRect();
        notification.style.left = `${videoRect.left + videoRect.width / 2 - notification.offsetWidth / 2}px`;
        notification.style.top = `${videoRect.bottom - 60}px`;

        // Remove after animation
        setTimeout(() => {
            notification.remove();
        }, durationMs);
    }
}
