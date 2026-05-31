import { useSyncExternalStore } from 'react'

// A tiny per-controller external store: the replacement for the model half of
// the FrameBridge (controller -> UI). The controller pushes model snapshots in;
// the React app reads them through `useModelStore`. Commands (the other half of
// the bridge) become plain callback props that call the controller directly.
//
// NEVER a module singleton — each controller instance owns its own store so
// multiple videos / dialogs on a page stay independent (mirrors SubtitleStore).
export interface ModelStore<T> {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => T
  // Replace the whole snapshot. The reference changes only when the value
  // actually differs (by `Object.is`), so idle pushes don't re-render.
  set: (next: T) => void
}

export function createModelStore<T>(initial: T): ModelStore<T> {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    set: (next: T) => {
      if (Object.is(state, next)) {
        return
      }
      state = next
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

export function useModelStore<T>(store: ModelStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

// A delta channel: the in-realm replacement for the FrameBridge surfaces whose
// controllers push PARTIAL model updates (updateState semantics). The component
// applies each delivered partial exactly as it applied bridge updateState
// messages. Late subscribers (React subscribes after the controller's first
// push) get the accumulated state replayed once, so no early update is lost.
export interface UpdateChannel<T> {
  subscribe: (listener: (partial: Partial<T>) => void) => () => void
  // Matches FrameBridgeClient.updateState so the controller can treat the iframe
  // client and this channel interchangeably.
  updateState: (partial: Partial<T>) => void
}

export function createUpdateChannel<T>(): UpdateChannel<T> {
  const listeners = new Set<(partial: Partial<T>) => void>()
  let merged: Partial<T> = {}

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      if (Object.keys(merged).length > 0) {
        listener(merged)
      }
      return () => {
        listeners.delete(listener)
      }
    },
    updateState: (partial) => {
      merged = { ...merged, ...partial }
      for (const listener of listeners) {
        listener(partial)
      }
    },
  }
}
