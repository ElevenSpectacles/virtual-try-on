import { describe, expect, it } from 'vitest'
import {
  CARD_CROP_HEIGHT,
  CARD_CROP_WIDTH,
  CARD_FACE_RATIO,
  CARD_REGION_WIDTH_FACTOR,
  CARD_SAMPLES,
  CARD_STANDOFF_MM,
  CARD_TIMEOUT_MS,
  CARD_WIDTH_MM,
  IDLE_CARD_CALIBRATION,
  cardRegion,
  cardWidthInFrame,
  expireCardCalibration,
  findCardEdges,
  nearPdFromCard,
  startCardCalibration,
  updateCardCalibration,
  type CardCalibrationState
} from '../../../src/runtime/utils/tryon-card'
import { distancePdMm } from '../../../src/runtime/utils/tryon-measure'
import type { NormalizedLandmark } from '../../../src/runtime/utils/tryon'
import { gaussian, mulberry32 } from '../support/landmark-stream'

const W = CARD_CROP_WIDTH
const H = CARD_CROP_HEIGHT

/** A grey crop: `skin` background, optional card from `left` to `right` (fractional columns, anti-aliased). */
function crop({
  left,
  right,
  skin = 170,
  card = 220,
  noise = 3,
  logo,
  hairlines = [] as number[],
  seed = 1
}: {
  left?: number
  right?: number
  skin?: number
  card?: number
  noise?: number
  logo?: [number, number]
  hairlines?: number[]
  seed?: number
}) {
  const rand = mulberry32(seed)
  const gray = new Uint8ClampedArray(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Coverage of pixel [x, x+1) by the card [left, right).
      const cover =
        left !== undefined && right !== undefined
          ? Math.max(0, Math.min(x + 1, right) - Math.max(x, left))
          : 0
      let value = skin + (card - skin) * cover
      if (logo && x >= logo[0] && x < logo[1] && y > H * 0.3 && y < H * 0.6) value = 60
      for (const h of hairlines) if (x >= h) value = 40 // dark hair past the line
      gray[y * W + x] = value + noise * gaussian(rand)
    }
  }
  return gray
}

describe('findCardEdges', () => {
  it('finds both edges to a fraction of a pixel', () => {
    const edges = findCardEdges(crop({ left: 80.3, right: 210.7 }), W, H)!
    // Sub-pixel: the gradient peak of an edge at 80.3 sits at 80.3 - 0.5 + ...
    expect(edges.right - edges.left).toBeCloseTo(210.7 - 80.3, 0)
    expect(Math.abs(edges.right - edges.left - (210.7 - 80.3))).toBeLessThan(0.5)
  })

  it('ignores a logo printed on the card', () => {
    const edges = findCardEdges(crop({ left: 70, right: 210, logo: [90, 120] }), W, H)!
    // Edges sit at pixel boundaries (x − 0.5 in pixel-centre terms); the
    // width is what matters.
    expect(Math.abs(edges.left - 69.5)).toBeLessThan(0.5)
    expect(edges.right - edges.left).toBeCloseTo(140, 0)
  })

  it('does not pair a card edge with a hairline', () => {
    // Card against skin, hair starting 30 px to its right.
    const edges = findCardEdges(crop({ left: 70, right: 200, hairlines: [235] }), W, H)!
    expect(edges.right - edges.left).toBeCloseTo(130, 0)
  })

  it('finds nothing on bare skin, or with only a hairline', () => {
    expect(findCardEdges(crop({}), W, H)).toBeNull()
    expect(findCardEdges(crop({ hairlines: [250] }), W, H)).toBeNull()
  })

  it('rejects spans no card has against a face', () => {
    const minSpan = (CARD_FACE_RATIO.min / CARD_REGION_WIDTH_FACTOR) * W
    expect(findCardEdges(crop({ left: 100, right: 100 + minSpan * 0.8 }), W, H)).toBeNull()
  })
})

