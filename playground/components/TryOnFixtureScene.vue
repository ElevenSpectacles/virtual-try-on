<script setup lang="ts">
/**
 * One frozen try-on frame: `TryOnScene` fed from a recorded snapshot
 * (tests/fixtures/tryon-pose, written by record-tryon-pose.spec.ts) instead of
 * a live tracker. No camera and no detection, so two renders differ only by
 * the props that change: this is what makes the shadow on/off comparison exact.
 *
 * `?view=scene&shadow=on|off` picks the contact shadow. The background is flat
 * grey, not a portrait: the shadow is painted on the occluder mesh, so it
 * lands on the same skin whatever is behind it.
 */
import { computed } from 'vue'
import { NeutralToneMapping } from 'three'
import TryOnScene from '../../src/runtime/components/TryOnScene.vue'
import {
  CONTACT_SHADOW_STRENGTH,
  bridgeContact,
  computeContactShadowColors,
  contactShadowEllipse
} from '../../src/runtime/utils/tryon-contact-shadow'
// Every recorded pose; `face` picks one. Missing names fall back to the first.
const poses = import.meta.glob<PoseFixture>('../../tests/fixtures/tryon-pose/*.json', { eager: true, import: 'default' })

/** Shape of tests/fixtures/tryon-pose/<face>.json (see record-tryon-pose.spec.ts). */
interface PoseFixture {
  face: string
  aspect: number
  faceWorldHalfWidth: number
  framePosition: { x: number; y: number; z: number }
  scale: number
  rotation: { x: number; y: number; z: number }
  modelOffset: { x: number; y: number; z: number }
  occluderPositions: number[] | null
  occluderPosition: { x: number; y: number; z: number }
  occluderRadius: { radiusX: number; radiusY: number; radiusZ: number }
}

// Flags for the rendering goldens (tests/e2e/rendering-goldens.spec.ts).
// Defaults reproduce the frozen frame used by tryon-pose-scene.spec.ts.
const props = withDefaults(
  defineProps<{
    shadow: boolean
    face?: string
    /** Occluder (#E): hides the far temple behind the head. */
    occluder?: boolean
    /** Room light (#A): dims or brightens the key, fill and ambient lights. */
    light?: 'neutral' | 'dim' | 'bright'
    /** Flat backdrop behind the frame. */
    background?: 'mid' | 'light' | 'dark'
  }>(),
  { face: 'iris-moss', occluder: true, light: 'neutral', background: 'mid' }
)

// Gains match LIGHT_GAIN_RANGE in utils/tryon-lighting: dim is the floor, bright the ceiling.
const LIGHT_GAIN = { neutral: 1, dim: 0.5, bright: 1.5 } as const
const BACKDROP = { mid: '#c9c9c9', light: '#f2f2f2', dark: '1e1e1e' } as const
const lightGain = computed(() => LIGHT_GAIN[props.light])

const fixture = computed<PoseFixture>(() => {
  const match = Object.entries(poses).find(([path]) => path.endsWith(`/${props.face}.json`))
  return (match ?? Object.entries(poses)[0]!)[1]
})

/** Stage width in CSS px; height follows the recorded aspect. */
const STAGE_WIDTH = 448
const stageHeight = computed(() => STAGE_WIDTH / fixture.value.aspect)

const occluderPositions = computed(() =>
  fixture.value.occluderPositions ? Float32Array.from(fixture.value.occluderPositions) : null
)

// Same ellipse as VirtualTryOnExperience: 55% of the face half-width across,
// 40% up and down, centred on the occluder.
const contactShadowColors = computed(() => {
  if (!props.shadow || !occluderPositions.value) return null
  const contact = bridgeContact(fixture.value.framePosition, fixture.value.rotation, fixture.value.scale)
  const shadow = contactShadowEllipse(contact, fixture.value.faceWorldHalfWidth)
  return computeContactShadowColors(
    occluderPositions.value,
    shadow.centre,
    shadow.radius,
    CONTACT_SHADOW_STRENGTH
  )
})
</script>

<template>
  <div
    data-scene
    :style="{ width: `${STAGE_WIDTH}px`, height: `${stageHeight}px`, background: BACKDROP[props.background] }"
    class="relative"
  >
    <ClientOnly>
      <TresCanvas
        :alpha="true"
        :clear-alpha="0"
        :antialias="true"
        :dpr="1"
        :tone-mapping="NeutralToneMapping"
        render-mode="always"
        class="absolute inset-0 h-full w-full"
      >
        <TryOnScene
          :src="`/models/virtual-try-on/${fixture.face}.glb`"
          :visible="true"
          :position="fixture.framePosition"
          :model-offset="fixture.modelOffset"
          :scale="fixture.scale"
          :rotation="fixture.rotation"
          :occluder-enabled="occluder"
          :light-gain="lightGain"
          :occluder-positions="occluderPositions"
          :occluder-position="fixture.occluderPosition"
          :occluder-radius="fixture.occluderRadius"
          :occluder-rotation="fixture.rotation"
          :contact-shadow-colors="contactShadowColors"
        />
      </TresCanvas>
    </ClientOnly>
  </div>
</template>
