// Subtitle-style timestamp for a segment's start time: "mm:ss", growing to
// "hh:mm:ss" past the hour. Empty string for untimed (text) tracks.
export const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hh = Math.floor(totalSeconds / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}
