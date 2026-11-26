<script setup lang="ts">
import { computed, ref } from 'vue'
import { NeutralToneMapping, VSMShadowMap } from 'three'
import TryOnScene from '../../src/runtime/components/TryOnScene.vue'
import { useFrameCalibration } from '../../src/runtime/composables/tryon/useFrameCalibration'
import { LIGHT_GAIN_RANGE } from '../../src/runtime/utils/tryon-lighting'

const poses = import.meta.glob<PoseFixture>('../../tests/fixtures/tryon-pose/*.json', { eager: true, import: 'default' })

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

const props = withDefaults(
  defineProps<{
    shadow: boolean
    face?: string
    occluder?: boolean
    light?: 'neutral' | 'dim' | 'bright'
    background?: 'mid' | 'light' | 'dark'
    lens?: 'physical' | 'standard'
    model?: string | undefined
    hair?: 'off' | 'band'
    hairBand?: [number, number]
    cameraMatch?: boolean
  }>(),
  {
    face: 'iris-moss',
    occluder: true,
    light: 'neutral',
    background: 'mid',
    lens: 'physical',
    model: undefined,
    hair: 'off',
    hairBand: () => [0.66, 0.8],
    cameraMatch: false
  }
)

const GRAIN_SEED = 7

const LIGHT_GAIN = { neutral: 1, dim: LIGHT_GAIN_RANGE.min, bright: LIGHT_GAIN_RANGE.max } as const
const BACKDROP = { mid: '#c9c9c9', light: '#f2f2f2', dark: '#1e1e1e' } as const
const lightGain = computed(() => LIGHT_GAIN[props.light])

const HAIR_MASK_SIZE = { width: 96, height: 128 } as const
const hairMask = computed(() => {
  if (props.hair !== 'band') return null
  const { width, height } = HAIR_MASK_SIZE
  const data = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    const screenX = 1 - (x + 0.5) / width
    if (screenX < props.hairBand[0] || screenX > props.hairBand[1]) continue
    for (let y = 0; y < height; y++) data[y * width + x] = 255
  }
  return { data, width, height }
})

const fixture = computed<PoseFixture>(() => {
  const match = Object.entries(poses).find(([path]) => path.endsWith(`/${props.face}.json`))
  return (match ?? Object.entries(poses)[0]!)[1]
})

const STAGE_WIDTH = 448
const stageHeight = computed(() => STAGE_WIDTH / fixture.value.aspect)

const { manifest, loadError, getCalibration } = useFrameCalibration('/models/virtual-try-on/calibration.json')
const modelLoaded = ref(false)
const environmentDone = ref(false)
const ready = computed(
  () => modelLoaded.value && environmentDone.value && (manifest.value !== null || loadError.value !== null)
)
function onTiming(asset: 'model' | 'environment') {
  if (asset === 'environment') environmentDone.value = true
}
function onError(source: 'model' | 'environment') {
  if (source === 'environment') environmentDone.value = true
}
const lensOverride = computed(() => getCalibration(props.model ?? fixture.value.face).lens)

const occluderPositions = computed(() =>
  fixture.value.occluderPositions ? Float32Array.from(fixture.value.occluderPositions) : null
)

</script>

<template>
  <div
    data-scene
    :data-ready="ready"
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
        :shadows="shadow"
        :shadow-map-type="VSMShadowMap"
        render-mode="always"
        class="absolute inset-0 h-full w-full"
      >
        <TryOnScene
          :src="`/models/virtual-try-on/${model ?? fixture.face}.glb`"
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
          :contact-shadow="shadow"
          :physical-lens="lens === 'physical'"
          :lens="lensOverride"
          :hair-mask="hairMask"
          :camera-match="cameraMatch"
          :grain-seed="GRAIN_SEED"
          @loaded="modelLoaded = true"
          @timing="onTiming"
          @error="onError"
        />
      </TresCanvas>
    </ClientOnly>
  </div>
</template>
