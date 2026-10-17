<script setup lang="ts">
import type { TryOnModel } from '../src/runtime/composables/tryon/useTryOnModels'
import type { TryOnSessionMetrics } from '../src/runtime/utils/tryon-metrics'

import { useRoute } from '#imports'
import { computed, ref } from 'vue'

import VirtualTryOnPrototype from './components/VirtualTryOnPrototype.vue'
import TryOnFixtureScene from './components/TryOnFixtureScene.vue'

// The full Eleven Spectacles frame catalog, mirroring what the host passes.
// Served from the host checkout via nitro publicAssets (see nuxt.config.ts).
const models: TryOnModel[] = [
  { label: 'Iris · Bronze', file: 'iris-bronze', family: 'iris', color: 'Bronze', colorClass: 'bg-amber-700' },
  { label: 'Iris · Jade', file: 'iris-jade', family: 'iris', color: 'Jade', colorClass: 'bg-emerald-600' },
  { label: 'Iris · Moss', file: 'iris-moss', family: 'iris', color: 'Moss', colorClass: 'bg-lime-800' },
  { label: 'Kairos · Amber', file: 'kairos-amber', family: 'kairos', color: 'Amber', colorClass: 'bg-amber-500' },
  { label: 'Kairos · Crystal', file: 'kairos-crystal', family: 'kairos', color: 'Crystal', colorClass: 'bg-slate-300' },
  { label: 'Nous · Navy', file: 'nous-navy', family: 'nous', color: 'Navy', colorClass: 'bg-blue-900' },
  { label: 'Nous · Obsidian', file: 'nous-obsidian', family: 'nous', color: 'Obsidian', colorClass: 'bg-neutral-900' },
  { label: 'Pteron · Azure', file: 'pteron-azure', family: 'pteron', color: 'Azure', colorClass: 'bg-sky-600' },
  { label: 'Pteron · Charcoal', file: 'pteron-charcoal', family: 'pteron', color: 'Charcoal', colorClass: 'bg-neutral-700' },
  { label: 'Pteron · Hunter', file: 'pteron-hunter', family: 'pteron', color: 'Hunter', colorClass: 'bg-green-900' }
]

// `?view=experience` mounts the shipped headless component with a minimal
// host UI built from its slot; the default view is the tuning prototype.
const route = useRoute()
const showExperience = computed(() => route.query.view === 'experience')
// `?view=scene&shadow=on|off` renders one frozen frame (no camera), for the
// shadow comparison.
const showScene = computed(() => route.query.view === 'scene')
const sceneShadow = computed(() => route.query.shadow !== 'off')
const sceneFace = computed(() => (typeof route.query.face === 'string' ? route.query.face : 'iris-moss'))
// Rendering-golden flags: ?occluder=off, ?light=dim|bright, ?background=light|dark,
// ?lens=standard, ?model=<file> (another catalog frame on the same pose),
// ?hair=band (a painted hair band over the near temple arm).
const sceneOccluder = computed(() => route.query.occluder !== 'off')
const sceneLight = computed(() => (route.query.light === 'dim' || route.query.light === 'bright' ? route.query.light : 'neutral'))
const sceneLens = computed(() => (route.query.lens === 'standard' ? 'standard' : 'physical'))
const sceneModel = computed(() => (typeof route.query.model === 'string' ? route.query.model : undefined))
const sceneHair = computed(() => (route.query.hair === 'band' ? 'band' : 'off'))
// `?hairBand=0.4-0.5`: where the band sits, as stage-width fractions.
const sceneHairBand = computed<[number, number]>(() => {
  const [from, to] = String(route.query.hairBand ?? '').split('-').map(Number)
  return from !== undefined && to !== undefined && from < to ? [from, to] : [0.66, 0.8]
})
const sceneBackground = computed(() => (route.query.background === 'light' || route.query.background === 'dark' ? route.query.background : 'mid'))
// `?tier=low|mid|high` pins the capability tier (disables the step-down) so
// the experience can be checked at a given tier.
const tierParam = computed(() => {
  const value = route.query.tier
  return value === 'low' || value === 'mid' || value === 'high' ? value : undefined
})

