<script setup lang="ts">
import {
  getTryOnModelFamilies,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'

const props = defineProps<{
  models: TryOnModel[]
}>()

const selectedModel = defineModel<string>({ required: true })

const families = computed(() => getTryOnModelFamilies(props.models))

function selectModel(model: TryOnModel) {
  selectedModel.value = model.file
}
</script>

<template>
  <div
    class="flex flex-col gap-5"
    role="region"
    :aria-label="$t('virtualTryOn.suggestions.ariaLabel')"
  >
    <h3 class="text-xs font-semibold uppercase tracking-wide text-stone-950">
      {{ $t('virtualTryOn.suggestions.title') }}
    </h3>

    <div class="flex flex-col gap-4">
      <div
        v-for="family in families"
        :key="family.family"
        class="flex flex-col gap-2"
      >
        <span
          class="text-xs font-medium text-stone-500 uppercase tracking-wide"
        >
          {{ family.displayName }}
        </span>

        <div class="flex flex-wrap gap-2">
          <button
            v-for="model in family.models"
            :key="model.file"
            type="button"
            class="group relative h-14 w-14 shrink-0 overflow-hidden rounded-sm border bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-950"
            :class="
              selectedModel === model.file
                ? 'border-stone-950 ring-1 ring-stone-950'
                : 'border-stone-200 hover:border-stone-400'
            "
            :aria-label="model.label"
            :aria-pressed="selectedModel === model.file"
            @click="selectModel(model)"
          >
            <span class="flex h-full w-full items-center justify-center">
              <span
                class="inline-block h-5 w-5 rounded-full border border-stone-200"
                :class="model.colorClass"
                aria-hidden="true"
              />
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
