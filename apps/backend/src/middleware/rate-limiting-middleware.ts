import { rateLimit } from 'express-rate-limit'

const getRateLimitMessage = (limit: number, window: number) => {
  return {
    errors: [
      {
        message: `Too many requests, please try again later, params are: ${limit}, ${window}`,
        code: '1060',
      },
    ],
  }
}

const rateLimitMessage = (limit: number, window: number) => getRateLimitMessage(limit, window)

export const createRateLimitMiddleware = (limit: number, window: number, options = {}) => {
  return rateLimit({
    windowMs: window * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: rateLimitMessage(window, limit),
    ...options,
  })
}
