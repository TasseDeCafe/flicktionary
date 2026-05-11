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

export const recordPassTelemetry = async (
  repo: ProcessingTelemetryRepositoryInterface,
  args: RecordPassTelemetryArgs
): Promise<void> => {
  try {
    await repo.record(args)
  } catch (e) {
    logCustomErrorMessageAndError(`recordPassTelemetry failed (pass=${args.passName})`, e)
  }
}
