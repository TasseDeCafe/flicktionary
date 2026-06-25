import { useMemo, useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Card } from '@flicktionary/ui/components/card'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useListStudySessions } from '../api/sessions-hooks'
import { deriveTvShows, latestEpisode } from '../utils/derive-tv-shows'
import { SessionRemoveDialog } from './session-remove-dialog'

const routeApi = getRouteApi('/_authenticated/_app/sessions/show/$tmdbShowId')

const pad2 = (n: number): string => String(n).padStart(2, '0')

type RemoveTarget = { id: string; title: string }

// Drill-in screen for one TV show: a full-width Add-episode button on top, then
// the list of added episodes. Reached by tapping a show row in the Sessions list.
export const ShowDetailView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { tmdbShowId } = routeApi.useParams()
  const { data: sessions } = useListStudySessions()
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)

  const group = useMemo(
    () => deriveTvShows(sessions ?? []).find((g) => g.tmdbShowId === Number(tmdbShowId)),
    [sessions, tmdbShowId]
  )

  const close = () => navigate({ to: '/sessions' })

  // The group disappears once its last episode is removed — fall back to the
  // Sessions list rather than render an empty shell.
  if (!group) {
    return (
      <ModalScreen onClose={close} closeIcon='chevron' title={t`Show`}>
        <div className='mx-auto w-full max-w-2xl px-4 py-6'>
          <p className='text-muted-foreground text-sm'>{t`This show has no episodes.`}</p>
        </div>
      </ModalScreen>
    )
  }

  const addEpisode = () =>
    void navigate({
      to: '/sessions/new',
      search: { tmdbShowId: group.tmdbShowId, tgt: group.language, season: latestEpisode(group).seasonNumber },
    })

  return (
    <ModalScreen onClose={close} closeIcon='chevron' title={group.showTitle}>
      <div className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto flex max-w-2xl flex-col gap-2'>
          {group.episodes.map((ep) => {
            const code = `S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`
            const label = ep.episodeTitle ? `${code} · ${ep.episodeTitle}` : code
            return (
              <Card key={ep.sessionId} className='hover:bg-accent active:bg-accent relative transition-colors'>
                <Link to='/sessions/$sessionId' params={{ sessionId: ep.sessionId }} className='block p-4 pr-14'>
                  <div className='truncate text-sm font-medium'>{label}</div>
                </Link>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t`Remove session`}
                  className='text-muted-foreground hover:text-destructive absolute top-1/2 right-2 h-8 w-8 -translate-y-1/2'
                  onClick={() => setRemoveTarget({ id: ep.sessionId, title: ep.contentSourceTitle ?? label })}
                >
                  <Trash2 className='h-4 w-4' />
                </Button>
              </Card>
            )
          })}
        </div>
      </div>

      <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
        <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
          <Button size='xl' className='w-full' onClick={addEpisode}>
            <Plus />
            {t`Add episode`}
          </Button>
        </div>
      </div>

      <SessionRemoveDialog
        open={removeTarget !== null}
        sessionId={removeTarget?.id ?? null}
        sessionTitle={removeTarget?.title ?? ''}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null)
        }}
      />
    </ModalScreen>
  )
}
