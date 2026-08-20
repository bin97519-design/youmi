<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCameraAngleSpec, normalizeHorizontalAngle } from '../../utils/cameraAnglePrompt'
import { writeTextToClipboard } from '../../utils/clipboard'

const props = defineProps({
  open: { type: Boolean, default: false },
  sourceLayer: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'generate'])
const UNIT_PRICE = 20

const controlMode = ref('subject')
const horizontalAngle = ref(0)
const verticalAngle = ref(0)
const distance = ref(1)
const outputFormat = ref('png')
const seed = ref(-1)
const additionalPrompt = ref('')
const generationShots = ref([])
const copied = ref(false)
let copyTimer = null
let shotSequence = 1

const distanceOptions = [
  { value: 0, label: '特写', icon: 'ri-zoom-in-line' },
  { value: 1, label: '标准', icon: 'ri-focus-3-line' },
  { value: 2, label: '远景', icon: 'ri-zoom-out-line' },
]

const outputFormats = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
]

const normalizedHorizontal = computed(() => Math.round(normalizeHorizontalAngle(horizontalAngle.value)))
const signedHorizontalAngle = computed(() => {
  const normalized = normalizedHorizontal.value
  return normalized > 180 ? normalized - 360 : normalized
})
const apiHorizontalAngle = computed(() =>
  controlMode.value === 'camera'
    ? normalizedHorizontal.value
    : Math.round(normalizeHorizontalAngle(360 - normalizedHorizontal.value)),
)
const batchCount = computed(() => generationShots.value.length)
const totalCost = computed(() => batchCount.value * UNIT_PRICE)
const distanceLabel = computed(
  () => distanceOptions.find((item) => item.value === distance.value)?.label || '标准',
)
const currentShotExists = computed(() =>
  generationShots.value.some(
    (shot) =>
      shot.horizontalAngle === apiHorizontalAngle.value &&
      shot.verticalAngle === verticalAngle.value &&
      shot.distance === distance.value,
  ),
)
const spec = computed(() =>
  getCameraAngleSpec({
    horizontalAngle: apiHorizontalAngle.value,
    verticalAngle: verticalAngle.value,
    distance: distance.value,
  }),
)

const cubeTransform = computed(() => {
  const horizontal = signedHorizontalAngle.value
  const vertical = Math.max(-21, Math.min(21, verticalAngle.value * 0.34))
  const scale = distance.value === 0 ? 1.08 : distance.value === 2 ? 0.84 : 0.96
  return `rotateX(${14 - vertical}deg) rotateY(${-30 + horizontal}deg) scale(${scale})`
})

const cameraPositionStyle = computed(() => {
  const radians = (signedHorizontalAngle.value * Math.PI) / 180
  const radius = distance.value === 0 ? 25 : distance.value === 2 ? 42 : 34
  const verticalOffset = (verticalAngle.value / 90) * 28
  const left = 50 + Math.sin(radians) * radius
  const top = 50 + Math.cos(radians) * radius - verticalOffset
  return {
    left: `${Math.max(9, Math.min(91, left))}%`,
    top: `${Math.max(9, Math.min(91, top))}%`,
  }
})

const requestPrompt = computed(() => {
  const extra = additionalPrompt.value.trim()
  const base = '保持主体身份、结构、材质、颜色和场景风格一致。'
  return extra ? `${base}${extra}` : base
})

