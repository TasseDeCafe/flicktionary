import type { CSSProperties } from 'react'

// One bottom-track subtitle line, already styled. `style` is the object form
// from `computeStyles()` (NOT `computeStyleString()`) — zero `!important`,
// applied inline so it wins inside the shadow root in both fullscreen states.
export interface SubtitleLineModel {
  // The cue's subtitle index — also the `data-segment-index` the save path
  // needs to resolve a clicked occurrence to a `text_segments` row.
  index: number
  track: number
  text: string
  style: CSSProperties
  // True when this track has subtitle-blur enabled and hasn't been
  // keybind-unblurred for the current cue. Rendered as a CSS blur the viewer
  // reveals by hovering — mirrors the legacy `asbplayer-subtitles-blurred`.
  blurred: boolean
}

// Immutable snapshot consumed by `useSyncExternalStore`. The reference is only
// replaced when something actually changes, so React doesn't re-render on the
// SubtitleController's idle 100ms ticks.
export interface SubtitleOverlaySnapshot {
  // Subtitles are shown unless display is off / force-hidden. In React mode the
  // disabled/force-hide case flips THIS flag (the app renders nothing) instead
  // of calling overlay.hide() — which would dispose the host and leak the root.
  visible: boolean
  isFullscreen: boolean
  lines: SubtitleLineModel[]
  // The transient "+250 ms" offset indicator, or null when not showing one.
  offsetText: string | null
}

const EMPTY_LINES: SubtitleLineModel[] = []

const linesEqual = (a: SubtitleLineModel[], b: SubtitleLineModel[]): boolean => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].index !== b[i].index ||
      a[i].text !== b[i].text ||
      a[i].style !== b[i].style ||
      a[i].blurred !== b[i].blurred
    ) {
      return false
    }
  }
  return true
}

// Per-Binding external store bridging the imperative SubtitleController loop to
// the React overlay. NEVER a module singleton — each Binding (each video) owns
// its own instance, so multiple videos on a page stay independent (plan #7).
export class SubtitleStore {
  private state: SubtitleOverlaySnapshot = {
    visible: true,
    isFullscreen: typeof document !== 'undefined' && !!document.fullscreenElement,
    lines: EMPTY_LINES,
    offsetText: null,
  }

  private readonly listeners = new Set<() => void>()

  // Stable arrow identities so React's useSyncExternalStore doesn't resubscribe.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): SubtitleOverlaySnapshot => this.state

  private commit(next: SubtitleOverlaySnapshot) {
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }

  setLines(lines: SubtitleLineModel[]) {
    const next = lines.length === 0 ? EMPTY_LINES : lines
    if (linesEqual(this.state.lines, next)) {
      return
    }
    this.commit({ ...this.state, lines: next })
  }

  setVisible(visible: boolean) {
    if (this.state.visible === visible) return
    this.commit({ ...this.state, visible })
  }

  setFullscreen(isFullscreen: boolean) {
    if (this.state.isFullscreen === isFullscreen) return
    this.commit({ ...this.state, isFullscreen })
  }

  setOffsetText(offsetText: string | null) {
    if (this.state.offsetText === offsetText) return
    this.commit({ ...this.state, offsetText })
  }

  reset() {
    this.commit({ ...this.state, lines: EMPTY_LINES, offsetText: null })
  }
}
