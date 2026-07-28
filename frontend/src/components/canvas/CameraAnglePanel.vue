<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildCameraAnglePrompt,
  getCameraAngleSpec,
  normalizeHorizontalAngle,
} from '../../utils/cameraAnglePrompt'
import { writeTextToClipboard } from '../../utils/clipboard'

const props = defineProps({
  open: { type: Boolean, default: false },
  sourceLayer: { type: Object, default: null },
  model: { type: String, default: 'banana2' },
  ratio: { type: String, default: 'auto' },
  resolution: { type: String, default: '2K' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'insert', 'generate'])

const horizontalAngle = ref(0)
const verticalAngle = ref(0)
const distance = ref(1)
const snapHorizontal = ref(false)
const preserveBackground = ref(true)
const additionalPrompt = ref('')
const copied = ref(false)
let copyTimer = null

const horizontalPresets = [
  { value: -180, label: '后' },
  { value: -135, label: '左后' },
  { value: -90, label: '左侧' },
  { value: -45, label: '左前' },
  { value: 0, label: '正面' },
  { value: 45, label: '右前' },
  { value: 90, label: '右侧' },
  { value: 135, label: '右后' },
  { value: 180, label: '后' },
]

const verticalPresets = [
  { value: -30, label: '仰拍' },
  { value: 0, label: '平视' },
  { value: 30, label: '俯拍' },
  { value: 60, label: '高俯' },
]

const distanceOptions = [
  { value: 0, label: '近景', icon: 'ri-zoom-in-line' },
  { value: 1, label: '中景', icon: 'ri-focus-3-line' },
  { value: 2, label: '远景', icon: 'ri-zoom-out-line' },
]

const spec = computed(() =>
  getCameraAngleSpec({
    horizontalAngle: horizontalAngle.value,
    verticalAngle: verticalAngle.value,
    distance: distance.value,
  }),
)

const prompt = computed(() =>
  buildCameraAnglePrompt({
    horizontalAngle: horizontalAngle.value,
    verticalAngle: verticalAngle.value,
    distance: distance.value,
    additionalPrompt: additionalPrompt.value,
    preserveBackground: preserveBackground.value,
  }),
)

const normalizedHorizontal = computed(() =>
  Math.round(normalizeHorizontalAngle(horizontalAngle.value) * 10) / 10,
)

const cameraMarkerStyle = computed(() => {
  const radians = (normalizedHorizontal.value * Math.PI) / 180
  return {
    left: `${50 + Math.sin(radians) * 38}%`,
    top: `${50 + Math.cos(radians) * 38}%`,
  }
})

const previewTransform = computed(() => {
  const horizontal = Math.max(-14, Math.min(14, horizontalAngle.value / 9))
  const vertical = Math.max(-10, Math.min(10, verticalAngle.value / 5))
  const scale = distance.value === 0 ? 1.12 : distance.value === 2 ? 0.82 : 0.96
  return `perspective(700px) rotateY(${horizontal}deg) rotateX(${-vertical}deg) scale(${scale})`
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    horizontalAngle.value = 0
    verticalAngle.value = 0
    distance.value = 1
    snapHorizontal.value = false
    preserveBackground.value = true
    additionalPrompt.value = ''
  },
)

function normalizeHorizontalInput(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  const clamped = Math.max(-180, Math.min(180, number))
  return snapHorizontal.value ? Math.round(clamped / 45) * 45 : Math.round(clamped)
}

function setHorizontal(value) {
  horizontalAngle.value = normalizeHorizontalInput(value)
}

function setVertical(value) {
  const number = Number(value)
  verticalAngle.value = Number.isFinite(number)
    ? Math.max(-30, Math.min(60, Math.round(number)))
    : 0
}

function payload() {
  return {
    prompt: prompt.value,
    displayText: `多角度视角转换：${spec.value.summary}`,
    params: {
      horizontalAngle: horizontalAngle.value,
      normalizedHorizontalAngle: normalizedHorizontal.value,
      verticalAngle: verticalAngle.value,
      distance: distance.value,
      horizontalView: spec.value.horizontal.name,
      verticalView: spec.value.vertical.name,
      distanceView: spec.value.distance.name,
    },
  }
}

async function copyPrompt() {
  try {
    await writeTextToClipboard(prompt.value)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

function handleKeydown(event) {
  if (props.open && event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  clearTimeout(copyTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cap-backdrop" @click.self="emit('close')">
      <section class="cap-panel" role="dialog" aria-modal="true" aria-label="多角度视角调整">
        <header class="cap-head">
          <div>
            <i class="ri-camera-lens-line" aria-hidden="true"></i>
            <span>
              <strong>多角度</strong>
              <small>精确设置相机位置并生成视角提示词</small>
            </span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" @click="emit('close')">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </header>

        <div class="cap-body">
          <section class="cap-preview">
            <div class="cap-image-stage">
              <img
                v-if="sourceLayer?.url"
                :src="sourceLayer.thumbnailUrl || sourceLayer.url"
                alt="当前参考图"
                :style="{ transform: previewTransform }"
              />
              <div v-else class="cap-image-empty">
                <i class="ri-image-line" aria-hidden="true"></i>
                <span>请选择图片图层</span>
              </div>
              <span class="cap-image-label">参考图1</span>
            </div>

            <div class="cap-camera-map" aria-label="相机水平位置预览">
              <span class="cap-map-axis cap-map-axis--front">正面 0°</span>
              <span class="cap-map-axis cap-map-axis--right">右侧 90°</span>
              <span class="cap-map-axis cap-map-axis--back">背面 180°</span>
              <span class="cap-map-axis cap-map-axis--left">左侧 270°</span>
              <div class="cap-map-orbit"></div>
              <div class="cap-map-subject">
                <i class="ri-box-3-line" aria-hidden="true"></i>
              </div>
              <div class="cap-map-camera" :style="cameraMarkerStyle">
                <i class="ri-camera-3-line" aria-hidden="true"></i>
              </div>
            </div>

            <div class="cap-summary">
              <strong>{{ spec.summary }}</strong>
              <span>
                归一化水平角 {{ normalizedHorizontal }}° · 原始输入
                {{ horizontalAngle > 0 ? '+' : '' }}{{ horizontalAngle }}°
              </span>
            </div>
          </section>

          <section class="cap-controls">
            <div class="cap-control-group">
              <div class="cap-control-head">
                <span>
                  <i class="ri-arrow-left-right-line" aria-hidden="true"></i>
                  水平旋转
                </span>
                <label class="cap-snap-toggle">
                  <input v-model="snapHorizontal" type="checkbox" />
                  <span>45°吸附</span>
                </label>
              </div>
              <div class="cap-range-row">
                <input
                  :value="horizontalAngle"
                  type="range"
                  min="-180"
                  max="180"
                  :step="snapHorizontal ? 45 : 1"
                  @input="setHorizontal($event.target.value)"
                />
                <label class="cap-number-input">
                  <input
                    :value="horizontalAngle"
                    type="number"
                    min="-180"
                    max="180"
                    step="1"
                    @input="setHorizontal($event.target.value)"
                  />
                  <span>°</span>
                </label>
              </div>
              <div class="cap-preset-strip cap-preset-strip--angles">
                <button
                  v-for="item in horizontalPresets"
                  :key="item.value"
                  type="button"
                  :class="{ active: horizontalAngle === item.value }"
                  :title="`${item.label} ${item.value}°`"
                  @click="setHorizontal(item.value)"
                >
                  <span>{{ item.label }}</span>
                  <small>{{ item.value > 0 ? '+' : '' }}{{ item.value }}°</small>
                </button>
              </div>
              <p>{{ spec.horizontal.direction }}，{{ spec.horizontal.composition }}。</p>
            </div>

            <div class="cap-control-group">
              <div class="cap-control-head">
                <span>
                  <i class="ri-arrow-up-down-line" aria-hidden="true"></i>
                  垂直倾斜
                </span>
                <b>{{ spec.vertical.name }}</b>
              </div>
              <div class="cap-range-row">
                <input
                  :value="verticalAngle"
                  type="range"
                  min="-30"
                  max="60"
                  step="1"
                  @input="setVertical($event.target.value)"
                />
                <label class="cap-number-input">
                  <input
                    :value="verticalAngle"
                    type="number"
                    min="-30"
                    max="60"
                    step="1"
                    @input="setVertical($event.target.value)"
                  />
                  <span>°</span>
                </label>
              </div>
              <div class="cap-preset-strip">
                <button
                  v-for="item in verticalPresets"
                  :key="item.value"
                  type="button"
                  :class="{ active: verticalAngle === item.value }"
                  @click="setVertical(item.value)"
                >
                  <span>{{ item.label }}</span>
                  <small>{{ item.value > 0 ? '+' : '' }}{{ item.value }}°</small>
                </button>
              </div>
              <p>{{ spec.vertical.instruction }}。</p>
            </div>

            <div class="cap-control-group">
              <div class="cap-control-head">
                <span>
                  <i class="ri-focus-mode" aria-hidden="true"></i>
                  拍摄距离
                </span>
                <b>distance {{ distance }}</b>
              </div>
              <div class="cap-distance-control" role="group" aria-label="拍摄距离">
                <button
                  v-for="item in distanceOptions"
                  :key="item.value"
                  type="button"
                  :class="{ active: distance === item.value }"
                  @click="distance = item.value"
                >
                  <i :class="item.icon" aria-hidden="true"></i>
                  <span>{{ item.label }}</span>
                  <small>{{ item.value }}</small>
                </button>
              </div>
              <p>{{ spec.distance.instruction }}。</p>
            </div>

            <div class="cap-options-row">
              <label class="cap-check">
                <input v-model="preserveBackground" type="checkbox" />
                <span>
                  <i class="ri-check-line" aria-hidden="true"></i>
                </span>
                保持场景风格与光线
              </label>
              <span>{{ model }} · {{ ratio }} · {{ resolution }}</span>
            </div>

            <label class="cap-extra">
              <span>附加要求</span>
              <textarea
                v-model="additionalPrompt"
                rows="2"
                placeholder="例如：使用纯白摄影棚背景，保持柔和左侧光..."
              ></textarea>
            </label>
          </section>
        </div>

        <section class="cap-prompt-preview">
          <header>
            <div>
              <strong>生成提示词</strong>
              <span>{{ prompt.length }} 字</span>
            </div>
            <button type="button" :title="copied ? '已复制' : '复制提示词'" @click="copyPrompt">
              <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'" aria-hidden="true"></i>
              {{ copied ? '已复制' : '复制' }}
            </button>
          </header>
          <textarea :value="prompt" readonly></textarea>
        </section>

        <footer class="cap-footer">
          <button type="button" class="cap-secondary" @click="emit('insert', payload())">
            <i class="ri-chat-upload-line" aria-hidden="true"></i>
            填入对话框
          </button>
          <button
            type="button"
            class="cap-primary"
            :disabled="busy || !sourceLayer?.url"
            @click="emit('generate', payload())"
          >
            <i class="ri-sparkling-2-line" aria-hidden="true"></i>
            {{ busy ? '生成中' : '按此角度生图' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cap-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 6, 10, 0.72);
  backdrop-filter: blur(4px);
}

.cap-panel {
  width: min(940px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  color: var(--canvas-text, #f4f4f5);
  border: 1px solid var(--canvas-border-strong, #555);
  border-radius: 8px;
  background: var(--canvas-panel, #151515);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.48);
}

.cap-head,
.cap-footer,
.cap-control-head,
.cap-options-row,
.cap-prompt-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cap-head {
  min-height: 62px;
  padding: 0 18px;
  border-bottom: 1px solid var(--canvas-border, #353535);
}

.cap-head > div {
  display: flex;
  align-items: center;
  gap: 11px;
}

.cap-head > div > i {
  color: var(--canvas-accent, #fff1a6);
  font-size: 22px;
}

.cap-head span {
  display: grid;
  gap: 3px;
}

.cap-head strong {
  font-size: 16px;
}

.cap-head small {
  color: var(--canvas-text-subtle, #898989);
  font-size: 11px;
}

.cap-head > button,
.cap-prompt-preview button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 34px;
  height: 34px;
  padding: 0 9px;
  color: var(--canvas-text-muted, #c3c3c3);
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background: var(--canvas-surface, #202020);
}

.cap-head > button {
  padding: 0;
  font-size: 20px;
}

.cap-body {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(430px, 1.35fr);
  min-height: 456px;
  min-width: 0;
}

.cap-preview {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  border-right: 1px solid var(--canvas-border, #353535);
  background: var(--canvas-surface-muted, #111);
}

.cap-image-stage {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background-color: #f4f4f3;
  background-image:
    linear-gradient(45deg, #e7e7e5 25%, transparent 25%),
    linear-gradient(-45deg, #e7e7e5 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e7e7e5 75%),
    linear-gradient(-45deg, transparent 75%, #e7e7e5 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
}

.cap-image-stage img {
  width: 84%;
  height: 84%;
  object-fit: contain;
  transition: transform 180ms ease;
}

.cap-image-label {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 3px 7px;
  color: #f8fafc;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.78);
  font-size: 10px;
  font-weight: 700;
}

.cap-image-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  color: #64748b;
}

.cap-image-empty i {
  font-size: 34px;
}

.cap-camera-map {
  position: relative;
  width: min(220px, 82%);
  aspect-ratio: 1;
  margin: 2px auto 0;
}

.cap-map-orbit {
  position: absolute;
  inset: 15%;
  border: 1px dashed var(--canvas-border-strong, #555);
  border-radius: 50%;
}

.cap-map-orbit::before,
.cap-map-orbit::after {
  position: absolute;
  content: '';
  background: var(--canvas-border, #353535);
}

.cap-map-orbit::before {
  top: 50%;
  left: -18%;
  width: 136%;
  height: 1px;
}

.cap-map-orbit::after {
  top: -18%;
  left: 50%;
  width: 1px;
  height: 136%;
}

.cap-map-subject,
.cap-map-camera {
  position: absolute;
  display: grid;
  place-items: center;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.cap-map-subject {
  top: 50%;
  left: 50%;
  z-index: 2;
  width: 44px;
  height: 44px;
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border-strong, #555);
  background: var(--canvas-panel, #151515);
  font-size: 22px;
}

.cap-map-camera {
  z-index: 3;
  width: 34px;
  height: 34px;
  color: #061015;
  background: var(--canvas-accent, #fff1a6);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--canvas-accent, #fff1a6) 18%, transparent);
  transition:
    left 160ms ease,
    top 160ms ease;
}

.cap-map-axis {
  position: absolute;
  z-index: 2;
  color: var(--canvas-text-subtle, #898989);
  font-size: 9px;
  white-space: nowrap;
}

.cap-map-axis--front {
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
}

.cap-map-axis--right {
  top: 50%;
  right: -4px;
  transform: translateY(-50%);
}

.cap-map-axis--back {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}

.cap-map-axis--left {
  top: 50%;
  left: -4px;
  transform: translateY(-50%);
}

.cap-summary {
  display: grid;
  gap: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--canvas-border, #353535);
}

.cap-summary strong {
  font-size: 13px;
}

.cap-summary span {
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.cap-controls {
  display: grid;
  align-content: start;
  gap: 0;
  min-width: 0;
  padding: 8px 20px;
}

.cap-control-group {
  min-width: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--canvas-border, #353535);
}

.cap-control-head {
  margin-bottom: 11px;
}

.cap-control-head > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
}

.cap-control-head i {
  color: var(--canvas-accent, #fff1a6);
  font-size: 15px;
}

.cap-control-head b {
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
  font-weight: 600;
}

.cap-snap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
}

.cap-snap-toggle input {
  accent-color: var(--canvas-accent, #fff1a6);
}

.cap-range-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  align-items: center;
  gap: 12px;
}

.cap-range-row > input {
  width: 100%;
  accent-color: var(--canvas-accent, #fff1a6);
}

.cap-number-input {
  display: grid;
  grid-template-columns: 1fr 20px;
  align-items: center;
  height: 32px;
  overflow: hidden;
  border: 1px solid var(--canvas-border-strong, #555);
  border-radius: 6px;
  background: var(--canvas-surface, #202020);
}

.cap-number-input input {
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0 2px 0 9px;
  color: var(--canvas-text, #fff);
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.cap-number-input span {
  color: var(--canvas-text-subtle, #898989);
  font-size: 11px;
}

.cap-preset-strip,
.cap-distance-control {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}

.cap-preset-strip {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.cap-preset-strip--angles {
  grid-template-columns: repeat(9, minmax(42px, 1fr));
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  padding-bottom: 2px;
}

.cap-preset-strip button,
.cap-distance-control button {
  display: grid;
  place-items: center;
  gap: 2px;
  min-height: 42px;
  padding: 4px;
  color: var(--canvas-text-muted, #c3c3c3);
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background: var(--canvas-surface, #202020);
}

.cap-preset-strip button:hover,
.cap-distance-control button:hover {
  border-color: var(--canvas-border-strong, #555);
  background: var(--canvas-surface-hover, #292929);
}

.cap-preset-strip button.active,
.cap-distance-control button.active {
  color: var(--canvas-text, #fff);
  border-color: var(--canvas-accent, #fff1a6);
  background: var(--canvas-accent-soft, rgba(255, 241, 166, 0.08));
}

.cap-preset-strip span,
.cap-distance-control span {
  font-size: 10px;
  white-space: nowrap;
}

.cap-preset-strip small,
.cap-distance-control small {
  color: var(--canvas-text-subtle, #898989);
  font-size: 8px;
  font-variant-numeric: tabular-nums;
}

.cap-control-group p {
  margin: 9px 0 0;
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
  line-height: 1.5;
}

.cap-distance-control {
  grid-template-columns: repeat(3, 1fr);
}

.cap-distance-control button {
  grid-template-columns: auto auto auto;
  align-content: center;
  min-height: 38px;
}

.cap-distance-control button i {
  font-size: 15px;
}

.cap-options-row {
  min-height: 50px;
  gap: 12px;
}

.cap-options-row > span {
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
}

.cap-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--canvas-text-muted, #c3c3c3);
  font-size: 11px;
}

.cap-check > input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.cap-check > span {
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  color: transparent;
  border: 1px solid var(--canvas-border-strong, #555);
  border-radius: 4px;
  background: var(--canvas-surface, #202020);
}

.cap-check input:checked + span {
  color: #061015;
  border-color: var(--canvas-accent, #fff1a6);
  background: var(--canvas-accent, #fff1a6);
}

.cap-extra {
  display: grid;
  gap: 6px;
}

.cap-extra > span {
  color: var(--canvas-text-muted, #c3c3c3);
  font-size: 11px;
  font-weight: 700;
}

.cap-extra textarea,
.cap-prompt-preview textarea {
  width: 100%;
  resize: none;
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  outline: 0;
  background: var(--canvas-surface-muted, #111);
  font-size: 11px;
  line-height: 1.55;
}

.cap-extra textarea {
  min-height: 54px;
  padding: 8px 10px;
}

.cap-extra textarea:focus {
  border-color: var(--canvas-accent, #fff1a6);
}

.cap-prompt-preview {
  margin: 0 18px;
  border-top: 1px solid var(--canvas-border, #353535);
}

.cap-prompt-preview > header {
  min-height: 46px;
}

.cap-prompt-preview > header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-prompt-preview strong {
  font-size: 12px;
}

.cap-prompt-preview span {
  color: var(--canvas-text-subtle, #898989);
  font-size: 9px;
}

.cap-prompt-preview button {
  height: 28px;
  font-size: 10px;
}

.cap-prompt-preview textarea {
  height: 104px;
  padding: 10px 12px;
  scrollbar-gutter: stable;
}

.cap-footer {
  gap: 10px;
  min-height: 68px;
  padding: 12px 18px;
}

.cap-footer button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
}

.cap-secondary {
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border-strong, #555);
  background: var(--canvas-surface, #202020);
}

.cap-primary {
  margin-left: auto;
  color: #151515;
  border: 1px solid var(--canvas-accent, #fff1a6);
  background: var(--canvas-accent, #fff1a6);
}

.cap-primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 760px) {
  .cap-backdrop {
    padding: 10px;
  }

  .cap-panel {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }

  .cap-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .cap-preview {
    grid-template-columns: minmax(150px, 0.8fr) minmax(180px, 1fr);
    border-right: 0;
    border-bottom: 1px solid var(--canvas-border, #353535);
  }

  .cap-camera-map {
    width: min(190px, 100%);
  }

  .cap-summary {
    grid-column: 1 / -1;
  }
}

@media (max-width: 520px) {
  .cap-head {
    padding: 0 12px;
  }

  .cap-head small {
    display: none;
  }

  .cap-preview {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px;
  }

  .cap-summary {
    grid-column: auto;
  }

  .cap-controls {
    padding: 8px 12px;
  }

  .cap-preset-strip--angles {
    display: flex;
    width: 100%;
  }

  .cap-preset-strip--angles button {
    flex: 0 0 48px;
  }

  .cap-prompt-preview {
    margin: 0 12px;
  }

  .cap-footer {
    padding: 10px 12px;
  }

  .cap-footer button {
    flex: 1;
    padding: 0 10px;
  }
}
</style>
