import {
  EnsureArticleSessionMessage,
  EnsureArticleSessionResponse,
  SaveArticleHighlightMessage,
  SaveArticleHighlightResponse,
  SaveWordStudyIntent,
} from '@asbplayer-fork/common'
import { v4 as uuidv4 } from 'uuid'

// Content-script ↔ background messaging for the on-page article-highlight flow.
// Pure async over browser.runtime.sendMessage — never touches the DOM. The
// gloss / saved-gloss / delete / note round-trips reuse the existing
// flicktionary-client helpers verbatim (they send 'asbplayer-video-tab', which
// the existing handlers accept); only these two find-or-create + save calls need
// the dedicated 'flicktionary-extension-highlight' sender + new handlers.

const SENDER = 'flicktionary-extension-highlight'

export const ensureArticleSession = async (params: {
  title: string
  text: string
  sourceUrl: string
}): Promise<EnsureArticleSessionResponse> => {
  const message: { sender: typeof SENDER; message: EnsureArticleSessionMessage } = {
    sender: SENDER,
    message: {
      command: 'ensure-article-session',
      messageId: uuidv4(),
      title: params.title,
      text: params.text,
      sourceUrl: params.sourceUrl,
    },
  }
  const response: EnsureArticleSessionResponse | undefined = await browser.runtime.sendMessage(message)
  return response ?? { success: false, signedIn: true, error: 'No response from background' }
}

export const saveArticleHighlight = async (params: {
  sessionId: string
  segmentId: string
  startOffset: number
  endOffset: number
  selectionText: string
  studyIntent?: SaveWordStudyIntent
}): Promise<SaveArticleHighlightResponse> => {
  const message: { sender: typeof SENDER; message: SaveArticleHighlightMessage } = {
    sender: SENDER,
    message: {
      command: 'save-article-highlight',
      messageId: uuidv4(),
      sessionId: params.sessionId,
      segmentId: params.segmentId,
      startOffset: params.startOffset,
      endOffset: params.endOffset,
      selectionText: params.selectionText,
      studyIntent: params.studyIntent,
    },
  }
  const response: SaveArticleHighlightResponse | undefined = await browser.runtime.sendMessage(message)
  return response ?? { success: false, error: 'No response from background' }
}
