<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import EmotionMoodControl from './EmotionMoodControl.vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useCanvasV3TaskStore } from '../stores/tasks'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { imageMiCost } from '../../../utils/imageMiPricing'
import { imageEditPreset } from '../config/imageEditPresets'
import { boxFromDrag, emotionAt, validFaceBox } from '../config/portraitEmotion'
import { detectFaces } from '../sync/faceDetectionClient'

const props = defineProps({
  node: { type: Object, required: true },
  target: { type: Object, default: null },
})
const emit = defineEmits(['close', 'created'])
const graph = useCanvasV3GraphStore()
const tasks = useCanvasV3TaskStore()
const user = useUserStore()
const phase = ref('detecting')
const faces = ref([])
const roles = ref(
  JSON.parse(JSON.stringify(props.target?.data.editTemplate?.roles || [])).filter((r) =>
    validFaceBox(r.box),
  ),
)
const active = ref(roles.value[0]?.id || '')
const error = ref('')
const manual = ref(false)
const dragStart = ref(null)
const draftBox = ref(null)
const picture = ref(null)
const panel = ref(null)
const choices = ref('')
const resolution = ref(props.target?.data.params?.resolution || '2K')
const count = ref(props.target?.data.params?.count || '1张')
const current = computed(() => roles.value.find((r) => r.id === active.value))
const mood = computed(() => emotionAt(current.value?.x ?? 50, current.value?.y ?? 50))
const cost = computed(
  () => imageMiCost(props.node.data.model, resolution.value, parseInt(count.value)) || '—',
)
let controller
let sequence = 0
let previousFocus

