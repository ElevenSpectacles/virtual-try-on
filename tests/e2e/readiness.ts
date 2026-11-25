import { expect, type Locator, type Page } from '@playwright/test'

export const STILL_TOLERANCE = 2
export const LIVE_STILL_TOLERANCE = 12
export const STILL_MAX_CHANGED_RATIO = 0.001
export const LIVE_STILL_MAX_CHANGED_RATIO = 0.003
export const STILL_INTERVAL_MS = 500
export const STILL_CONSECUTIVE = 2
export const LIVE_STILL_CONSECUTIVE = 3

export async function changedPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  tolerance = STILL_TOLERANCE
): Promise<{ changed: number; total: number }> {
  return page.evaluate(
    async ([aB64, bB64, tol]) => {
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const [imgA, imgB] = [await decode(aB64), await decode(bB64)]
      const width = imgA.width
      const height = imgA.height
      const pixels = (img: ImageBitmap) => {
        const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, width, height).data
      }
      const dA = pixels(imgA)
      const dB = pixels(imgB)
      let changed = 0
      for (let i = 0; i < dA.length; i += 4) {
        if (
          Math.abs(dA[i]! - dB[i]!) > tol ||
          Math.abs(dA[i + 1]! - dB[i + 1]!) > tol ||
          Math.abs(dA[i + 2]! - dB[i + 2]!) > tol
        ) {
          changed++
        }
      }
      return { changed, total: width * height }
    },
    [a.toString('base64'), b.toString('base64'), tolerance] as const
  )
}

export async function waitForStill(
  page: Page,
  target: Locator,
  {
    timeout = 60_000,
    maxChangedRatio = STILL_MAX_CHANGED_RATIO,
    tolerance = STILL_TOLERANCE,
    consecutive = STILL_CONSECUTIVE
  } = {}
): Promise<void> {
  const deadline = Date.now() + timeout
  let previous = await target.screenshot()
  let still = 0
  let last = 1
  while (Date.now() < deadline) {
    await page.waitForTimeout(STILL_INTERVAL_MS)
    const next = await target.screenshot()
    const { changed, total } = await changedPixels(page, previous, next, tolerance)
    last = changed / total
    still = last <= maxChangedRatio ? still + 1 : 0
    if (still >= consecutive) return
    previous = next
  }
  throw new Error(`render did not settle within ${timeout} ms (last change ${(last * 100).toFixed(3)}%)`)
}

export async function waitForScene(page: Page, timeout = 60_000): Promise<Locator> {
  const scene = page.locator('[data-scene]').first()
  await expect(scene).toHaveAttribute('data-ready', 'true', { timeout })
  await waitForStill(page, scene, { timeout })
  return scene
}

export async function waitForTryOn(page: Page, timeout = 90_000): Promise<Locator> {
  const experience = page.locator('[data-experience]')
  await expect(experience).toHaveAttribute('data-has-face', 'true', { timeout })
  await expect(experience).toHaveAttribute('data-model-loaded', 'true', { timeout })
  const stage = page.locator('.vto-stage')
  await waitForLiveStill(page, stage, timeout)
  return stage
}

export function waitForLiveStill(page: Page, stage: Locator, timeout = 60_000): Promise<void> {
  return waitForStill(page, stage, {
    timeout,
    tolerance: LIVE_STILL_TOLERANCE,
    maxChangedRatio: LIVE_STILL_MAX_CHANGED_RATIO,
    consecutive: LIVE_STILL_CONSECUTIVE
  })
}
