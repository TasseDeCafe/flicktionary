import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { RateButtons, type RateValue } from '@/components/ui/rate-buttons'

export type RateSheetChunkContent = {
  headword: string
  sense: string
  // Either translation (L1≠L2) or definition (L1=L2 fallback) is shown as the
  // glossing line. Optional support fields rendered when present.
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
}

interface RateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: RateSheetChunkContent | null
  isSubmitting?: boolean
  onSubmit: (rating: RateValue) => void
}

export const RateSheet = ({ open, onOpenChange, chunk, isSubmitting, onSubmit }: RateSheetProps) => {
  const { t } = useLingui()
  const [selected, setSelected] = useState<RateValue>('good')

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected('good')
        onOpenChange(next)
      }}
    >
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk?.headword ?? t`Rate`}</OverlayTitle>
          {chunk?.sense && <OverlayDescription>{chunk.sense}</OverlayDescription>}
        </OverlayHeader>
        {chunk && (
          <div className='flex flex-col gap-3 px-4 pb-2 text-sm'>
            {chunk.translation && (
              <p>
                <span className='text-muted-foreground'>{t`Translation: `}</span>
                {chunk.translation}
              </p>
            )}
            {chunk.definition && (
              <p>
                <span className='text-muted-foreground'>{t`Definition: `}</span>
                {chunk.definition}
              </p>
            )}
            {chunk.targetExample && (
              <p className='border-l-2 border-yellow-300 pl-3 italic'>
                {chunk.targetExample}
                {chunk.nativeExample && (
                  <span className='text-muted-foreground mt-1 block not-italic'>{chunk.nativeExample}</span>
                )}
              </p>
            )}
          </div>
        )}
        <OverlayFooter>
          <RateButtons
            value={selected}
            disabled={isSubmitting || !chunk}
            onSelect={(rating) => {
              setSelected(rating)
              onSubmit(rating)
            }}
          />
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
