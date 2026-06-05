import type Binding from '@/services/binding'

const ATTR = 'data-flicktionary-dev-notification-test'

// Admin-only debugging helper (originally Gate B of the Radix/Tailwind
// migration): the notification dialog's real trigger
// (activeTabPermissionRequest) is buried in a legacy audio-recording path, so
// mount two floating buttons that drive NotificationController directly on the
// first live binding. Gated at the call site on the Admin-tab toggle
// (dev-tools-storage), which only test-user accounts can flip — off by
// default in every build.
export function mountNotificationTestButtons(bindings: Binding[]): void {
  unmountNotificationTestButtons()

  const wrapper = document.createElement('div')
  wrapper.setAttribute(ATTR, '')
  wrapper.style.cssText =
    'position:fixed;bottom:12px;left:12px;z-index:2147483647;display:flex;gap:6px;font:12px system-ui'

  const makeButton = (label: string, onClick: () => void) => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText =
      'padding:6px 10px;border-radius:6px;border:1px solid #888;background:#facc15;color:#111;cursor:pointer'
    button.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    })
    wrapper.appendChild(button)
  }

  const firstBinding = (): Binding | undefined => {
    if (bindings.length === 0) {
      console.warn('[flicktionary dev] no video binding yet — is there a bound <video> on this page?')
    }
    return bindings[0]
  }

  makeButton('🔔 dialog', () => {
    firstBinding()?.notificationController.show('activeTabPermissionRequest.title', 'activeTabPermissionRequest.prompt')
  })

  makeButton('🔔 update', () => {
    firstBinding()?.notificationController.updateAlert('9.9.9')
  })

  document.body.appendChild(wrapper)
}

export function unmountNotificationTestButtons(): void {
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.remove())
}
