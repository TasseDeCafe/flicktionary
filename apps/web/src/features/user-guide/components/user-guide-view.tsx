import { Trans } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Button } from '@flicktionary/ui/components/button'

// Stable anchor ids — the in-app checklist/explainer cards deep-link to them
// (e.g. /user-guide#practice). scroll-mt keeps the heading clear of the page
// padding when scrolled to.
const SectionTitle = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <h2 id={id} className='mt-10 scroll-mt-6 text-xl font-semibold'>
    {children}
  </h2>
)

const StepList = ({ children }: { children: React.ReactNode }) => (
  <ol className='list-decimal space-y-2 pl-6'>{children}</ol>
)

// Public user guide. Linked from the extension (FTUE page + popup) — keep the
// /user-guide path stable.
export const UserGuideView = () => {
  return (
    <main className='flex flex-1 justify-center overflow-y-auto p-4'>
      <div className='w-full max-w-3xl pb-16'>
        <h1 className='mt-6 text-3xl font-bold'>
          <Trans>Flicktionary User Guide</Trans>
        </h1>
        <p className='text-muted-foreground mt-2'>
          <Trans>Learn a language from the videos you already watch and the articles you already read.</Trans>
        </p>
        {/* '/' lands on the app for signed-in users and on sign-in otherwise. */}
        <Button asChild className='mt-4'>
          <Link to='/'>
            <Trans>Open Flicktionary</Trans>
          </Link>
        </Button>

        <SectionTitle id='what-is-flicktionary'>
          <Trans>What is Flicktionary?</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <p>
            <Trans>
              Flicktionary has two parts that work together: a <b>browser extension</b> and this <b>web app</b>.
            </Trans>
          </p>
          <p>
            <Trans>
              The extension overlays interactive subtitles on streaming video (YouTube, Netflix, and many other
              platforms). Hover any word for an instant definition, and save the words and phrases you want to learn. It
              can also import articles from any web page.
            </Trans>
          </p>
          <p>
            <Trans>
              Everything you save lands in the web app, where you can review your sessions, browse your vocabulary, and
              practice what you collected.
            </Trans>
          </p>
        </div>

        <SectionTitle id='extension'>
          <Trans>Getting started</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <StepList>
            <li>
              <Trans>Install the Flicktionary extension and pin it to your browser toolbar for easy access.</Trans>
            </li>
            <li>
              <Trans>Create an account (or sign in) here in the web app.</Trans>
            </li>
            <li>
              <Trans>
                Open the extension popup and choose <b>Sign in with Flicktionary</b>. A pairing page opens in the web
                app and connects the extension to your account automatically.
              </Trans>
            </li>
          </StepList>
          <p className='text-muted-foreground'>
            <Trans>
              You can watch videos with subtitles without signing in — but saving words requires a paired account.
            </Trans>
          </p>
        </div>

        <span id='sessions' className='block scroll-mt-6' aria-hidden />
        <SectionTitle id='watching-videos'>
          <Trans>Watching videos</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <p>
            <Trans>
              Open a video on a supported platform. On YouTube, subtitles load automatically in the video's own
              language; on other platforms, a dialog asks which subtitle track to load the first time, and your
              last-used language loads automatically after that. You can also load your own subtitle file by
              drag-and-dropping it onto the video.
            </Trans>
          </p>
          <p>
            <Trans>
              When you pause the video, a <b>controls overlay</b> appears: toggle subtitles, switch playback modes,
              adjust subtitle timing, and change the playback rate. Scroll the rightmost control to switch between
              subtitle navigation, subtitle offset, and playback rate.
            </Trans>
          </p>
        </div>

        <SectionTitle id='saving-words'>
          <Trans>Looking up and saving words</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <ul className='list-disc space-y-2 pl-6'>
            <li>
              <Trans>
                <b>Hover</b> a word in the subtitles to see an instant definition with pronunciation. The video pauses
                while you hover, and resumes when you move away.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Click</b> a word to select it, or <b>press and drag</b> to select a longer phrase.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Right-click</b> the selection to save it — the word or phrase is stored in your account together with
                the sentence it appeared in. Right-click a saved selection to remove it again.
              </Trans>
            </li>
          </ul>
        </div>

        <SectionTitle id='importing-articles'>
          <Trans>Importing articles</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <p>
            <Trans>
              On any non-video page, open the extension popup and choose <b>Import this article</b>. Flicktionary
              extracts the article text and creates a reading session in the web app. To import only part of a page,
              select the text first.
            </Trans>
          </p>
        </div>

        <SectionTitle id='practice'>
          <Trans>Reviewing and practicing</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <ul className='list-disc space-y-2 pl-6'>
            <li>
              <Trans>
                <b>Sessions</b> — every video you watched and article you imported, with the words you saved in each.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Vocabulary</b> — all your saved words and phrases in one place.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Practice</b> — exercises built from your saved words to review and strengthen what you learned.
              </Trans>
            </li>
          </ul>
        </div>

        <SectionTitle id='checkpoint-reviews'>
          <Trans>Collecting reviews while you read</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <p>
            <Trans>
              While you read a session, a button labeled <b>I understood up to here</b> appears (at the end of the text:{' '}
              <b>I understood everything</b>). Pressing it tells Flicktionary you read and understood everything up to
              that point. Words you saved earlier that appeared in that stretch of text and were due for review are
              credited as successful reviews automatically — reading counts as practice, so they won't come up as
              flashcards that day. Words you looked up or saved while reading are simply left out; looking something up
              never counts against you.
            </Trans>
          </p>
          <p>
            <Trans>
              Afterwards you may be offered a second, optional step: <b>words you may already know</b>. These are words
              you saved but never practiced that appeared in what you just read. Confirming marks them as known, so they
              skip the beginner learning steps — each one gets a first check-in about three weeks later to make sure.
              You can always dismiss this, and there's an undo right after confirming; declining costs nothing, the
              words just enter practice the normal way later.
            </Trans>
          </p>
        </div>

        <SectionTitle id='settings'>
          <Trans>Settings and keyboard shortcuts</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <p>
            <Trans>
              The extension popup contains the full settings: subtitle appearance (with live preview), keyboard
              shortcuts, streaming-video behavior, and more. You can keep several settings profiles and switch between
              them from the popup.
            </Trans>
          </p>
          <p>
            <Trans>
              Most playback actions have editable keyboard shortcuts — seeking by subtitle, adjusting subtitle offset,
              toggling subtitles, changing playback rate, and more. Check the Keyboard Shortcuts tab in the settings.
            </Trans>
          </p>
        </div>

        <SectionTitle id='troubleshooting'>
          <Trans>Troubleshooting</Trans>
        </SectionTitle>
        <div className='mt-3 space-y-3 text-sm leading-6'>
          <ul className='list-disc space-y-2 pl-6'>
            <li>
              <Trans>
                <b>No subtitles appear</b> — make sure the platform is supported and the video actually has subtitle
                tracks. You can always load a subtitle file manually by dropping it onto the video.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Saving is disabled</b> — sign in via the extension popup. If a video's language isn't supported yet,
                you'll see a notice and saving stays off for that video.
              </Trans>
            </li>
            <li>
              <Trans>
                <b>Saved words don't show up</b> — they appear here in the web app, not in the extension. Open the app
                and check your latest session.
              </Trans>
            </li>
          </ul>
        </div>
      </div>
    </main>
  )
}
