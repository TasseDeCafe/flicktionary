import { useEffect, useRef } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronRight, Circle, CircleCheck, X } from 'lucide-react'
import { useAddAccountFlag, useGetUserPrefs, useGettingStartedStatus } from '../api/sessions-hooks'

// The first tenant of the home header slot: a first-run checklist that
// self-retires (records getting_started_completed) once every item is done,
// or disappears forever on dismiss. Renders nothing until both prefs and the
// status signals have resolved so established users never see it flash.
export const GettingStartedChecklist = ({ hasSessionsInList }: { hasSessionsInList: boolean }) => {
  const { t } = useLingui()
  const { data: prefs } = useGetUserPrefs()
  const addFlag = useAddAccountFlag()

  const flags = prefs?.accountFlags
  const retired =
    flags !== undefined && (flags.includes('getting_started_dismissed') || flags.includes('getting_started_completed'))
  const { data: status } = useGettingStartedStatus(flags !== undefined && !retired)

  const items = [
    {
      key: 'extension',
      label: t`Install the browser extension`,
      done: flags?.includes('extension_installed') ?? false,
      linkProps: { to: '/extension-welcome' } satisfies Pick<LinkProps, 'to' | 'hash'>,
    },
    {
      key: 'session',
      label: t`Start your first session`,
      done: (status?.hasSession ?? false) || hasSessionsInList,
      linkProps: { to: '/sessions/new' } satisfies Pick<LinkProps, 'to' | 'hash'>,
    },
    {
      key: 'terms',
      label: t`Save your first terms`,
      done: status?.hasSavedWords ?? false,
      linkProps: { to: '/user-guide', hash: 'saving-words' } satisfies Pick<LinkProps, 'to' | 'hash'>,
    },
    {
      key: 'practice',
      label: t`Do your first practice`,
      done: status?.hasPracticed ?? false,
      linkProps: { to: '/practice' } satisfies Pick<LinkProps, 'to' | 'hash'>,
    },
  ]
  const doneCount = items.filter((item) => item.done).length
  const allDone = status !== undefined && doneCount === items.length

  // Self-retire exactly once; the ref resets on failure so a transient error
  // doesn't brick retirement until remount (the endpoint is idempotent).
  const completionFired = useRef(false)
  const { mutate: recordFlag } = addFlag
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- completion is not a user event: the fourth item can flip via a background refetch (e.g. window refocus after practicing in another tab), so the record must fire from the derived all-done state, not from any handler */
    if (!allDone || retired || completionFired.current) return
    completionFired.current = true
    recordFlag(
      { flag: 'getting_started_completed' },
      {
        onError: () => {
          completionFired.current = false
        },
      }
    )
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
  }, [allDone, retired, recordFlag])

  // isPending/isSuccess hide the card the moment a dismissal (or the
  // completion record) fires, without waiting for the prefs refetch.
  if (retired || flags === undefined || status === undefined || addFlag.isPending || addFlag.isSuccess) {
    return null
  }

  const progressCount = doneCount
  const totalCount = items.length

  return (
    <section className='bg-card mt-4 overflow-hidden rounded-xl border'>
      <div className='flex items-center gap-2 px-4 pt-3 pb-1'>
        <h2 className='flex-1 text-sm font-semibold'>{t`Getting started`}</h2>
        <span className='text-muted-foreground text-xs'>{t`${progressCount} of ${totalCount} done`}</span>
        <button
          type='button'
          aria-label={t`Dismiss the getting-started checklist`}
          onClick={() => addFlag.mutate({ flag: 'getting_started_dismissed' })}
          className='text-muted-foreground hover:text-foreground active:text-foreground -mr-1 rounded-md p-1 transition-colors'
        >
          <X className='h-4 w-4' />
        </button>
      </div>
      <ul className='divide-border divide-y'>
        {items.map((item) =>
          item.done ? (
            <li key={item.key} className='flex items-center gap-3 px-4 py-3'>
              <CircleCheck className='h-5 w-5 shrink-0 text-yellow-500' />
              <span className='text-muted-foreground text-sm'>{item.label}</span>
            </li>
          ) : (
            <li key={item.key}>
              <Link
                {...item.linkProps}
                className='hover:bg-accent active:bg-accent flex items-center gap-3 px-4 py-3 transition-colors'
              >
                <Circle className='text-muted-foreground/40 h-5 w-5 shrink-0' />
                <span className='flex-1 text-sm font-medium'>{item.label}</span>
                <ChevronRight className='text-muted-foreground h-4 w-4 shrink-0' />
              </Link>
            </li>
          )
        )}
      </ul>
    </section>
  )
}
