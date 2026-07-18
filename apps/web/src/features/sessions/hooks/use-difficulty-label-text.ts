import { useLingui } from '@lingui/react/macro'
import type { SessionDifficulty } from '../api/sessions-hooks'

// Localized display text for the difficulty label (shared by the compact stat
// and the detail sheet).
export const useDifficultyLabelText = () => {
  const { t } = useLingui()
  return (label: NonNullable<SessionDifficulty['label']>): string => {
    if (label === 'comfortable') return t`comfortable`
    if (label === 'challenging') return t`challenging`
    return t`frustrating`
  }
}
