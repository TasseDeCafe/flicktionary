import { OffscreenDomCache } from '@asbplayer-fork/common'

// Tags the single React content host placed inside a subtitle container by
// `mountPersistentHost`. Used to keep the host out of the dom-cache recycling
// loop (`_setChildren`) so its live React root is never detached.
export const PERSISTENT_HOST_ATTR = 'data-asbplayer-react-host'

export enum OffsetAnchor {
  bottom,
  top,
}

export interface KeyedHtml {
  key?: string
  html: () => string
}

export interface ElementOverlayParams {
  targetElement: HTMLElement
  nonFullscreenContainerClassName: string
  nonFullscreenContentClassName: string
  fullscreenContainerClassName: string
  fullscreenContentClassName: string
  offsetAnchor: OffsetAnchor
  contentPositionOffset?: number
  contentWidthPercentage: number
  onMouseOver: (event: MouseEvent) => void
  onMouseOut: (event: MouseEvent) => void
}

export interface ElementOverlay {
  setHtml(htmls: KeyedHtml[]): void
  appendHtml(html: string): void
  refresh(): void
  hide(): void
  dispose(): void
  nonFullscreenContainerClassName: string
  nonFullscreenContentClassName: string
  fullscreenContainerClassName: string
  fullscreenContentClassName: string
  offsetAnchor: OffsetAnchor
  contentPositionOffset: number
  contentWidthPercentage: number
  displayingElements: () => Iterable<HTMLElement>
  containerElement: HTMLElement | undefined
}

export class CachingElementOverlay implements ElementOverlay {
  private readonly targetElement: HTMLElement

  private readonly domCache: OffscreenDomCache = new OffscreenDomCache()

  private fullscreenContainerElement?: HTMLElement
  private defaultContentElement?: HTMLElement
  // The React content host (Option A). While set, this overlay is in "React
  // mode": setHtml/appendHtml become guarded no-ops, hide() no longer disposes,
  // and _setChildren never recycles the host. Cleared by disposePersistentHost.
  private persistentHostElement?: HTMLElement
  private nonFullscreenContainerElement?: HTMLElement
  private nonFullscreenElementFullscreenChangeListener?: (this: any, event: Event) => any
  private nonFullscreenStylesInterval?: NodeJS.Timeout
  private nonFullscreenElementFullscreenPollingInterval?: NodeJS.Timeout
  private fullscreenElementFullscreenChangeListener?: (this: any, event: Event) => any
  private fullscreenElementFullscreenPollingInterval?: NodeJS.Timeout
  private fullscreenStylesInterval?: NodeJS.Timeout
  private onMouseOver: (event: MouseEvent) => void
  private onMouseOut: (event: MouseEvent) => void

  nonFullscreenContainerClassName: string
  nonFullscreenContentClassName: string
  fullscreenContainerClassName: string
  fullscreenContentClassName: string
  offsetAnchor: OffsetAnchor = OffsetAnchor.bottom
  contentPositionOffset: number
  contentWidthPercentage: number

  constructor({
    targetElement,
    nonFullscreenContainerClassName,
    nonFullscreenContentClassName,
    fullscreenContainerClassName,
    fullscreenContentClassName,
    offsetAnchor,
    contentPositionOffset,
    contentWidthPercentage,
    onMouseOver,
    onMouseOut,
  }: ElementOverlayParams) {
    this.targetElement = targetElement
    this.nonFullscreenContainerClassName = nonFullscreenContainerClassName
    this.nonFullscreenContentClassName = nonFullscreenContentClassName
    this.fullscreenContainerClassName = fullscreenContainerClassName
    this.fullscreenContentClassName = fullscreenContentClassName
    this.offsetAnchor = offsetAnchor
    this.contentPositionOffset = contentPositionOffset ?? 75
    this.contentWidthPercentage = contentWidthPercentage
    this.onMouseOver = onMouseOver
    this.onMouseOut = onMouseOut
  }

  *displayingElements() {
    function* grandChildren(container: HTMLElement) {
      for (const content of container.childNodes) {
        for (const el of content.childNodes) {
          if (el instanceof HTMLElement) {
            yield el as HTMLElement
          }
        }
      }
    }

    const container = this.containerElement

    if (container !== undefined) {
      for (const el of grandChildren(container)) {
        yield el
      }
    }
  }

