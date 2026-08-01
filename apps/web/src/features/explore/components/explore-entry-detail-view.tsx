import { useMemo } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ORPCError } from '@orpc/contract'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { checkIsTestUser } from '@/utils/test-users-utils'
import { getUserEmail, useAuthStore } from '@/stores/auth-store'
import { useSharedContentEntryDetail } from '../api/explore-hooks'
import { countWords } from '../utils/count-words'
import { ExploreAdminPanel } from './explore-admin-panel'
import { ExploreThumb } from './explore-card'
import { useAddSharedEntry } from './use-add-shared-entry'

const routeApi = getRouteApi('/_authenticated/_app/explore/$entryId')

// Mirrors the loaded layout (header block + text lines) so the screen doesn't
// reflow when the entry lands.
const ExploreEntryDetailSkeleton = () => (
  <div className='mx-auto w-full max-w-2xl px-4 py-6'>
    <div className='flex items-center gap-4'>
      <Skeleton className='h-20 w-14 shrink-0 rounded' />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <Skeleton className='h-6 w-2/3' />
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-3 w-32' />
      </div>
    </div>
    <div className='mt-6 flex flex-col gap-3'>
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className='h-4' style={{ width: `${100 - (index % 4) * 9}%` }} />
      ))}
    </div>
  </div>
)

// The full-text preview behind a catalog card: read first, add explicitly.
// Looking is free — nothing lands in the user's library until the sticky CTA
// commits; the CEFR first-contact dialog now lives on that commit, not on the
// card tap.
export const ExploreEntryDetailView = () => {
  const { t, i18n } = useLingui()
  const { entryId } = routeApi.useParams()
  const close = useModalScreenClose({ to: '/explore' })
  const isAdmin = checkIsTestUser(useAuthStore(getUserEmail))
  const { data: entry, isLoading, isError, error, isFetching, refetch } = useSharedContentEntryDetail(entryId)
  const { addEntry, isAdding, cefrDialog } = useAddSharedEntry()

  const isNotFound = isError && error instanceof ORPCError && error.code === 'NOT_FOUND'

  const wordCount = useMemo(() => (entry ? countWords(entry.text, entry.language) : 0), [entry])
  const paragraphs = useMemo(() => (entry ? entry.text.split('\n').filter((line) => line !== '') : []), [entry])

  const metaParts = entry
    ? [getLocalizedCoverageLanguageName(i18n, entry.language), entry.sourceDomain].filter(
        (part): part is string => part !== null && part !== ''
      )
    : []
  const lineCount = entry?.segmentCount ?? 0

  return (
    <ModalScreen onClose={close} closeIcon='chevron' title={entry?.title ?? t`Shared content`}>
      <div className='flex flex-1 flex-col overflow-y-auto'>
        {isLoading ? (
          <ExploreEntryDetailSkeleton />
        ) : isNotFound ? (
          <div className='flex flex-1 items-center justify-center px-4 py-8'>
            <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
              <p className='text-muted-foreground text-sm'>{t`This content is no longer shared.`}</p>
              <Button variant='outline' onClick={close}>
                {t`Back to Explore`}
              </Button>
            </div>
          </div>
        ) : isError || !entry ? (
          <div className='flex flex-1 items-center justify-center px-4 py-8'>
            <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
              <p className='text-muted-foreground text-sm'>{t`We couldn't load this content.`}</p>
              <Button variant='outline' disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? t`Retrying...` : t`Try again`}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className='mx-auto w-full max-w-2xl flex-1 px-4 py-6'>
              <div className='flex items-center gap-4'>
                <ExploreThumb entry={entry} className='h-20 w-14' />
                <div className='min-w-0 flex-1'>
                  <h2 className='text-lg font-semibold'>{entry.title}</h2>
                  <div className='text-muted-foreground truncate text-sm'>{metaParts.join(' · ')}</div>
                  <div className='text-muted-foreground mt-1 text-xs'>{t`~${wordCount} words · ${lineCount} lines`}</div>
                </div>
              </div>
              {isAdmin && <ExploreAdminPanel entry={entry} />}
              {/* Read-only preview: no glossing, no selection commit — the
                  reader (and everything interactive) starts after the CTA. */}
              <div className='mt-6 flex flex-col gap-3 text-base leading-relaxed whitespace-pre-wrap'>
                {paragraphs.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            </div>
            {/* Non-live entries are admin-only views of dead content — adding
                would 404, so there is nothing to CTA. */}
            {entry.status === 'live' && (
              <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
                <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
                  <Button size='xl' className='w-full' disabled={isAdding} onClick={() => addEntry(entry)}>
                    {isAdding ? t`Adding...` : t`Start reading`}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {cefrDialog}
    </ModalScreen>
  )
}
