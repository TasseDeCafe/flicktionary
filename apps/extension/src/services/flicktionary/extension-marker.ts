type MarkerObserver = Pick<MutationObserver, 'observe' | 'disconnect'>
type MarkerObserverFactory = (callback: MutationCallback) => MarkerObserver

const defaultObserverFactory: MarkerObserverFactory = (callback) => new MutationObserver(callback)

// document_start normally sees <html>, but some browser/document combinations
// briefly expose a Document without documentElement. Observe the Document in
// that case so the marker is stamped as soon as the root appears.
export const installExtensionMarker = (
  markerDocument: Document,
  version: string,
  createObserver: MarkerObserverFactory = defaultObserverFactory
): void => {
  const stamp = (): boolean => {
    const root = markerDocument.documentElement
    if (!root) return false
    root.setAttribute('data-flicktionary-extension', version)
    return true
  }

  if (stamp()) return

  const observer = createObserver(() => {
    if (!stamp()) return
    observer.disconnect()
  })
  observer.observe(markerDocument, { childList: true })
}
