const STORAGE_KEY = 'flicktionary.pendingPairNonce.v1'
const PAIR_NONCE_TTL_MS = 2 * 60 * 1000

export interface PendingFlicktionaryPairNonce {
  nonce: string
  createdAt: number
}

const isPendingNonce = (value: unknown): value is PendingFlicktionaryPairNonce => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.nonce === 'string' && typeof v.createdAt === 'number'
}

export const setPendingFlicktionaryPairNonce = async (nonce: string): Promise<void> => {
  await browser.storage.local.set({
    [STORAGE_KEY]: {
      nonce,
      createdAt: Date.now(),
    },
  })
}

export const getPendingFlicktionaryPairNonce = async (): Promise<PendingFlicktionaryPairNonce | null> => {
  const result = await browser.storage.local.get(STORAGE_KEY)
  const value = (result as Record<string, unknown>)[STORAGE_KEY]

  if (!isPendingNonce(value)) {
    return null
  }

  if (Date.now() - value.createdAt > PAIR_NONCE_TTL_MS) {
    await clearPendingFlicktionaryPairNonce()
    return null
  }

  return value
}

export const clearPendingFlicktionaryPairNonce = async (): Promise<void> => {
  await browser.storage.local.remove(STORAGE_KEY)
}

// The id of the tab a successful pairing was performed in. Recorded so the
// later `flicktionary-pair-finished` message (which fires after the page
// finishes onboarding, possibly seconds later and across an MV3 worker suspend)
// can be validated: the finished handler only ever closes this exact tab.
// Persisted in storage.local — NOT in memory — so it survives a worker suspend
// between the pair ack and the finished signal.
const PAIRED_TAB_KEY = 'flicktionary.pairedTabId.v1'

export const setFlicktionaryPairedTabId = async (tabId: number): Promise<void> => {
  await browser.storage.local.set({ [PAIRED_TAB_KEY]: tabId })
}

export const getFlicktionaryPairedTabId = async (): Promise<number | null> => {
  const result = await browser.storage.local.get(PAIRED_TAB_KEY)
  const value = (result as Record<string, unknown>)[PAIRED_TAB_KEY]
  return typeof value === 'number' ? value : null
}

export const clearFlicktionaryPairedTabId = async (): Promise<void> => {
  await browser.storage.local.remove(PAIRED_TAB_KEY)
}