  get containerElement() {
    if (document.fullscreenElement && this.fullscreenContainerElement !== undefined) {
      return this.fullscreenContainerElement
    } else if (!document.fullscreenElement && this.nonFullscreenContainerElement !== undefined) {
      return this.nonFullscreenContainerElement
    }

    return undefined
  }

  uncacheHtml() {
    this.domCache.clear()
  }

  uncacheHtmlKey(key: string) {
    this.domCache.delete(key)
  }

  cacheHtml(key: string, html: string) {
    this.domCache.add(key, html)
  }

  setHtml(htmls: KeyedHtml[]) {
    // React mode owns this overlay's content. A stray legacy render
    // (showLoadedMessage / offset / notification path) must not clobber the
    // host or inject sibling nodes next to it — so swallow it here.
    if (this.persistentHostElement) {
      return
    }

    if (document.fullscreenElement) {
      this._displayFullscreenContentElementsWithHtml(htmls)
    } else {
      this._displayNonFullscreenContentElementsWithHtml(htmls)
    }
  }

  private _displayNonFullscreenContentElementsWithHtml(htmls: KeyedHtml[]) {
    this._displayNonFullscreenContentElements(htmls.map((html) => this._cachedContentElement(html.html, html.key)))
  }

  private _displayNonFullscreenContentElements(contentElements: HTMLElement[]) {
    for (const contentElement of contentElements) {
      contentElement.className = this.nonFullscreenContentClassName
    }

    this._setChildren(this._nonFullscreenContainerElement(), contentElements)
  }

  private _displayFullscreenContentElementsWithHtml(htmls: KeyedHtml[]) {
    this._displayFullscreenContentElements(htmls.map((html) => this._cachedContentElement(html.html, html.key)))
  }

  private _displayFullscreenContentElements(contentElements: HTMLElement[]) {
    for (const contentElement of contentElements) {
      contentElement.className = this.fullscreenContentClassName
    }

    this._setChildren(this._fullscreenContainerElement(), contentElements)
  }

  private _nonFullscreenContainerElement() {
    if (this.nonFullscreenContainerElement) {
      return this.nonFullscreenContainerElement
    }

    const container = document.createElement('div')
    container.className = this.nonFullscreenContainerClassName
    container.onmouseover = this.onMouseOver
    container.onmouseout = this.onMouseOut
    this._applyContainerStyles(container)
    document.body.appendChild(container)

    const toggle = () => {
      // Hide while the target video has no layout box (off-screen/paused in a
      // virtualized feed, display:none, or detached pending cleanup). Otherwise
      // the container below would be pinned to the page's top-left and show up
      // as a stray duplicate overlay.
      if (document.fullscreenElement || this._targetRectEmpty()) {
        container.style.setProperty('display', 'none', 'important')
      } else {
        // Position before showing so it never flashes at the top-left when a
        // video scrolls back into view.
        this._applyContainerStyles(container)
        container.style.display = ''

        if (this.fullscreenContainerElement) {
          this._transferChildren(this.fullscreenContainerElement, container)
        }
      }
    }

    toggle()
    this.nonFullscreenElementFullscreenChangeListener = () => toggle()
    this.nonFullscreenStylesInterval = setInterval(() => this._applyContainerStyles(container), 1000)
    this.nonFullscreenElementFullscreenPollingInterval = setInterval(() => toggle(), 1000)
    document.addEventListener('fullscreenchange', this.nonFullscreenElementFullscreenChangeListener)
    this.nonFullscreenContainerElement = container
    return container
  }

  private _fullscreenContainerElement() {
    if (this.fullscreenContainerElement) {
      return this.fullscreenContainerElement
    }

    const container = document.createElement('div')
    container.className = this.fullscreenContainerClassName
    container.onmouseover = this.onMouseOver
    container.onmouseout = this.onMouseOut
    this._applyContainerStyles(container)
    this._findFullscreenParentElement(container).appendChild(container)
    container.style.setProperty('display', 'none', 'important')

    const toggle = () => {
      if (document.fullscreenElement) {
        if (container.style.display === 'none') {
          container.style.display = ''
          container.remove()
          this._findFullscreenParentElement(container).appendChild(container)
        }

        if (this.nonFullscreenContainerElement) {
          this._transferChildren(this.nonFullscreenContainerElement, container)
        }
      } else if (!document.fullscreenElement) {
        container.style.setProperty('display', 'none', 'important')
      }
    }

    toggle()
    this.fullscreenElementFullscreenChangeListener = () => toggle()
    this.fullscreenStylesInterval = setInterval(() => this._applyContainerStyles(container), 1000)
    this.fullscreenElementFullscreenPollingInterval = setInterval(() => toggle(), 1000)
    document.addEventListener('fullscreenchange', this.fullscreenElementFullscreenChangeListener)
    this.fullscreenContainerElement = container
    return this.fullscreenContainerElement
  }

