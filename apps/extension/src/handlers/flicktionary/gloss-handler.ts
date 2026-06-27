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
        // Prefer the VIDEO'S detected subtitle language (sent by the overlay
        // from the session cache) over the user's primary target language —
        // a Russian-subtitle video must gloss Russian even for a user whose
        // primary language is Spanish. The primary-language fallback covers
        // the window before the overlay learns the detected language.
        const targetLanguage = message.targetLanguage ?? (await getFlicktionaryTargetLanguage())
        if (!targetLanguage) {
          // The subtitle language is detected server-side once a session is
          // registered; reaching here means no session exists yet AND the user
          // has no studied language to fall back on — i.e. onboarding isn't
          // done. Don't tell them to "set a target language" (the target IS the
          // subtitle language); point them at finishing setup.
          sendResponse({ error: i18n._(msg`Finish setting up Flicktionary to translate.`) })
          return
        }

        const client = getFlicktionaryApiClient()
        const { data } = await client.glosses.fastGloss({
          selectionText: message.selectionText,
          contextLine: message.contextLine,
          targetLanguage,
        })
        sendResponse({
          gloss: data.gloss,
          pos: data.pos,
          register: data.register,
          ipaDisplay: data.ipaDisplay,
          ipaLemma: data.ipaLemma,
        })
      } catch (error) {
        sendResponse({
          error: error instanceof Error ? error.message : 'Could not fetch a translation.',
        })
      }
    })()

    return true
  }
}
