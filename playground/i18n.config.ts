// Module translations (virtualTryOn.*) are injected by src/module.ts via the
// i18n:registerModule hook — this config only sets behavior. Playground-only
// strings live in playground/locales/en.ts.
import { defineI18nConfig } from '#imports'

export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en'
}))
