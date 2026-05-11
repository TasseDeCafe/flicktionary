import { useEffect } from 'react'

type Args = {
  onPrev: () => void
  onNext: () => void
}

const NAV_KEYS = new Set(['j', 'k', 'ArrowLeft', 'ArrowRight'])

export const useFocusKeyboardNav = ({ onPrev, onNext }: Args): void => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  }, [onPrev, onNext])
}
