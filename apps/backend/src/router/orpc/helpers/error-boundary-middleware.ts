import { type AnyMiddleware, ORPCError, ValidationError } from '@orpc/server'
import { ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import { logError } from '../../../transport/error-monitoring/error-monitoring'
import { GuestSourceLimitError } from '../../../transport/database/guests/guest-source-quota'
import { UpstreamRateLimitError } from '../../../transport/third-party/upstream-rate-limit-error'

// Wired into every oRPC implementer via `.use(errorBoundaryMiddleware)`. Catches any
// thrown error that isn't an explicit oRPC error (which carries an HTTP status the
// handler chose deliberately), logs it to PostHog error tracking with the request's userId already
// bound via AsyncLocalStorage, and rethrows as a generic INTERNAL_SERVER_ERROR.
//
// Handlers no longer need their own try/catch for translating unknown failures.
// They still throw `errors.NOT_FOUND(...)` etc. explicitly for entity-not-found
// and validation cases — those are ORPCError instances and pass straight through.
//
// Special case: oRPC's input/output validators wrap Zod issues inside an
// ORPCError whose `cause` is a `ValidationError`. The wire response only
// surfaces a generic "validation failed" message, which is impossible to
// debug from the frontend. We log the issues locally + to error tracking before
// rethrowing so a `pnpm dev` terminal shows what field and what reason.
export const errorBoundaryMiddleware: AnyMiddleware = async ({ next, errors, path }) => {
  try {
    return await next()
  } catch (e) {
    if (e instanceof ORPCError) {
      if (e.cause instanceof ValidationError) {
        const procedure = path.join('.')

        console.error(`[orpc validation] ${procedure} ${e.message}\n` + JSON.stringify(e.cause.issues, null, 2))
        logError({
          message: 'orpc validation failed',
          params: { path: procedure, message: e.message, issues: e.cause.issues },
          error: e.cause,
        })
      }
      throw e
    }
    // An anonymous user hit the per-guest content-source cap. An expected
    // business outcome, not an ops failure — no logError. Falls through to 500
    // if the procedure's contract doesn't declare FORBIDDEN.
    if (e instanceof GuestSourceLimitError && 'FORBIDDEN' in errors) {
      throw errors.FORBIDDEN({
        data: { errors: [{ code: ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED, message: e.message }] },
      })
    }
    // A third-party service (TMDB / OpenSubtitles) throttled us or the shared
    // daily quota is spent. Answer 429 — which the frontends never retry — with
    // a machine-readable code so the client can show a real message instead of
    // a generic failure. Still logged: quota exhaustion is the ops signal to
    // buy a bigger tier. Falls through to 500 if the procedure's contract
    // doesn't declare TOO_MANY_REQUESTS.
    if (e instanceof UpstreamRateLimitError && 'TOO_MANY_REQUESTS' in errors) {
      logError({
        message: 'upstream rate limited',
        params: { path: path.join('.'), service: e.service, kind: e.kind },
        error: e,
      })
      throw errors.TOO_MANY_REQUESTS({
        data: {
          errors: [
            {
              code: e.kind === 'quota_exceeded' ? 'UPSTREAM_QUOTA_EXCEEDED' : 'UPSTREAM_RATE_LIMITED',
              message: e.message,
            },
          ],
        },
      })
    }
    logError({
      message: 'unhandled handler error',
      params: { path: path.join('.') },
      error: e,
    })
    throw errors.INTERNAL_SERVER_ERROR({
      data: { errors: [{ message: 'Internal server error' }] },
    })
  }
}
