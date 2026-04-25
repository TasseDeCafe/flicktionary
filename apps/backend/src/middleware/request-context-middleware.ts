import { RequestHandler } from 'express'
import { runWithRequestContext } from '../context/request-context'

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  runWithRequestContext(() => {
    next()
  })
}
