import { useEffect } from 'react'

// One practice-surface hotkey: a semantic key, the action it triggers, and the
// gates that decide when it's live. Bindings are plain data so the same array
// that drives behavior can drive the on-button <Kbd> hints — a badge and its
// key can never drift apart.
export type HotkeyBinding = {
  key: HotkeyKey
  onPress: () => void
  // Binding-level gate — lets one key carry different actions across view
  // states (e.g. Space = reveal on the card front, Space = Good on the back)
  // as long as at most one binding is enabled at a time.
  enabled?: boolean
  // Fire even while an editable element has focus. Reserved for keys the
  // focused input can't meaningfully consume (e.g. Enter-to-advance after the
  // input was disabled by grading, or Escape-to-skip while typing an answer).
  allowInEditable?: boolean
  // Fire on OS key repeat too. Reserved for navigation keys where holding to
  // scan is desirable (prev/next paging) — never for destructive/rating keys.
  allowRepeat?: boolean
}

// 'space' | 'enter' | 'escape' | arrows | digits | single lowercase letters.
export type HotkeyKey = string

const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

// Digits match by PHYSICAL position (event.code Digit/Numpad) as well as by
// produced character: on layouts where the top row needs Shift to type a digit
// (AZERTY), rating with a bare 1-4 press must still work.
const matches = (e: KeyboardEvent, key: HotkeyKey): boolean => {
  if (key === 'enter') return e.key === 'Enter'
  if (key === 'space') return e.key === ' ' || e.code === 'Space'
  if (key === 'escape') return e.key === 'Escape'
  if (key === 'arrowleft') return e.key === 'ArrowLeft'
  if (key === 'arrowright') return e.key === 'ArrowRight'
  if (/^[1-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}` || e.key === key
  return e.key.toLowerCase() === key
}

// Global-keydown hotkeys for the practice and focus-view surfaces: the
// listener stays mounted (rules of hooks) and the `enabled` flag makes it
// inert while an overlay is open over the view.
// A matched binding always preventDefaults — this both stops Space from
// scrolling the page and suppresses the native re-activation of whichever
// button still holds focus from a previous click (the double-fire trap).
export const useHotkeys = (bindings: HotkeyBinding[], enabled = true): void => {
  useEffect(() => {
    if (!enabled) return
    const attachedAt = performance.now()
    const handler = (e: KeyboardEvent) => {
      // Only react to key presses that began while this binding set was live.
      // A synchronous state change during a keydown (e.g. Enter grading a
      // typed answer from the input's own handler) re-registers this listener
      // before the event finishes bubbling to window, and a freshly-enabled
      // binding for the same key would fire on the very keypress that enabled
      // it (submit + advance on a single Enter).
      if (e.timeStamp <= attachedAt) return
      // Never hijack browser/OS chords.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const editable = isEditableTarget(e.target)
      const binding = bindings.find((b) => (b.enabled ?? true) && (!editable || b.allowInEditable) && matches(e, b.key))
      if (!binding) return
      // Swallow repeats even when not acting on them (a held Space must not
      // start scrolling), but only re-fire for bindings that opt in.
      e.preventDefault()
      if (e.repeat && !binding.allowRepeat) return
      binding.onPress()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [bindings, enabled])
}
