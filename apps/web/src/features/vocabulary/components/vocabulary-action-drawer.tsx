import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ExternalLink, Trash2, type LucideIcon } from 'lucide-react'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { ResponsiveOverlay, OverlayContent, OverlayHeader, OverlayTitle } from '@/components/ui/responsive-overlay'
import { Button } from '@/components/ui/button'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface VocabularyActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: ChunkRow | null
  onOpenSource: (chunk: ChunkRow) => void
  onDelete: (chunk: ChunkRow) => void
  isDeleting?: boolean
}

type Variant = 'default' | 'destructive'

const ActionRow = ({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
  variant = 'default',
}: {
  icon: LucideIcon
  label: string
  description?: string
  onClick: () => void
  disabled?: boolean
  variant?: Variant
}) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-4 rounded-lg px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'destructive' ? 'hover:bg-red-50 active:bg-red-100' : 'hover:bg-gray-50 active:bg-gray-100'
    )}
  >
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        variant === 'destructive' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-900'
      )}
    >
      <Icon className='h-5 w-5' />
    </span>
    <span className='flex min-w-0 flex-col'>
      <span className={cn('text-base font-medium', variant === 'destructive' && 'text-red-700')}>{label}</span>
      {description && <span className='text-muted-foreground text-sm'>{description}</span>}
    </span>
  </button>
)

export const VocabularyActionDrawer = ({
  open,
  onOpenChange,
  chunk,
  onOpenSource,
  onDelete,
  isDeleting,
}: VocabularyActionDrawerProps) => {
  const { t } = useLingui()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Reset the confirm step whenever the drawer transitions to closed OR a
  // different chunk is loaded into the drawer. The parent closes the drawer
  // imperatively after a successful delete (without going through
  // onOpenChange), so we can't rely on the wrapper alone — `open` and
  // `chunk?.id` cover both paths.
  const chunkId = chunk?.id
  useEffect(() => {
    if (!open) setConfirmingDelete(false)
  }, [open, chunkId])

  const handleOpenChange = (next: boolean) => {
    if (!next) setConfirmingDelete(false)
    onOpenChange(next)
  }

  if (!chunk) return null

  const canOpenSource = chunk.studySessionId !== null && chunk.sourceAvailable

  return (
    <ResponsiveOverlay open={open} onOpenChange={handleOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk.headword}</OverlayTitle>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <ActionRow
            icon={ExternalLink}
            label={t`Open source`}
            description={canOpenSource ? t`Jump to the session this term came from` : t`Source was removed`}
            disabled={!canOpenSource}
            onClick={() => onOpenSource(chunk)}
          />
          {!confirmingDelete && (
            <ActionRow
              icon={Trash2}
              label={t`Delete`}
              description={t`Hide from vocabulary and Practice`}
              variant='destructive'
              onClick={() => setConfirmingDelete(true)}
            />
          )}
        </div>
        {confirmingDelete && (
          <div className='border-t bg-red-50/50 px-4 py-4'>
            <p className='text-sm text-red-900'>
              {(() => {
                const headword = chunk.headword
                return t`Hide "${headword}" from vocabulary and Practice? You can revive it by re-keeping it in a session.`
              })()}
            </p>
            <div className='mt-3 flex gap-2'>
              <Button
                variant='outline'
                className='flex-1'
                disabled={isDeleting}
                onClick={() => setConfirmingDelete(false)}
              >
                {t`Cancel`}
              </Button>
              <Button variant='destructive' className='flex-1' disabled={isDeleting} onClick={() => onDelete(chunk)}>
                {isDeleting ? t`Deleting…` : t`Delete`}
              </Button>
            </div>
          </div>
        )}
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
