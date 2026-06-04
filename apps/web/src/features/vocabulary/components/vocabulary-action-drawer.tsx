import { useLingui } from '@lingui/react/macro'
import { ExternalLink, Star, Trash2 } from 'lucide-react'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { useSetLearningMode } from '../api/vocabulary-hooks'

interface VocabularyActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: ChunkRow | null
  onOpenSource: (chunk: ChunkRow) => void
  onRequestDelete: (chunk: ChunkRow) => void
}

export const VocabularyActionDrawer = ({
  open,
  onOpenChange,
  chunk,
  onOpenSource,
  onRequestDelete,
}: VocabularyActionDrawerProps) => {
  const { t } = useLingui()
  const { mutate: setLearningMode, isPending: isSettingLearningMode } = useSetLearningMode()

  if (!chunk) return null

  const canOpenSource = chunk.studySessionId !== null && chunk.sourceAvailable
  const isActive = chunk.learningMode === 'active'

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk.headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this vocabulary term.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <OverlayActionRow
            icon={Star}
            label={isActive ? t`Switch to passive vocabulary` : t`Switch to active vocabulary`}
            description={
              isActive ? t`Stop drilling this term in active practice` : t`Drill this term in active practice`
            }
            disabled={isSettingLearningMode}
            onClick={() => {
              setLearningMode(
                { chunkId: chunk.id, learningMode: isActive ? 'passive' : 'active' },
                {
                  onSuccess: () => {
                    onOpenChange(false)
                  },
                }
              )
            }}
          />
          {canOpenSource && (
            <OverlayActionRow
              icon={ExternalLink}
              label={t`Open source`}
              description={t`Jump to the session this term came from`}
              onClick={() => onOpenSource(chunk)}
            />
          )}
          <OverlayActionRow
            icon={Trash2}
            label={t`Delete`}
            description={t`Hide from vocabulary and Practice`}
            variant='destructive'
            onClick={() => onRequestDelete(chunk)}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
