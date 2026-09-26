import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { booksContract } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { isBookReady, readBookMetadata } from '../../transport/database/books/books-repository'
import {
  finalizeBookUpload,
  openBookPart,
  toBookPartInserts,
  type BookUploadDependencies,
} from '../../service/books/book-upload'
import { blockedContentMessage } from '../../service/moderation/moderate-ingest-text'
import { toIsoString } from '../router-utils'

const bookNotFound = { data: { errors: [{ message: 'Book not found' }] } }
const staleUpload = {
  data: { errors: [{ code: 'BOOK_UPLOAD_SUPERSEDED', message: 'This upload was restarted elsewhere' }] },
}
const missingPrefs = (reason: 'needs-onboarding' | 'missing-cefr') => ({
  data: {
    errors: [
      reason === 'needs-onboarding'
        ? { code: 'native_language_not_set', message: 'Finish onboarding before importing a book' }
        : { code: 'cefr_not_set', message: "Set your level for this book's language first" },
    ],
  },
})

export const BooksRouter = (deps: BookUploadDependencies): Router => {
  const implementer = implement(booksContract).$context<OrpcContext>().use(errorBoundaryMiddleware)
  const { booksRepository } = deps

  const router = implementer.router({
    create: implementer.create.handler(async ({ input, context }) => {
      const result = await booksRepository.startUpload({ ...input, userId: context.res.locals.userId })
      return {
        data: {
          contentSourceId: result.source.id,
          alreadyExisted: result.kind === 'ready',
          uploadId: result.kind === 'uploading' ? result.uploadId : null,
        },
      }
    }),

    appendParts: implementer.appendParts.handler(async ({ input, context, errors }) => {
      const result = await booksRepository.appendParts({
        contentSourceId: input.contentSourceId,
        userId: context.res.locals.userId,
        uploadId: input.uploadId,
        parts: toBookPartInserts(input.parts),
      })
      if (!result.ok) {
        if (result.reason === 'not-found') throw errors.NOT_FOUND(bookNotFound)
        if (result.reason === 'stale-upload') throw errors.CONFLICT(staleUpload)
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Part index outside the declared part count' }] } })
      }
      return { data: { receivedPartCount: result.receivedPartCount } }
    }),

    finalize: implementer.finalize.handler(async ({ input, context, errors }) => {
      const result = await finalizeBookUpload({ ...input, userId: context.res.locals.userId }, deps)
      if (result.ok) return { data: { sessionId: result.sessionId } }
      switch (result.reason) {
        case 'not-found':
          throw errors.NOT_FOUND(bookNotFound)
        case 'stale-upload':
          throw errors.CONFLICT(staleUpload)
        case 'incomplete':
          throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Some parts of the book are missing' }] } })
        case 'blocked':
          throw errors.UNPROCESSABLE_ENTITY({
            data: { errors: [{ code: 'CONTENT_BLOCKED', message: blockedContentMessage(result.category) }] },
          })
        case 'needs-onboarding':
        case 'missing-cefr':
          throw errors.PRECONDITION_FAILED(missingPrefs(result.reason))
      }
    }),

    get: implementer.get.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const source = await booksRepository.findOwnedBook(input.contentSourceId, userId)
      if (!source || !isBookReady(source)) throw errors.NOT_FOUND(bookNotFound)
      const parts = await booksRepository.listPartsForUser(source.id, userId)
      const lastRead = parts
        .filter((part) => part.last_read_at !== null)
        .sort((a, b) => new Date(b.last_read_at!).getTime() - new Date(a.last_read_at!).getTime())[0]
      return {
        data: {
          contentSourceId: source.id,
          title: source.title,
          author: readBookMetadata(source).author,
          language: source.language,
          currentPartIndex: lastRead?.book_part_index ?? 0,
          parts: parts.map((part) => ({
            textTrackId: part.text_track_id,
            partIndex: part.book_part_index,
            title: part.book_part_title,
            segmentCount: part.segment_count,
            sessionId: part.session_id,
            furthestReadSegmentIndex: part.furthest_read_segment_index,
            lastReadAt: toIsoString(part.last_read_at),
          })),
        },
      }
    }),

    openPart: implementer.openPart.handler(async ({ input, context, errors }) => {
      const result = await openBookPart({ ...input, userId: context.res.locals.userId }, deps)
      if (result.ok) return { data: { sessionId: result.sessionId } }
      if (result.reason === 'not-found') throw errors.NOT_FOUND(bookNotFound)
      throw errors.PRECONDITION_FAILED(missingPrefs(result.reason))
    }),

    remove: implementer.remove.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const source = await booksRepository.findOwnedBook(input.contentSourceId, userId)
      if (!source) throw errors.NOT_FOUND(bookNotFound)
      await booksRepository.removeForUser(source.id, userId)
      return { data: { ok: true as const } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: booksContract })
}