describe('cardRegion', () => {
  function face(): NormalizedLandmark[] {
    const points: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
    points[234] = { x: 0.35, y: 0.45 }
    points[454] = { x: 0.65, y: 0.45 }
    points[151] = { x: 0.5, y: 0.3 }
    points[9] = { x: 0.5, y: 0.36 }
    return points
  }

  it('is a band above the brows, centred, wider than a card', () => {
    const region = cardRegion(face())!
    expect(region.x + region.width / 2).toBeCloseTo(0.5, 6)
    expect(region.width).toBeCloseTo(0.3 * CARD_REGION_WIDTH_FACTOR, 6)
    expect(region.y + region.height).toBeLessThan(0.36)
    expect(region.height).toBeGreaterThan(0.3 * (53.98 / 145))
  })

  it('stays inside the frame', () => {
    const points = face()
    points[151] = { x: 0.05, y: 0.02 }
    points[9] = { x: 0.05, y: 0.05 }
    const region = cardRegion(points)!
    expect(region.x).toBeGreaterThanOrEqual(0)
    expect(region.y).toBeGreaterThanOrEqual(0)
  })

  it('is null without the landmarks', () => {
    expect(cardRegion([])).toBeNull()
  })
})

describe('nearPdFromCard', () => {
  it('scales the IPD by the card ruler', () => {
    // Card 0.3 of the frame, IPD 0.2: 85.6 * 2/3 mm.
    expect(nearPdFromCard(0.3, 0.2)).toBeCloseTo((CARD_WIDTH_MM * 0.2) / 0.3, 6)
  })

  it('corrects for the card sitting in front of the eyes', () => {
    const flat = nearPdFromCard(0.3, 0.2)
    const at500 = nearPdFromCard(0.3, 0.2, 500)
    expect(at500 / flat).toBeCloseTo(500 / (500 - CARD_STANDOFF_MM), 6)
    expect(at500 - flat).toBeGreaterThan(1)
  })

  it('reads the card width out of a crop', () => {
    const width = cardWidthInFrame(
      { left: 40, right: 200, score: 5 },
      { x: 0.2, y: 0.1, width: 0.5, height: 0.15 },
      320
    )
    expect(width).toBeCloseTo(0.25, 6)
  })
})

describe('card calibration state', () => {
  function feed(state: CardCalibrationState, readings: number[], t0 = 0) {
    return readings.reduce((s, pd, i) => updateCardCalibration(s, pd, 500, t0 + i * 33), state)
  }

  it('is done once enough readings agree, with the distance PD', () => {
    const rand = mulberry32(5)
    const readings = Array.from({ length: CARD_SAMPLES }, () => 61 + 0.25 * gaussian(rand))
    const done = feed(startCardCalibration(0), readings)
    expect(done.status).toBe('done')
    expect(done.nearPdMm).toBeGreaterThan(60.5)
    expect(done.nearPdMm).toBeLessThan(61.5)
    expect(done.pdMm).toBeCloseTo(Math.round(distancePdMm(done.nearPdMm!, 500) * 2) / 2, 6)
  })

  it('keeps detecting while readings disagree or no card is seen', () => {
    const scattered = feed(startCardCalibration(0), [55, 70, 58, 66, 61, 73, 52, 68, 60, 75, 57, 64])
    expect(scattered.status).toBe('detecting')
    const empty = feed(startCardCalibration(0), [0, 0, 0])
    expect(empty.status).toBe('detecting')
    expect(empty.progress).toBe(0)
  })

  it('reports progress, below 1 until done', () => {
    const half = feed(startCardCalibration(0), Array(CARD_SAMPLES / 2).fill(61))
    expect(half.progress).toBeCloseTo(0.5, 6)
  })

  it('fails after the timeout, also with no frames at all', () => {
    const late = updateCardCalibration(startCardCalibration(0), 0, 0, CARD_TIMEOUT_MS)
    expect(late.status).toBe('failed')
    expect(expireCardCalibration(startCardCalibration(0), CARD_TIMEOUT_MS).status).toBe('failed')
    expect(expireCardCalibration(startCardCalibration(0), CARD_TIMEOUT_MS - 1).status).toBe('detecting')
  })

  it('leaves idle and finished states alone', () => {
    expect(updateCardCalibration(IDLE_CARD_CALIBRATION, 61, 500, 0)).toBe(IDLE_CARD_CALIBRATION)
    const done = feed(startCardCalibration(0), Array(CARD_SAMPLES).fill(61))
    expect(updateCardCalibration(done, 70, 500, 1)).toBe(done)
  })
})
