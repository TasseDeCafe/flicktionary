import { useState } from 'react'
import { Button } from '@flicktionary/ui/components/button'
import { Input } from '@flicktionary/ui/components/input'
import { useAdminRemoveSharedEntry, useAdminSetSharedEntryFeatured } from '../api/explore-admin-hooks'
import type { SharedContentEntryStatus } from '../api/explore-admin-hooks'

const STATUS_CLASSES: Record<SharedContentEntryStatus, string> = {
  live: 'text-green-700 dark:text-green-400',
  unshared: 'text-amber-700 dark:text-amber-400',
  removed: 'text-destructive',
}

type Props = {
  entry: {
    id: string
    status: SharedContentEntryStatus
    featured: boolean
    removedReason: string | null
  }
}

// Moderation actions on the detail screen, test users only — the admin acts
// with the full text in view (removal is a permanent tombstone, so seeing the
// content first is the point). Strings are intentionally untranslated like
// the rest of the admin surfaces; the server's assertTestUser is the
// authority.
export const ExploreAdminPanel = ({ entry }: Props) => {
  const removeMutation = useAdminRemoveSharedEntry()
  const setFeaturedMutation = useAdminSetSharedEntryFeatured()
  // The remove flow is inline: "Remove…" opens a reason input, and only a
  // non-empty reason enables the tombstone.
  const [removalReason, setRemovalReason] = useState<string | null>(null)

  const handleConfirmRemove = async () => {
    if (removalReason === null || removalReason.trim() === '') return
    try {
      await removeMutation.mutateAsync({ entryId: entry.id, reason: removalReason.trim() })
      setRemovalReason(null)
    } catch {
      // the mutation's errorMessage meta already surfaced a toast
    }
  }

  return (
    <div className='mt-4 space-y-2 rounded-lg border border-dashed p-3'>
      <div className='flex items-center gap-3'>
        <div className='min-w-0 flex-1 text-sm'>
          Admin · <span className={STATUS_CLASSES[entry.status]}>{entry.status}</span>
          {entry.featured ? ' · ★ featured' : ''}
        </div>
        <div className='flex shrink-0 gap-2'>
          {entry.status === 'live' && (
            <Button
              size='sm'
              variant='outline'
              disabled={setFeaturedMutation.isPending}
              onClick={() => setFeaturedMutation.mutate({ entryId: entry.id, featured: !entry.featured })}
            >
              {entry.featured ? 'Unfeature' : 'Feature'}
            </Button>
          )}
          {entry.status !== 'removed' && removalReason === null && (
            <Button
              size='sm'
              variant='outline'
              className='border-destructive/40 hover:bg-destructive/10'
              onClick={() => setRemovalReason('')}
            >
              Remove…
            </Button>
          )}
        </div>
      </div>
      {entry.status === 'removed' && entry.removedReason !== null && (
        <div className='text-muted-foreground text-xs italic'>Reason: {entry.removedReason}</div>
      )}
      {removalReason !== null && (
        <div className='flex items-center gap-2'>
          <Input
            autoFocus
            placeholder='Removal reason (kept on the tombstone)'
            value={removalReason}
            onChange={(event) => setRemovalReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleConfirmRemove()
            }}
          />
          <Button
            size='sm'
            variant='outline'
            className='border-destructive/40 hover:bg-destructive/10'
            disabled={removeMutation.isPending || removalReason.trim() === ''}
            onClick={() => void handleConfirmRemove()}
          >
            Remove
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setRemovalReason(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
