// Module translations (virtualTryOn.*) are injected by module.ts via the
// i18n:registerModule hook — this config only sets behavior.
import { defineI18nConfig } from '#imports'

export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en'
}))
