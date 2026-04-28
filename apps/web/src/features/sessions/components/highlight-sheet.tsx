import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateHighlightNoteAndTags } from '../api/sessions-hooks'

const PRESET_TAGS = ['explain', '3_examples', 'synonyms', 'etymology', 'why_this_form'] as const

type EditableHighlight = {
  id: string
  selectionText: string
  note: string | null
  presetTags: string[]
}

type Props = {
  open: boolean
  sessionId: string
  highlight: EditableHighlight | null
  onClose: () => void
}

const presetLabel = (
  tag: (typeof PRESET_TAGS)[number],
  t: (s: TemplateStringsArray, ...args: unknown[]) => string
): string => {
  switch (tag) {
    case 'explain':
      return t`Explain`
    case '3_examples':
      return t`3 examples`
    case 'synonyms':
      return t`Synonyms`
    case 'etymology':
      return t`Etymology`
    case 'why_this_form':
      return t`Why this form?`
  }
}

export const HighlightSheet = ({ open, sessionId, highlight, onClose }: Props) => {
  const { t } = useLingui()
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const { mutate: update, isPending } = useUpdateHighlightNoteAndTags(sessionId)

  // Re-prime the form whenever the editor opens with a different highlight.
  useEffect(() => {
    if (!open || !highlight) return
    setNote(highlight.note ?? '')
    setTags(highlight.presetTags)
  }, [open, highlight?.id])

  const handleSave = () => {
    if (!highlight) return
    update(
      {
        sessionId,
        highlightId: highlight.id,
        note: note.trim() || null,
        presetTags: tags,
      },
      { onSuccess: onClose }
    )
  }

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{t`Note & tags`}</DialogTitle>
        </DialogHeader>
        {highlight ? (
          <div className='flex flex-col gap-4'>
            <div className='rounded-md border bg-yellow-50 p-3 text-sm'>“{highlight.selectionText}”</div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t`Optional note for the LLM (what specifically confuses you?)`}
              rows={3}
            />
            <div className='flex flex-wrap gap-2'>
              {PRESET_TAGS.map((tag) => (
                <button
                  key={tag}
                  type='button'
                  onClick={() => toggleTag(tag)}
                  className={
                    tags.includes(tag)
                      ? 'rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs'
                      : 'rounded-full border px-3 py-1 text-xs hover:bg-gray-50'
                  }
                >
                  {presetLabel(tag, t)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>{t`No highlight selected.`}</p>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>{t`Cancel`}</Button>
          <Button disabled={!highlight || isPending} onClick={handleSave}>
            {isPending ? t`Saving…` : t`Save`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
