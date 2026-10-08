<script setup lang="ts">
import type { TryOnModel } from '../src/runtime/composables/tryon/useTryOnModels'

import { useRoute } from '#imports'
import { computed } from 'vue'

import VirtualTryOnPrototype from './components/VirtualTryOnPrototype.vue'

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

function onTrack(event: string, payload: Record<string, unknown>) {
  console.info('[track]', event, payload)
}
</script>

<template>
  <UApp>
    <div class="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <header class="flex items-baseline justify-between">
        <h1 class="text-lg font-semibold">Virtual Try-On · Playground</h1>
        <p class="text-xs text-neutral-500">
          ?model=&lt;file&gt; · ?debug_tryon=true · ?view=experience
        </p>
      </header>
      <div
        v-if="showExperience"
        class="relative mx-auto aspect-3/4 w-full max-w-md bg-neutral-900"
      >
        <VirtualTryOnExperience
          :models="models"
          calibration-url="/models/virtual-try-on/calibration.json"
          @track="onTrack"
        >
          <template #default="{ status, error, faceError, guideHint, isStarting, start }">
            <div
              v-if="status !== 'active'"
              class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
            >
              <p v-if="error" class="text-xs">Camera error: {{ error }}</p>
              <UButton :loading="isStarting" color="neutral" @click="start">
                {{ error ? 'Retry camera' : 'Start camera' }}
              </UButton>
            </div>
            <p
              v-else-if="faceError || guideHint === 'noFace'"
              class="absolute inset-x-0 bottom-4 text-center text-xs text-white"
            >
              {{ faceError ? `Face tracking error: ${faceError}` : 'Position your face in view' }}
            </p>
          </template>
        </VirtualTryOnExperience>
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
