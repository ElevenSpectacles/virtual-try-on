/**
 * Snapshot of the composited try-on (issue #93): which part of the camera
 * frame the preview shows, and how big the picture is. Pure math, no DOM.
 *
 * The stage shows the `<video>` with `object-fit: cover` (cropped to the
 * stage's aspect, centred) and mirrored once with CSS; the WebGL canvas
 * covers the whole stage unmirrored. A capture redraws exactly that: the
 * cover window of the raw frame, mirrored, then the canvas over it, both
 * scaled to the output size.
 */

import { objectCoverWindow } from './tryon'

export type TryOnCaptureType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface TryOnCaptureOptions {
  /** Image format. Default `'image/jpeg'`. */
  type?: TryOnCaptureType
  /** Encoder quality for JPEG/WebP, 0 … 1. Default 0.92. */
  quality?: number
  /**
   * Maximum output width in pixels. Default: the camera's own resolution
   * across the visible window (no upscaling).
   */
  maxWidth?: number
}

export interface CaptureLayout {
  /** Output size, pixels. */
  width: number
  height: number
  /** Visible window of the raw camera frame, in its pixels. */
  source: { x: number; y: number; width: number; height: number }
}

export const CAPTURE_DEFAULT_QUALITY = 0.92

/**
 * The output size and the camera-frame crop for a stage of `stageWidth` ×
 * `stageHeight` (CSS pixels) showing a `videoWidth` × `videoHeight` frame.
 * Null while a size is unknown.
 */
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

/** Quality clamped to 0 … 1, the default when absent or invalid. */
export function captureQuality(quality: number | undefined): number {
  return typeof quality === 'number' && Number.isFinite(quality)
    ? Math.min(Math.max(quality, 0), 1)
    : CAPTURE_DEFAULT_QUALITY
}
