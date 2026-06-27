import { useEffect, useState } from 'react'
import SettingsSwitchRow from '@asbplayer-fork/common/components/SettingsSwitchRow'
import {
  DevToolsState,
  getDevToolsState,
  onDevToolsStateChange,
  setDevToolsState,
} from '@/services/flicktionary/dev-tools-storage'

// Admin-only debugging tools (popup tab gated by useIsTestUser). Strings are
// deliberately untranslated: this surface is never shown to end users.
export const AdminSettingsTab = () => {
  const [state, setState] = useState<DevToolsState>()

  useEffect(() => {
    let active = true
    void getDevToolsState().then((value) => {
      if (active) setState(value)
    })
    const unsubscribe = onDevToolsStateChange(setState)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!state) {
    return null
  }

  return (
    <div className='flex flex-col gap-2'>
      <SettingsSwitchRow
        label='Notification test buttons'
        checked={state.notificationTestButtonsEnabled}
        onCheckedChange={(checked) => void setDevToolsState({ notificationTestButtonsEnabled: checked })}
      />
      <p className='text-muted-foreground text-xs'>
        Mounts floating buttons on video pages that trigger the notification dialog and the update alert, to check the
        in-page UI quickly. Applies to already-open tabs immediately.
      </p>
    </div>
  )
}
