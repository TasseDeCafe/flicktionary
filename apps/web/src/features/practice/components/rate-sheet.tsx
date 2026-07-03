import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { MoreVertical, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react'
import {
  FloatingSheet,
  FloatingSheetContent,
  FloatingSheetDescription,
  FloatingSheetFooter,
  FloatingSheetHeader,
  FloatingSheetTitle,
  type FloatingSheetAnchor,
} from '@flicktionary/ui/components/floating-sheet'
import { Button } from '@flicktionary/ui/components/button'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { composeGermanCitation } from '@flicktionary/core/utils/german-noun-forms'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import type { Grammar } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'

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
  // Whether the term is in production study. Drives the production-study
  // toggle action in the 3-dots overflow. Null when the canonical row is
  // missing — the switch action is hidden in that case.
  isProductionEnabled: boolean | null
}

type Mode = 'rate' | 'actions'

interface RateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: RateSheetChunkContent | null
  // Element or rect the floating sheet should anchor to on desktop. Mobile
  // ignores this and slides up from the bottom.
  anchor: FloatingSheetAnchor
  // Previously-submitted rating for this chunk in the current text, if any.
  // Highlights that button instead of the default 'good' so the user sees
  // what they last picked when re-opening a chunk.
  currentRating?: RateValue | null
  isSubmitting?: boolean
  onSubmit: (rating: RateValue) => void
  // Actions-mode handlers — the 3-dots overflow swaps the sheet contents to
  // an action list rather than opening a sibling popover, so the bottom-drawer
  // visual position stays put on mobile.
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  // Flips the term's production study on/off. Called with the target state
  // (i.e. the opposite of the current one). Hidden in the menu when
  // `chunk.isProductionEnabled` is null (no canonical row yet).
  onToggleProduction: (next: boolean) => void
  isTogglingProduction?: boolean
  // Restore is only meaningful when isDeleted=true; the parent fires the
  // mutation and re-fetches.
  onRestore?: () => void
  isRestoring?: boolean
}

export const RateSheet = ({
  open,
  onOpenChange,
  chunk,
  anchor,
  currentRating,
  isSubmitting,
  onSubmit,
  canEdit,
  onEdit,
  onDelete,
  onToggleProduction,
  isTogglingProduction,
  onRestore,
  isRestoring,
}: RateSheetProps) => {
  const { t } = useLingui()
  const [mode, setMode] = useState<Mode>('rate')
  const { data: userPrefs } = useGetUserPrefs()

  // Reset to rate-mode whenever the sheet closes, so the next open is fresh.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- the sheet stays mounted across open/close (overlay exit animation), and close happens through several paths (dismiss, rating success, restore); keying the reset on `open` covers them all
    if (!open) setMode('rate')
  }, [open])

  // Translation wins for the description slot; definition is the fallback.
  // Presence-based: with the translations pref off, a stored translation is a
  // manual one the user wants to see.
  const description = chunk?.translation || chunk?.definition || null
  // German citation nouns get the derived article title (`der Bestandteil`); an
  // explicit display form (e.g. Russian stress-marked) still wins where present.
  const citationTitle = chunk
    ? composeGermanCitation({ headword: chunk.headword, grammar: chunk.grammar, targetLanguage: chunk.targetLanguage })
        .title
    : null
  const titleText = chunk?.displayForm || citationTitle || chunk?.headword || t`Rate`
  const showOverflow = !!chunk && !chunk.isDeleted && mode === 'rate'

  return (
    <FloatingSheet open={open} onOpenChange={onOpenChange} anchor={anchor}>
      <FloatingSheetContent>
        <FloatingSheetHeader className={mode === 'actions' ? 'text-center md:text-left' : undefined}>
          <div className='relative'>
            <div className={`flex flex-col gap-1 ${showOverflow ? 'pr-10' : ''}`}>
              <FloatingSheetTitle>
                <span lang={chunk?.targetLanguage}>{titleText}</span>
              </FloatingSheetTitle>
              {mode === 'rate' && chunk?.ipa && (
                <div className='text-muted-foreground flex items-center gap-1.5 text-sm'>
                  <EnglishIpaDialectFlag
                    targetLanguage={chunk.targetLanguage}
                    englishIpaDialect={userPrefs?.englishIpaDialect ?? 'ga'}
                  />
                  <span>{chunk.ipa}</span>
                </div>
              )}
              {mode === 'rate' && description && <FloatingSheetDescription>{description}</FloatingSheetDescription>}
            </div>
            {showOverflow && (
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t`More options`}
                onClick={() => setMode('actions')}
                className='absolute top-0 right-0'
              >
                <MoreVertical className='h-5 w-5' />
              </Button>
            )}
          </div>
          {mode === 'rate' && chunk?.grammar && !chunk.isDeleted && (
            <div className='mt-2 flex justify-start'>
              <GrammarChips grammar={chunk.grammar} targetLanguage={chunk.targetLanguage} />
            </div>
          )}
        </FloatingSheetHeader>

        {mode === 'rate' && chunk?.targetExample && !chunk.isDeleted && (
          <div className='flex flex-col gap-3 px-2 pb-2 text-sm'>
            <p className='border-l-2 border-yellow-300 pl-3'>
              {chunk.targetExample}
              {chunk.nativeExample && <span className='text-muted-foreground mt-1 block'>{chunk.nativeExample}</span>}
            </p>
          </div>
        )}
        {mode === 'rate' && chunk?.isDeleted && (
          <div className='flex flex-col gap-3 px-2 pb-2 text-sm'>
            <p className='text-muted-foreground'>{t`This term is removed from your vocabulary. Restore it to keep practicing.`}</p>
          </div>
        )}

        {mode === 'actions' && (
          <div className='flex flex-col gap-1 px-2 pb-2'>
            <OverlayActionRow
              icon={Pencil}
              label={t`Edit term`}
              description={t`Open the focus view to edit fields, chat, or generate full exploration.`}
              disabled={!canEdit}
              onClick={onEdit}
            />
            {chunk?.isProductionEnabled === false && (
              <OverlayActionRow
                icon={Star}
                label={t`Switch to production`}
                description={t`Add this term to production practice.`}
                disabled={!!isTogglingProduction}
                onClick={() => onToggleProduction(true)}
              />
            )}
            {chunk?.isProductionEnabled === true && (
              <OverlayActionRow
                icon={Star}
                label={t`Switch to recognition`}
                description={t`Move this term back to recognition practice only.`}
                disabled={!!isTogglingProduction}
                onClick={() => onToggleProduction(false)}
              />
            )}
            <OverlayActionRow
              icon={Trash2}
              label={t`Delete from vocabulary`}
              description={t`Hide this term from Practice and Vocabulary. You can restore it later.`}
              variant='destructive'
              onClick={onDelete}
            />
          </div>
        )}

        {mode === 'rate' && (
          <FloatingSheetFooter>
            {chunk?.isDeleted ? (
              <Button type='button' size='xl' disabled={isRestoring || !onRestore} onClick={() => onRestore?.()}>
                <RotateCcw className='mr-1 h-4 w-4' />
                {isRestoring ? t`Restoring…` : t`Restore`}
              </Button>
            ) : (
              <RateButtons value={currentRating ?? undefined} disabled={isSubmitting || !chunk} onSelect={onSubmit} />
            )}
          </FloatingSheetFooter>
        )}
      </FloatingSheetContent>
    </FloatingSheet>
  )
}
