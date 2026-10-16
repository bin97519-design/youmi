<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import {
  ANGLE_PRESETS,
  anglePreset,
  changeCamera,
  angleShotLabel,
  normalizeCamera,
  anglePanelPlacement,
} from '../config/multiAngle'
import { angleScene, createAngleMotion } from '../config/angleMotion'
import { createMultiAngleOutput } from '../sync/multiAngleCommand'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useCanvasV3TaskStore } from '../stores/tasks'
import { imageMiCost } from '../../../utils/imageMiPricing'

const props = defineProps({
  node: { type: Object, required: true },
  target: { type: Object, default: null },
  anchor: { type: Object, required: true },
  viewport: { type: Object, required: true },
})
const emit = defineEmits(['close', 'created'])
const graph = useCanvasV3GraphStore(),
  tasks = useCanvasV3TaskStore()
const draft = ref(normalizeCamera(props.target?.data.editTemplate?.camera))
const presented = ref({ ...draft.value })
const scene = computed(() => angleScene(presented.value))
const panel = ref(null),
  submitting = ref(false),
  error = ref('')
const clipId = useId().replace(/:/g, '')
const placement = computed(() => anglePanelPlacement(props.anchor, props.viewport))
const model = computed(() => {
  const chosen = props.target?.data.model || props.node.data.model
  return tasks.imageModels.some((m) => m.value === chosen)
    ? chosen
    : tasks.imageModels[0]?.value || chosen
})
const modelLabel = computed(
  () => tasks.imageModels.find((m) => m.value === model.value)?.label || model.value,
)
const cost = computed(
  () =>
    imageMiCost(
      model.value,
      props.target?.data.params?.resolution || props.node.data.params?.resolution || '2K',
      1,
    ) || '—',
)
let motion,
  media,
  drag,
  previousFocus,
  alive = true

