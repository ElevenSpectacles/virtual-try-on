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
import fixture from '../../tests/fixtures/tryon-pose/iris-moss.json'

const props = defineProps<{ shadow: boolean }>()

/** Stage width in CSS px; height follows the recorded aspect. */
const STAGE_WIDTH = 448
const stageHeight = STAGE_WIDTH / fixture.aspect

const occluderPositions = computed(() =>
  fixture.occluderPositions ? Float32Array.from(fixture.occluderPositions) : null
)

// Same ellipse as VirtualTryOnExperience: 55% of the face half-width across,
// 40% up and down, centred on the occluder.
const contactShadowColors = computed(() => {
  if (!props.shadow || !occluderPositions.value) return null
  const contact = bridgeContact(fixture.framePosition, fixture.rotation, fixture.scale)
  const shadow = contactShadowEllipse(contact, fixture.faceWorldHalfWidth)
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
    :style="{ width: `${STAGE_WIDTH}px`, height: `${stageHeight}px`, background: '#c9c9c9' }"
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
          :occluder-enabled="true"
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
