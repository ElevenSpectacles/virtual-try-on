/**
 * Minimal logger contract the try-on composables write to. Structurally
 * compatible with typical host loggers (`info`/`warn`/`error` taking a
 * message plus arbitrary context), so a host can hand its own logger over
 * as-is — see `useTryOnLogger`.
 */
export interface TryOnLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/** Console-backed fallback used when the host provides no `$tryOnLogger`. */
export const defaultTryOnLogger: TryOnLogger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
}
