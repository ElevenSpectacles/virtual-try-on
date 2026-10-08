import { test as base, type Page } from '@playwright/test'
import { fakeCameraArgs } from './fixtures'

/**
 * `test` with a `cameraPage` whose fake camera plays the `clip` option.
 * Chromium takes the capture file as a launch flag, and Playwright only
 * allows launch options per worker, so each test launches its own browser.
 */
export const test = base.extend<{
  clip: string
  gl: 'hardware' | 'swiftshader'
  cameraPage: Page
}>({
  clip: ['', { option: true }],
  gl: ['hardware', { option: true }],
  cameraPage: async ({ playwright, clip, gl, baseURL, viewport }, use) => {
    const browser = await playwright.chromium.launch({ args: fakeCameraArgs(clip, gl) })
    const context = await browser.newContext({
      baseURL,
      viewport,
      permissions: ['camera']
    })
    await use(await context.newPage())
    await browser.close()
  }
})

export { expect } from '@playwright/test'
