import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetHeader,
  FloatingSheetTitle,
  type FloatingSheetAnchor,
} from '@flicktionary/ui/components/floating-sheet'
import type { Chunk } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { EditableCardFields } from '@/features/review/components/editable-card-fields'
import { EditableGrammarPanel } from '@/features/review/components/editable-grammar-panel'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { useGetChunk } from '@/features/review/api/review-hooks'

type EditCardSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Anchored to the pencil button that opened the sheet (desktop popover
  // positioning; mobile renders a bottom drawer regardless).
  anchor: FloatingSheetAnchor
  // chunkId IS userLookupId — the practice queue's term id addresses the
  // canonical chunk row directly.
  userLookupId: string
  targetLanguage: string
  // Live sync back into the flashcard queue: fired with the freshest chunk on
  // every fetch/refetch so the card faces (and any redrill copies of the same
  // lookup) reflect edits immediately without rewriting QueueItems.
  onChunkChange: (chunk: Chunk) => void
}

// Mid-review content editing: the full focus-view editor stack — content
// fields + grammar panel — in a FloatingSheet over the flashcard, so a typo
// spotted on a card face doesn't force abandoning the session queue. Edits
// PATCH the canonical chunk; both editors debounce + server-sync internally.
export const EditCardSheet = ({
  open,
  onOpenChange,
  anchor,
  userLookupId,
  targetLanguage,
  onChunkChange,
}: EditCardSheetProps) => {
  const { t } = useLingui()
  const { data: userPrefs } = useGetUserPrefs()
  // Fetch on open only — the queue payload stays lean (ReviewTerm lacks
  // explorationExtras/learningMode/etc.).
  const { data, isPending } = useGetChunk(userLookupId, open)
  const chunk = data?.chunk
  const surfaceForm = data?.surfaceForm ?? null

  // Mirror focus-view's translation-fields mode: same language → meaningless
  // (hidden); translations pref off → manual-add disclosure (on-demand).
  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const translationFieldsMode = sameLanguage
    ? ('hidden' as const)
    : getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
      ? ('editable' as const)
      : ('on-demand' as const)

  // Push every fresh server copy (initial fetch + post-save invalidations)
  // into the queue overlay so the displayed card tracks the edits live.
  // Keyed on chunk alone (not onChunkChange — a per-render parent closure) so
  // it fires once per fresh server copy, not on every parent re-render.
  useEffect(() => {
    if (chunk) onChunkChange(chunk)
  }, [chunk])

  return (
    <FloatingSheet open={open} onOpenChange={onOpenChange} anchor={anchor}>
      {/* The desktop popover has no max-height of its own — cap + scroll so
          the two-panel editor never overflows the viewport. w-96 widens the
          default w-80 popover for the field grid; mobile ignores both (the
          drawer brings its own cap and scroll container). */}
      <FloatingSheetContent className='max-h-[80vh] w-96 overflow-y-auto'>
        <FloatingSheetHeader>
          <FloatingSheetTitle>{chunk ? chunk.headword : t`Edit card`}</FloatingSheetTitle>
        </FloatingSheetHeader>
        <FloatingSheetBody>
          {isPending || !chunk ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>{t`Loading…`}</p>
          ) : (
            // Keyed on chunk.id only — the sheet stays mounted across saves,
            // and both editors already server-sync via their lastSavedRef
            // effects (remount-per-save would steal input focus mid-typing).
            // No sourceSessionId: flashcards are sessionless.
            <div key={chunk.id} className='flex flex-col gap-3 text-left'>
              <EditableCardFields
                chunk={chunk}
                surfaceForm={surfaceForm}
                translationFieldsMode={translationFieldsMode}
              />
              <EditableGrammarPanel chunk={chunk} targetLanguage={targetLanguage} />
            </div>
          )}
        </FloatingSheetBody>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}