const parameterText = computed(() => {
  return [
    'WaveSpeed Qwen 多角度',
    ...generationShots.value.map(
      (shot, index) =>
        `视角${index + 1}（${shot.mode === 'subject' ? '主体' : '摄像头'}）：水平 ${shot.horizontalAngle}°，垂直 ${shot.verticalAngle}°，距离 ${shot.distance}`,
    ),
    `格式：${outputFormat.value}`,
    `种子：${seed.value}`,
    additionalPrompt.value.trim() ? `附加要求：${additionalPrompt.value.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetControls()
  },
)

function resetControls() {
  controlMode.value = 'subject'
  horizontalAngle.value = 0
  verticalAngle.value = 0
  distance.value = 1
  outputFormat.value = 'png'
  seed.value = -1
  additionalPrompt.value = ''
  generationShots.value = []
  shotSequence = 1
}

function normalizeHorizontalInput(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(-180, Math.min(180, Math.round(number)))
}

function setHorizontal(value) {
  const next = normalizeHorizontalInput(value)
  horizontalAngle.value = next
}

function addCurrentShot() {
  if (currentShotExists.value) return
  generationShots.value.push({
    id: `angle-${shotSequence++}`,
    mode: controlMode.value,
    horizontalAngle: apiHorizontalAngle.value,
    verticalAngle: verticalAngle.value,
    distance: distance.value,
  })
}

function loadShot(shot) {
  controlMode.value = shot.mode || 'camera'
  const displayAngle =
    controlMode.value === 'subject'
      ? normalizeHorizontalAngle(360 - shot.horizontalAngle)
      : normalizeHorizontalAngle(shot.horizontalAngle)
  horizontalAngle.value = displayAngle > 180 ? displayAngle - 360 : displayAngle
  verticalAngle.value = shot.verticalAngle
  distance.value = shot.distance
}

function shotDisplayHorizontal(shot) {
  const normalized =
    shot.mode === 'subject'
      ? normalizeHorizontalAngle(360 - shot.horizontalAngle)
      : normalizeHorizontalAngle(shot.horizontalAngle)
  return normalized > 180 ? normalized - 360 : normalized
}

function removeShot(id) {
  generationShots.value = generationShots.value.filter((shot) => shot.id !== id)
}

function setVertical(value) {
  const number = Number(value)
  verticalAngle.value = Number.isFinite(number)
    ? Math.max(-30, Math.min(60, Math.round(number)))
    : 0
}

function payload() {
  const shots = generationShots.value.map(({ horizontalAngle, verticalAngle, distance }) => ({
    horizontalAngle,
    verticalAngle,
    distance,
  }))
  return {
    prompt: requestPrompt.value,
    displayText: `多角度批量生成：${shots
      .map((shot) => `${shot.horizontalAngle}°/${shot.verticalAngle}°/距离${shot.distance}`)
      .join('、')}`,
    params: {
      shots,
      seed: Number.isFinite(Number(seed.value)) ? Number(seed.value) : -1,
      outputFormat: outputFormat.value,
    },
  }
}

async function copyParameters() {
  try {
    await writeTextToClipboard(parameterText.value)
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
    <div
      class="cap-backdrop"
      :class="{ 'is-open': open }"
      :aria-hidden="!open"
      :inert="!open"
      @click.self="emit('close')"
    >
      <section class="cap-panel" role="dialog" aria-modal="true" aria-label="多角度视角调整">
        <header class="cap-head">
          <div>
            <i class="ri-camera-lens-line" aria-hidden="true"></i>
            <span>
              <strong>多角度</strong>
              <small>Qwen 多角度模型 · WaveSpeed</small>
            </span>
          </div>
          <button type="button" title="关闭" aria-label="关闭" @click="emit('close')">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </header>

        <div class="cap-body">
          <section class="cap-preview">
            <div class="cap-mode-switch" role="group" aria-label="视角控制方式">
              <button
                type="button"
                :class="{ active: controlMode === 'subject' }"
                @click="controlMode = 'subject'"
              >
                主体
              </button>
              <button
                type="button"
                :class="{ active: controlMode === 'camera' }"
                @click="controlMode = 'camera'"
              >
                摄像头
              </button>
            </div>
            <div
              v-if="controlMode === 'subject'"
              class="cap-cube-stage"
              aria-label="主体立方体视角预览"
            >
              <div class="cap-cube" :style="{ transform: cubeTransform }">
                <div class="cap-cube-face cap-cube-front">
                  <img
                    v-if="sourceLayer?.url"
                    :src="sourceLayer.thumbnailUrl || sourceLayer.url"
                    alt="当前参考图"
                  />
                  <i v-else class="ri-image-line" aria-hidden="true"></i>
                </div>
                <div class="cap-cube-face cap-cube-back" aria-hidden="true"></div>
                <div class="cap-cube-face cap-cube-right"><span>R</span></div>
                <div class="cap-cube-face cap-cube-left"><span>L</span></div>
                <div class="cap-cube-face cap-cube-top"><span>T</span></div>
                <div class="cap-cube-face cap-cube-bottom"><span>B</span></div>
              </div>
            </div>
            <div v-else class="cap-camera-stage" aria-label="摄像头轨道视角预览">
              <div class="cap-camera-sphere">
                <span class="cap-orbit-ring cap-orbit-ring--outer"></span>
                <span class="cap-orbit-ring cap-orbit-ring--horizontal"></span>
                <span class="cap-orbit-ring cap-orbit-ring--vertical"></span>
                <span class="cap-orbit-ring cap-orbit-ring--diagonal-a"></span>
                <span class="cap-orbit-ring cap-orbit-ring--diagonal-b"></span>
                <span class="cap-camera-axis cap-camera-axis--top">⌃</span>
                <span class="cap-camera-axis cap-camera-axis--right">›</span>
                <span class="cap-camera-axis cap-camera-axis--bottom">⌄</span>
                <span class="cap-camera-axis cap-camera-axis--left">‹</span>
                <div class="cap-camera-subject">
                  <img
                    v-if="sourceLayer?.url"
                    :src="sourceLayer.thumbnailUrl || sourceLayer.url"
                    alt="当前参考图"
                  />
                  <i v-else class="ri-image-line" aria-hidden="true"></i>
                </div>
                <div class="cap-camera-node" :style="cameraPositionStyle">
                  <i class="ri-camera-3-line" aria-hidden="true"></i>
                </div>
              </div>
            </div>

            <div class="cap-summary">
              <strong>{{ spec.summary }}</strong>
              <span>
                旋转 {{ signedHorizontalAngle }}° · 倾斜 {{ verticalAngle }}° · {{ distanceLabel }}
              </span>
            </div>
          </section>

          <section class="cap-controls">
            <section class="cap-dimension-card" aria-label="视角参数">
              <div class="cap-dimension-control">
                <div>
                  <span>{{ controlMode === 'camera' ? '旋转' : '主体旋转' }}</span>
                  <b>{{ signedHorizontalAngle }}°</b>
                </div>
                <input
                  :value="horizontalAngle"
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  aria-label="旋转角度"
                  @input="setHorizontal($event.target.value)"
                />
              </div>

              <div class="cap-dimension-control">
                <div>
                  <span>倾斜</span>
                  <b>{{ verticalAngle }}°</b>
                </div>
                <input
                  :value="verticalAngle"
                  type="range"
                  min="-30"
                  max="60"
                  step="1"
                  aria-label="倾斜角度"
                  @input="setVertical($event.target.value)"
                />
              </div>

              <div class="cap-dimension-control">
                <div>
                  <span>缩放</span>
                  <b>{{ distanceLabel }}</b>
                </div>
                <input
                  :value="distance"
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  aria-label="拍摄距离"
                  @input="distance = Number($event.target.value)"
                />
              </div>
            </section>

            <div class="cap-add-shot">
              <div>
                <span>当前视角</span>
                <strong>
                  旋转 {{ signedHorizontalAngle }}° · 倾斜 {{ verticalAngle }}° ·
                  {{ distanceLabel }}
                </strong>
                <small v-if="currentShotExists">这组参数已经在生成列表中</small>
                <small v-else>三个维度确认无误后，加入下方生成列表</small>
              </div>
              <button
                type="button"
                :disabled="currentShotExists"
                @click="addCurrentShot"
              >
                <i :class="currentShotExists ? 'ri-check-line' : 'ri-add-line'" aria-hidden="true"></i>
                {{ currentShotExists ? '已加入' : '加入生成列表' }}
              </button>
            </div>

            <section class="cap-generation-list" aria-label="角度生成列表">
              <header>
                <span>
                  <i class="ri-list-check-3" aria-hidden="true"></i>
                  生成列表
                </span>
                <b>{{ batchCount }} 张 · {{ totalCost }} 米值</b>
              </header>
              <div v-if="!generationShots.length" class="cap-generation-empty">
                调整上方角度后，点击“加入生成列表”
              </div>
              <ol v-else>
                <li v-for="(shot, index) in generationShots" :key="shot.id">
                  <button type="button" class="cap-shot-main" @click="loadShot(shot)">
                    <strong>视角 {{ index + 1 }}</strong>
                    <span>{{ shot.mode === 'subject' ? '主体' : '摄像头' }}</span>
                    <span>旋转 {{ shotDisplayHorizontal(shot) }}°</span>
                    <span>倾斜 {{ shot.verticalAngle }}°</span>
                    <span>{{ distanceOptions.find((item) => item.value === shot.distance)?.label }}</span>
                  </button>
                  <small>{{ UNIT_PRICE }} 米值</small>
                  <button
                    type="button"
                    class="cap-shot-remove"
                    title="从生成列表删除"
                    :aria-label="`删除视角 ${index + 1}`"
                    @click="removeShot(shot.id)"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                </li>
              </ol>
            </section>

            <div class="cap-output-grid">
              <div>
                <span>输出格式</span>
                <div class="cap-format-control">
                  <button
                    v-for="item in outputFormats"
                    :key="item.value"
                    type="button"
                    :class="{ active: outputFormat === item.value }"
                    @click="outputFormat = item.value"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>
              <label>
                <span>随机种子</span>
                <input v-model.number="seed" type="number" min="-1" step="1" />
                <small>-1 为随机</small>
              </label>
            </div>

            <label class="cap-extra">
              <span>附加提示（可选）</span>
              <textarea
                v-model="additionalPrompt"
                rows="2"
                placeholder="例如：保持纯白摄影棚背景与柔和左侧光"
              ></textarea>
            </label>
          </section>
        </div>

        <footer class="cap-footer">
          <div class="cap-price">
            <span>{{ batchCount }} 张 × {{ UNIT_PRICE }} 米值</span>
            <strong>共 {{ totalCost }} 米值</strong>
          </div>
          <button type="button" class="cap-secondary" @click="copyParameters">
            <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'" aria-hidden="true"></i>
            {{ copied ? '已复制' : '复制参数' }}
          </button>
          <button
            type="button"
            class="cap-primary"
            :disabled="busy || !sourceLayer?.url || !batchCount"
            @click="emit('generate', payload())"
          >
            <i class="ri-sparkling-2-line" aria-hidden="true"></i>
            {{ busy ? '提交中' : `生成 ${batchCount} 张` }}
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
  visibility: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateZ(0);
  will-change: opacity;
}

.cap-backdrop.is-open {
  visibility: visible;
  pointer-events: auto;
  opacity: 1;
}

:global([data-theme='light']) .cap-backdrop {
  background: rgba(15, 23, 42, 0.3);
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
  contain: layout paint;
  transform: translateZ(0);
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
  background: var(--canvas-input, #191a1f);
}

.cap-mode-switch,
.cap-format-control {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background: var(--canvas-surface, #202020);
}

.cap-mode-switch button,
.cap-format-control button {
  height: 30px;
  color: var(--canvas-text-muted, #c3c3c3);
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
}

.cap-mode-switch button.active,
.cap-format-control button.active {
  color: var(--canvas-text, #fff);
  background: var(--canvas-accent-soft, rgba(16, 195, 216, 0.16));
  box-shadow: inset 0 0 0 1px var(--canvas-accent, #10c3d8);
}

.cap-cube-stage {
  position: relative;
  display: grid;
  min-height: 280px;
  place-items: center;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  background: var(--canvas-surface, #2a2b31);
  perspective: 760px;
}

.cap-cube {
  position: relative;
  width: 104px;
  height: 104px;
  transform-style: preserve-3d;
  transition: transform 180ms ease;
}

.cap-cube-face {
  position: absolute;
  inset: 0;
  display: grid;
  overflow: hidden;
  place-items: center;
  color: var(--canvas-text-subtle, #858b96);
  border: 1.5px solid var(--canvas-border-strong, rgba(255, 255, 255, 0.18));
  border-radius: 4px;
  background: var(--canvas-panel, #222329);
  backface-visibility: hidden;
  font-size: 20px;
  font-weight: 500;
}

.cap-cube-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cap-cube-front {
  border-color: color-mix(in srgb, var(--canvas-text-subtle, #858b96) 55%, transparent);
  background: var(--canvas-panel, #222329);
}

.cap-cube-face:not(.cap-cube-front) {
  box-shadow: inset 0 0 28px color-mix(in srgb, var(--canvas-text-subtle, #858b96) 8%, transparent);
}

.cap-cube-front {
  transform: translateZ(52px);
}

.cap-cube-back {
  transform: rotateY(180deg) translateZ(52px);
}

.cap-cube-right {
  transform: rotateY(90deg) translateZ(52px);
}

.cap-cube-left {
  transform: rotateY(-90deg) translateZ(52px);
}

.cap-cube-top {
  transform: rotateX(90deg) translateZ(52px);
}

.cap-cube-bottom {
  transform: rotateX(-90deg) translateZ(52px);
}

.cap-cube-front i {
  color: var(--canvas-text-subtle, #858b96);
  font-size: 36px;
}

.cap-camera-stage {
  position: relative;
  display: grid;
  min-height: 280px;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background: var(--canvas-surface, #2a2b31);
}

.cap-camera-sphere {
  position: relative;
  width: min(230px, 82%);
  aspect-ratio: 1;
}

.cap-orbit-ring {
  position: absolute;
  inset: 10%;
  display: block;
  border: 1px solid color-mix(in srgb, var(--canvas-text-subtle, #898989) 22%, transparent);
  border-radius: 50%;
  pointer-events: none;
}

.cap-orbit-ring--outer {
  inset: 7%;
}

.cap-orbit-ring--horizontal {
  transform: rotateX(68deg);
}

.cap-orbit-ring--vertical {
  transform: rotateY(68deg);
}

.cap-orbit-ring--diagonal-a {
  transform: rotate(45deg) scaleX(0.42);
}

.cap-orbit-ring--diagonal-b {
  transform: rotate(-45deg) scaleX(0.42);
}

.cap-camera-subject,
.cap-camera-node {
  position: absolute;
  z-index: 3;
  display: grid;
  overflow: hidden;
  place-items: center;
  transform: translate(-50%, -50%);
}

.cap-camera-subject {
  top: 50%;
  left: 50%;
  width: 60px;
  height: 60px;
  color: var(--canvas-text-subtle, #898989);
  border: 1px solid color-mix(in srgb, var(--canvas-border-strong, #555555) 76%, transparent);
  border-radius: 5px;
  background: var(--canvas-panel, #151515);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.16);
}

.cap-camera-subject img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cap-camera-subject i {
  font-size: 24px;
}

.cap-camera-node {
  width: 38px;
  height: 30px;
  color: var(--canvas-accent, #10c3d8);
  border: 1px solid color-mix(in srgb, var(--canvas-accent, #10c3d8) 48%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--canvas-panel, #151515) 88%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--canvas-accent, #10c3d8) 10%, transparent);
  font-size: 18px;
  transition:
    left 160ms ease,
    top 160ms ease;
}

.cap-camera-axis {
  position: absolute;
  z-index: 4;
  color: var(--canvas-text-subtle, #898989);
  font-size: 13px;
  line-height: 1;
}

.cap-camera-axis--top {
  top: 1%;
  left: 50%;
  transform: translateX(-50%);
}

.cap-camera-axis--right {
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}

.cap-camera-axis--bottom {
  bottom: 1%;
  left: 50%;
  transform: translateX(-50%);
}

.cap-camera-axis--left {
  top: 50%;
  left: 0;
  transform: translateY(-50%);
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
  font-weight: 600;
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

.cap-dimension-card {
  display: grid;
  gap: 18px;
  padding: 18px 0;
  border-bottom: 1px solid var(--canvas-border, #353535);
}

.cap-dimension-control {
  display: grid;
  gap: 8px;
}

.cap-dimension-control > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cap-dimension-control span {
  color: var(--canvas-text, #fff);
  font-size: 12px;
  font-weight: 600;
}

.cap-dimension-control b {
  color: var(--canvas-text-subtle, #898989);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.cap-dimension-control input[type='range'] {
  width: 100%;
  height: 18px;
  margin: 0;
  accent-color: var(--canvas-accent, #10c3d8);
  cursor: pointer;
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
  font-weight: 600;
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
  grid-template-columns: repeat(8, minmax(46px, 1fr));
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

.cap-preset-strip button.current {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--canvas-accent, #10c3d8) 34%, transparent);
}

.cap-preset-strip--angles button > i {
  color: var(--canvas-accent, #10c3d8);
  font-size: 12px;
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

.cap-batch-note {
  margin-top: 9px;
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
  line-height: 1.5;
}

.cap-add-shot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 12px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--canvas-accent, #10c3d8) 34%, var(--canvas-border, #353535));
  border-radius: 6px;
  background: var(--canvas-accent-soft, rgba(16, 195, 216, 0.08));
}

.cap-add-shot > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.cap-add-shot span,
.cap-add-shot small {
  color: var(--canvas-text-subtle, #898989);
  font-size: 9px;
}

.cap-add-shot strong {
  overflow: hidden;
  color: var(--canvas-text, #fff);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-add-shot > button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 128px;
  height: 36px;
  padding: 0 13px;
  color: #061015;
  border: 1px solid var(--canvas-accent, #10c3d8);
  border-radius: 6px;
  background: var(--canvas-accent, #10c3d8);
  font-size: 11px;
  font-weight: 600;
}

.cap-add-shot > button:disabled {
  cursor: default;
  color: var(--canvas-text-subtle, #898989);
  border-color: var(--canvas-border, #353535);
  background: var(--canvas-surface, #202020);
}

.cap-generation-list {
  padding: 14px 0;
  border-bottom: 1px solid var(--canvas-border, #353535);
}

.cap-generation-list > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 9px;
}

.cap-generation-list > header span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--canvas-text, #fff);
  font-size: 13px;
  font-weight: 600;
}

.cap-generation-list > header i {
  color: var(--canvas-accent, #10c3d8);
  font-size: 15px;
}

.cap-generation-list > header b {
  color: var(--canvas-accent, #10c3d8);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.cap-generation-empty {
  display: grid;
  min-height: 48px;
  place-items: center;
  color: var(--canvas-text-subtle, #898989);
  border: 1px dashed var(--canvas-border-strong, #555);
  border-radius: 6px;
  background: var(--canvas-input, #191a1f);
  font-size: 10px;
}

.cap-generation-list ol {
  display: grid;
  gap: 6px;
  max-height: 168px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-gutter: stable;
}

.cap-generation-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 5px 4px 9px;
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  background: var(--canvas-surface, #202020);
}

.cap-shot-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 0;
  color: var(--canvas-text-muted, #c3c3c3);
  border: 0;
  background: transparent;
  text-align: left;
}

.cap-shot-main strong {
  flex: 0 0 auto;
  color: var(--canvas-text, #fff);
  font-size: 11px;
}

.cap-shot-main span {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap-generation-list li > small {
  color: var(--canvas-accent, #10c3d8);
  font-size: 9px;
  white-space: nowrap;
}

.cap-shot-remove {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  color: var(--canvas-text-subtle, #898989);
  border: 0;
  border-radius: 5px;
  background: transparent;
  font-size: 15px;
}

.cap-shot-remove:hover {
  color: #fb7185;
  background: rgba(244, 63, 94, 0.12);
}

.cap-distance-control {
  grid-template-columns: repeat(3, 1fr);
}

.cap-distance-control button {
  grid-template-columns: auto auto auto;
  align-content: center;
  min-height: 38px;
}

.cap-output-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 14px;
  padding: 14px 0;
}

.cap-output-grid > div,
.cap-output-grid > label {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
}

.cap-output-grid > div > span,
.cap-output-grid > label > span {
  color: var(--canvas-text-muted, #c3c3c3);
  font-size: 11px;
  font-weight: 600;
}

.cap-format-control {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.cap-output-grid input {
  min-width: 0;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  outline: 0;
  background: var(--canvas-input, #191a1f);
  font-size: 11px;
}

.cap-output-grid input:focus {
  border-color: var(--canvas-accent, #10c3d8);
}

.cap-output-grid small {
  color: var(--canvas-text-subtle, #898989);
  font-size: 9px;
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
  font-weight: 600;
}

.cap-extra textarea,
.cap-prompt-preview textarea {
  width: 100%;
  resize: none;
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border, #353535);
  border-radius: 6px;
  outline: 0;
  background: var(--canvas-input, #191a1f);
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

.cap-price {
  display: grid;
  gap: 2px;
  margin-right: auto;
}

.cap-price span {
  color: var(--canvas-text-subtle, #898989);
  font-size: 10px;
}

.cap-price strong {
  color: var(--canvas-accent, #10c3d8);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
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
  font-weight: 600;
}

.cap-secondary {
  color: var(--canvas-text, #fff);
  border: 1px solid var(--canvas-border-strong, #555);
  background: var(--canvas-surface, #202020);
}

.cap-primary {
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

  .cap-mode-switch {
    grid-column: 1 / -1;
  }

  .cap-cube-stage,
  .cap-camera-stage {
    min-height: 220px;
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

  .cap-mode-switch {
    grid-column: auto;
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

  .cap-add-shot {
    align-items: stretch;
    flex-direction: column;
  }

  .cap-add-shot > button {
    width: 100%;
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
