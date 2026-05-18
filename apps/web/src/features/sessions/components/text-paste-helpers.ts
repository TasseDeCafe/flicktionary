export const TEXT_PASTE_MIN_LENGTH = 50
export const TEXT_PASTE_MAX_LENGTH = 20_000
export const TEXT_PASTE_TITLE_MAX_LENGTH = 200

export const suggestTitleFromText = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 60) return compact
  const truncated = compact.slice(0, 60)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}