async function identify() {
  controller?.abort()
  controller = new AbortController()
  const ticket = ++sequence
  phase.value = 'detecting'
  manual.value = false
  error.value = ''
  faces.value = []
  try {
    const result = await detectFaces(props.node.data.assetUrl, {
      path: apiPath,
      headers: user.authHeaders(),
      signal: controller.signal,
    })
    if (ticket !== sequence) return
    faces.value = result
    phase.value = 'choosing'
    if (!result.length) error.value = '未识别到可用面部，请手动框选面部区域，或更换清晰图片后重试'
  } catch (failure) {
    if (ticket !== sequence || failure.name === 'AbortError') return
    phase.value = 'choosing'
    error.value = failure.message
  }
}
function chooseFace(box) {
  if (!validFaceBox(box)) return
  const existing = roles.value.find((r) => r.box.every((n, i) => Math.abs(n - box[i]) < 0.015))
  if (existing) active.value = existing.id
  else {
    const role = { id: crypto.randomUUID(), box: [...box], x: 50, y: 50 }
    roles.value.push(role)
    active.value = role.id
  }
  manual.value = false
  phase.value = 'editing'
  error.value = ''
}
function pointInPicture(event) {
  const r = picture.value.getBoundingClientRect()
  return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height }
}
function startFace(event) {
  if (!manual.value || event.button !== 0) return
  event.preventDefault()
  dragStart.value = pointInPicture(event)
  draftBox.value = null
  event.currentTarget.setPointerCapture(event.pointerId)
}
function moveFace(event) {
  if (dragStart.value) draftBox.value = boxFromDrag(dragStart.value, pointInPicture(event))
}
function endFace(event) {
  if (!dragStart.value) return
  const box = boxFromDrag(dragStart.value, pointInPicture(event))
  dragStart.value = null
  draftBox.value = null
  if (box) chooseFace(box)
  else error.value = '框选范围过小，请沿面部边缘重新拖动框选'
}
function cancelFace() {
  dragStart.value = null
  draftBox.value = null
}
function boxStyle(box) {
  return {
    left: box[0] * 100 + '%',
    top: box[1] * 100 + '%',
    width: (box[2] - box[0]) * 100 + '%',
    height: (box[3] - box[1]) * 100 + '%',
  }
}
function cropStyle(box) {
  const w = box[2] - box[0],
    h = box[3] - box[1]
  return {
    width: 100 / w + '%',
    height: 100 / h + '%',
    left: (-box[0] * 100) / w + '%',
    top: (-box[1] * 100) / h + '%',
  }
}
function selectMood(x, y) {
  if (!current.value) return
  Object.assign(current.value, { x: emotionAt(x, y).x, y: emotionAt(x, y).y })
}
function removeRole(id) {
  roles.value = roles.value.filter((r) => r.id !== id)
  if (active.value === id) active.value = roles.value[0]?.id || ''
  if (!roles.value.length) phase.value = 'choosing'
}
function addRole() {
  manual.value = true
  choices.value = ''
  phase.value = 'choosing'
}
function toggleManual() {
  if (phase.value === 'detecting') {
    sequence++
    controller?.abort()
    phase.value = 'choosing'
  }
  manual.value = !manual.value
  error.value = ''
}
function chooseOutput(kind, value) {
  if (kind === 'resolution') resolution.value = value
  else count.value = value
  choices.value = ''
}
function generate() {
  if (!current.value || !roles.value.every((r) => validFaceBox(r.box))) return
  const preset = imageEditPreset('portrait-emotion')
  preset.editTemplate.roles = JSON.parse(JSON.stringify(roles.value))
  preset.params = { ...props.node.data.params, resolution: resolution.value, count: count.value }
  let node = props.target
  if (node) {
    graph.remember()
    graph.updateNodeData(node.id, {
      editTemplate: { ...preset.editTemplate, sourceNodeId: props.node.id },
      params: preset.params,
    })
  } else node = graph.createImageVariation(props.node.id, preset)
  if (!node) return
  emit('created', node)
  // runImage enters its busy state synchronously; never auto-submit during detection/selection.
  void tasks.runImage(node.id)
  emit('close')
}
function closeOutside(event) {
  if (choices.value && !event.target.closest?.('.cv3-emotion-select')) choices.value = ''
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (choices.value) choices.value = ''
    else if (phase.value !== 'editing' && roles.value.length) {
      phase.value = 'editing'
      manual.value = false
    } else emit('close')
  }
  if (event.key !== 'Tab') return
  const items = [
    ...(panel.value?.querySelectorAll('button:not(:disabled), [tabindex="0"]') || []),
  ].filter((e) => e.getClientRects().length)
  if (!items.length) return
  const i = items.indexOf(document.activeElement)
  if ((event.shiftKey && i <= 0) || (!event.shiftKey && i === items.length - 1)) {
    event.preventDefault()
    items[event.shiftKey ? items.length - 1 : 0]?.focus()
  }
}
watch(
  () => props.node.data.assetUrl,
  () => {
    roles.value = []
    active.value = ''
    void identify()
  },
)
onMounted(() => {
  previousFocus = document.activeElement
  if (roles.value.length) phase.value = 'editing'
  else void identify()
  panel.value?.querySelector('button')?.focus({ preventScroll: true })
  document.addEventListener('pointerdown', closeOutside, true)
  document.addEventListener('keydown', keydown, true)
})
onBeforeUnmount(() => {
  sequence++
  controller?.abort()
  document.removeEventListener('pointerdown', closeOutside, true)
  document.removeEventListener('keydown', keydown, true)
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to=".cv3-app-shell">
    <div class="cv3-emotion-layer" @pointerdown.self="emit('close')" @wheel.stop>
      <section
        v-if="phase !== 'editing'"
        ref="panel"
        class="cv3-face-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择面部"
      >
        <header>
          <button type="button" aria-label="关闭面部选择" @click="emit('close')">
            <CanvasIcon name="close" :size="18" />
          </button>
          <CanvasIcon name="character" :size="18" />
          <strong>{{ phase === 'detecting' ? '正在识别面部…' : '请选择人物进行操作' }}</strong>
          <button type="button" :aria-pressed="manual" @click="toggleManual">
            <CanvasIcon name="rectangle" :size="14" />
            手动框选
          </button>
        </header>
        <div
          class="cv3-face-picture"
          :class="{ 'is-drawing': manual }"
          @pointerdown="startFace"
          @pointermove="moveFace"
          @pointerup="endFace"
          @pointercancel="cancelFace"
        >
          <img ref="picture" :src="node.data.assetUrl" :alt="node.data.title" draggable="false" />
          <button
            v-for="(face, i) in faces"
            v-show="!manual"
            :key="face.id"
            type="button"
            class="cv3-face-box"
            :style="boxStyle(face.box)"
            :aria-label="'选择面部' + (i + 1)"
            @pointerdown.stop
            @click="chooseFace(face.box)"
          />
          <span v-if="draftBox" class="cv3-face-box is-draft" :style="boxStyle(draftBox)" />
          <span v-if="phase === 'detecting'" class="cv3-face-detect-status" role="status">
            <span class="cv3-loading-spinner" />
            识别面部中…
          </span>
        </div>
        <p v-if="manual">在图片上拖动框选脸部，松开后加入角色。</p>
        <p v-else-if="faces.length">已识别 {{ faces.length }} 张面部，点击脸框继续。</p>
        <p v-if="error" class="cv3-face-error" role="status">
          {{ error }}
          <button type="button" @click="identify">重新识别</button>
        </p>
        <button
          v-if="roles.length"
          type="button"
          class="cv3-face-return"
          @click="phase = 'editing'"
        >
          返回情绪调节
        </button>
      </section>
      <section
        v-else
        ref="panel"
        class="cv3-emotion-panel"
        role="dialog"
        aria-modal="true"
        aria-label="情绪调节"
      >
        <header>
          <button type="button" aria-label="关闭情绪调节" @click="emit('close')">
            <CanvasIcon name="close" :size="16" />
          </button>
          <span class="cv3-emotion-divider" />
          <strong>情绪调节</strong>
          <span class="cv3-composer-spacer" />
          <div class="cv3-emotion-select">
            <button
              type="button"
              aria-label="情绪清晰度"
              :aria-expanded="choices === 'resolution'"
              @click="choices = choices === 'resolution' ? '' : 'resolution'"
            >
              {{ resolution }}
              <CanvasIcon name="chevron" :size="9" />
            </button>
            <div
              v-if="choices === 'resolution'"
              class="cv3-emotion-options"
              role="group"
              aria-label="清晰度"
            >
              <button
                v-for="value in ['1K', '2K', '4K']"
                :key="value"
                type="button"
                :aria-pressed="resolution === value"
                @click="chooseOutput('resolution', value)"
              >
                {{ value }}
              </button>
            </div>
          </div>
          <div class="cv3-emotion-select">
            <button
              type="button"
              aria-label="情绪生成张数"
              :aria-expanded="choices === 'count'"
              @click="choices = choices === 'count' ? '' : 'count'"
            >
              {{ count }}
              <CanvasIcon name="chevron" :size="9" />
            </button>
            <div
              v-if="choices === 'count'"
              class="cv3-emotion-options"
              role="group"
              aria-label="生成张数"
            >
              <button
                v-for="value in ['1张', '2张', '4张']"
                :key="value"
                type="button"
                :aria-pressed="count === value"
                @click="chooseOutput('count', value)"
              >
                {{ value }}
              </button>
            </div>
          </div>
          <span class="cv3-composer-cost">
            <CanvasIcon name="power" :size="12" />
            {{ cost }}
          </span>
          <button
            type="button"
            class="cv3-generate-button"
            aria-label="生成表情"
            :disabled="!current"
            @click="generate"
          >
            <CanvasIcon name="arrowUp" :size="20" />
          </button>
        </header>
        <div class="cv3-emotion-roles" role="group" aria-label="已选面部">
          <span
            v-for="(role, i) in roles"
            :key="role.id"
            class="cv3-emotion-role"
            :class="{ selected: active === role.id }"
          >
            <button type="button" :aria-pressed="active === role.id" @click="active = role.id">
              <span class="cv3-face-avatar">
                <img :src="node.data.assetUrl" alt="" :style="cropStyle(role.box)" />
              </span>
              角色{{ i + 1 }}
            </button>
            <button
              type="button"
              class="cv3-emotion-delete"
              :aria-label="'删除角色' + (i + 1)"
              @click="removeRole(role.id)"
            >
              ×
            </button>
          </span>
          <button type="button" @click="addRole">
            <CanvasIcon name="rectangle" :size="13" />
            手动添加
          </button>
        </div>
        <EmotionMoodControl
          v-if="current"
          :role-id="current.id"
          :x="mood.x"
          :y="mood.y"
          @select="selectMood"
        />
      </section>
    </div>
  </Teleport>
</template>
