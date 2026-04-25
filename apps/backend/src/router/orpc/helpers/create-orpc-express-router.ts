import { type RequestHandler, Router } from 'express'
import { OpenAPIHandler } from '@orpc/openapi/node'
import type { AnyRouter } from '@orpc/server'
import { collectContractPaths, extractStaticPrefixes } from '../orpc-paths'

/**
 * Creates an Express router for an oRPC router, similar to ts-rest's createExpressEndpoints.
 * This allows you to create individual router files and use Express middleware normally.
 *
 * Usage:
 * ```ts
 * export const MessagesRouterOrpc = (dependencies) => {
 *   const router = createOrpcExpressRouter(messagesRouterImplementation)
 *   return router
 * }
 * ```
 *
 * Then in app.ts:
 * ```ts
 * app.use(tokenAuthenticationMiddleware)
 * app.use(API_V1, MessagesRouterOrpc(dependencies))  // Works like ts-rest!
 * app.use(subscriptionMiddleware)
 * app.use(API_V1, AudioRouterOrpc(dependencies))
 * ```
 */

type CreateOrpcExpressRouterOptions = {
  contract?: unknown
  basePath?: string
}

const shouldHandleRequest = (path: string, prefixes: string[]): boolean => {
  if (prefixes.length === 0) {
    return true
  }

  return prefixes.some((prefix) => {
    if (prefix === '/') {
      return true
    }

    if (path === prefix) {
      return true
    }

    return path.startsWith(`${prefix}/`)
  })
}

export const createOrpcExpressRouter = (orpcRouter: AnyRouter, options?: CreateOrpcExpressRouterOptions): Router => {
  const expressRouter = Router()
  const handler = new OpenAPIHandler(orpcRouter)

  const contractPrefixes = options?.contract ? extractStaticPrefixes(collectContractPaths(options.contract)) : []

  const middleware: RequestHandler = async (req, res, next) => {
    try {
      if (!shouldHandleRequest(req.path, contractPrefixes)) {
        next()
        return
      }
      // oRPC expects the Express mount path (e.g. '/api/v1'); forward it when present.
      const prefix = req.baseUrl as `/${string}`

      const { matched } = await handler.handle(req, res, {
        prefix,
        context: () => {
          return { req, res }
        },
      })

      if (matched) {
        return
      }

      next()
    } catch (error) {
      console.error('[oRPC Router Error]', error)
      next(error)
    }
  }

  expressRouter.use(middleware)

  return expressRouter
}
