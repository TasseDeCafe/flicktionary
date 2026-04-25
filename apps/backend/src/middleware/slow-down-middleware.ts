import { NextFunction, Request, Response } from 'express'

export const slowDownMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const msToWait: number = 500
  setTimeout(() => {
    next()
  }, msToWait)
}