  private _findFullscreenParentElement(container: HTMLElement): HTMLElement {
    const testNode = container.cloneNode(true) as HTMLElement
    testNode.innerHTML = '&nbsp;' // The node needs to take up some space to perform test clicks
    let current = this.targetElement.parentElement

    if (!current) {
      return document.body
    }

    let chosen: HTMLElement | undefined = undefined

    do {
      const rect = current.getBoundingClientRect()

      if (
        rect.height > 0 &&
        (typeof chosen === 'undefined' ||
          // Typescript is not smart enough to know that it's possible for 'chosen' to be defined here
          rect.height >= (chosen as HTMLElement).getBoundingClientRect().height) &&
        this._clickable(current, testNode)
      ) {
        chosen = current
        break
      }

      current = current.parentElement
    } while (current && !current.isSameNode(document.body.parentElement))

    if (chosen) {
      return chosen
    }

    return document.body
  }

  private _transferChildren(source: HTMLElement, destination: HTMLElement) {
    if (!source) {
      return
    }

    while (source.firstChild) {
      destination.appendChild(source.firstChild)
    }
  }

  private _setChildren(containerElement: HTMLElement, contentElements: HTMLElement[]) {
    while (containerElement.firstChild) {
      const last = containerElement.lastChild! as HTMLElement
      // Defense in depth: should be unreachable while a host is mounted
      // (setHtml is a guarded no-op), but never recycle the React host into the
      // offscreen dom-cache — that detaches the live root. Bail instead.
      if (this._isPersistentHost(last)) {
        return
      }
      this.domCache.return(last)
    }

    for (const contentElement of contentElements) {
      containerElement.appendChild(contentElement)
    }
  }

  private _isPersistentHost(node: Node | null): node is HTMLElement {
    return (
      node instanceof HTMLElement && (node === this.persistentHostElement || node.hasAttribute(PERSISTENT_HOST_ATTR))
    )
  }

  private _cachedContentElement(html: () => string, key: string | undefined) {
    if (key === undefined) {
      if (!this.defaultContentElement) {
        this.defaultContentElement = document.createElement('div')
      }

      this.defaultContentElement.innerHTML = html()
      return this.defaultContentElement
    }

    return this.domCache.get(key, html)
  }

  appendHtml(html: string) {
    // See setHtml: no sibling injection while the React host owns this overlay.
    if (this.persistentHostElement) {
      return
    }

    if (document.fullscreenElement) {
      this._appendHtml(`${html}\n`, this.fullscreenContentClassName, this._fullscreenContainerElement())
    } else {
      this._appendHtml(`${html}\n`, this.nonFullscreenContentClassName, this._nonFullscreenContainerElement())
    }
  }

  private _appendHtml(html: string, className: string, container: HTMLElement) {
    const breakLine = document.createElement('br')
    const content = document.createElement('div')
    content.innerHTML = html
    content.className = className
    container.appendChild(breakLine)
    container.appendChild(content)
  }

  refresh() {
    if (this.fullscreenContainerElement) {
      this._applyContainerStyles(this.fullscreenContainerElement)
    }

    if (this.nonFullscreenContainerElement) {
      this._applyContainerStyles(this.nonFullscreenContainerElement)
    }
  }

  // Eagerly create BOTH containers (so each registers its `fullscreenchange`
  // listener and the existing `_transferChildren` path is live), then place a
  // single plain <div> host as the only content child of the currently-active
  // container. The host is tagged so `_setChildren` never recycles it; the
  // caller attaches a shadow root and a React root to it. Returns the host.
  //
  // The transfer logic moves the host between containers on every fullscreen
  // toggle WITHOUT any subtitle update — that's the whole reason both
  // containers must exist up front (the lazy creation in setHtml would never
  // run in React mode, stranding the host on fullscreen entry).
  mountPersistentHost(): HTMLElement {
    if (this.persistentHostElement) {
      return this.persistentHostElement
    }

    // Force both containers (and their fullscreenchange listeners) into
    // existence regardless of the current fullscreen state.
    const nonFullscreenContainer = this._nonFullscreenContainerElement()
    const fullscreenContainer = this._fullscreenContainerElement()

    const host = document.createElement('div')
    host.setAttribute(PERSISTENT_HOST_ATTR, '')
    this.persistentHostElement = host

    const activeContainer = document.fullscreenElement ? fullscreenContainer : nonFullscreenContainer
    activeContainer.appendChild(host)

    return host
  }

