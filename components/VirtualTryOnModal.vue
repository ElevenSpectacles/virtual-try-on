<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import {
  getTryOnModel,
  type TryOnModel
} from '../composables/tryon/useTryOnModels'

const props = defineProps<{
  models: TryOnModel[]
  calibrationUrl: string
  modelBaseUrl?: string
  productModel?: string
}>()

const emit = defineEmits<{
  track: [event: string, payload: Record<string, unknown>]
}>()

const open = defineModel<boolean>('open')
const { t } = useI18n()

const isMobile = useMediaQuery('(max-width: 1023px)')

const step = ref<'privacy' | 'tryon'>('privacy')
const defaultModel =
  getTryOnModel(props.models, props.productModel)?.file ?? props.models[0]?.file

if (!defaultModel) {
  throw new Error('VirtualTryOnModal requires at least one model')
}

const selectedModel = ref<string>(defaultModel)

watch(open, (value) => {
  if (value) {
    step.value = 'privacy'
    selectedModel.value =
      getTryOnModel(props.models, props.productModel)?.file ?? defaultModel
  }
})

function onContinue() {
  step.value = 'tryon'
}

function onTrack(event: string, payload: Record<string, unknown>) {
  emit('track', event, payload)
}

const privacyItems = computed(() => [
  {
    icon: 'i-heroicons-trash',
    title: t('virtualTryOn.modal.privacy.noStorage.title'),
    body: t('virtualTryOn.modal.privacy.noStorage.body')
  },
  {
    icon: 'i-heroicons-computer-desktop',
    title: t('virtualTryOn.modal.privacy.localProcessing.title'),
    body: t('virtualTryOn.modal.privacy.localProcessing.body')
  },
  {
    icon: 'i-heroicons-user-plus',
    title: t('virtualTryOn.modal.privacy.noAccount.title'),
    body: t('virtualTryOn.modal.privacy.noAccount.body')
  },
  {
    icon: 'i-heroicons-shield-check',
    title: t('virtualTryOn.modal.privacy.youControl.title'),
    body: t('virtualTryOn.modal.privacy.youControl.body')
  }
])
</script>

<template>
  <UModal
    v-model:open="open"
    dismissible
    overlay
    :fullscreen="isMobile"
    :modal="isMobile"
    :ui="{
      content:
        'w-full lg:max-w-3xl rounded-xs overflow-hidden flex flex-col max-h-[95dvh] lg:max-h-[90dvh]'
    }"
  >
    <template #content>
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div
          class="flex items-center justify-between border-b border-stone-200 px-4 py-3 lg:px-6"
        >
          <h2
            class="text-xs font-semibold uppercase tracking-wide text-stone-950"
          >
            {{ t('virtualTryOn.modal.title') }}
          </h2>
          <UButton
            variant="ghost"
            icon="i-heroicons-x-mark"
            size="sm"
            color="neutral"
            :aria-label="t('virtualTryOn.modal.close')"
            @click="open = false"
          />
        </div>

        <!-- Privacy step -->
        <div
          v-if="step === 'privacy'"
          class="flex-1 overflow-y-auto px-4 py-8 lg:px-12 lg:py-12"
        >
          <div class="mx-auto max-w-md text-center">
            <UIcon
              name="i-heroicons-video-camera"
              class="mx-auto h-10 w-10 text-stone-950"
            />
            <h3
              class="mt-4 text-lg font-bold uppercase tracking-wide text-stone-950"
            >
              {{ t('virtualTryOn.modal.privacy.title') }}
            </h3>
            <p class="mt-3 text-xs font-light leading-5 text-stone-600">
              {{ t('virtualTryOn.modal.privacy.body') }}
            </p>

            <ul class="mt-8 space-y-4 text-left">
              <li
                v-for="item in privacyItems"
                :key="item.title"
                class="flex items-start gap-3"
              >
                <UIcon
                  :name="item.icon"
                  class="mt-0.5 h-5 w-5 shrink-0 text-stone-950"
                />
                <div>
                  <h4 class="text-xs font-semibold text-stone-950">
                    {{ item.title }}
                  </h4>
                  <p class="text-xs font-light text-stone-500">
                    {{ item.body }}
                  </p>
                </div>
              </li>
            </ul>

            <UButton
              color="neutral"
              variant="solid"
              size="lg"
              class="mt-8 uppercase tracking-widest text-xs font-medium"
              trailing-icon="i-heroicons-arrow-right"
              @click="onContinue"
            >
              {{ t('virtualTryOn.modal.privacy.cta') }}
            </UButton>

            <p class="mt-4 text-xs font-light text-stone-500">
              {{ t('virtualTryOn.modal.privacy.policy.before') }}
              <NuxtLinkLocale
                to="/resources/legal/privacy-policy"
                class="text-stone-950 underline hover:text-stone-700 transition-colors"
              >
                {{ t('virtualTryOn.modal.privacy.policy.link') }}
              </NuxtLinkLocale>
              {{ t('virtualTryOn.modal.privacy.policy.after') }}
            </p>
          </div>
        </div>

        <!-- Try-on step -->
        <div v-else class="flex flex-1 flex-col lg:flex-row overflow-hidden">
          <div class="flex-1 overflow-y-auto px-4 py-4 lg:px-8 lg:py-8">
            <ClientOnly>
              <VirtualTryOnExperience
                v-model:model="selectedModel"
                :models="models"
                :calibration-url="calibrationUrl"
                :model-base-url="modelBaseUrl"
                @track="onTrack"
              />
              <template #fallback>
                <div
                  class="flex flex-col items-center justify-center gap-4 py-20"
                >
                  <USkeleton class="aspect-3/4 w-full max-w-sm rounded-2xl" />
                  <p class="text-xs font-light text-stone-500">
                    {{ t('virtualTryOn.experience.fallback') }}
                  </p>
                </div>
              </template>
            </ClientOnly>
          </div>

          <div
            class="border-t border-stone-200 bg-stone-50 px-4 py-4 lg:w-72 lg:border-t-0 lg:border-l lg:px-6 lg:py-8 lg:overflow-y-auto"
          >
            <VirtualTryOnSuggestions
              v-model="selectedModel"
              :models="models"
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
