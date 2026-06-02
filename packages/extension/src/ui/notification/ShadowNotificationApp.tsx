import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Link from '@mui/material/Link'
import type { PaletteMode } from '@mui/material/styles'
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import LogoIcon from '@asbplayer-fork/common/components/LogoIcon'
import { usePortalContainer } from '@asbplayer-fork/common/components/portal-container-context'
import { i18n } from '../lingui'
import { ShadowMuiProvider } from '../shadow/ShadowMuiProvider'
import { ModelStore, useModelStore } from '../shadow/model-store'

// The in-realm replacement for NotificationUi's bridge transport: the model is a
// store snapshot the controller pushes (formerly UpdateStateMessage over the
// FrameBridge) and `close` is a plain callback (formerly bridge.sendMessageFromServer).
export interface NotificationState {
  themeType: PaletteMode
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

export function ShadowNotificationApp({ store, shadowRoot, portalContainer, onClose }: ShadowNotificationAppProps) {
  const state = useModelStore(store)
  return (
    <ShadowMuiProvider
      shadowRoot={shadowRoot}
      portalContainer={portalContainer}
      themeType={state.themeType}
      language={state.language}
    >
      <NotificationContent state={state} onClose={onClose} />
    </ShadowMuiProvider>
  )
}

function NotificationContent({ state, onClose }: { state: NotificationState; onClose: () => void }) {
  // Portal the Dialog into the shadow root (provided by ShadowMuiProvider) so it
  // keeps its emotion styles and stays out of the host page's transformed/CSS
  // context. The Snackbar is fixed-positioned inline (no portal) and resolves
  // against the viewport since the modal host carries no transform.
  const portalContainer = usePortalContainer()
  const title = state.titleLocKey === '' ? '' : localizeDialogKey(state.titleLocKey)
  const message = state.messageLocKey === '' ? '' : localizeDialogKey(state.messageLocKey)

  return (
    <>
      {message && title && (
        <Dialog open={true} container={portalContainer} disableEnforceFocus fullWidth maxWidth='sm' onClose={onClose}>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{message}</DialogContent>
          <DialogActions>
            <Button onClick={onClose}>
              <Trans>OK</Trans>
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {state.newVersion && (
        <Snackbar open={true} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={onClose}>
          <Alert icon={<LogoIcon />} severity='info' onClose={onClose}>
            <Trans>
              Flicktionary updated to version {state.newVersion}. Check out the{' '}
              <Link
                color='primary'
                target='_blank'
                rel='noreferrer'
                href={`https://github.com/TasseDeCafe/flicktionary/releases/tag/v${state.newVersion}`}
              >
                release notes
              </Link>
              .
            </Trans>
          </Alert>
        </Snackbar>
      )}
    </>
  )
}
