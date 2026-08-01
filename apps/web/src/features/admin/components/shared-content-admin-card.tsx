import { useState } from 'react'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@flicktionary/ui/components/card'
import { Input } from '@flicktionary/ui/components/input'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import {
  useAdminRemoveSharedEntry,
  useAdminSetSharedEntryFeatured,
  useAdminSharedContentList,
} from '@/features/admin/api/shared-content-admin-hooks'

const STATUS_CLASSES: Record<'live' | 'unshared' | 'removed', string> = {
  live: 'text-green-700 dark:text-green-400',
  unshared: 'text-amber-700 dark:text-amber-400',
  removed: 'text-destructive',
}

// Moderation surface for the Explore catalog. Like the rest of the admin
// view, strings are intentionally untranslated (test users only; the route
// gate is in admin-settings.tsx, the authority is assertTestUser server-side).
export const SharedContentAdminCard = () => {
  const listQuery = useAdminSharedContentList()
  const removeMutation = useAdminRemoveSharedEntry()
  const setFeaturedMutation = useAdminSetSharedEntryFeatured()
  // The remove flow is inline per row: "Remove…" opens a reason input, and
  // only a non-empty reason enables the tombstone.
  const [removalTarget, setRemovalTarget] = useState<{ entryId: string; reason: string } | null>(null)

  const handleConfirmRemove = async () => {
    if (removalTarget === null || removalTarget.reason.trim() === '') return
    try {
      await removeMutation.mutateAsync({ entryId: removalTarget.entryId, reason: removalTarget.reason.trim() })
      setRemovalTarget(null)
    } catch {
      // the mutation's errorMessage meta already surfaced a toast
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared content (Explore)</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-stone-600'>
          Latest entries in the public Explore catalog. Removing an entry tombstones it: it leaves the feed and the same
          content can never be re-shared. Featured entries surface on the dashboard.
        </p>
        {listQuery.isPending ? (
          <p className='text-muted-foreground text-sm'>Loading…</p>
        ) : listQuery.isError ? (
          <p className='text-destructive text-sm'>Failed to load the catalog.</p>
        ) : listQuery.data.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No shared entries yet.</p>
        ) : (
          <ul className='divide-border divide-y'>
            {listQuery.data.map((entry) => {
              const isRemovalTarget = removalTarget?.entryId === entry.id
              const metaParts = [
                entry.type,
                getLanguageName(entry.language),
                new Date(entry.createdAt).toLocaleDateString(),
              ]
              return (
                <li key={entry.id} className='space-y-2 py-3 first:pt-0 last:pb-0'>
                  <div className='flex items-center gap-3'>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-sm font-semibold'>
                        {entry.featured ? '★ ' : ''}
                        {entry.title}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        {metaParts.join(' · ')} · <span className={STATUS_CLASSES[entry.status]}>{entry.status}</span>
                      </div>
                      {entry.status === 'removed' && entry.removedReason !== null && (
                        <div className='text-muted-foreground text-xs italic'>Reason: {entry.removedReason}</div>
                      )}
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
                      {entry.status !== 'removed' && !isRemovalTarget && (
                        <Button
                          size='sm'
                          variant='outline'
                          className='border-destructive/40 hover:bg-destructive/10'
                          onClick={() => setRemovalTarget({ entryId: entry.id, reason: '' })}
                        >
                          Remove…
                        </Button>
                      )}
                    </div>
                  </div>
                  {isRemovalTarget && (
                    <div className='flex items-center gap-2'>
                      <Input
                        autoFocus
                        placeholder='Removal reason (kept on the tombstone)'
                        value={removalTarget.reason}
                        onChange={(event) => setRemovalTarget({ entryId: entry.id, reason: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleConfirmRemove()
                        }}
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        className='border-destructive/40 hover:bg-destructive/10'
                        disabled={removeMutation.isPending || removalTarget.reason.trim() === ''}
                        onClick={() => void handleConfirmRemove()}
                      >
                        Remove
                      </Button>
                      <Button size='sm' variant='ghost' onClick={() => setRemovalTarget(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
