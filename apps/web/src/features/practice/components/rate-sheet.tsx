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
  // Previously-submitted rating for this chunk in the current text, if any.
  // Highlights that button instead of the default 'good' so the user sees
  // what they last picked when re-opening a chunk.
  currentRating?: RateValue | null
  isSubmitting?: boolean
  onSubmit: (rating: RateValue) => void
}

export const RateSheet = ({ open, onOpenChange, chunk, currentRating, isSubmitting, onSubmit }: RateSheetProps) => {
  const { t } = useLingui()
  // Translation wins for the description slot; definition is the L1=L2 fallback.
  const description = chunk?.translation || chunk?.definition || null

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk?.headword ?? t`Rate`}</OverlayTitle>
          {description && <OverlayDescription>{description}</OverlayDescription>}
        </OverlayHeader>
        {chunk?.targetExample && (
          <div className='flex flex-col gap-3 px-4 pb-2 text-sm'>
            <p className='border-l-2 border-yellow-300 pl-3 italic'>
              {chunk.targetExample}
              {chunk.nativeExample && (
                <span className='text-muted-foreground mt-1 block not-italic'>{chunk.nativeExample}</span>
              )}
            </p>
          </div>
        )}
        <OverlayFooter>
          <RateButtons value={currentRating ?? undefined} disabled={isSubmitting || !chunk} onSelect={onSubmit} />
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
