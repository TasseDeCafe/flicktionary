import Binding from '@/services/binding'
import { PageDelegate, currentPageDelegate } from '@/services/pages'
import VideoSelectController from '@/controllers/video-select-controller'
import { CopyToClipboardMessage, CropAndResizeMessage, ExtensionToVideoCommand, Message } from '@asbplayer-fork/common'
import { FrameInfoBroadcaster, FrameInfoListener } from '@/services/frame-info'
import { cropAndResize } from '@asbplayer-fork/common/src/image-transformer'
import { incrementallyFindShadowRoots, shadowRootHosts } from '@/services/shadow-roots'
import { isFirefoxBuild } from '@/services/build-flags'
import { getDevToolsState, onDevToolsStateChange } from '@/services/flicktionary/dev-tools-storage'
import { isYoutubeHost } from '@/services/flicktionary/youtube-context'
import { installTopFrameActivationResponder, shouldActivateInThisFrame } from '@/services/frame-activation'

import type { ContentScriptContext } from '#imports'
import './video.css'

const excludeGlobs = ['*://killergerbah.github.io/asbplayer*', '*://app.asbplayer.dev/*']

if (import.meta.env.DEV) {
  excludeGlobs.push('*://localhost:3000/*')
}

export default defineContentScript({
  // Set manifest options
  matches: ['<all_urls>'],
  excludeGlobs,
  allFrames: true,
  runAt: 'document_idle',

  main(ctx: ContentScriptContext) {
    // Answer activation queries from child frames. Runs in EVERY top-level
    // document — including non-platforms — so an embedded platform clip (e.g. a
    // YouTube video in a Guardian article) can learn its host page is not a
    // recognized platform and stay inert. See frame-activation.ts.
    installTopFrameActivationResponder()

    const hasValidVideoSource = (videoElement: HTMLVideoElement, page?: PageDelegate) => {
      if (page?.config?.allowVideoElementsWithBlankSrc) {
        return true
      }

      if (videoElement.src) {
        return true
      }

      for (let index = 0, length = videoElement.children.length; index < length; index++) {
        const elm = videoElement.children[index]

        if ('SOURCE' === elm.tagName && (elm as HTMLSourceElement).src) {
          return true
        }
      }

      return false
    }

    const bind = async () => {
      const bindings: Binding[] = []
      const page = await currentPageDelegate()
      let hasPageScript = page?.config.pageScript !== undefined
      let frameInfoListener: FrameInfoListener | undefined
      let frameInfoBroadcaster: FrameInfoBroadcaster | undefined
      const isParentDocument = window.self === window.top

      if (isParentDocument) {
        // Parent document, listen for child iframe info
        frameInfoListener = new FrameInfoListener()
        frameInfoListener.bind()
      } else {
        // Child iframe, broadcast frame info
        frameInfoBroadcaster = new FrameInfoBroadcaster()
      }

      const bindToVideoElements = () => {
        const videoElements = [...document.getElementsByTagName('video')]

        for (const shadowRootHost of shadowRootHosts) {
          if (!shadowRootHost.shadowRoot) {
            continue
          }

          for (const video of shadowRootHost.shadowRoot.querySelectorAll('video')) {
            videoElements.push(video)
          }
        }

        for (let i = 0; i < videoElements.length; ++i) {
          const videoElement = videoElements[i]
          const bindingExists = bindings.filter((b) => b.video.isSameNode(videoElement)).length > 0

          if (!bindingExists && hasValidVideoSource(videoElement, page) && !page?.shouldIgnore(videoElement)) {
            const b = new Binding(videoElement, hasPageScript, frameInfoBroadcaster?.frameId)
            b.bind()
            bindings.push(b)
          }
        }

        for (let i = bindings.length - 1; i >= 0; --i) {
          const b = bindings[i]
          let videoElementExists = false

          for (let j = 0; j < videoElements.length; ++j) {
            const videoElement = videoElements[j]

            if (
              videoElement.isSameNode(b.video) &&
              hasValidVideoSource(videoElement, page) &&
              !page?.shouldIgnore(videoElement)
            ) {
              videoElementExists = true
              break
            }
          }

          if (!videoElementExists) {
            bindings.splice(i, 1)
            b.unbind()
          }
        }

        if (bindings.length === 0) {
          frameInfoBroadcaster?.unbind()
        } else {
          frameInfoBroadcaster?.bind()
        }
      }

      bindToVideoElements()
      const videoInterval = setInterval(bindToVideoElements, 1000)
      const shadowRootInterval = page?.config.searchShadowRootsForVideoElements
        ? setInterval(incrementallyFindShadowRoots, 100)
        : undefined

      const videoSelectController = new VideoSelectController(bindings)
      videoSelectController.bind()

      if (isParentDocument) {
        // Test trigger for the Radix notification surface (the real trigger is
        // buried in the legacy audio-recording path). Driven live by the
        // popup's admin-only dev-tools toggle — off by default, so nothing
        // mounts (or even loads the chunk) for regular users.
        const applyNotificationTestButtons = async (enabled: boolean, mounted: boolean) => {
          if (enabled) {
            const { mountNotificationTestButtons } = await import('@/dev/notification-test-buttons')
            mountNotificationTestButtons(bindings)
          } else if (mounted) {
            const { unmountNotificationTestButtons } = await import('@/dev/notification-test-buttons')
            unmountNotificationTestButtons()
          }
          return enabled
        }

        let testButtonsMounted = false
        void getDevToolsState().then(async (state) => {
          testButtonsMounted = await applyNotificationTestButtons(state.notificationTestButtonsEnabled, false)
        })
        onDevToolsStateChange(async (state) => {
          testButtonsMounted = await applyNotificationTestButtons(
            state.notificationTestButtonsEnabled,
            testButtonsMounted
          )
        })
      }

      const messageListener = (
        request: ExtensionToVideoCommand<Message>,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => {
        if (!isParentDocument) {
          // Inside iframe - only root window is allowed to handle messages here
          return
        }

        if (request.sender !== 'asbplayer-extension-to-video') {
          return
        }

        switch (request.message.command) {
          case 'copy-to-clipboard':
            const copyToClipboardMessage = request.message as CopyToClipboardMessage
            fetch(copyToClipboardMessage.dataUrl)
              .then((response) => response.blob())
              .then((blob) => {
                if (isFirefoxBuild) {
                  if (blob.type.startsWith('text/plain')) {
                    blob
                      .text()
                      .then((text) => navigator.clipboard.writeText(text))
                      .catch(console.info)
                  } else {
                    console.error(`Cannot write blob type ${blob.type} to clipboard on Firefox`)
                  }
                } else {
                  navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]).catch(console.error)
                }
              })
            break
          case 'crop-and-resize':
            const cropAndResizeMessage = request.message as CropAndResizeMessage
            let rect = cropAndResizeMessage.rect

            if (cropAndResizeMessage.frameId !== undefined) {
              const iframe = frameInfoListener?.iframesById?.[cropAndResizeMessage.frameId]

              if (iframe !== undefined) {
                const iframeRect = iframe.getBoundingClientRect()
                rect = {
                  left: rect.left + iframeRect.left,
                  top: rect.top + iframeRect.top,
                  width: rect.width,
                  height: rect.height,
                }
              }
            }

            cropAndResize(
              cropAndResizeMessage.maxWidth,
              cropAndResizeMessage.maxHeight,
              rect,
              cropAndResizeMessage.dataUrl
            ).then((dataUrl) => sendResponse({ dataUrl }))
            return true
          default:
          // ignore
        }
      }

      browser.runtime.onMessage.addListener(messageListener)

      window.addEventListener('beforeunload', (event) => {
        for (let b of bindings) {
          b.unbind()
        }

        bindings.length = 0

        clearInterval(videoInterval)

        if (shadowRootInterval !== undefined) {
          clearInterval(shadowRootInterval)
        }

        videoSelectController.unbind()
        frameInfoListener?.unbind()
        frameInfoBroadcaster?.unbind()
        browser.runtime.onMessage.removeListener(messageListener)
      })
    }

    // Only bind on recognized streaming platforms, decided against the
    // top-level page (not this individual frame) so third-party embeds don't
    // activate. See shouldActivateInThisFrame.
    const start = async () => {
      if (!(await shouldActivateInThisFrame())) {
        return
      }

      // Marker class for YouTube-scoped overlay z-index (see video.css). Keeps
      // the subtitle/notification overlays below YouTube's masthead/search
      // chrome while leaving them at max int on every other site.
      if (isYoutubeHost()) {
        document.documentElement.classList.add('asbplayer-youtube')
      }

      await bind()
    }

    if (document.readyState === 'complete') {
      start().catch(console.error)
    } else {
      document.addEventListener('readystatechange', (event) => {
        if (document.readyState === 'complete') {
          start().catch(console.error)
        }
      })
    }
  },
})
