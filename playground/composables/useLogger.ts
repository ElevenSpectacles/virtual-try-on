/**
 * Playground-only stand-in for the host's `useLogger()`. The module assumes
 * the host auto-imports a logger; here we just mirror to the console so the
 * composables work unchanged. Do not copy this into the module source.
 */
export function useLogger() {
  return {
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args)
  }
}
