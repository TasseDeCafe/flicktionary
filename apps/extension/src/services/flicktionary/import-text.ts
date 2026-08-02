import { msg } from '@lingui/core/macro'
import {
  IMPORT_TEXT_MAX_LENGTH,
  IMPORT_TEXT_TITLE_MAX_LENGTH,
} from '@flicktionary/api-client/orpc-contracts/study-sessions-contract'
import { i18n } from '@/ui/lingui'
import { activateBackgroundLocale } from '@/services/activate-background-locale'
import { getFlicktionaryApiClient } from './flicktionary-api-client'
import { getFullAccountFlicktionaryAuth } from './auth-storage'
import { getFlicktionaryConfig } from './flicktionary-config'
import { extractFlicktionaryApiError } from './api-error'

// Stable codes the content script returns instead of localized prose, so the
// always-injected content bundle never pulls in the Lingui catalog. The
// background (here) maps them to localized messages.
export type ArticleExtractionErrorCode = 'no-readable-article' | 'extract-failed'

// Result the import content script returns for an extraction request.
export type ArticleExtractionResult =
  { ok: true; title: string; text: string } | { ok: false; errorCode: ArticleExtractionErrorCode }

export type ImportOutcome =
  | { ok: true; sessionId: string }
  // The detected target language has no CEFR level set yet. Only the popup
  // caller (`presentation: 'popup'`) gets this structured variant so it can host
  // an inline picker and replay; the context menu keeps toasting (no popup to
  // host a picker). Mirrors SaveWordOutcome's `missing-cefr` shape.
  | { ok: false; kind: 'missing-cefr'; targetLanguage: string }
  | { ok: false; error: string }

// Where the import was triggered from, which decides how a MISSING_CEFR failure
// is surfaced: the popup can host an inline picker; the context menu can't, so
// it keeps toasting.
export type ImportPresentation = 'popup' | 'contextMenu'

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
  const auth = await getFullAccountFlicktionaryAuth()
  if (!auth) {
    throw new Error(i18n._(msg`Sign in to Flicktionary to import text.`))
  }
  const { data } = await getFlicktionaryApiClient().studySessions.importText({
    // Readability page titles can exceed the contract cap; clamp rather than
    // fail validation over a title.
    title: input.title.slice(0, IMPORT_TEXT_TITLE_MAX_LENGTH),
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
  if (await getFullAccountFlicktionaryAuth()) {
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
  return (firstLine || fallback || i18n._(msg`Imported text`)).slice(0, IMPORT_TEXT_TITLE_MAX_LENGTH)
}

const finishImport = async (
  tabId: number,
  input: ImportTextInput,
  presentation: ImportPresentation,
  isCefrRetry: boolean
): Promise<ImportOutcome> => {
  // Pre-check the contract's text cap so an oversized body gets a message that
  // names the problem and the limit, instead of bouncing off backend input
  // validation as a bare "Input validation failed".
  if (input.text.length > IMPORT_TEXT_MAX_LENGTH) {
    const textLength = i18n.number(input.text.length)
    const maxLength = i18n.number(IMPORT_TEXT_MAX_LENGTH)
    // sourceUrl marks the Readability-article path; without it the text came
    // from a selection.
    const error = input.sourceUrl
      ? i18n._(msg`This article is too long to import (${textLength} characters — the limit is ${maxLength}).`)
      : i18n._(msg`This selection is too long to import (${textLength} characters — the limit is ${maxLength}).`)
    await showToast(tabId, 'error', error)
    return { ok: false, error }
  }
  try {
    const sessionId = await importTextToFlicktionary(input)
    await openFlicktionarySession(sessionId)
    return { ok: true, sessionId }
  } catch (error) {
    const { code, message, targetLanguage } = extractFlicktionaryApiError(
      error,
      i18n._(msg`Failed to import into Flicktionary.`)
    )
    // The language has no CEFR level yet. In the popup we hand the structured
    // signal back so it can show an inline picker and replay (unless this WAS
    // the replay — then fall through to the toast). The context menu has no
    // popup to host a picker, so it always toasts.
    if (code === 'MISSING_CEFR' && targetLanguage && presentation === 'popup' && !isCefrRetry) {
      return { ok: false, kind: 'missing-cefr', targetLanguage }
    }
    // Context-menu MISSING_CEFR can't host a picker — toast copy that points the
    // user at the extension popup, where the inline picker lives.
    // CONTENT_BLOCKED gets a localized message instead of the backend's raw
    // English string (the moderation gate rejected the text).
    const surfaced =
      code === 'MISSING_CEFR'
        ? i18n._(msg`Open the Flicktionary extension popup to set your level for this language, then import again.`)
        : code === 'CONTENT_BLOCKED'
          ? i18n._(msg`This text appears to contain explicit content and can't be imported.`)
          : message
    await showToast(tabId, 'error', surfaced)
    return { ok: false, error: surfaced }
  }
}

// Readability path (popup button + page context menu): ask the tab's content
// script to extract the main article, then import it as an 'article' source.
export const importArticleFromTab = async (
  tab: {
    id?: number
    url?: string
    title?: string
  },
  options: { presentation?: ImportPresentation; isCefrRetry?: boolean } = {}
): Promise<ImportOutcome> => {
  const { presentation = 'contextMenu', isCefrRetry = false } = options
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
  return finishImport(
    tab.id,
    { title: extracted.title, text: extracted.text, sourceUrl: tab.url },
    presentation,
    isCefrRetry
  )
}

// Selection path (selection context menu): the highlighted text is a paste, so
// it imports as a 'text' source (no sourceUrl).
export const importSelectionFromTab = async (
  tab: { id?: number; title?: string },
  selectionText: string,
  options: { presentation?: ImportPresentation; isCefrRetry?: boolean } = {}
): Promise<ImportOutcome> => {
  const { presentation = 'contextMenu', isCefrRetry = false } = options
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
  return finishImport(
    tab.id,
    { title: deriveTitle(text, tab.title ?? i18n._(msg`Selection`)), text },
    presentation,
    isCefrRetry
  )
}