function onTrack(event: string, payload: Record<string, unknown>) {
  console.info('[track]', event, payload)
}

// `?fit=true` shows the fit verdict from the slot (off by default so the
// experience goldens stay unchanged).
const showFit = computed(() => route.query.fit === 'true')
const FIT_LABELS = { narrow: 'May be narrow for you', good: 'Good fit', wide: 'May be wide for you' } as const
// `?lighting=true` shows the room-lighting estimate read from the component
// ref (tests/e2e/lighting.spec.ts reads its data attributes).
const showLighting = computed(() => route.query.lighting === 'true')
const experienceRef = ref<{
  lighting: { luma: number | null; gain: number; sampleMs: number | null }
  hair: {
    active: boolean
    coverage: number | null
    segmentMs: number | null
    masks: number
    overBudget: boolean
    error: string | null
  }
} | null>(null)
// `?hair=on` turns hair occlusion on and shows its state (tests/e2e/hair.spec.ts).
const hairParam = computed(() => (route.query.hair === 'on' ? 'on' : 'off'))

// `?capture=true` shows a capture button and the last snapshot
// (tests/e2e/capture.spec.ts reads it back).
const showCapture = computed(() => route.query.capture === 'true')
const captureUrl = ref<string | null>(null)
async function onCapture(capture: (options?: { type?: 'image/png' }) => Promise<Blob>) {
  const blob = await capture({ type: 'image/png' })
  if (captureUrl.value) URL.revokeObjectURL(captureUrl.value)
  captureUrl.value = URL.createObjectURL(blob)
}

// `?freeze=true` shows Freeze / Unfreeze and a model switcher, to compare
// frames on a held pose (tests/e2e/freeze.spec.ts).
const showFreeze = computed(() => route.query.freeze === 'true')
const activeModel = ref<string | undefined>(
  typeof route.query.model === 'string' ? route.query.model : undefined
)
function nextModel() {
  const index = models.findIndex((m) => m.file === activeModel.value)
  activeModel.value = models[(index + 1) % models.length]!.file
}

// `?metrics=true` turns on the metrics event; the e2e spec reads the JSON.
const reportMetrics = computed(() => route.query.metrics === 'true')
function onMetrics(payload: TryOnSessionMetrics) {
  console.info('[metrics]', JSON.stringify(payload))
}
</script>

