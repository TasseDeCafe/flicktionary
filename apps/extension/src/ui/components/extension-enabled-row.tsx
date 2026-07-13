import { useEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { Switch } from '@flicktionary/ui/components/switch'
import {
  ExtensionEnabledState,
  getExtensionEnabledState,
  onExtensionEnabledChange,
  setExtensionEnabled,
} from '@/services/flicktionary/extension-enabled-storage'

// The global master switch, shown at the top of both popup variants. Backed by
// the profile-independent extension-enabled storage (NOT a setting), so it
// survives profile switches and settings import/export. Changes fan out live
// to every open video tab via the storage subscription.
export const ExtensionEnabledRow = () => {
  const [state, setState] = useState<ExtensionEnabledState>()

  useEffect(() => {
    let active = true
    void getExtensionEnabledState().then((value) => {
      if (active) setState(value)
    })
    const unsubscribe = onExtensionEnabledChange(setState)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!state) {
    return null
  }

  return (
    <div className='flex flex-col gap-1 rounded-md border px-3 py-2'>
      <label className='flex cursor-pointer items-center justify-between gap-4'>
        <span className='text-sm font-medium'>
          <Trans>Flicktionary enabled</Trans>
        </span>
        <Switch checked={state.enabled} onCheckedChange={(checked) => void setExtensionEnabled(checked)} />
      </label>
      {!state.enabled && (
        <p className='text-muted-foreground text-xs'>
          <Trans>On-video features are paused and native subtitles work normally. Article import still works.</Trans>
        </p>
      )}
    </div>
  )
}
