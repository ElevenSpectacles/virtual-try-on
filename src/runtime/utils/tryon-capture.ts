import { objectCoverWindow } from './tryon'

export type TryOnCaptureType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface TryOnCaptureOptions {
  type?: TryOnCaptureType
  quality?: number
  maxWidth?: number
}

export interface CaptureLayout {
  width: number
  height: number
  source: { x: number; y: number; width: number; height: number }
}

export const CAPTURE_DEFAULT_QUALITY = 0.92

export function captureLayout(
  videoWidth: number,
  videoHeight: number,
  stageWidth: number,
  stageHeight: number,
  maxWidth?: number
): CaptureLayout | null {
  if (videoWidth <= 0 || videoHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) return null
  const stageAspect = stageWidth / stageHeight
  const window = objectCoverWindow(videoWidth / videoHeight, stageAspect)
  const source = {
    x: window.xMin * videoWidth,
    y: window.yMin * videoHeight,
    width: (window.xMax - window.xMin) * videoWidth,
    height: (window.yMax - window.yMin) * videoHeight
  }
  const limit = maxWidth && maxWidth > 0 ? maxWidth : Infinity
  const width = Math.max(1, Math.round(Math.min(source.width, limit)))
  const height = Math.max(1, Math.round(width / stageAspect))
  return { width, height, source }
}

export function captureQuality(quality: number | undefined): number {
  return typeof quality === 'number' && Number.isFinite(quality)
    ? Math.min(Math.max(quality, 0), 1)
    : CAPTURE_DEFAULT_QUALITY
}
