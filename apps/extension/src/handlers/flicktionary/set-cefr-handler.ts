import type { Browser } from 'wxt/browser'
import type { Command, Message, SetFlicktionaryCefrMessage, SetFlicktionaryCefrResponse } from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

// Sets the user's CEFR level for a language on behalf of the content script's
// in-video picker (shown when a save fails with 'MISSING_CEFR'). Wraps the same
// `userPrefs.setCefrForLanguage` endpoint the web app wizards use — the content
// script can't reach the authed oRPC client directly, so it routes through here.
export default class SetFlicktionaryCefrHandler {
  get sender(): string[] {
    return ['asbplayer-video', 'asbplayer-video-tab']
  }

  get command(): string {
    return 'set-flicktionary-cefr'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: SetFlicktionaryCefrResponse) => void
  ) {
    const message = command.message as SetFlicktionaryCefrMessage

    void (async () => {
      try {
        await activateBackgroundLocale()
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          sendResponse({ success: false, error: i18n._(msg`Sign in to Flicktionary to set your level.`) })
          return
        }

        const client = getFlicktionaryApiClient()
        await client.userPrefs.setCefrForLanguage({
          targetLanguage: message.targetLanguage,
          cefrLevel: message.cefrLevel,
        })

        sendResponse({ success: true })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'Failed to set your level')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
