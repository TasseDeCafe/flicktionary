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
import { GrammarChips } from '@/features/review/components/grammar-chips'
import type { Grammar } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type RateSheetChunkContent = {
  headword: string
  // Stress-marked / decorated variant of the headword (e.g. Russian `ви́деть`).
  // When present, replaces `headword` in the title so the learner sees the
  // stress cue directly.
  displayForm: string | null
  // Already-picked IPA string. The caller is responsible for dialect selection
  // (English GA/RP) via `pickIpa`; the rate sheet just renders the string.
  ipa: string | null
  // Either translation (L1≠L2) or definition (L1=L2 fallback) is shown as the
  // glossing line. Optional support fields rendered when present.
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  // Typed morphology bag from user_lookups.grammar. Drives the GrammarChips
  // (gender / aspect / government / pos / …). Filtered by per-language
  // allowlist in `getLanguageGrammarConfig`.
  grammar: Grammar | null
  targetLanguage: string
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
  const titleText = chunk?.displayForm || chunk?.headword || t`Rate`

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{titleText}</OverlayTitle>
          {chunk?.ipa && <div className='text-muted-foreground text-sm'>{chunk.ipa}</div>}
          {description && <OverlayDescription>{description}</OverlayDescription>}
          {chunk?.grammar && (
            <div className='mt-2 flex justify-center sm:justify-start'>
              <GrammarChips grammar={chunk.grammar} targetLanguage={chunk.targetLanguage} />
            </div>
          )}
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
