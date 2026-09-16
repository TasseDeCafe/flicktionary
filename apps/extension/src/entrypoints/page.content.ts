import { currentPageDelegate } from '@/services/pages'
import type { ContentScriptContext } from '#imports'

const excludeGlobs = ['*://killergerbah.github.io/asbplayer*', '*://app.asbplayer.dev/*']

if (import.meta.env.DEV) {
  excludeGlobs.push('*://localhost:3000/*')
}

export default defineContentScript({
  // Set manifest options
  matches: ['<all_urls>'],
  excludeGlobs,
  allFrames: true,
  runAt: 'document_start',

  main(ctx: ContentScriptContext) {
    // Same scoping as the video content script's activation gate: a platform
    // row can restrict activation to part of its host (`activateAt`), and the
    // page script is useless where no video will be bound.
    currentPageDelegate().then((pageDelegate) => {
      if (pageDelegate?.isActivationPage()) {
        pageDelegate.loadScripts()
      }
    })
  },
})
