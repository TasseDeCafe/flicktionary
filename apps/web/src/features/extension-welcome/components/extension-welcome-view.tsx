import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { BookOpenCheck, Brain, MousePointerClick, Pin, Puzzle } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useExtensionDetected } from '@/lib/extension/use-extension-detected'
import { CHROME_WEB_STORE_URL, FIREFOX_ADDONS_URL } from '../constants'

// Public welcome page, opened by the extension's onInstalled handler (and set
// as its uninstall URL). Branches on the marker: freshly installed users get
// pin + pair guidance; a browser without the extension gets the install pitch.
// Must work signed-out — the only app link is '/', which lands on the app for
// signed-in users and on sign-in otherwise.
export const ExtensionWelcomeView = () => {
  const detection = useExtensionDetected()

  return (
    <main className='flex flex-1 justify-center overflow-y-auto p-4'>
      <div className='w-full max-w-2xl pb-16'>
        {/* Neutral while the marker poll settles: never flash "not installed"
            at someone whose install just opened this tab. */}
        {detection === 'checking' && (
          <div className='mt-6 space-y-4'>
            <Skeleton className='h-9 w-2/3' />
            <Skeleton className='h-5 w-full' />
            <Skeleton className='h-40 w-full rounded-xl' />
          </div>
        )}

        {detection === 'detected' && <InstalledBranch />}
        {detection === 'not-detected' && <InstallBranch />}

        {detection !== 'checking' && <HowItWorks />}
      </div>
    </main>
  )
}

const InstalledBranch = () => {
  const { t } = useLingui()
  return (
    <>
      <h1 className='mt-6 text-3xl font-bold'>{t`The extension is installed 🎉`}</h1>
      <p className='text-muted-foreground mt-2'>
        {t`One quick thing before you start: pin Flicktionary so it's always one click away.`}
      </p>

      {/* Staged toolbar mockup (not a screenshot): points at the real puzzle
          icon in the user's own toolbar, right above this tab. */}
      <div className='bg-card mt-6 rounded-xl border p-4'>
        <div className='bg-muted flex items-center justify-end gap-3 rounded-full px-4 py-2'>
          <div className='bg-background h-6 flex-1 rounded-full' />
          <Puzzle className='h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400' />
        </div>
        <ol className='mt-4 list-decimal space-y-2 pl-6 text-sm leading-6'>
          <li>
            <Trans>
              Click the <b>puzzle icon</b> at the top right of your browser toolbar.
            </Trans>
          </li>
          <li>
            <Trans>
              Click the <Pin className='inline h-4 w-4 align-text-bottom' aria-hidden /> <b>pin</b> next to
              Flicktionary.
            </Trans>
          </li>
          <li>
            <Trans>
              Open the Flicktionary popup and choose <b>Sign in with Flicktionary</b> to connect your account — that's
              what lets you save terms.
            </Trans>
          </li>
        </ol>
      </div>

      <div className='mt-6 flex flex-wrap items-center gap-4'>
        {/* '/' lands on the app for signed-in users and on sign-in otherwise. */}
        <Button asChild>
          <Link to='/'>{t`Open Flicktionary`}</Link>
        </Button>
        <Link to='/user-guide' hash='extension' className='text-sm font-medium underline'>
          {t`Read the full guide`}
        </Link>
      </div>
    </>
  )
}

const InstallBranch = () => {
  const { t } = useLingui()
  return (
    <>
      <h1 className='mt-6 text-3xl font-bold'>{t`Get the Flicktionary extension`}</h1>
      <p className='text-muted-foreground mt-2'>
        {t`Interactive subtitles on YouTube, Netflix, and other streaming sites: hover any word for an instant definition, save the terms you want to learn, and import articles from any page.`}
      </p>

      <div className='mt-6 flex flex-wrap gap-3'>
        <Button asChild>
          <a href={CHROME_WEB_STORE_URL} target='_blank' rel='noreferrer'>
            {t`Add to Chrome`}
          </a>
        </Button>
        <Button asChild variant='secondary'>
          <a href={FIREFOX_ADDONS_URL} target='_blank' rel='noreferrer'>
            {t`Add to Firefox`}
          </a>
        </Button>
      </div>

      <p className='text-muted-foreground mt-4 text-sm'>
        <Trans>
          No extension needed for the rest of the app —{' '}
          <Link to='/' className='font-medium underline'>
            open Flicktionary
          </Link>{' '}
          to import texts and practice your vocabulary.
        </Trans>
      </p>
    </>
  )
}

const HowItWorks = () => {
  const { t } = useLingui()
  const steps = [
    {
      icon: MousePointerClick,
      title: t`Watch and look up`,
      description: t`Hover a subtitle word for an instant definition; the video pauses while you look.`,
    },
    {
      icon: BookOpenCheck,
      title: t`Save the terms you meet`,
      description: t`Right-click a word or phrase to save it with the sentence it appeared in.`,
    },
    {
      icon: Brain,
      title: t`Practice in the app`,
      description: t`Saved terms become cards scheduled with spaced repetition in the web app.`,
    },
  ]
  return (
    <section className='mt-10'>
      <h2 className='text-xl font-semibold'>{t`How it works`}</h2>
      <div className='mt-3 flex flex-col gap-2'>
        {steps.map((step) => (
          <div key={step.title} className='bg-card flex items-start gap-4 rounded-xl border p-4'>
            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300'>
              <step.icon className='h-5 w-5' />
            </span>
            <div className='min-w-0'>
              <p className='font-medium'>{step.title}</p>
              <p className='text-muted-foreground text-sm'>{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
