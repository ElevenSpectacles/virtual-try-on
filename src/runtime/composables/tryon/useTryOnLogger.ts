import { useNuxtApp } from '#imports'
import { defaultTryOnLogger, type TryOnLogger } from '../../utils/tryon-logger'

/**
 * Logger for the try-on composables. Hosts route module logs into their own
 * logging by providing `$tryOnLogger` from a Nuxt plugin:
 *
 * ```ts
 * export default defineNuxtPlugin(() => ({
 *   provide: { tryOnLogger: useLogger() }
 * }))
 * ```
 *
 * Without one, logs go to the console. Must be called in a Nuxt context
 * (component setup / plugin), like any `useNuxtApp()` consumer.
 */
export function useTryOnLogger(): TryOnLogger {
  const { $tryOnLogger } = useNuxtApp() as { $tryOnLogger?: TryOnLogger }
  return $tryOnLogger ?? defaultTryOnLogger
}
