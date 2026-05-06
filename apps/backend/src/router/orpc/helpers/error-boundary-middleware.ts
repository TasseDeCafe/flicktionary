import { type AnyMiddleware, ORPCError, ValidationError } from '@orpc/server'
import { logWithSentry } from '../../../transport/third-party/sentry/error-monitoring'

// Wired into every oRPC implementer via `.use(errorBoundaryMiddleware)`. Catches any
// thrown error that isn't an explicit oRPC error (which carries an HTTP status the
// handler chose deliberately), logs it to Sentry with the request's userId already
// bound via AsyncLocalStorage, and rethrows as a generic INTERNAL_SERVER_ERROR.
//
// Handlers no longer need their own try/catch for translating unknown failures.
// They still throw `errors.NOT_FOUND(...)` etc. explicitly for entity-not-found
// and validation cases — those are ORPCError instances and pass straight through.
//
// Special case: oRPC's input/output validators wrap Zod issues inside an
// ORPCError whose `cause` is a `ValidationError`. The wire response only
// surfaces a generic "validation failed" message, which is impossible to
// debug from the frontend. We log the issues locally + to Sentry before
// rethrowing so a `pnpm dev` terminal shows what field and what reason.
export const errorBoundaryMiddleware: AnyMiddleware = async ({ next, errors, path }) => {
  try {
    return await next()
  } catch (e) {
    if (e instanceof ORPCError) {
      if (e.cause instanceof ValidationError) {
        const procedure = path.join('.')
        // eslint-disable-next-line no-console
        console.error(
          `[orpc validation] ${procedure} ${e.message}\n` + JSON.stringify(e.cause.issues, null, 2)
        )
        logWithSentry({
          message: 'orpc validation failed',
          params: { path: procedure, message: e.message, issues: e.cause.issues },
          error: e.cause,
        })
      }
      throw e
    }
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
