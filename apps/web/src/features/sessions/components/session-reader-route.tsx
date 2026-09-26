import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { SessionView } from './session-view'

// The reader restores the saved line once per mount, from whatever session
// data it first sees. A cached copy can be stale — the position may have moved
// on another device, or been set lower there (which the monotonic cache merge
// would discard) — so each mount drops the cached session first and restores
// from the server's answer, behind the reader's loading skeleton.
const FreshSessionView = ({ sessionId }: { sessionId: string }) => {
  const queryClient = useQueryClient()
  useState(() =>
    queryClient.removeQueries({
      queryKey: orpcQuery.studySessions.get.queryKey({ input: { sessionId } }),
      exact: true,
    })
  )
  return <SessionView />
}

// Keyed by session so moving between sessions (a book's previous/next part)
// remounts the reader: its restore and progress-tracking state is per session.
export const SessionReaderRoute = () => {
  const { sessionId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/' })
  return <FreshSessionView key={sessionId} sessionId={sessionId} />
}
