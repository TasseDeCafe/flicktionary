// Thrown by third-party clients when the upstream service refused the request
// over rate or quota limits, so the oRPC error boundary can answer 429 with a
// machine-readable code instead of a generic 500 (which the frontend would
// retry, amplifying the load on an already-throttled service).
//
// - 'rate_limited': transient request-rate throttling — retrying shortly can work.
// - 'quota_exceeded': a daily allowance is spent (OpenSubtitles downloads are a
//   single shared per-key budget) — retrying won't help until the quota resets.
export type UpstreamRateLimitKind = 'rate_limited' | 'quota_exceeded'

export type UpstreamService = 'tmdb' | 'opensubtitles'

export class UpstreamRateLimitError extends Error {
  constructor(
    public readonly service: UpstreamService,
    public readonly kind: UpstreamRateLimitKind,
    message: string
  ) {
    super(message)
    this.name = 'UpstreamRateLimitError'
  }
}
