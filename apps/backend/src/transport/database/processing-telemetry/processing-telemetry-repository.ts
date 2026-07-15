import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbProcessingTelemetry = Tables<'processing_telemetry'>

export type ProcessingPassName =
  'disambiguation' | 'exclusion_prefilter' | 'wiktionary_grounding' | 'highlight_enrichment' | 'window_nomination'

const record = async (params: {
  studySessionId: string | null
  passName: ProcessingPassName
  payload: Record<string, unknown>
  durationMs: number | null
}): Promise<void> => {
  const payloadJson = sql.json(params.payload as unknown as postgres.JSONValue)
  await sql`
    INSERT INTO public.processing_telemetry (study_session_id, pass_name, payload, duration_ms)
    VALUES (${params.studySessionId}, ${params.passName}, ${payloadJson}, ${params.durationMs})
  `
}

export interface ProcessingTelemetryRepositoryInterface {
  record: (params: {
    studySessionId: string | null
    passName: ProcessingPassName
    payload: Record<string, unknown>
    durationMs: number | null
  }) => Promise<void>
}

export const ProcessingTelemetryRepository = (): ProcessingTelemetryRepositoryInterface => {
  return {
    record,
  }
}
