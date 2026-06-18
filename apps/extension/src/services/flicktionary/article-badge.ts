// Toolbar badge animation for the article-highlight import round trip: a busy
// `· ·· ···` cycle while find-or-create runs, then a brief `✓` / `!`. Per-tab so
// two tabs importing at once don't clobber each other's badge.
//
// MV3's service worker can be torn down mid-animation; a stranded `…` self-heals
// on the next interaction (the next startBadgeBusy resets it). Firefox's MV2
// background is persistent, so it's smoother there.

const action = browser.action || browser.browserAction

const BUSY_FRAMES = ['·', '··', '···']
const BUSY_COLOR = '#2563eb' // blue-600
const DONE_COLOR = '#16a34a' // green-600
const ERROR_COLOR = '#dc2626' // red-600
const CLEAR_AFTER_MS = 2000
const FRAME_MS = 350

const intervals = new Map<number, ReturnType<typeof setInterval>>()
const clearTimers = new Map<number, ReturnType<typeof setTimeout>>()

const setText = (tabId: number, text: string): void => {
  try {
    void action.setBadgeText({ text, tabId })
  } catch {
    // Action API unavailable (e.g. permission missing) — badge is cosmetic.
  }
}

const setColor = (tabId: number, color: string): void => {
  try {
    void action.setBadgeBackgroundColor({ color, tabId })
  } catch {
    // ignore
  }
}

const stopTimers = (tabId: number): void => {
  const interval = intervals.get(tabId)
  if (interval) {
    clearInterval(interval)
    intervals.delete(tabId)
  }
  const timer = clearTimers.get(tabId)
  if (timer) {
    clearTimeout(timer)
    clearTimers.delete(tabId)
  }
}

export const startBadgeBusy = (tabId: number): void => {
  stopTimers(tabId)
  setColor(tabId, BUSY_COLOR)
  let frame = 0
  setText(tabId, BUSY_FRAMES[0])
  const interval = setInterval(() => {
    frame = (frame + 1) % BUSY_FRAMES.length
    setText(tabId, BUSY_FRAMES[frame])
  }, FRAME_MS)
  intervals.set(tabId, interval)
}

export const finishBadgeBusy = (tabId: number, ok: boolean): void => {
  stopTimers(tabId)
  setColor(tabId, ok ? DONE_COLOR : ERROR_COLOR)
  setText(tabId, ok ? '✓' : '!')
  const timer = setTimeout(() => {
    setText(tabId, '')
    clearTimers.delete(tabId)
  }, CLEAR_AFTER_MS)
  clearTimers.set(tabId, timer)
}
