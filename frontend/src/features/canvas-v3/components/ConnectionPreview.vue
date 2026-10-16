<script setup>
import { computed } from 'vue'
import { getBezierPath } from '@vue-flow/core'
import EdgeFlowSegments from './EdgeFlowSegments.vue'

const props = defineProps({
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
})

const path = computed(
  () =>
    getBezierPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      targetX: props.targetX,
      targetY: props.targetY,
      sourcePosition: props.sourcePosition,
      targetPosition: props.targetPosition,
      curvature: 0.25,
    })[0],
)
</script>

<template>
  <g class="cv3-connection-preview" aria-hidden="true">
    <path :d="path" class="cv3-connection-base" />
    <EdgeFlowSegments :path="path" />
  </g>
</template>
