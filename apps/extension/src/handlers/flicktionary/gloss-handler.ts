import type { Browser } from 'wxt/browser'
import type { Command, Message, FlicktionaryGlossMessage, FlicktionaryGlossResponse } from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { getFlicktionaryTargetLanguage } from '../../services/flicktionary/flicktionary-target-language'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

// Fetches a fast gloss for a hovered subtitle selection via Flicktionary's
// stateless `glosses.fastGloss` endpoint. Replaces the old self-hosted
// Anthropic call that required the user to paste an API key.
export default class FlicktionaryGlossHandler {
  get sender() {
    return ['asbplayer-video-tab', 'asbplayerv2']
  }

  get command() {
    return 'flicktionary-gloss'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (r?: FlicktionaryGlossResponse) => void
  ) {
    const message = command.message as FlicktionaryGlossMessage

    void (async () => {
      try {
        await activateBackgroundLocale()
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          sendResponse({ error: i18n._(msg`Sign in to Flicktionary to translate.`) })
          return
        }
        const targetLanguage = await getFlicktionaryTargetLanguage()
        if (!targetLanguage) {
          sendResponse({ error: 'Set your target language on flicktionary.app.' })
          return
        }

        const client = getFlicktionaryApiClient()
        const { data } = await client.glosses.fastGloss({
          selectionText: message.selectionText,
          contextLine: message.contextLine,
          targetLanguage,
        })
        sendResponse({ gloss: data.gloss, pos: data.pos, register: data.register, ipaDisplay: data.ipaDisplay })
      } catch (error) {
        sendResponse({
          error: error instanceof Error ? error.message : 'Could not fetch a translation.',
        })
      }
    })()

    return true
  }
}
