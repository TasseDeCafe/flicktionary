import { type AnyMiddleware, ORPCError } from '@orpc/server'
import { logWithSentry } from '../../../transport/third-party/sentry/error-monitoring'

// Wired into every oRPC implementer via `.use(errorBoundaryMiddleware)`. Catches any
// thrown error that isn't an explicit oRPC error (which carries an HTTP status the
// handler chose deliberately), logs it to Sentry with the request's userId already
// bound via AsyncLocalStorage, and rethrows as a generic INTERNAL_SERVER_ERROR.
//
// Handlers no longer need their own try/catch for translating unknown failures.
// They still throw `errors.NOT_FOUND(...)` etc. explicitly for entity-not-found
// and validation cases — those are ORPCError instances and pass straight through.
export const errorBoundaryMiddleware: AnyMiddleware = async ({ next, errors, path }) => {
  try {
    return await next()
  } catch (e) {
    if (e instanceof ORPCError) throw e
    logWithSentry({
      message: 'unhandled handler error',
      params: { path: path.join('.') },
      error: e,
    })
    throw errors.INTERNAL_SERVER_ERROR({
      data: { errors: [{ message: 'Internal server error' }] },
    })
  }
}
