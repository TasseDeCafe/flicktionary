import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLingui } from '@lingui/react/macro'
import { Pencil, Trash2 } from 'lucide-react'

type Props = {
  anchorEl: HTMLElement | null
  onEdit: () => void
  onRemove: () => void
  onClose: () => void
}

export const HighlightActionMenu = ({ anchorEl, onEdit, onRemove, onClose }: Props) => {
  const { t } = useLingui()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null)
      return
    }
    const rect = anchorEl.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [anchorEl])

  useEffect(() => {
    if (!anchorEl) return
    const handleDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null
      if (!target) return
      if (target.closest('[data-highlight-action-menu]')) return
      if (target === anchorEl || target.closest(`[data-highlight-id="${anchorEl.dataset.highlightId}"]`)) return
      onClose()
    }
    const handleScroll = () => onClose()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('touchstart', handleDown)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('touchstart', handleDown)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [anchorEl, onClose])

  if (!anchorEl || !pos) return null

  return createPortal(
    <div
      data-highlight-action-menu
      role='menu'
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className='bg-popover text-popover-foreground z-50 flex gap-1 rounded-md border p-1 shadow-md'
    >
      <button
        type='button'
        onClick={onEdit}
        className='hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm'
      >
        <Pencil className='h-3.5 w-3.5' />
        {t`Note & tags`}
      </button>
      <button
        type='button'
        onClick={onRemove}
        className='hover:bg-destructive/10 text-destructive flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm'
      >
        <Trash2 className='h-3.5 w-3.5' />
        {t`Remove`}
      </button>
    </div>,
    document.body
  )
}
