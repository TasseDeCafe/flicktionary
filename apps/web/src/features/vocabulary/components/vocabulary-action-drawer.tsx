import { useLingui } from '@lingui/react/macro'
import { ExternalLink, Trash2 } from 'lucide-react'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { StudyTargetsSection } from '@/features/review/components/study-targets-section'

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

  if (!chunk) return null

  const canOpenSource = chunk.studySessionId !== null && chunk.sourceAvailable

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk.headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this vocabulary term.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-3 px-4 pb-2'>
          <StudyTargetsSection
            chunk={{
              id: chunk.id,
              headword: chunk.headword,
              learningMode: chunk.learningMode,
              grammar: chunk.grammar,
              targetLanguage: chunk.targetLanguage,
            }}
          />
        </div>
        <div className='flex flex-col gap-1 px-2 pb-2'>
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
