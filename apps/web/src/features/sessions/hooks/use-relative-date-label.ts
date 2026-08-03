import { useLingui } from '@lingui/react/macro'

// Relative for the freshest items, then a compact date — the lists that use
// this are recency-sorted, so a full timestamp earns no extra ink. Year only
// when it differs from the current one.
export const useRelativeDateLabel = () => {
  const { t, i18n } = useLingui()
  return (iso: string): string => {
    const created = new Date(iso)
    const now = new Date()
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayDiff = Math.round((startOfDay(now) - startOfDay(created)) / 86_400_000)
    if (dayDiff === 0) return t`Today`
    if (dayDiff === 1) return t`Yesterday`
    return i18n.date(created, {
      month: 'short',
      day: 'numeric',
      year: created.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    })
  }
}