<template>
  <UApp>
    <div class="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <header class="flex items-baseline justify-between">
        <h1 class="text-lg font-semibold">Virtual Try-On · Playground</h1>
        <p class="text-xs text-neutral-500">
          ?model=&lt;file&gt; · ?debug_tryon=true · ?view=experience · &amp;fit=true
        </p>
      </header>
      <div
        v-if="showExperience"
        class="relative mx-auto aspect-3/4 w-full max-w-md bg-neutral-900"
      >
        <VirtualTryOnExperience
          ref="experienceRef"
          v-model:model="activeModel"
          :models="models"
          calibration-url="/models/virtual-try-on/calibration.json"
          :tier="tierParam"
          :report-metrics="reportMetrics"
          :contact-shadow="route.query.shadow !== 'off'"
          :physical-lens="route.query.lens !== 'standard'"
          :hair-occlusion="hairParam === 'on'"
          @track="onTrack"
          @metrics="onMetrics"
        >
          <template #default="{ status, error, faceError, guideHint, fit, isStarting, start, stop, calibration, startCalibration, cancelCalibration, capture, frozen, freeze, unfreeze }">
            <div
              v-if="status !== 'active'"
              class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
            >
              <p v-if="error" class="text-xs">Camera error: {{ error }}</p>
              <UButton :loading="isStarting" color="neutral" @click="start">
                {{ error ? 'Retry camera' : 'Start camera' }}
              </UButton>
            </div>
            <UButton
              v-if="status === 'active' && reportMetrics"
              class="absolute bottom-4 left-4"
              color="neutral"
              size="xs"
              @click="stop"
            >
              Stop camera
            </UButton>
            <div
              v-if="status === 'active' && route.query.calibrate === 'true'"
              class="absolute top-4 left-4 flex items-center gap-2 text-xs text-white"
              :data-calibration="calibration.status"
            >
              <UButton
                color="neutral"
                size="xs"
                @click="calibration.status === 'detecting' ? cancelCalibration() : startCalibration()"
              >
                {{ calibration.status === 'detecting' ? 'Cancel' : 'Calibrate with a card' }}
              </UButton>
              <span v-if="calibration.status === 'detecting'">Hold a card flat to your forehead · {{ Math.round(calibration.progress * 100) }}%</span>
              <span v-else-if="calibration.status === 'done'">PD {{ calibration.pdMm }} mm</span>
              <span v-else-if="calibration.status === 'failed'">No card found, try again in better light</span>
            </div>
            <UButton
              v-if="status === 'active' && showCapture"
              class="absolute right-4 bottom-4"
              color="neutral"
              size="xs"
              @click="onCapture(capture)"
            >
              Capture
            </UButton>
            <img
              v-if="showCapture && captureUrl"
              :src="captureUrl"
              alt="Last capture"
              data-capture
              class="absolute top-4 left-4 w-24 border border-white"
            >
            <div
              v-if="status === 'active' && showFreeze"
              class="absolute right-4 bottom-4 flex gap-2"
              :data-frozen="frozen"
            >
              <UButton color="neutral" size="xs" @click="frozen ? unfreeze() : freeze()">
                {{ frozen ? 'Unfreeze' : 'Freeze' }}
              </UButton>
              <UButton color="neutral" size="xs" @click="nextModel">
                Next frame
              </UButton>
            </div>
            <p
              v-if="showFit && fit"
              class="absolute inset-x-0 top-4 text-center text-xs text-white"
              :data-fit="fit.verdict"
            >
              {{ FIT_LABELS[fit.verdict] }} · face {{ Math.round(fit.faceWidthMm) }} mm · frame {{ Math.round(fit.frameWidthMm) }} mm
            </p>
            <p
              v-if="showLighting && experienceRef?.lighting.luma != null"
              class="absolute inset-x-0 top-4 text-center text-xs text-white"
              data-lighting
              :data-luma="experienceRef.lighting.luma"
              :data-gain="experienceRef.lighting.gain"
              :data-sample-ms="experienceRef.lighting.sampleMs ?? ''"
            >
              room luma {{ experienceRef.lighting.luma.toFixed(2) }} · light gain {{ experienceRef.lighting.gain.toFixed(2) }}
            </p>
            <p
              v-if="hairParam === 'on' && experienceRef"
              class="absolute inset-x-0 top-10 text-center text-xs text-white"
              data-hair
              :data-active="experienceRef.hair.active"
              :data-coverage="experienceRef.hair.coverage ?? ''"
              :data-segment-ms="experienceRef.hair.segmentMs ?? ''"
              :data-masks="experienceRef.hair.masks"
              :data-error="experienceRef.hair.error ?? ''"
            >
              hair {{ experienceRef.hair.active ? 'on' : 'off' }} · masks {{ experienceRef.hair.masks }}
            </p>
            <p
              v-if="status === 'active' && (faceError || guideHint === 'noFace')"
              class="absolute inset-x-0 bottom-4 text-center text-xs text-white"
            >
              {{ faceError ? `Face tracking error: ${faceError}` : 'Position your face in view' }}
            </p>
          </template>
        </VirtualTryOnExperience>
      </div>
      <div v-else-if="showScene" class="mx-auto">
        <TryOnFixtureScene
          :shadow="sceneShadow"
          :face="sceneFace"
          :occluder="sceneOccluder"
          :light="sceneLight"
          :background="sceneBackground"
          :lens="sceneLens"
          :model="sceneModel"
          :hair="sceneHair"
          :hair-band="sceneHairBand"
        />
      </div>
      <VirtualTryOnPrototype
        v-else
        :models="models"
        calibration-url="/models/virtual-try-on/calibration.json"
        @track="onTrack"
      />
    </div>
  </UApp>
</template>
