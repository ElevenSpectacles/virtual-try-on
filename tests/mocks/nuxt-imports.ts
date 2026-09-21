// Nuxt's `#imports` virtual module doesn't exist outside a Nuxt build; the
// unit tests only exercise pure helpers, so a minimal stub is enough.
export function useFetch(): never {
  throw new Error('useFetch is not available in unit tests')
}
