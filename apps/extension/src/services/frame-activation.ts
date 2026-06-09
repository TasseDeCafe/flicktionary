import { v4 as uuidv4 } from 'uuid'
import { currentPageDelegate } from './pages'

// Whether the video content script should activate (bind to videos, show the
// overlay, enable track selection) in the current frame.
//
// asbplayer's upstream design binds to *any* <video> on *any* page, in every
// frame. Flicktionary instead scopes activation to recognized streaming
// platforms (see pages.json), matching how the popup and context menus already
// gate on `isVideoPlatformUrl`. The decision is made against the TOP-LEVEL page,
// not the individual frame, so that:
//   - an unrecognized site (e.g. smotri) never activates, and
//   - a platform clip embedded in a third-party page (e.g. a YouTube video in a
//     Guardian article) stays inert, while
//   - a platform that renders its player in a same-site iframe still works
//     (its top frame is the platform, so child frames activate).
//
// A child frame can't read its top-level host cross-origin, so the top frame
// answers a postMessage query. `installTopFrameActivationResponder` runs in
// every top document — including non-platforms — purely to answer those
// queries; `shouldActivateInThisFrame` is what each frame calls to decide.

const SENDER = 'asbplayer-frame-activation'

interface QueryMessage {
  sender: typeof SENDER
  type: 'query'
  nonce: string
}

interface ResponseMessage {
  sender: typeof SENDER
  type: 'response'
  nonce: string
  isPlatform: boolean
}

// Poll the top frame until it answers (its content script may not have run yet)
// or we give up. A platform that hosts its player in a same-site iframe loads
// both frames together, so this resolves quickly in practice; the timeout only
// bites on embeds whose top frame has no content script (sandboxed, or our
// excludeGlobs), where defaulting to "do not activate" is the desired outcome.
const QUERY_INTERVAL_MS = 500
const QUERY_MAX_ATTEMPTS = 20

export function installTopFrameActivationResponder() {
  if (window.self !== window.top) {
    return
  }

  let cachedIsPlatform: boolean | undefined
  const isPlatform = async () => {
    if (cachedIsPlatform === undefined) {
      cachedIsPlatform = (await currentPageDelegate()) !== undefined
    }
    return cachedIsPlatform
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as QueryMessage | undefined
    if (data?.sender !== SENDER || data.type !== 'query') {
      return
    }

    const source = event.source as Window | null
    if (source === null) {
      return
    }

    void isPlatform().then((platform) => {
      const response: ResponseMessage = {
        sender: SENDER,
        type: 'response',
        nonce: data.nonce,
        isPlatform: platform,
      }
      source.postMessage(response, '*')
    })
  })
}

export async function shouldActivateInThisFrame(): Promise<boolean> {
  if (window.self === window.top) {
    return (await currentPageDelegate()) !== undefined
  }

  return queryTopFrame()
}

function queryTopFrame(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const nonce = uuidv4()
    let settled = false
    let attempts = 0

    const finish = (result: boolean) => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
      resolve(result)
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as ResponseMessage | undefined
      if (data?.sender !== SENDER || data.type !== 'response' || data.nonce !== nonce) {
        return
      }
      finish(Boolean(data.isPlatform))
    }

    const ask = () => {
      attempts += 1
      window.top?.postMessage({ sender: SENDER, type: 'query', nonce } satisfies QueryMessage, '*')
      if (attempts >= QUERY_MAX_ATTEMPTS) {
        finish(false)
      }
    }

    window.addEventListener('message', onMessage)
    const timer = setInterval(ask, QUERY_INTERVAL_MS)
    ask()
  })
}
