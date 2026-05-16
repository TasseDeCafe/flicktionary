import { useLingui } from '@lingui/react/macro'
import { MoreVertical, RotateCcw } from 'lucide-react'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { Button } from '@/components/ui/button'
import { RateButtons, type RateValue } from '@/components/ui/rate-buttons'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import type { Grammar } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { StressMarkedText } from './stress-marked-text'

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
  // The user has soft-deleted this term. Swaps the rate UI for a slim Restore
  // CTA — rating a deleted chunk would be confusing, and the chunk no longer
  // participates in SRS until restored anyway.
  isDeleted: boolean
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
  // Wires the 3-dots overflow button in the header. The parent owns the
  // actions sheet because navigation + delete confirm + restore-toast all
  // live there.
  onMoreOptions?: () => void
  // Restore is only meaningful when isDeleted=true; the parent fires the
  // mutation and re-fetches.
  onRestore?: () => void
  isRestoring?: boolean
}

export const RateSheet = ({
  open,
  onOpenChange,
  chunk,
  currentRating,
  isSubmitting,
  onSubmit,
  onMoreOptions,
  onRestore,
  isRestoring,
}: RateSheetProps) => {
  const { t } = useLingui()
  // Translation wins for the description slot; definition is the L1=L2 fallback.
  const description = chunk?.translation || chunk?.definition || null
  const titleText = chunk?.displayForm || chunk?.headword || t`Rate`
  const showOverflow = !!onMoreOptions && !!chunk && !chunk.isDeleted

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      {/* showCloseButton=false on desktop so the dialog's built-in X doesn't
          collide with our 3-dots overflow. Esc + click-outside still dismiss. */}
      <OverlayContent showCloseButton={false}>
        <OverlayHeader>
          <div className='relative'>
            <div className='flex flex-col gap-1'>
              <OverlayTitle>
                <StressMarkedText text={titleText} lang={chunk?.targetLanguage} />
              </OverlayTitle>
              {chunk?.ipa && <div className='text-muted-foreground text-sm'>{chunk.ipa}</div>}
              {description && <OverlayDescription>{description}</OverlayDescription>}
            </div>
            {showOverflow && (
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t`More options`}
                onClick={onMoreOptions}
                className='absolute top-0 right-0'
              >
                <MoreVertical className='h-5 w-5' />
              </Button>
            )}
          </div>
          {chunk?.grammar && !chunk.isDeleted && (
            <div className='mt-2 flex justify-center sm:justify-start'>
              <GrammarChips grammar={chunk.grammar} targetLanguage={chunk.targetLanguage} />
            </div>
          )}
        </OverlayHeader>
        {chunk?.targetExample && !chunk.isDeleted && (
          <div className='flex flex-col gap-3 px-4 pb-2 text-sm'>
            <p className='border-l-2 border-yellow-300 pl-3 italic'>
              {chunk.targetExample}
              {chunk.nativeExample && (
                <span className='text-muted-foreground mt-1 block not-italic'>{chunk.nativeExample}</span>
              )}
            </p>
          </div>
        )}
        {chunk?.isDeleted && (
          <div className='flex flex-col gap-3 px-4 pb-2 text-sm'>
            <p className='text-muted-foreground'>{t`This term is removed from your vocabulary. Restore it to keep practicing.`}</p>
          </div>
        )}
        <OverlayFooter>
          {chunk?.isDeleted ? (
            <Button type='button' size='xl' disabled={isRestoring || !onRestore} onClick={() => onRestore?.()}>
              <RotateCcw className='mr-1 h-4 w-4' />
              {isRestoring ? t`Restoring…` : t`Restore`}
            </Button>
          ) : (
            <RateButtons value={currentRating ?? undefined} disabled={isSubmitting || !chunk} onSelect={onSubmit} />
          )}
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