  // Tear down the React host (called on unbind, before the overlay's own
  // dispose()). Removing the host and clearing the flag restores normal
  // overlay semantics, so the subsequent dispose()/hide() cleans up containers.
  disposePersistentHost() {
    if (!this.persistentHostElement) {
      return
    }

    this.persistentHostElement.remove()
    this.persistentHostElement = undefined
  }

  hide() {
    // React mode: never dispose. Tearing down the containers here would detach
    // the shadow host with no React unmount, leaking the root. Visibility in
    // React mode is driven by a store flag (the app renders nothing); this is
    // just defense in depth if a legacy force-hide path still calls hide().
    if (this.persistentHostElement) {
      this.nonFullscreenContainerElement?.style.setProperty('display', 'none', 'important')
      this.fullscreenContainerElement?.style.setProperty('display', 'none', 'important')
      return
    }

    if (this.nonFullscreenElementFullscreenChangeListener) {
      document.removeEventListener('fullscreenchange', this.nonFullscreenElementFullscreenChangeListener)
    }

    if (this.nonFullscreenStylesInterval) {
      clearInterval(this.nonFullscreenStylesInterval)
    }

    if (this.nonFullscreenElementFullscreenPollingInterval) {
      clearInterval(this.nonFullscreenElementFullscreenPollingInterval)
    }

    if (this.fullscreenElementFullscreenChangeListener) {
      document.removeEventListener('fullscreenchange', this.fullscreenElementFullscreenChangeListener)
    }

    if (this.fullscreenStylesInterval) {
      clearInterval(this.fullscreenStylesInterval)
    }

    if (this.fullscreenElementFullscreenPollingInterval) {
      clearInterval(this.fullscreenElementFullscreenPollingInterval)
    }

    this.defaultContentElement?.remove()
    this.defaultContentElement = undefined
    this.nonFullscreenContainerElement?.remove()
    this.nonFullscreenContainerElement = undefined
    this.fullscreenContainerElement?.remove()
    this.fullscreenContainerElement = undefined
  }

  private _targetRectEmpty() {
    const rect = this.targetElement.getBoundingClientRect()
    return rect.width === 0 && rect.height === 0
  }

  private _applyContainerStyles(container: HTMLElement) {
    const rect = this.targetElement.getBoundingClientRect()

    // When the target video isn't laid out its rect is all zeros; positioning off
    // that would pin the container to the page's top-left. Skip it — toggle()
    // keeps the container hidden until the video has a real box again.
    if (rect.width === 0 && rect.height === 0) {
      return
    }

    container.style.left = rect.left + rect.width / 2 + 'px'

    if (this.contentWidthPercentage === -1) {
      container.style.maxWidth = rect.width + 'px'
      container.style.width = ''
    } else {
      container.style.maxWidth = ''
      container.style.width = Math.min(window.innerWidth, (rect.width * this.contentWidthPercentage) / 100) + 'px'
    }

    const clampedY = Math.max(rect.top + window.scrollY, 0)

    if (this.offsetAnchor === OffsetAnchor.bottom) {
      const clampedHeight = Math.min(clampedY + rect.height, window.innerHeight + window.scrollY)
      container.style.top = clampedHeight - this.contentPositionOffset + 'px'
      container.style.bottom = ''
    } else {
      container.style.top = clampedY + this.contentPositionOffset + 'px'
      container.style.bottom = ''
    }
  }

  private _clickable(container: HTMLElement, element: HTMLElement): boolean {
    container.appendChild(element)
    const rect = element.getBoundingClientRect()
    const clickedElement = document.elementFromPoint(rect.x, rect.y)
    const clickable = element.isSameNode(clickedElement) || element.contains(clickedElement)
    element.remove()
    return clickable
  }

  dispose() {
    this.hide()
    this.domCache.clear()
  }
}
