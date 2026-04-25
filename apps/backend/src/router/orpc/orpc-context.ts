import type { Request, Response } from 'express'

// todo orpc: ideally we should be chaining an oRPC middleware to the implementers in each
// router to safely type the context and return oRPC errors.
export type OrpcContext = {
  req: Request
  res: Response
}
