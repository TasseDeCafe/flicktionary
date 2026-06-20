import { useEffect, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Textarea } from './textarea'
import { PRESET_TAGS, usePresetTagTexts, type PresetTag } from './preset-tags'

// Nearest scrollable ancestor — the gloss popover's internal scroller
// (FloatingSheet's desktop popover body or mobile drawer body).
const getScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

// The note editor inside the gloss popovers (textarea + preset-tag chips +
// hint) — shared by the web gloss sheet and the extension's saved-mode popover
// so the note UX feeding the chat-seed pipeline stays identical across
// platforms. Both hosts mount it on demand below their study-targets block, so
// on mount it scrolls its popover scroller to the bottom to bring the textarea
// into view above the sticky footer. Renders a `display: contents` wrapper (no
// box of its own) so the host's flex gap still applies to the fields.
export const HighlightNoteEditor = ({
  note,
  tags,
  onNoteChange,
  onToggleTag,
}: {
  note: string
  tags: readonly string[]
  onNoteChange: (note: string) => void
  onToggleTag: (tag: PresetTag) => void
}) => {
  const { t } = useLingui()
  const { labels } = usePresetTagTexts()
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const scroller = getScrollParent(rootRef.current)
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [])

  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      <Textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder={t`Optional note for the LLM (what specifically confuses you?)`}
        rows={3}
      />
      <div className='flex flex-wrap gap-2'>
        {PRESET_TAGS.map((tag) => (
          <button
            key={tag}
            type='button'
            onClick={() => onToggleTag(tag)}
            className={
              tags.includes(tag)
                ? 'rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs dark:bg-yellow-400/15'
                : 'hover:bg-accent rounded-full border px-3 py-1 text-xs'
            }
          >
            {labels[tag]}
          </button>
        ))}
      </div>
      <p className='text-muted-foreground mt-2 text-xs'>{t`Your answer will appear in this card's chat.`}</p>
    </div>
  )
}
