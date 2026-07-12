import { describe, expect, test } from 'vitest'
import type { ChunksCursor } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { decodeCursor, encodeCursor } from './chunks-router'

// The listChunks cursor wire format: every variant must survive the
// base64-of-JSON round trip, and anything else must decode to null (the
// deliberate "fall back to page 1" contract — never a throw).
describe('chunks cursor codec', () => {
  const variants: ChunksCursor[] = [
    { sort: 'recent', createdAt: '2026-07-01T00:00:00Z', id: '9f2b6f4e-0000-4000-8000-000000000001' },
    {
      sort: 'due',
      phase: 'scheduled',
      srsDue: '2026-07-02T00:00:00Z',
      id: '9f2b6f4e-0000-4000-8000-000000000002',
    },
    { sort: 'due', phase: 'unscheduled', id: '9f2b6f4e-0000-4000-8000-000000000003' },
    {
      sort: 'queue',
      tier: 2,
      zipfKey: 5.42,
      createdAt: '2026-07-03T00:00:00Z',
      headword: ' höchstens',
      sense: '',
      id: '9f2b6f4e-0000-4000-8000-000000000004',
    },
    // NULL zipf rides as -1 (COALESCE), and sense can be non-empty.
    {
      sort: 'queue',
      tier: 3,
      zipfKey: -1,
      createdAt: '2026-07-03T00:00:00Z',
      headword: 'банк',
      sense: 'financial institution',
      id: '9f2b6f4e-0000-4000-8000-000000000005',
    },
  ]

  test.each(variants.map((cursor) => [cursor.sort, cursor] as const))('round-trips the %s cursor', (_sort, cursor) => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  test('null/absent cursors encode to null and decode to null', () => {
    expect(encodeCursor(null)).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  test('malformed cursors fall back to page 1 (null), never throw', () => {
    expect(decodeCursor('not-base64!!')).toBeNull()
    expect(decodeCursor(Buffer.from('{"sort":"nope"}').toString('base64'))).toBeNull()
    expect(decodeCursor(Buffer.from('[1,2,3]').toString('base64'))).toBeNull()
    // A queue cursor missing one ordering key must be rejected wholesale —
    // resuming with a partial key would silently skip or repeat rows.
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ sort: 'queue', tier: 1, zipfKey: 2, createdAt: '2026-07-03T00:00:00Z' })).toString(
          'base64'
        )
      )
    ).toBeNull()
  })
})