function selectPreset(id) {
  const next = anglePreset(id)
  if (!next || submitting.value) return
  draft.value = next
  motion?.to(next)
  error.value = ''
}
function update(patch, immediate = true) {
  draft.value = changeCamera(draft.value, patch)
  motion?.to(draft.value, immediate)
}
function reset() {
  selectPreset('custom')
}
function startOrbit(event) {
  if (event.button !== 0 || submitting.value) return
  event.preventDefault()
  const live = motion.current()
  draft.value = changeCamera(draft.value, live)
  motion.to(draft.value, true)
  drag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    camera: { ...draft.value },
    width: event.currentTarget.getBoundingClientRect().width,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function moveOrbit(event) {
  if (!drag || drag.pointerId !== event.pointerId) return
  update({
    horizontal: drag.camera.horizontal + ((event.clientX - drag.x) / drag.width) * 360,
    vertical: drag.camera.vertical - ((event.clientY - drag.y) / drag.width) * 180,
  })
}
function endOrbit(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag = null
  if (event.currentTarget.hasPointerCapture(event.pointerId))
    event.currentTarget.releasePointerCapture(event.pointerId)
}
function orbitKey(event) {
  const changes = {
    ArrowLeft: { horizontal: draft.value.horizontal - 45 },
    ArrowRight: { horizontal: draft.value.horizontal + 45 },
    ArrowUp: { vertical: draft.value.vertical + 30 },
    ArrowDown: { vertical: draft.value.vertical - 30 },
  }
  if (changes[event.key]) {
    event.preventDefault()
    update(changes[event.key], false)
  }
}
async function generate() {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await tasks.loadModels()
    if (!alive) return
    if (!tasks.imageModels.some((m) => m.value === model.value))
      throw new Error(tasks.modelError || '当前项目尚未配置图片编辑模型')
    const result = createMultiAngleOutput(graph, props.node.id, draft.value, {
      model: model.value,
      targetId: props.target?.id,
    })
    // The shared task engine locks synchronously before configuration/upload and
    // retains uncertain task IDs; this is the only path that may submit a POST.
    void tasks.runImage(result.id)
    emit('created', result)
    emit('close')
  } catch (failure) {
    if (alive) {
      error.value = failure.message
      submitting.value = false
    }
  }
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const controls = [
    ...panel.value.querySelectorAll(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ),
  ].filter((e) => e.getClientRects().length)
  const index = controls.indexOf(document.activeElement)
  if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === controls.length - 1)) {
    event.preventDefault()
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus()
  }
}
function reducedChange() {
  if (media.matches) motion.to(draft.value, true)
}
const fields = [
  { key: 'horizontal', label: '水平环绕', min: 0, max: 360, origin: 0 },
  { key: 'vertical', label: '垂直俯仰', min: -90, max: 90, origin: 0 },
  { key: 'distance', label: '景别缩放', min: 0, max: 10, origin: 5 },
]
function rangeStyle(field) {
  const percent = (value) => ((value - field.min) / (field.max - field.min)) * 100
  const a = percent(field.origin),
    b = percent(draft.value[field.key])
  return { '--range-start': Math.min(a, b) + '%', '--range-end': Math.max(a, b) + '%' }
}
onMounted(() => {
  previousFocus = document.activeElement
  media = matchMedia('(prefers-reduced-motion: reduce)')
  motion = createAngleMotion({
    initial: draft.value,
    render: (value) => {
      presented.value = value
    },
    requestFrame: requestAnimationFrame,
    cancelFrame: cancelAnimationFrame,
    reducedMotion: () => media.matches,
  })
  media.addEventListener('change', reducedChange)
  panel.value?.querySelector('button')?.focus({ preventScroll: true })
  void tasks.loadModels()
})
onBeforeUnmount(() => {
  alive = false
  motion?.dispose()
  media?.removeEventListener('change', reducedChange)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <section
    ref="panel"
    class="cv3-angle-editor nodrag nowheel"
    role="dialog"
    aria-label="多角度编辑器"
    :style="{
      left: placement.left + 'px',
      top: placement.top + 'px',
      width: placement.width + 'px',
      maxHeight: placement.maxHeight + 'px',
    }"
    @pointerdown.stop
    @click.stop
    @wheel.stop
    @keydown.stop="keydown"
  >
    <header class="cv3-angle-header">
      <strong>多角度编辑器</strong>
      <button type="button" aria-label="关闭多角度编辑器" @click="emit('close')">
        <CanvasIcon name="close" :size="20" />
      </button>
    </header>
    <div class="cv3-angle-presets" role="group" aria-label="视角预设">
      <button
        v-for="preset in ANGLE_PRESETS"
        :key="preset.id"
        type="button"
        :class="{ selected: draft.presetId === preset.id }"
        :aria-pressed="draft.presetId === preset.id"
        :disabled="submitting"
        @click="selectPreset(preset.id)"
      >
        {{ preset.label }}
      </button>
    </div>
    <div class="cv3-angle-body">
      <div class="cv3-angle-space">
        <svg
          class="cv3-angle-orbit"
          viewBox="0 0 240 240"
          tabindex="0"
          role="group"
          aria-label="机位空间预览，拖动或使用方向键调整"
          :data-horizontal="presented.horizontal"
          :data-vertical="presented.vertical"
          @pointerdown="startOrbit"
          @pointermove="moveOrbit"
          @pointerup="endOrbit"
          @pointercancel="endOrbit"
          @lostpointercapture="drag = null"
          @keydown="orbitKey"
        >
          <defs>
            <clipPath :id="clipId">
              <rect
                :x="120 - scene.photoSize / 2"
                :y="120 - scene.photoSize / 2"
                :width="scene.photoSize"
                :height="scene.photoSize"
                rx="3"
              />
            </clipPath>
          </defs>
          <g fill="none" stroke="#979797" stroke-width="0.65" opacity="0.43">
            <path v-for="(line, i) in scene.lines" :key="i" :d="line" />
            <circle cx="120" cy="120" r="76" />
          </g>
          <image
            :href="node.data.assetUrl"
            :x="120 - scene.photoSize / 2"
            :y="120 - scene.photoSize / 2"
            :width="scene.photoSize"
            :height="scene.photoSize"
            preserveAspectRatio="xMidYMid meet"
            :clip-path="`url(#${clipId})`"
          />
          <path
            :d="`M120,120 L${scene.camera.x},${scene.camera.y}`"
            stroke="#d7d3bb"
            stroke-width="0.9"
            opacity="0.65"
          />
          <g
            :transform="`translate(${scene.camera.x},${scene.camera.y}) rotate(${scene.camera.angle})`"
            stroke="#8d8d8d"
            stroke-width="0.8"
            stroke-linejoin="round"
          >
            <path d="M-10,-8 L3,-8 L10,-4 L10,8 L-3,8 L-10,4 Z" fill="#171717" />
            <path d="M-10,-8 L-3,-4 L10,-4 M-3,-4 V8 M3,-8 V-2" fill="none" />
            <rect x="0" y="-1" width="5" height="6" rx="1" fill="#262626" />
            <circle cx="2.5" cy="2" r="1.5" fill="#111" />
          </g>
        </svg>
        <button
          type="button"
          class="cv3-angle-direction is-up"
          aria-label="机位向上"
          :disabled="submitting"
          @click="update({ vertical: draft.vertical + 30 }, false)"
        >
          <CanvasIcon name="chevron" :size="12" />
        </button>
        <button
          type="button"
          class="cv3-angle-direction is-down"
          aria-label="机位向下"
          :disabled="submitting"
          @click="update({ vertical: draft.vertical - 30 }, false)"
        >
          <CanvasIcon name="chevron" :size="12" />
        </button>
        <button
          type="button"
          class="cv3-angle-direction is-left"
          aria-label="机位向左"
          :disabled="submitting"
          @click="update({ horizontal: draft.horizontal - 45 }, false)"
        >
          <CanvasIcon name="chevron" :size="12" />
        </button>
        <button
          type="button"
          class="cv3-angle-direction is-right"
          aria-label="机位向右"
          :disabled="submitting"
          @click="update({ horizontal: draft.horizontal + 45 }, false)"
        >
          <CanvasIcon name="chevron" :size="12" />
        </button>
      </div>
      <div class="cv3-angle-controls">
        <label v-for="field in fields" :key="field.key" class="cv3-angle-field">
          <span>{{ field.label }}</span>
          <input
            type="range"
            :aria-label="field.label"
            :min="field.min"
            :max="field.max"
            step="1"
            :value="draft[field.key]"
            :disabled="submitting"
            :style="rangeStyle(field)"
            @input="update({ [field.key]: Number($event.target.value) })"
          />
          <output>
            {{
              field.key === 'distance'
                ? angleShotLabel(draft.distance)
                : Math.round(draft[field.key]) + '°'
            }}
          </output>
        </label>
        <div class="cv3-angle-prompt-toggle">
          <span id="cv3-angle-prompt-label">提示词</span>
          <button
            type="button"
            role="switch"
            aria-labelledby="cv3-angle-prompt-label"
            :aria-checked="draft.promptEnabled"
            :disabled="submitting"
            @click="draft.promptEnabled = !draft.promptEnabled"
          >
            <i />
          </button>
        </div>
        <textarea
          v-if="draft.promptEnabled"
          v-model="draft.prompt"
          class="cv3-angle-prompt"
          placeholder="输入提示词…"
          aria-label="镜头补充提示词"
          maxlength="4000"
          :disabled="submitting"
        />
      </div>
    </div>
    <footer class="cv3-angle-footer">
      <button type="button" class="cv3-angle-reset" :disabled="submitting" @click="reset">
        <CanvasIcon name="reset" :size="16" />
        重置参数
      </button>
      <span class="cv3-angle-cost" :title="`当前模型：${modelLabel}；预计积分，实际以任务返回为准`">
        <CanvasIcon name="power" :size="13" />
        {{ cost }}
      </span>
      <button
        type="button"
        class="cv3-angle-generate"
        :aria-busy="submitting"
        aria-label="生成多角度图片"
        :title="`使用 ${modelLabel} 生成新视角`"
        :disabled="submitting"
        @click="generate"
      >
        <span v-if="submitting" class="cv3-loading-spinner" />
        <CanvasIcon v-else name="arrowUp" :size="22" />
      </button>
    </footer>
    <p v-if="error" class="cv3-angle-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.cv3-angle-editor {
  position: absolute;
  z-index: 110;
  padding: 16px 16px 6px;
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  background: #272727;
  color: #efefef;
  font-size: 12px;
  overflow: auto;
  box-shadow: 0 4px 16px #00000014;
}
.cv3-angle-header {
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cv3-angle-header strong {
  font-size: 13px;
  font-weight: 600;
  line-height: 16px;
}
.cv3-angle-header button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: #929292;
}
.cv3-angle-header button:hover {
  color: white;
}
.cv3-angle-presets {
  display: grid;
  grid-template-columns: 62px repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.cv3-angle-presets button {
  height: 30px;
  padding: 0 6px;
  border: 1px solid #383838;
  border-radius: 6px;
  background: transparent;
  color: #929292;
  white-space: nowrap;
  font-size: 12px;
}
.cv3-angle-presets button.selected {
  border-color: #454545;
  background: #454545;
  color: #f3f3f3;
  font-weight: 600;
}
.cv3-angle-presets button:hover {
  background: #3c3c3c;
  color: #eee;
}
.cv3-angle-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
  margin-top: 12px;
}
.cv3-angle-space {
  position: relative;
  height: 240px;
  border-radius: 12px;
  background: #363636;
  overflow: hidden;
}
.cv3-angle-orbit {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.cv3-angle-orbit:active {
  cursor: grabbing;
}
.cv3-angle-direction {
  position: absolute;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #999;
  border-radius: 4px;
}
.cv3-angle-direction:hover {
  color: #eee;
  background: #ffffff0b;
}
.is-up {
  left: calc(50% - 12px);
  top: 12px;
  transform: rotate(180deg);
}
.is-down {
  left: calc(50% - 12px);
  bottom: 12px;
}
.is-left {
  top: calc(50% - 12px);
  left: 12px;
  transform: rotate(90deg);
}
.is-right {
  top: calc(50% - 12px);
  right: 12px;
  transform: rotate(-90deg);
}
.cv3-angle-controls {
  min-width: 0;
}
.cv3-angle-field {
  display: grid;
  grid-template-columns: 66px minmax(40px, 1fr) 40px;
  gap: 10px;
  align-items: center;
  height: 40px;
  color: #919191;
}
.cv3-angle-field output {
  color: #eee;
  text-align: right;
  font-size: 12px;
}
.cv3-angle-field input {
  appearance: none;
  -webkit-appearance: none;
  min-width: 0;
  width: 100%;
  height: 4px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    #858993 0 var(--range-start),
    #24bdd7 var(--range-start) var(--range-end),
    #858993 var(--range-end) 100%
  );
  cursor: pointer;
}
.cv3-angle-field input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 0;
  background: white;
}
.cv3-angle-field input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 0;
  background: white;
}
.cv3-angle-prompt-toggle {
  display: flex;
  gap: 14px;
  height: 40px;
  align-items: center;
  color: #919191;
}
.cv3-angle-prompt-toggle button {
  width: 24px;
  height: 14px;
  border: 0;
  padding: 2px;
  border-radius: 20px;
  background: #555;
}
.cv3-angle-prompt-toggle button i {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #222;
}
.cv3-angle-prompt-toggle button[aria-checked='true'] {
  background: #eee;
}
.cv3-angle-prompt-toggle button[aria-checked='true'] i {
  transform: translateX(10px);
}
.cv3-angle-prompt {
  display: block;
  width: 100%;
  height: 80px;
  padding: 10px 12px;
  resize: none;
  border: 1px solid #393939;
  border-radius: 10px;
  outline: none;
  background: transparent;
  color: #eee;
  line-height: 20px;
  font-size: 12px;
}
.cv3-angle-prompt::placeholder {
  color: #777;
}
.cv3-angle-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  margin-top: 16px;
}
.cv3-angle-reset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  margin-left: -10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #929292;
}
.cv3-angle-reset:hover {
  color: white;
  background: #3c3c3c;
}
.cv3-angle-cost {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  color: #929292;
}
.cv3-angle-generate {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  padding: 0;
  background: #fff;
  color: #202020;
}
.cv3-angle-generate:active {
  background: #ddd;
}
.cv3-angle-generate:disabled {
  background: #aaa;
}
.cv3-angle-error {
  margin: 8px 0 0;
  color: #e8b96c;
  font-size: 12px;
}
@media (max-width: 560px) {
  .cv3-angle-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cv3-angle-body {
    grid-template-columns: 1fr;
  }
  .cv3-angle-space {
    width: 240px;
    margin: auto;
  }
}
</style>
