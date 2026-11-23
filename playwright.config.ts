import { defineConfig, devices } from '@playwright/test'
import { missingPrerequisite } from './tests/e2e/fixtures'

const PORT = 3298
const skipReason = missingPrerequisite()
if (skipReason) {
  console.log(`▸ Skipping face-fixture e2e — ${skipReason}`)
}

export default defineConfig({
  testDir: './tests/e2e',
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFileName}/{arg}{-platform}{ext}',
  workers: 1,
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    permissions: ['camera'],
    trace: 'retain-on-failure'
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.005 }
  },
  ...(skipReason
    ? { testIgnore: '**/*' }
    : {
        webServer: {
          command: `npx nuxt build playground && PORT=${PORT} node playground/.output/server/index.mjs`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000
        }
      })
})
