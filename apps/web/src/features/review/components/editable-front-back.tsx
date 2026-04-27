import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateCardOverrides } from '../api/review-hooks'

type Props = {
  cardId: string
  defaultFront: string
  defaultBack: string
  initialFrontOverride: string | null
  initialBackOverride: string | null
}

const SAVE_DEBOUNCE_MS = 600

export const EditableFrontBack = ({
  cardId,
  defaultFront,
  defaultBack,
  initialFrontOverride,
  initialBackOverride,
}: Props) => {
  const { t } = useLingui()
  const [front, setFront] = useState(initialFrontOverride ?? defaultFront)
  const [back, setBack] = useState(initialBackOverride ?? defaultBack)
  const { mutate, isPending } = useUpdateCardOverrides()
  const initialFrontRef = useRef(initialFrontOverride)
  const initialBackRef = useRef(initialBackOverride)

  // Debounced save: when the user pauses typing, send overrides. Empty values
  // collapse to null so a cleared edit reverts to the defaults.
  useEffect(() => {
    const id = setTimeout(() => {
      const frontOverride = front.trim() === defaultFront.trim() ? null : front
      const backOverride = back.trim() === defaultBack.trim() ? null : back
      if (frontOverride === initialFrontRef.current && backOverride === initialBackRef.current) {
        return
      }
      mutate({ cardId, frontOverride, backOverride })
      initialFrontRef.current = frontOverride
      initialBackRef.current = backOverride
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [front, back, cardId, defaultFront, defaultBack, mutate])

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-xs'>{t`Card front`}</Label>
        <Textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} />
      </div>
      <div>
        <Label className='text-xs'>{t`Card back`}</Label>
        <Textarea value={back} onChange={(e) => setBack(e.target.value)} rows={5} />
      </div>
      {isPending && <p className='text-muted-foreground text-xs'>{t`Saving…`}</p>}
    </div>
  )
}
