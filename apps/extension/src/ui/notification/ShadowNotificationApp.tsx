import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import { XIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@flicktionary/ui/components/dialog'
import { Button } from '@flicktionary/ui/components/button'
import { flicktionaryLogoDataUri } from '@asbplayer-fork/common/components/flicktionary-logo'
import type { ThemeType } from '@asbplayer-fork/common/settings'
import { i18n } from '../lingui'
import { ShadowUiProvider } from '../shadow/shadow-ui-provider'
import { ModelStore, useModelStore } from '../shadow/model-store'

// The in-realm replacement for NotificationUi's bridge transport: the model is a
// store snapshot the controller pushes (formerly UpdateStateMessage over the
// FrameBridge) and `close` is a plain callback (formerly bridge.sendMessageFromServer).
export interface NotificationState {
  // Raw setting value — ShadowUiProvider resolves 'system' in this realm.
  themeType: ThemeType
  language: string
  titleLocKey: string
  messageLocKey: string
  newVersion?: string
}

export interface ShadowNotificationAppProps {
  store: ModelStore<NotificationState>
  shadowRoot: ShadowRoot
  portalContainer: HTMLElement
  onClose: () => void
}

// The notification dialog receives a dotted loc-key chosen by the binding layer,
// so the text can't be a static macro at the call site. Map the known keys to
// lazy Lingui messages and resolve them imperatively (these are the only keys
// ever sent — see services/binding.ts). Ported verbatim from NotificationUi.
const dialogMessages: Record<string, MessageDescriptor> = {
  'activeTabPermissionRequest.title': msg`Enable audio recording`,
  'activeTabPermissionRequest.prompt': msg`Click on the Flicktionary action button in the top-right of the browser window to enable audio recording for this tab.`,
  'activeTabPermissionRequest.grantedTitle': msg`Audio recording enabled`,
  'activeTabPermissionRequest.grantedPrompt': msg`Audio recording has been enabled for this tab. You can now begin mining.`,
}

const localizeDialogKey = (locKey: string): string => {
  const descriptor = dialogMessages[locKey]
  return descriptor ? i18n._(descriptor) : locKey
}

export function ShadowNotificationApp({ store, portalContainer, onClose }: ShadowNotificationAppProps) {
  const state = useModelStore(store)
  return (
    <ShadowUiProvider portalContainer={portalContainer} themeType={state.themeType} language={state.language}>
      <NotificationContent state={state} onClose={onClose} />
    </ShadowUiProvider>
  )
}

function NotificationContent({ state, onClose }: { state: NotificationState; onClose: () => void }) {
  const title = state.titleLocKey === '' ? '' : localizeDialogKey(state.titleLocKey)
  const message = state.messageLocKey === '' ? '' : localizeDialogKey(state.messageLocKey)

  return (
    <>
      {message && title && (
        // The dialog content portals into portalContainer (via the
        // PortalContainerContext default in ui/dialog), so it keeps the adopted
        // Tailwind sheet and stays out of the host page's transformed/CSS
        // context. Radix owns backdrop, Escape, outside-click and focus trap.
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              onClose()
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <DialogDescription>{message}</DialogDescription>
            <DialogFooter>
              <Button variant='ghost' onClick={onClose}>
                <Trans>OK</Trans>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {state.newVersion && (
        // Update callout (formerly a MUI Snackbar+Alert): fixed-positioned
        // inline (no portal) and resolves against the viewport since the modal
        // host carries no transform; appRoot re-enables pointer events.
        <div className='fixed bottom-8 left-1/2 z-50 -translate-x-1/2'>
          <div className='bg-background flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg'>
            {/* The mark is a two-colour raster (black wing + yellow beam); the
                white chip keeps the black part legible on dark surfaces. */}
            <img src={flicktionaryLogoDataUri} alt='' className='size-6 shrink-0 rounded-sm bg-white' />
            <span className='text-sm'>
              <Trans>
                Flicktionary updated to version {state.newVersion}. Check out the{' '}
                <a
                  className='text-primary underline underline-offset-2'
                  target='_blank'
                  rel='noreferrer'
                  href={`https://github.com/TasseDeCafe/flicktionary/releases/tag/v${state.newVersion}`}
                >
                  release notes
                </a>
                .
              </Trans>
            </span>
            <button
              type='button'
              onClick={onClose}
              className='text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded-sm p-1 transition-colors'
            >
              <XIcon className='size-4' />
              <span className='sr-only'>
                <Trans>Close</Trans>
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
