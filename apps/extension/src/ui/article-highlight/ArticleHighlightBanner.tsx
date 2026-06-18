import { Trans } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Switch } from '@flicktionary/ui/components/switch'

// State of the article-highlight session, surfaced as the banner status line.
export type ArticleBannerStatus = { kind: 'importing' } | { kind: 'active' } | { kind: 'error'; message: string }

export interface ArticleHighlightBannerProps {
  status: ArticleBannerStatus
  // False → the user isn't paired; offer a Sign in button (saving is impossible).
  signedIn: boolean
  savedCount: number
  // Turn highlighting off for this page (also the Switch's off transition).
  onToggleOff: () => void
  onSignIn: () => void
}

// Thin fixed top strip overlaying the article (no body reflow — it floats),
// flush against the top edge and full-width like Readwise's bar. Light themed to
// match the page it sits over. One compact row: the on/off Switch, a status line
// driven by the orchestrator's state machine, the saved count, an optional Sign
// in button, and a × to dismiss.
export const ArticleHighlightBanner = ({
  status,
  signedIn,
  savedCount,
  onToggleOff,
  onSignIn,
}: ArticleHighlightBannerProps) => (
  <div className='pointer-events-none fixed top-0 right-0 left-0 flex justify-center'>
    <div className='bg-background text-foreground pointer-events-auto flex w-full items-center gap-2 border-b px-3 py-1 shadow-sm'>
      <Switch
        checked
        onCheckedChange={(next) => {
          if (!next) onToggleOff()
        }}
        aria-label='Highlight on this page'
      />
      <span className='text-sm font-medium'>
        <Trans>Highlight on this page</Trans>
      </span>
      <span className='text-muted-foreground truncate text-xs'>
        {'· '}
        {status.kind === 'importing' ? (
          <Trans>Preparing…</Trans>
        ) : status.kind === 'error' ? (
          <span className='text-destructive'>{status.message}</span>
        ) : (
          <Trans>{savedCount} saved</Trans>
        )}
      </span>

      <div className='flex-1' />

      {!signedIn && (
        <Button type='button' size='sm' className='h-6' onClick={onSignIn}>
          <Trans>Sign in</Trans>
        </Button>
      )}

      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-6 w-6 shrink-0 p-0'
        onClick={onToggleOff}
        aria-label='Turn off highlighting'
      >
        <X className='h-4 w-4' />
      </Button>
    </div>
  </div>
)
