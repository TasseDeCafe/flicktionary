import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWiktionaryGrounding } from './wiktionary-grounding-runner'
import { groundChunk } from '../wiktionary-grounding'
import type { TouchedLookupInfo } from './materialize-basic-data-chunks'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { ProcessingTelemetryRepositoryInterface } from '../../transport/database/processing-telemetry/processing-telemetry-repository'

vi.mock('../wiktionary-grounding', () => ({
  groundChunk: vi.fn(),
}))

const lookupId = '00000000-0000-0000-0000-000000000010'

const info = (overrides: Partial<TouchedLookupInfo> = {}): TouchedLookupInfo => ({
  headword: 'protestar',
  llmPos: 'verb',
  alreadyGrounded: false,
  hasGroundingPatch: false,
  grammarUserEdited: false,
  ...overrides,
})

const createDeps = () => {
  const applyGroundingPatch = vi.fn().mockResolvedValue(undefined)
  const record = vi.fn().mockResolvedValue(undefined)
  return {
    applyGroundingPatch,
    record,
    userLookupsRepository: { applyGroundingPatch } as unknown as UserLookupsRepositoryInterface,
    wiktionaryEntriesRepository: {} as WiktionaryEntriesRepositoryInterface,
    processingTelemetryRepository: { record } as unknown as ProcessingTelemetryRepositoryInterface,
  }
}

const run = (lookupInfo: TouchedLookupInfo, deps: ReturnType<typeof createDeps>) =>
  runWiktionaryGrounding({
    sessionId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    targetLanguage: 'es',
    touchedLookups: new Map([[lookupId, lookupInfo]]),
    userLookupsRepository: deps.userLookupsRepository,
    wiktionaryEntriesRepository: deps.wiktionaryEntriesRepository,
    processingTelemetryRepository: deps.processingTelemetryRepository,
  })

const telemetryPayload = (deps: ReturnType<typeof createDeps>) =>
  deps.record.mock.calls[0]![0].payload as Record<string, number>

describe('runWiktionaryGrounding — grounding_patch backfill skip logic', () => {
  beforeEach(() => {
    vi.mocked(groundChunk).mockReset()
    vi.mocked(groundChunk).mockResolvedValue({
      patch: { gender: 'f' },
      matchedHeadword: 'protestar',
      matchedPos: 'verb',
    })
  })

  it('skips a grounded row that already has its patch snapshot', async () => {
    const deps = createDeps()
    await run(info({ alreadyGrounded: true, hasGroundingPatch: true }), deps)

    expect(groundChunk).not.toHaveBeenCalled()
    expect(telemetryPayload(deps)).toMatchObject({ alreadyGrounded: 1, grounded: 0, backfilled: 0 })
  })

  it('re-grounds a grounded row missing its patch snapshot (backfill)', async () => {
    const deps = createDeps()
    await run(info({ alreadyGrounded: true, hasGroundingPatch: false }), deps)

    expect(deps.applyGroundingPatch).toHaveBeenCalledWith({ id: lookupId, grammarPatch: { gender: 'f' } })
    expect(telemetryPayload(deps)).toMatchObject({ grounded: 1, backfilled: 1, alreadyGrounded: 0 })
  })

  it('never re-grounds a user-edited row, even when its patch snapshot is missing', async () => {
    // userEdited must short-circuit before the backfill branch — otherwise a
    // reprocess would overwrite the user's grammar edits with kaikki values.
    const deps = createDeps()
    await run(info({ alreadyGrounded: true, hasGroundingPatch: false, grammarUserEdited: true }), deps)

    expect(groundChunk).not.toHaveBeenCalled()
    expect(telemetryPayload(deps)).toMatchObject({ userEdited: 1, grounded: 0, backfilled: 0 })
  })

  it('grounds a fresh row without counting it as a backfill', async () => {
    const deps = createDeps()
    await run(info(), deps)

    expect(deps.applyGroundingPatch).toHaveBeenCalledTimes(1)
    expect(telemetryPayload(deps)).toMatchObject({ grounded: 1, backfilled: 0 })
  })
})
