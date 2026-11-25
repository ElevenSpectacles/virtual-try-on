import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#imports': fileURLToPath(
        new URL('./tests/mocks/nuxt-imports.ts', import.meta.url)
      )
    }
  },
  define: {
    'import.meta.client': 'true'
  },
  test: {
    include: ['tests/unit/**/*.test.ts']
  }
})
