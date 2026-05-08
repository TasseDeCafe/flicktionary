import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import {
  ProcessingPassName,
  ProcessingTelemetryRepositoryInterface,
} from '../../transport/database/processing-telemetry/processing-telemetry-repository'

export type RecordPassTelemetryArgs = {
  studySessionId: string | null
  passName: ProcessingPassName
  payload: Record<string, unknown>
  durationMs: number | null
}

// Audit a single processing pass: emits a structured `[telemetry]` line for
// live tailing AND persists the same payload into processing_telemetry for
// later inspection. The DB write is best-effort — a failure here must never
// break the processing pipeline.
export const recordPassTelemetry = async (
  repo: ProcessingTelemetryRepositoryInterface,
  args: RecordPassTelemetryArgs
): Promise<void> => {
  console.log(
    JSON.stringify({
      tag: 'telemetry',
      passName: args.passName,
      studySessionId: args.studySessionId,
      durationMs: args.durationMs,
      payload: args.payload,
    })
  )
  try {
    await repo.record(args)
  } catch (e) {
    logCustomErrorMessageAndError(`recordPassTelemetry failed (pass=${args.passName})`, e)
  }
}
