<script setup lang="ts">
import type { TryOnModel } from '../composables/tryon/useTryOnModels'

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
          ?model=&lt;file&gt; · ?debug_tryon=true
        </p>
      </header>
      <VirtualTryOnPrototype
        :models="models"
        calibration-url="/models/calibration.json"
        @track="onTrack"
      />
    </div>
  </UApp>
</template>
