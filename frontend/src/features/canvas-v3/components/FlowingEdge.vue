<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import { useCanvasV3GraphStore } from '../stores/graph'
import CanvasIcon from './CanvasIcon.vue'
import EdgeFlowSegments from './EdgeFlowSegments.vue'

const props = defineProps({
  id: { type: String, required: true },
  source: { type: String, required: true },
  target: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  selected: Boolean,
})
const graph = useCanvasV3GraphStore()
const edgePath = ref(null)
const hovered = ref(false)
const cutVisible = ref(false)
const cutPoint = ref(null)
let hideTimer
let revealTimer
let moveFrame
let pendingPointer
let lastPointer
const pathInfo = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    curvature: 0.25,
  }),
)
const path = computed(() => pathInfo.value[0])
const labelX = computed(() => pathInfo.value[1])
const labelY = computed(() => pathInfo.value[2])
const endpointSelected = computed(() =>
  graph.nodes.some(
    (node) => (node.id === props.source || node.id === props.target) && node.selected,
  ),
)
const flowing = computed(() => hovered.value || props.selected || endpointSelected.value)
const emphasized = computed(() => hovered.value || endpointSelected.value)
const cutX = computed(() => cutPoint.value?.x ?? labelX.value)
const cutY = computed(() => cutPoint.value?.y ?? labelY.value)

function nearestPointOnPath(pathElement, target) {
  const total = pathElement.getTotalLength()
  let bestLength = 0
  let bestDistance = Number.POSITIVE_INFINITY
  const samples = 48
  for (let index = 0; index <= samples; index += 1) {
    const length = (total * index) / samples
    const point = pathElement.getPointAtLength(length)
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestLength = length
    }
  }
  let radius = total / samples
  for (let pass = 0; pass < 4; pass += 1) {
    const start = Math.max(0, bestLength - radius)
    const end = Math.min(total, bestLength + radius)
    for (let index = 0; index <= 8; index += 1) {
      const length = start + ((end - start) * index) / 8
      const point = pathElement.getPointAtLength(length)
      const distance = Math.hypot(point.x - target.x, point.y - target.y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestLength = length
      }
    }
    radius /= 4
  }
  return pathElement.getPointAtLength(bestLength)
}

function trackCut(event, force = false) {
  const pathElement = edgePath.value
  const matrix = pathElement?.getScreenCTM?.()
  if (!pathElement || !matrix) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  if (!force && lastPointer && Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y) < 10)
    return
  lastPointer = point
  pendingPointer = point
  if (moveFrame) return
  moveFrame = requestAnimationFrame(() => {
    if (edgePath.value && pendingPointer) {
      const nearest = nearestPointOnPath(edgePath.value, pendingPointer)
      cutPoint.value = { x: nearest.x, y: nearest.y }
    }
    moveFrame = 0
  })
}

function scheduleCut() {
  if (cutVisible.value || revealTimer) return
  revealTimer = setTimeout(() => {
    cutVisible.value = hovered.value
    revealTimer = undefined
  }, 1000)
}

function enterEdge(event) {
  clearTimeout(hideTimer)
  hovered.value = true
  trackCut(event, true)
  scheduleCut()
}
function enterCut() {
  clearTimeout(hideTimer)
  hovered.value = true
}
function hideCut() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hovered.value = false
    cutVisible.value = false
    clearTimeout(revealTimer)
    revealTimer = undefined
    lastPointer = undefined
  }, 120)
}
function remove() {
  graph.removeEdge(props.id)
}
onBeforeUnmount(() => {
  clearTimeout(hideTimer)
  clearTimeout(revealTimer)
  cancelAnimationFrame(moveFrame)
})
</script>

<template>
  <path
    :d="path"
    class="vue-flow__edge-interaction cv3-edge-hitbox"
    @pointerenter="enterEdge"
    @pointermove="trackCut"
    @pointerleave="hideCut"
  />
  <path
    ref="edgePath"
    :d="path"
    class="vue-flow__edge-path cv3-edge-base"
    :class="{ 'is-emphasized': emphasized, 'is-selected': selected }"
    @pointerenter="enterEdge"
    @pointermove="trackCut"
    @pointerleave="hideCut"
  />
  <EdgeFlowSegments v-if="flowing" :path="path" :edge-id="id" />
  <EdgeLabelRenderer>
    <Transition name="cv3-scissors">
      <button
        v-if="cutVisible"
        type="button"
        class="cv3-edge-cut nodrag nopan"
        :style="{
          transform: `translate(-50%, -50%) translate(${cutX}px, ${cutY}px)`,
        }"
        aria-label="删除连线"
        title="删除连线"
        @pointerenter="enterCut"
        @pointerleave="hideCut"
        @pointerdown.stop
        @click.stop="remove"
      >
        <CanvasIcon name="scissors" :size="28" />
      </button>
    </Transition>
  </EdgeLabelRenderer>
</template>
