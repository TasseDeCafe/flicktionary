import { describe, expect, it, vi } from 'vitest'
import { installExtensionMarker } from './extension-marker'

describe('installExtensionMarker', () => {
  it('stamps the current document root immediately', () => {
    const markerDocument = document.implementation.createHTMLDocument()

    installExtensionMarker(markerDocument, '1.2.3')

    expect(markerDocument.documentElement.getAttribute('data-flicktionary-extension')).toBe('1.2.3')
  })

  it('waits for a document root when document_start runs before it exists', () => {
    let root: HTMLElement | null = null
    const markerDocument = {
      get documentElement() {
        return root
      },
    } as Document
    let observerCallback: MutationCallback | undefined
    const observer = {
      observe: vi.fn(),
      disconnect: vi.fn(),
    }

    installExtensionMarker(markerDocument, '4.5.6', (callback) => {
      observerCallback = callback
      return observer
    })

    expect(observer.observe).toHaveBeenCalledWith(markerDocument, { childList: true })
    root = document.createElement('html')
    observerCallback?.([], observer as unknown as MutationObserver)

    expect(root.getAttribute('data-flicktionary-extension')).toBe('4.5.6')
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })
})
