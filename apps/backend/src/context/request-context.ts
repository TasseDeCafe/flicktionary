import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContext = {
  userId?: string
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export const runWithRequestContext = <T>(callback: () => T, initialContext: RequestContext = {}) => {
  return requestContextStorage.run(initialContext, callback)
}

export const getRequestContext = (): RequestContext | undefined => {
  return requestContextStorage.getStore()
}

export const setRequestContext = (context: Partial<RequestContext>) => {
  const store = requestContextStorage.getStore()
  if (!store) {
    return
  }

  Object.assign(store, context)
}

export const getRequestContextUserId = (): string | undefined => {
  return requestContextStorage.getStore()?.userId
}
