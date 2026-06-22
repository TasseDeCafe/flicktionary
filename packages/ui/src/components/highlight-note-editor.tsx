import { useEffect, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Lock } from 'lucide-react'
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
//
// `readOnly` is the locked, post-save view: the note/presets seed the card chat
// exactly once and can never be edited afterwards (re-saving would duplicate the
// seeded turn — see seed-card-chat-from-note.ts). The only way to change them is
// to delete the highlight. So it mirrors the study-targets lock above it: the
// saved note + selected chips, uniformly dimmed and non-interactive, with a lock
// caption — instead of a deletable affordance the compact sheet can't model.
export const HighlightNoteEditor = ({
  note,
  tags,
  onNoteChange,
  onToggleTag,
  readOnly = false,
}: {
  note: string
  tags: readonly string[]
  onNoteChange: (note: string) => void
  onToggleTag: (tag: PresetTag) => void
  readOnly?: boolean
}) => {
  const { t } = useLingui()
  const { labels } = usePresetTagTexts()
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const scroller = getScrollParent(rootRef.current)
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [])

  if (readOnly) {
    return (
      <div ref={rootRef} style={{ display: 'contents' }}>
        {note.trim() ? <p className='text-foreground/80 text-sm whitespace-pre-wrap'>{note}</p> : null}
        {tags.length > 0 && (
          <div className='pointer-events-none flex flex-wrap gap-2 opacity-70'>
            {PRESET_TAGS.filter((tag) => tags.includes(tag)).map((tag) => (
              <span
                key={tag}
                className='rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs dark:bg-yellow-400/15'
              >
                {labels[tag]}
              </span>
            ))}
          </div>
        )}
        <div className='text-muted-foreground/70 flex items-center gap-1 text-xs'>
          <Lock className='h-3 w-3' />
          {t`Saved to this card's chat — delete the highlight to change it.`}
        </div>
      </div>
    )
  }

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
