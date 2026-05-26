import { useEffect } from 'react'

type Args = {
  onPrev: () => void
  onNext: () => void
  // When false, the listener stays mounted (rules of hooks) but ignores keys —
  // used to make prev/next inert while the chat panel is open over the view.
  enabled?: boolean
}

const NAV_KEYS = new Set(['j', 'k', 'ArrowLeft', 'ArrowRight'])

export const useFocusKeyboardNav = ({ onPrev, onNext, enabled = true }: Args): void => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabled) return
      if (!NAV_KEYS.has(e.key)) return
      const target = e.target as HTMLElement | null
      // Don't trap when the user is typing in an editable field.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.key === 'k' || e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'j' || e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext, enabled])
}
