import { Link, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, FileText, Puzzle } from 'lucide-react'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'

// First-run replacement for the bare "no sessions" line: says what a session
// is and mirrors the primary "+ New" actions so the empty screen is itself an
// entry point. The extension row deep-links into the guide since watching on
// YouTube/streaming starts outside the app. Shared by the Sessions list and
// the dashboard's Recent section.
export const SessionsEmptyState = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  return (
    <div className='bg-card rounded-xl border p-4'>
      <h2 className='font-semibold'>{t`Start your first session`}</h2>
      <p className='text-muted-foreground mt-1 text-sm'>
        {t`A session is anything you study from: a movie or show with subtitles, a YouTube video, an article, or a pasted text. Terms you save while watching or reading become your vocabulary.`}
      </p>
      <div className='mt-3 flex flex-col gap-1'>
        <OverlayActionRow
          icon={Clapperboard}
          label={t`Start a movie or TV session`}
          description={t`Find a movie or show and load its subtitles`}
          onClick={() => void navigate({ to: '/sessions/new' })}
        />
        <OverlayActionRow
          icon={FileText}
          label={t`Practice with a text`}
          description={t`Paste an article, comment, or post`}
          onClick={() => void navigate({ to: '/sessions/new-text' })}
        />
        <OverlayActionRow
          icon={Puzzle}
          label={t`Watch with the browser extension`}
          description={t`YouTube and streaming sites, with instant subtitle lookups`}
          onClick={() => void navigate({ to: '/user-guide', hash: 'extension' })}
        />
      </div>
      <Link to='/user-guide' hash='sessions' className='mt-3 inline-block text-sm font-medium underline'>
        {t`Read more in the guide`}
      </Link>
    </div>
  )
}
