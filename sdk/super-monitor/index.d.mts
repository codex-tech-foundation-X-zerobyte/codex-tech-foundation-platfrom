export const SDK_NAME: string
export const SDK_VERSION: string
/** A stable 16-hex-character id for "the same error": digits in the message and line numbers in the frame are ignored. */
export function fingerprintOf(name: string, message: string, topFrame?: string): string

export type MonitorLevel = 'fatal' | 'error' | 'warning' | 'info'
export interface MonitorOptions {
  /** https://<project-ref>.supabase.co/functions/v1/monitor-ingest */
  endpoint: string
  /** The ctfm_… key. Keep it in an environment variable. */
  key: string
  environment?: string
  release?: string
  heartbeatSeconds?: number
  flushIntervalMs?: number
  maxBatch?: number
  maxQueue?: number
  fetch?: typeof fetch
  /** Called once if the key was revoked or expired; the client then stops for good. */
  onAuthFailure?: () => void
  onDrop?: (count: number) => void
}
export interface FlushResult { sent: number; ok?: boolean; retry?: boolean; revoked?: boolean }
export interface Monitor {
  captureError(error: unknown, context?: { route?: string; fatal?: boolean }): void
  message(text: string, level?: MonitorLevel, context?: { route?: string }): void
  latency(route: string, ms: number, statusCode?: number): void
  heartbeat(): void
  flush(): Promise<FlushResult>
  pending(): number
  /** Starts heartbeats and (in a browser) global error handlers. Pass `heartbeat: false` in a browser app, so a site nobody is visiting does not look down. */
  start(options?: { target?: unknown; heartbeat?: boolean }): void
  stop(): void
}
export function createMonitor(options: MonitorOptions): Monitor
