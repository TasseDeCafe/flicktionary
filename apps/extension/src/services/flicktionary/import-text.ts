import { msg } from '@lingui/core/macro'
import { i18n } from '@/ui/lingui'
import { activateBackgroundLocale } from '@/services/activate-background-locale'
import { getFlicktionaryApiClient } from './flicktionary-api-client'
import { getFlicktionaryAuth } from './auth-storage'
import { getFlicktionaryConfig } from './flicktionary-config'
import { extractFlicktionaryApiError } from './api-error'
import type { ArticleExtractionErrorCode, ArticleExtractionResult } from './extract-article'

export type { ArticleExtractionErrorCode, ArticleExtractionResult }

export type ImportOutcome = { ok: true; sessionId: string } | { ok: false; error: string }

const IMPORT_SENDER = 'flicktionary-extension-import'
const EXTRACT_COMMAND = 'flicktionary-extract-article'
const TOAST_COMMAND = 'flicktionary-import-toast'

const extractionErrorMessage = (code: ArticleExtractionErrorCode): string => {
  switch (code) {
    case 'no-readable-article':
      return i18n._(msg`Could not find a readable article on this page.`)
    case 'extract-failed':
      return i18n._(msg`Could not read this page.`)
  }
}

interface ImportTextInput {
  title: string
  text: string
  // Present for a Readability article (back-link + content_source type 'article');
  // omitted for a bare selection (treated as a paste, content_source type 'text').
  sourceUrl?: string
}

// POST the extracted text to the backend, which detects the language, segments
// the body, and creates the source + track + study session in one shot (same
// server-side flow the video ingestion uses). Returns the session id to open.
const importTextToFlicktionary = async (input: ImportTextInput): Promise<string> => {
  const auth = await getFlicktionaryAuth()
  if (!auth) {
    throw new Error(i18n._(msg`Sign in to Flicktionary to import text.`))
  }
  const { data } = await getFlicktionaryApiClient().studySessions.importText({
    title: input.title,
    text: input.text,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  })
  return data.sessionId
}

const openFlicktionarySession = async (sessionId: string): Promise<void> => {
  const url = `${getFlicktionaryConfig().webUrl}/sessions/${sessionId}`
  await browser.tabs.create({ url, active: true })
}

// Best-effort: the content script may be absent (restricted page) — never let a
// failed toast mask the real outcome.
const showToast = async (tabId: number, kind: 'success' | 'error', message: string): Promise<void> => {
  try {
    await browser.tabs.sendMessage(tabId, {
      sender: IMPORT_SENDER,
      message: { command: TOAST_COMMAND, payload: { kind, message } },
    })
  } catch {
    // no content script in this tab; nothing to surface the toast on.
  }
}

// Both import paths require a paired account. Checked up front — before any
// content-script round trip — so a signed-out user always gets a sign-in
// prompt rather than an extraction-layer error (e.g. "reload the page" when
// the content script isn't reachable).
const requireSignIn = async (tabId: number): Promise<ImportOutcome | null> => {
  if (await getFlicktionaryAuth()) {
    return null
  }
  const error = i18n._(msg`Sign in to Flicktionary to import text.`)
  await showToast(tabId, 'error', error)
  return { ok: false, error }
}

const deriveTitle = (raw: string, fallback: string): string => {
  const firstLine =
    raw
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  return (firstLine || fallback || i18n._(msg`Imported text`)).slice(0, 200)
}

const finishImport = async (tabId: number, input: ImportTextInput): Promise<ImportOutcome> => {
  try {
    const sessionId = await importTextToFlicktionary(input)
    await openFlicktionarySession(sessionId)
    return { ok: true, sessionId }
  } catch (error) {
    const { message } = extractFlicktionaryApiError(error, i18n._(msg`Failed to import into Flicktionary.`))
    await showToast(tabId, 'error', message)
    return { ok: false, error: message }
  }
}

// Readability path (popup button + page context menu): ask the tab's content
// script to extract the main article, then import it as an 'article' source.
export const importArticleFromTab = async (tab: {
  id?: number
  url?: string
  title?: string
}): Promise<ImportOutcome> => {
  await activateBackgroundLocale()
  if (tab.id === undefined) {
    return { ok: false, error: i18n._(msg`No active tab to import from.`) }
  }
  const signedOut = await requireSignIn(tab.id)
  if (signedOut) {
    return signedOut
  }
  let extracted: ArticleExtractionResult
  try {
    extracted = (await browser.tabs.sendMessage(tab.id, {
      sender: IMPORT_SENDER,
      message: { command: EXTRACT_COMMAND },
    })) as ArticleExtractionResult
  } catch {
    // The content script isn't reachable (e.g. a restricted page, or the tab was
    // loaded before the extension installed/updated).
    return { ok: false, error: i18n._(msg`Reload the page, then try importing again.`) }
  }
  if (!extracted?.ok) {
    const error = extractionErrorMessage(extracted?.errorCode ?? 'extract-failed')
    await showToast(tab.id, 'error', error)
    return { ok: false, error }
  }
  return finishImport(tab.id, { title: extracted.title, text: extracted.text, sourceUrl: tab.url })
}

// Selection path (selection context menu): the highlighted text is a paste, so
// it imports as a 'text' source (no sourceUrl).
export const importSelectionFromTab = async (
  tab: { id?: number; title?: string },
  selectionText: string
): Promise<ImportOutcome> => {
  await activateBackgroundLocale()
  if (tab.id === undefined) {
    return { ok: false, error: i18n._(msg`No active tab.`) }
  }
  const signedOut = await requireSignIn(tab.id)
  if (signedOut) {
    return signedOut
  }
  const text = selectionText.trim()
  if (text.length === 0) {
    await showToast(tab.id, 'error', i18n._(msg`Select some text first.`))
    return { ok: false, error: 'No text selected.' }
  }
  return finishImport(tab.id, { title: deriveTitle(text, tab.title ?? i18n._(msg`Selection`)), text })
}
