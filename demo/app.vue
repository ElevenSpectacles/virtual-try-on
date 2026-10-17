<script setup lang="ts">
/**
 * The public demo: the shipped component in a plain host page. Every control
 * here belongs to the host and is built from the default slot, as a storefront
 * would build it. Every asset comes from this origin (scripts/prepare-demo.mjs).
 */
import type { TryOnModel } from '../src/runtime/composables/tryon/useTryOnModels'
import type { TryOnFitVerdict } from '../src/runtime/utils/tryon-fit'
import type {
  FaceLandmarkerError,
  TryOnGuideHint,
  WebcamError
} from '../src/runtime/types/tryon-experience'

import { useRuntimeConfig } from '#imports'
import { onMounted, ref, shallowRef, useTemplateRef } from 'vue'

const base = useRuntimeConfig().app.baseURL
const vto = `${base}vto`
const modelBaseUrl = `${base}models/virtual-try-on`

const models = shallowRef<TryOnModel[]>([])
const activeModel = ref<string>()
const loadError = ref<string | null>(null)
const tryOn = useTemplateRef<{ prefetch: () => void }>('experience')

onMounted(async () => {
  try {
    const response = await fetch(`${modelBaseUrl}/models.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    models.value = (await response.json()) as TryOnModel[]
    activeModel.value = models.value[0]?.file
  } catch (err) {
    loadError.value = `The frame list could not be loaded (${err instanceof Error ? err.message : String(err)}).`
  }
})

const CAMERA_ERRORS: Record<WebcamError, string> = {
  denied: 'Camera access is blocked. Allow it in your browser’s site settings, then try again.',
  unsupported: 'This browser can’t open a camera here. Try a current Chrome, Safari or Firefox over HTTPS.',
  unavailable: 'No camera was found, or another app is using it.'
}

const FACE_ERRORS: Record<FaceLandmarkerError, string> = {
  unsupported: 'Face tracking isn’t supported in this browser.',
  load_failed: 'Face tracking couldn’t load. Check your connection and reload.',
  runtime_failed: 'Face tracking stopped. Reload the page to try again.'
}

const GUIDE_TEXT: Record<TryOnGuideHint, string | null> = {
  aligned: null,
  noFace: 'Look straight at the camera',
  turnBack: 'Turn back toward the camera',
  tooDark: 'Find more light'
}

const FIT_TEXT: Record<TryOnFitVerdict, string> = {
  narrow: 'May be narrow for you',
  good: 'Good fit',
  wide: 'May be wide for you'
}
</script>

<template>
  <main class="demo">
    <header>
      <h1>Virtual Try-On</h1>
      <p>
        Eyewear try-on that runs entirely in your browser.
        <a href="https://github.com/ElevenSpectacles/virtual-try-on">GitHub</a> ·
        <a href="https://www.npmjs.com/package/@eleven.spectacles/virtual-try-on">npm</a>
      </p>
    </header>

    <div class="stage">
      <p v-if="loadError" class="overlay">{{ loadError }}</p>
      <VirtualTryOnExperience
        v-else-if="models.length"
        ref="experience"
        v-model:model="activeModel"
        :models
        :model-base-url
        :calibration-url="`${modelBaseUrl}/calibration.json`"
        :mediapipe-base-path="`${vto}/wasm`"
        :mediapipe-model-asset-path="`${vto}/face_landmarker.task`"
        :draco-decoder-path="`${vto}/draco/`"
        :environment-url="`${vto}/canary_wharf_1k.hdr`"
        camera-match
        room-reflections
        temple-ear-bend
      >
        <template #default="{ status, error, faceError, guideHint, fit, isStarting, start, stop }">
          <div v-if="status !== 'active'" class="overlay">
            <p v-if="error">{{ CAMERA_ERRORS[error] }}</p>
            <p v-else>Your camera feed is processed on this device. Nothing is uploaded or recorded.</p>
            <button
              type="button"
              class="primary"
              :disabled="isStarting"
              @pointerenter="tryOn?.prefetch()"
              @focus="tryOn?.prefetch()"
              @click="start"
            >
              {{ isStarting ? 'Starting…' : error ? 'Try again' : 'Try on with your camera' }}
            </button>
          </div>
          <template v-else>
            <p v-if="fit" class="pill top">{{ FIT_TEXT[fit.verdict] }}</p>
            <p v-if="faceError" class="pill bottom">{{ FACE_ERRORS[faceError] }}</p>
            <p v-else-if="guideHint && GUIDE_TEXT[guideHint]" class="pill bottom">{{ GUIDE_TEXT[guideHint] }}</p>
            <button type="button" class="stop" @click="stop">Stop camera</button>
          </template>
        </template>
      </VirtualTryOnExperience>
    </div>

    <nav v-if="models.length > 1" class="picker" aria-label="Frames">
      <button
        v-for="model in models"
        :key="model.file"
        type="button"
        :aria-pressed="model.file === activeModel"
        @click="activeModel = model.file"
      >
        {{ model.label }}
      </button>
    </nav>

    <footer>
      <p>
        Face tracking (MediaPipe) runs in a Web Worker and the frame renders
        with WebGL, both on your device. This page loads every file from its
        own origin and sends no analytics.
      </p>
    </footer>
  </main>
</template>

<style>
:root {
  color-scheme: dark;
  --bg: #111214;
  --fg: #f2f2f0;
  --muted: #a3a3a0;
  --line: #2c2d31;
  --accent: #e9d8b4;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--fg);
}

body {
  margin: 0;
}

a {
  color: var(--accent);
}

.demo {
  box-sizing: border-box;
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.demo header h1 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 600;
}

.demo header p,
.demo footer p {
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.stage {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 1rem;
  background: #1b1c1f;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin: 0;
  padding: 2rem;
  text-align: center;
  line-height: 1.5;
}

.pill {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  font-size: 0.85rem;
  white-space: nowrap;
}

.pill.top {
  top: 1rem;
}

.pill.bottom {
  bottom: 4rem;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--fg);
  padding: 0.5rem 1rem;
}

button:disabled {
  cursor: progress;
  opacity: 0.6;
}

button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #1b1c1f;
  font-weight: 600;
}

button.stop {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  background: rgb(0 0 0 / 0.55);
  font-size: 0.8rem;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.picker button[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
