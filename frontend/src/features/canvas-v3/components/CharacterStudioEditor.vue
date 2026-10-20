<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import {
  CHARACTER_EDITOR_TABS,
  CHARACTER_FACE_GROUPS,
  CHARACTER_EYE_LIGHTS,
  CHARACTER_MAKEUP_GROUPS,
  CHARACTER_BODY_CONTROLS,
  CHARACTER_VOICE_FIELDS,
  CHARACTER_VOICE_CONTROLS,
  CHARACTER_DECAL_PRESETS,
  CHARACTER_STYLING_CATEGORIES,
  CHARACTER_MAKEUP_CATEGORIES,
  CHARACTER_CLOTHING_CATEGORIES,
  CHARACTER_HAIR_STYLES,
  CHARACTER_MAKEUP_STYLES,
  CHARACTER_HAIR_COLORS,
  CHARACTER_LIP_COLORS,
  CHARACTER_CLOTHING_STYLES,
  CHARACTER_VOICE_LIBRARY,
  characterStudioImage,
  characterStudioRecord,
  characterStudioInstruction,
  characterStudioVisualConfig,
} from '../config/characterStudioControls.js'

const props = defineProps({
  character: { type: Object, required: true },
  busy: Boolean,
  error: { type: String, default: '' },
  models: { type: Array, default: () => [] },
  previewUrl: { type: String, default: '' },
  initialTab: { type: String, default: 'face' },
})
const emit = defineEmits([
  'back',
  'change',
  'generate',
  'save',
  'age-variant',
  'upload-reference',
  'choose-reference',
  'upload-decal',
  'design-voice',
])
const clone = (value) => JSON.parse(JSON.stringify(value))
const readAppliedVisualConfig = (character) =>
  typeof character.config?.appliedVisualConfig === 'string' && character.config.appliedVisualConfig
    ? character.config.appliedVisualConfig
    : characterStudioVisualConfig({})
const draft = ref(characterStudioRecord(props.character))
const initial = ref(clone(draft.value))
const appliedConfig = ref(readAppliedVisualConfig(props.character))
const undoStack = ref([])
const redoStack = ref([])
const editorTab = (value) =>
  CHARACTER_EDITOR_TABS.some((tab) => tab.id === value) ? value : 'face'
const activeTab = ref(editorTab(props.initialTab))
const faceGroup = ref('skin')
const makeupGroup = ref('eyebrows')
const imageView = ref('half')
const comparing = ref(false)
const smartOpen = ref(false)
const smartInstruction = ref('')
const withAssets = ref(true)
const clothesTab = ref('styling')
const voiceTab = ref('library')
const voiceSearch = ref('')
const voiceFilter = ref('全部')
const voiceFiltersOpen = ref(false)
const voicePlaying = ref('')
const voiceNotice = ref('')
const selectedDecalId = ref('')
const decalUploadInput = ref(null)
const stylingUploadInput = ref(null)
let decalDrag = null
const selectedDecal = computed(() =>
  draft.value.config.features.decals.find((decal) => decal.id === selectedDecalId.value),
)
const filteredVoices = computed(() =>
  CHARACTER_VOICE_LIBRARY.filter(
    (voice) =>
      voice.name.toLowerCase().includes(voiceSearch.value.trim().toLowerCase()) &&
      (voiceFilter.value === '全部' ||
        voice.gender === voiceFilter.value ||
        voice.tone === voiceFilter.value),
  ),
)
const currentImage = computed(
  () => characterStudioImage(props.character) || characterStudioImage(draft.value),
)
const originalImage = computed(
  () =>
    props.character.originalImageUrl ||
    props.character.config?.originalImageUrl ||
    characterStudioImage(initial.value),
)
const displayImage = computed(() => {
  const url = comparing.value ? originalImage.value : currentImage.value
  return url === characterStudioImage(props.character) && props.previewUrl ? props.previewUrl : url
})
const group = computed(() => CHARACTER_FACE_GROUPS.find((item) => item.id === faceGroup.value))
const selectedMakeup = computed(() =>
  CHARACTER_MAKEUP_GROUPS.find((item) => item.key === makeupGroup.value),
)
const pendingChanges = computed(
  () => characterStudioVisualConfig(draft.value) !== appliedConfig.value,
)
const metadata = computed(() =>
  [draft.value.gender, draft.value.ageGroup, draft.value.culture].filter(Boolean).join(' · '),
)

watch(
  () => props.character.id,
  () => {
    draft.value = characterStudioRecord(props.character)
    initial.value = clone(draft.value)
    appliedConfig.value = readAppliedVisualConfig(props.character)
    undoStack.value = []
    redoStack.value = []
    smartOpen.value = false
    smartInstruction.value = ''
    comparing.value = false
    activeTab.value = editorTab(props.initialTab)
  },
)
watch(
  () => props.initialTab,
  (value) => {
    // Navigation only: opening a panel never changes or submits the character.
    activeTab.value = editorTab(value)
  },
)
watch(
  () => [characterStudioImage(props.character), props.character.config?.appliedVisualConfig],
  ([url], [previous]) => {
    if (url && url !== previous) draft.value = { ...draft.value, imageUrl: url }
    // A changed URL is not proof that every local adjustment was part of that job.
    appliedConfig.value = readAppliedVisualConfig(props.character)
    draft.value.config.appliedVisualConfig = appliedConfig.value
  },
)
// Uploaded source files are resolved by the parent service. Do not deep-sync the entire draft.
watch(
  () => props.character.config?.features?.decals,
  (decals) => {
    if (
      !Array.isArray(decals) ||
      JSON.stringify(decals) === JSON.stringify(draft.value.config.features.decals)
    )
      return
    draft.value.config.features.decals = characterStudioRecord(
      props.character,
    ).config.features.decals
  },
  { deep: true },
)
watch(
  () => props.character.config?.clothes?.referenceUrl,
  (url) => {
    if (url) draft.value.config.clothes.referenceUrl = url
  },
)
watch(
  () => props.character.config?.styleReferenceUrls,
  (urls) => {
    if (Array.isArray(urls)) draft.value.config.styleReferenceUrls = [...urls]
  },
  { deep: true },
)

function notify() {
  emit('change', clone(draft.value))
}
function remember() {
  undoStack.value.push(clone(draft.value))
  if (undoStack.value.length > 80) undoStack.value.shift()
  redoStack.value = []
}
function edit(section, key, value) {
  if (props.busy) return
  if (draft.value.config[section][key] === value) return
  remember()
  draft.value.config[section][key] = value
  notify()
}
function rename(event) {
  if (props.busy) return
  remember()
  draft.value.name = String(event.target.value || '').slice(0, 80)
  notify()
}
function changeNumber(section, control, event) {
  const number = Number(event.target.value)
  if (!Number.isFinite(number)) return
  edit(section, control.key, Math.round(Math.max(control.min, Math.min(control.max, number))))
}
function undo() {
  if (props.busy || !undoStack.value.length) return
  redoStack.value.push(clone(draft.value))
  draft.value = undoStack.value.pop()
  notify()
}
function redo() {
  if (props.busy || !redoStack.value.length) return
  undoStack.value.push(clone(draft.value))
  draft.value = redoStack.value.pop()
  notify()
}
function resetGroup() {
  if (props.busy) return
  remember()
  if (activeTab.value === 'face') {
    if (faceGroup.value === 'makeup') draft.value.config.makeup[selectedMakeup.value.key] = '无'
    else {
      for (const control of group.value.controls) draft.value.config.facial[control.key] = 0
      if (faceGroup.value === 'skin') draft.value.config.facial.removeBlemishes = false
      if (faceGroup.value === 'eyes') draft.value.config.facial.eyeLight = '无'
    }
  } else
    draft.value.config[activeTab.value] = clone(characterStudioRecord({}).config[activeTab.value])
  notify()
}
function generate(custom = '') {
  if (props.busy || !currentImage.value || activeTab.value === 'voice') return
  emit('generate', {
    character: clone(draft.value),
    kind: 'edit',
    instruction: characterStudioInstruction(draft.value, custom),
    customInstruction: custom,
  })
  smartOpen.value = false
}
function save(insert) {
  if (props.busy || !draft.value.name.trim() || !currentImage.value) return
  emit('save', {
    character: {
      ...clone(draft.value),
      name: draft.value.name.trim(),
      imageUrl: currentImage.value,
    },
    withAssets: withAssets.value,
    insert,
  })
}
function compareStart(event) {
  if (!originalImage.value) return
  comparing.value = true
  event?.currentTarget?.setPointerCapture?.(event.pointerId)
}
function compareEnd() {
  comparing.value = false
}
function handleKey(event) {
  if (event.key === 'Escape' && smartOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    smartOpen.value = false
  }
}
function addDecal(kind) {
  if (props.busy || !currentImage.value) return
  if (kind === 'custom') {
    decalUploadInput.value?.click()
    return
  }
  if (draft.value.config.features.decals.length >= 20) return
  const id = `decal-${globalThis.crypto?.randomUUID?.() || Date.now()}`
  edit('features', 'decals', [
    ...draft.value.config.features.decals,
    { id, kind, x: 50, y: 40, rotation: 0, scale: 1, url: '' },
  ])
  selectedDecalId.value = id
}
function uploadFile(event, action) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || props.busy) return
  emit(action, file)
}
function startDecalDrag(event, decal) {
  if (props.busy) return
  selectedDecalId.value = decal.id
  const bounds = event.currentTarget.parentElement.getBoundingClientRect()
  remember()
  decalDrag = {
    id: decal.id,
    x: decal.x,
    y: decal.y,
    startX: event.clientX,
    startY: event.clientY,
    width: bounds.width,
    height: bounds.height,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
function dragDecal(event) {
  if (!decalDrag || props.busy) return
  const decal = draft.value.config.features.decals.find((item) => item.id === decalDrag.id)
  if (!decal || !decalDrag.width || !decalDrag.height) return
  decal.x = Math.max(
    0,
    Math.min(100, decalDrag.x + ((event.clientX - decalDrag.startX) / decalDrag.width) * 100),
  )
  decal.y = Math.max(
    0,
    Math.min(100, decalDrag.y + ((event.clientY - decalDrag.startY) / decalDrag.height) * 100),
  )
  notify()
}
function updateDecal(patch) {
  if (!selectedDecal.value || props.busy) return
  edit(
    'features',
    'decals',
    draft.value.config.features.decals.map((item) =>
      item.id === selectedDecalId.value ? { ...item, ...patch } : item,
    ),
  )
}
function removeDecal() {
  if (!selectedDecalId.value || props.busy) return
  edit(
    'features',
    'decals',
    draft.value.config.features.decals.filter((item) => item.id !== selectedDecalId.value),
  )
  selectedDecalId.value = ''
}
function removeStylingReference(url) {
  if (props.busy) return
  remember()
  draft.value.config.styleReferenceUrls = draft.value.config.styleReferenceUrls.filter(
    (item) => item !== url,
  )
  notify()
}
function decalKey(event, decal) {
  selectedDecalId.value = decal.id
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ]
  if (delta) {
    event.preventDefault()
    event.stopPropagation()
    updateDecal({
      x: Math.max(0, Math.min(100, decal.x + delta[0])),
      y: Math.max(0, Math.min(100, decal.y + delta[1])),
    })
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    event.stopPropagation()
    removeDecal()
  }
}
function playVoice(voice) {
  const synth = globalThis.speechSynthesis
  if (!synth || typeof globalThis.SpeechSynthesisUtterance !== 'function') {
    voiceNotice.value = '当前浏览器不支持系统音色试听。'
    return
  }
  if (voicePlaying.value === voice.id) {
    synth.cancel()
    voicePlaying.value = ''
    return
  }
  synth.cancel()
  const utterance = new globalThis.SpeechSynthesisUtterance(
    `你好，我是${draft.value.name || '你的模特'}，很高兴认识你。让我们一起开始创作吧。`,
  )
  utterance.lang = 'zh-CN'
  utterance.rate = Math.max(0.5, Math.min(2, 1 + draft.value.config.voice.speed / 100))
  utterance.pitch = Math.max(0.2, Math.min(2, 1 + draft.value.config.voice.pitch / 100))
  const systemVoice = synth.getVoices().find((item) => item.lang.startsWith('zh'))
  if (systemVoice) utterance.voice = systemVoice
  utterance.onend = utterance.onerror = () => {
    if (voicePlaying.value === voice.id) voicePlaying.value = ''
  }
  voicePlaying.value = voice.id
  voiceNotice.value = '当前为浏览器系统音色试听，并非 LibTV 专有音色。'
  synth.speak(utterance)
}
onBeforeUnmount(() => {
  if (voicePlaying.value) globalThis.speechSynthesis?.cancel()
})
</script>

<template>
  <section class="cv3-character-editor" data-character-studio-editor @keydown="handleKey">
    <aside class="cv3-character-editor-sidebar">
      <button class="cv3-character-back" type="button" :disabled="busy" @click="emit('back')">
        <i class="ri-arrow-left-s-line" aria-hidden="true" />
        返回模特库
      </button>
      <div class="cv3-character-editor-identity">
        <label class="cv3-character-name-label" for="cv3-character-editor-name">模特名称</label>
        <div class="cv3-character-name-field">
          <input
            id="cv3-character-editor-name"
            :value="draft.name"
            maxlength="80"
            :disabled="busy"
            placeholder="未命名模特"
            @input="rename"
          />
          <i class="ri-edit-line" aria-hidden="true" />
        </div>
        <p v-if="metadata">{{ metadata }}</p>
        <span v-else>自定义模特</span>
      </div>
      <nav class="cv3-character-editor-tabs" aria-label="模特编辑分类">
        <button
          v-for="tab in CHARACTER_EDITOR_TABS"
          :key="tab.id"
          type="button"
          :class="{ active: activeTab === tab.id }"
          :aria-pressed="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          <CanvasIcon :name="tab.icon" :size="19" />
          {{ tab.label }}
          <i class="ri-arrow-right-s-line" aria-hidden="true" />
        </button>
      </nav>
      <button
        class="cv3-character-age-button"
        type="button"
        :disabled="busy || !currentImage"
        @click="emit('age-variant', clone(draft))"
      >
        <i class="ri-time-line" aria-hidden="true" />
        生成不同年龄的模特
      </button>
      <div class="cv3-character-editor-history">
        <button
          type="button"
          aria-label="撤销调整"
          title="撤销调整"
          :disabled="busy || !undoStack.length"
          @click="undo"
        >
          <i class="ri-arrow-go-back-line" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="恢复调整"
          title="恢复调整（重做）"
          :disabled="busy || !redoStack.length"
          @click="redo"
        >
          <i class="ri-arrow-go-forward-line" aria-hidden="true" />
        </button>
        <button
          class="cv3-character-compare"
          type="button"
          :class="{ active: comparing }"
          :disabled="!originalImage"
          aria-label="按住对比原图"
          @pointerdown.prevent="compareStart"
          @pointerup="compareEnd"
          @pointercancel="compareEnd"
          @lostpointercapture="compareEnd"
          @keydown.space.prevent="comparing = true"
          @keyup.space.prevent="compareEnd"
          @keydown.enter.prevent="comparing = true"
          @keyup.enter.prevent="compareEnd"
          @blur="compareEnd"
        >
          <i class="ri-contrast-2-line" aria-hidden="true" />
          按住对比
        </button>
      </div>
    </aside>

    <main class="cv3-character-preview">
      <div class="cv3-character-preview-toolbar">
        <div class="cv3-character-view-toggle" aria-label="模特预览视图">
          <button
            type="button"
            :class="{ active: imageView === 'half' }"
            :aria-pressed="imageView === 'half'"
            @click="imageView = 'half'"
          >
            半身
          </button>
          <button
            type="button"
            :class="{ active: imageView === 'full' }"
            :aria-pressed="imageView === 'full'"
            @click="imageView = 'full'"
          >
            全身
          </button>
        </div>
        <span v-if="comparing" class="cv3-character-preview-badge">原图对比</span>
        <span v-else-if="pendingChanges" class="cv3-character-preview-badge is-pending">
          调整待生成生效
        </span>
      </div>
      <div class="cv3-character-image-stage" :class="{ 'is-half': imageView === 'half' }">
        <img
          v-if="displayImage"
          :src="displayImage"
          :alt="`${draft.name || '模特'}${comparing ? '原图' : '预览'}`"
          draggable="false"
        />
        <div v-else class="cv3-character-preview-empty">
          <CanvasIcon name="characterSheet" :size="48" />
          <p>请先上传或生成模特图片</p>
        </div>
        <div
          v-if="activeTab === 'features' && !comparing && currentImage"
          class="cv3-character-decals"
          aria-label="待生成特征贴图布局"
        >
          <button
            v-for="decal in draft.config.features.decals"
            :key="decal.id"
            type="button"
            class="cv3-character-decal"
            :class="[`is-${decal.kind}`, { active: selectedDecalId === decal.id }]"
            :aria-label="`${CHARACTER_DECAL_PRESETS.find((item) => item.id === decal.kind)?.label || '特征'}贴图，方向键移动`"
            :aria-pressed="selectedDecalId === decal.id"
            :style="{
              left: `${decal.x}%`,
              top: `${decal.y}%`,
              transform: `translate(-50%, -50%) rotate(${decal.rotation}deg) scale(${decal.scale})`,
            }"
            :disabled="busy"
            @pointerdown.prevent.stop="startDecalDrag($event, decal)"
            @pointermove.prevent="dragDecal"
            @pointerup="decalDrag = null"
            @pointercancel="decalDrag = null"
            @lostpointercapture="decalDrag = null"
            @keydown="decalKey($event, decal)"
          >
            <img
              v-if="decal.kind === 'custom' && decal.url"
              :src="decal.url"
              alt="自定义特征贴图"
              draggable="false"
            />
            <span v-else aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
      <div v-if="busy" class="cv3-character-preview-working" role="status">
        <i class="ri-loader-4-line" aria-hidden="true" />
        正在处理模特任务，请稍候…
      </div>
      <p class="cv3-character-preview-note">
        {{
          imageView === 'half' ? '半身为视图裁切，不修改原图。' : '全身视图展示当前完整图片。'
        }}参数调整需确认生成后应用。
      </p>
      <p v-if="error" class="cv3-character-editor-error" role="alert">{{ error }}</p>
    </main>

    <aside class="cv3-character-editor-controls">
      <div class="cv3-character-control-heading">
        <h3>
          {{
            activeTab === 'features'
              ? '纹身 & 疤痕'
              : CHARACTER_EDITOR_TABS.find((tab) => tab.id === activeTab)?.label
          }}
        </h3>
        <button type="button" :disabled="busy" @click="resetGroup">重置</button>
      </div>
      <nav v-if="activeTab === 'face'" class="cv3-character-face-groups" aria-label="脸部精修部位">
        <button
          v-for="item in CHARACTER_FACE_GROUPS"
          :key="item.id"
          type="button"
          :class="{ active: faceGroup === item.id }"
          :aria-pressed="faceGroup === item.id"
          @click="faceGroup = item.id"
        >
          <CanvasIcon :name="item.icon" :size="20" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="cv3-character-controls-scroll">
        <template v-if="activeTab === 'face' && faceGroup !== 'makeup'">
          <label
            v-for="control in group.controls"
            :key="control.key"
            class="cv3-character-slider-field"
          >
            <span>
              {{ control.label }}
              <input
                type="number"
                :aria-label="`${control.label}数值`"
                :value="draft.config.facial[control.key]"
                :min="control.min"
                :max="control.max"
                :step="control.step"
                :disabled="busy"
                @input="changeNumber('facial', control, $event)"
              />
            </span>
            <input
              type="range"
              :aria-label="control.label"
              :value="draft.config.facial[control.key]"
              :min="control.min"
              :max="control.max"
              :step="control.step"
              :disabled="busy"
              :style="{
                '--slider-progress': `${((draft.config.facial[control.key] - control.min) / (control.max - control.min)) * 100}%`,
              }"
              @input="changeNumber('facial', control, $event)"
            />
          </label>
          <label v-if="faceGroup === 'skin'" class="cv3-character-switch-field">
            <span>祛斑祛痘</span>
            <input
              type="checkbox"
              role="switch"
              :checked="draft.config.facial.removeBlemishes"
              :disabled="busy"
              @change="edit('facial', 'removeBlemishes', $event.target.checked)"
            />
          </label>
          <div v-if="faceGroup === 'eyes'" class="cv3-character-choice-field">
            <h4>眼神光</h4>
            <div class="cv3-character-choice-grid">
              <button
                v-for="choice in CHARACTER_EYE_LIGHTS"
                :key="choice"
                type="button"
                :class="{ active: draft.config.facial.eyeLight === choice }"
                :aria-pressed="draft.config.facial.eyeLight === choice"
                :disabled="busy"
                @click="edit('facial', 'eyeLight', choice)"
              >
                {{ choice }}
              </button>
            </div>
          </div>
        </template>
        <template v-else-if="activeTab === 'face'">
          <div class="cv3-character-makeup-tabs" aria-label="妆造分类">
            <button
              v-for="item in CHARACTER_MAKEUP_GROUPS"
              :key="item.key"
              type="button"
              :class="{ active: makeupGroup === item.key }"
              :aria-pressed="makeupGroup === item.key"
              @click="makeupGroup = item.key"
            >
              {{ item.label }}
            </button>
          </div>
          <div class="cv3-character-choice-field">
            <h4>{{ selectedMakeup.label }}</h4>
            <div class="cv3-character-makeup-choices">
              <button
                v-for="(choice, index) in selectedMakeup.choices"
                :key="choice"
                type="button"
                :class="{ active: draft.config.makeup[selectedMakeup.key] === choice }"
                :aria-pressed="draft.config.makeup[selectedMakeup.key] === choice"
                :disabled="busy"
                @click="edit('makeup', selectedMakeup.key, choice)"
              >
                <span
                  class="cv3-character-makeup-swatch"
                  :style="{
                    '--swatch-color': [
                      '#555',
                      '#8d6355',
                      '#bc8c78',
                      '#ba6777',
                      '#6d5553',
                      '#b7a38c',
                    ][index % 6],
                  }"
                >
                  <i v-if="choice === '无'" class="ri-forbid-line" aria-hidden="true" />
                  <CanvasIcon v-else name="faceViews" :size="25" />
                </span>
                {{ choice }}
              </button>
            </div>
          </div>
          <p class="cv3-character-field-hint">妆造选项为生成方向，不会直接替换当前图片。</p>
        </template>
        <template v-else-if="activeTab === 'features'">
          <input
            ref="decalUploadInput"
            type="file"
            accept="image/*"
            hidden
            :disabled="busy"
            @change="uploadFile($event, 'upload-decal')"
          />
          <div class="cv3-character-feature-tiles">
            <button
              v-for="preset in CHARACTER_DECAL_PRESETS"
              :key="preset.id"
              type="button"
              :aria-label="preset.label"
              :disabled="busy || !currentImage || draft.config.features.decals.length >= 20"
              @click="addDecal(preset.id)"
            >
              <span :class="`cv3-character-feature-example is-${preset.id}`">
                <i v-if="preset.id === 'custom'" class="ri-add-line" aria-hidden="true" />
                <span v-else aria-hidden="true">
                  {{ preset.id === 'mole' ? '•' : preset.id.startsWith('scar') ? '╱' : '∴' }}
                </span>
              </span>
              {{ preset.label }}
            </button>
          </div>
          <p class="cv3-character-field-hint">
            选择特征后可拖动定位。当前为布局示意，确认生成后才会应用到图片。
          </p>
          <div v-if="selectedDecal" class="cv3-character-decal-tools">
            <h4>已选特征</h4>
            <label>
              水平位置
              <input
                type="number"
                min="0"
                max="100"
                :value="Math.round(selectedDecal.x)"
                :disabled="busy"
                @input="
                  updateDecal({ x: Math.max(0, Math.min(100, Number($event.target.value) || 0)) })
                "
              />
            </label>
            <label>
              垂直位置
              <input
                type="number"
                min="0"
                max="100"
                :value="Math.round(selectedDecal.y)"
                :disabled="busy"
                @input="
                  updateDecal({ y: Math.max(0, Math.min(100, Number($event.target.value) || 0)) })
                "
              />
            </label>
            <label>
              旋转
              <input
                type="range"
                min="-180"
                max="180"
                :value="selectedDecal.rotation"
                :disabled="busy"
                @input="updateDecal({ rotation: Number($event.target.value) })"
              />
            </label>
            <label>
              大小
              <input
                type="range"
                min="0.2"
                max="3"
                step="0.1"
                :value="selectedDecal.scale"
                :disabled="busy"
                @input="updateDecal({ scale: Number($event.target.value) })"
              />
            </label>
            <button type="button" :disabled="busy" @click="removeDecal">
              <i class="ri-delete-bin-line" aria-hidden="true" />
              删除
            </button>
          </div>
        </template>
        <template v-else-if="activeTab === 'clothes'">
          <div class="cv3-character-subtabs" aria-label="服装造型分类">
            <button
              v-for="[id, label] in [
                ['styling', '造型'],
                ['clothing', '服装'],
                ['ai', 'AI 生成'],
              ]"
              :key="id"
              type="button"
              :class="{ active: clothesTab === id }"
              @click="clothesTab = id"
            >
              {{ label }}
            </button>
          </div>
          <template v-if="clothesTab === 'styling'">
            <h4 class="cv3-character-section-title">发型</h4>
            <div class="cv3-character-category-tabs">
              <button
                v-for="category in CHARACTER_STYLING_CATEGORIES"
                :key="category"
                type="button"
                :class="{ active: draft.config.clothes.hairCategory === category }"
                :disabled="busy"
                @click="edit('clothes', 'hairCategory', category)"
              >
                {{ category }}
              </button>
            </div>
            <div class="cv3-character-style-options">
              <button
                v-for="style in CHARACTER_HAIR_STYLES"
                :key="style"
                type="button"
                :class="{ active: draft.config.clothes.hairStyle === style }"
                :disabled="busy"
                @click="edit('clothes', 'hairStyle', style)"
              >
                <CanvasIcon name="characterSheet" :size="23" />
                {{ style }}
              </button>
            </div>
            <h4 class="cv3-character-section-title">发色</h4>
            <div class="cv3-character-color-options">
              <button
                v-for="color in CHARACTER_HAIR_COLORS"
                :key="color"
                type="button"
                :class="{ active: draft.config.clothes.hairColor === color }"
                :aria-label="`发色 ${color}`"
                :aria-pressed="draft.config.clothes.hairColor === color"
                :style="{ background: color }"
                :disabled="busy"
                @click="edit('clothes', 'hairColor', color)"
              />
              <label title="自定义发色">
                ＋
                <input
                  type="color"
                  aria-label="自定义发色"
                  :value="draft.config.clothes.hairColor || '#171412'"
                  :disabled="busy"
                  @input="edit('clothes', 'hairColor', $event.target.value)"
                />
              </label>
            </div>
            <h4 class="cv3-character-section-title">妆容</h4>
            <div class="cv3-character-category-tabs">
              <button
                v-for="category in CHARACTER_MAKEUP_CATEGORIES"
                :key="category"
                type="button"
                :class="{ active: draft.config.clothes.makeupCategory === category }"
                :disabled="busy"
                @click="edit('clothes', 'makeupCategory', category)"
              >
                {{ category }}
              </button>
            </div>
            <div class="cv3-character-style-options">
              <button
                v-for="style in CHARACTER_MAKEUP_STYLES"
                :key="style"
                type="button"
                :class="{ active: draft.config.clothes.makeupStyle === style }"
                :disabled="busy"
                @click="edit('clothes', 'makeupStyle', style)"
              >
                <CanvasIcon name="faceViews" :size="23" />
                {{ style }}
              </button>
            </div>
            <h4 class="cv3-character-section-title">口红</h4>
            <div class="cv3-character-color-options">
              <button
                v-for="color in CHARACTER_LIP_COLORS"
                :key="color"
                type="button"
                :class="{ active: draft.config.clothes.lipColor === color }"
                :aria-label="`口红 ${color}`"
                :aria-pressed="draft.config.clothes.lipColor === color"
                :style="{ background: color }"
                :disabled="busy"
                @click="edit('clothes', 'lipColor', color)"
              />
            </div>
          </template>
          <template v-else-if="clothesTab === 'clothing'">
            <div class="cv3-character-category-tabs">
              <button
                v-for="category in CHARACTER_CLOTHING_CATEGORIES"
                :key="category"
                type="button"
                :class="{ active: draft.config.clothes.clothingCategory === category }"
                :disabled="busy"
                @click="edit('clothes', 'clothingCategory', category)"
              >
                {{ category }}
              </button>
            </div>
            <div class="cv3-character-style-options">
              <button
                v-for="style in CHARACTER_CLOTHING_STYLES"
                :key="style"
                type="button"
                :class="{ active: draft.config.clothes.clothingStyle === style }"
                :disabled="busy"
                @click="edit('clothes', 'clothingStyle', style)"
              >
                <i class="ri-t-shirt-line" aria-hidden="true" />
                {{ style }}
              </button>
            </div>
            <p class="cv3-character-field-hint">服装选项会作为生成方向，图片效果以生成结果为准。</p>
          </template>
          <template v-else>
            <label class="cv3-character-text-field">
              <span>造型描述</span>
              <textarea
                :value="draft.config.clothes.description"
                rows="6"
                maxlength="1200"
                placeholder="描述或上传参考图，复刻发型 / 妆造 / 服装"
                :disabled="busy"
                @input="edit('clothes', 'description', $event.target.value)"
              />
            </label>
            <input
              ref="stylingUploadInput"
              type="file"
              accept="image/*"
              hidden
              :disabled="busy"
              @change="uploadFile($event, 'upload-reference')"
            />
            <button
              class="cv3-character-outline-action"
              type="button"
              :disabled="busy"
              @click="stylingUploadInput?.click()"
            >
              <i class="ri-upload-2-line" aria-hidden="true" />
              上传造型参考图
            </button>
            <button
              class="cv3-character-outline-action"
              type="button"
              :disabled="busy"
              @click="emit('choose-reference', { purpose: 'styling' })"
            >
              <i class="ri-image-line" aria-hidden="true" />
              选择参考图
            </button>
            <div
              v-if="draft.config.styleReferenceUrls.length"
              class="cv3-character-styling-references"
            >
              <div v-for="(url, index) in draft.config.styleReferenceUrls" :key="url">
                <img
                  class="cv3-character-styling-reference"
                  :src="url"
                  :alt="`造型参考图 ${index + 1}`"
                />
                <button
                  type="button"
                  :disabled="busy"
                  :aria-label="`移除造型参考图 ${index + 1}`"
                  @click="removeStylingReference(url)"
                >
                  ×
                </button>
              </div>
            </div>
            <label class="cv3-character-text-field">
              <span>造型技能</span>
              <select
                :value="draft.config.clothes.style"
                :disabled="busy"
                @change="edit('clothes', 'style', $event.target.value)"
              >
                <option value="保持原样">人设定制造型</option>
                <option value="保持身份换装">保持身份换装</option>
                <option value="参考图造型复刻">参考图造型复刻</option>
              </select>
            </label>
          </template>
        </template>
        <template v-else-if="activeTab === 'voice'">
          <div class="cv3-character-subtabs" aria-label="音色分类">
            <button
              v-for="[id, label] in [
                ['library', '音色库'],
                ['mine', '我的音色'],
                ['ai', 'AI 生成'],
              ]"
              :key="id"
              type="button"
              :class="{ active: voiceTab === id }"
              @click="voiceTab = id"
            >
              {{ label }}
            </button>
          </div>
          <template v-if="voiceTab === 'library'">
            <div class="cv3-character-voice-search">
              <input
                :value="voiceSearch"
                aria-label="搜索音色"
                placeholder="搜索音色"
                @input="voiceSearch = $event.target.value"
              />
              <button
                type="button"
                aria-label="筛选音色"
                :aria-expanded="voiceFiltersOpen"
                @click="voiceFiltersOpen = !voiceFiltersOpen"
              >
                <i class="ri-equalizer-line" aria-hidden="true" />
              </button>
            </div>
            <div v-if="voiceFiltersOpen" class="cv3-character-category-tabs">
              <button
                v-for="filter in ['全部', '男', '女', '儿童', '卡通']"
                :key="filter"
                type="button"
                :class="{ active: voiceFilter === filter }"
                @click="voiceFilter = filter"
              >
                {{ filter }}
              </button>
            </div>
            <p class="cv3-character-field-hint">
              选择保存音色方向；播放使用浏览器系统音色示范，不是 LibTV 专有音色。
            </p>
            <div class="cv3-character-voice-list">
              <div
                v-for="voice in filteredVoices"
                :key="voice.id"
                :class="{ active: draft.config.voice.selectedVoice === voice.id }"
              >
                <button
                  type="button"
                  class="cv3-character-voice-select"
                  :aria-pressed="draft.config.voice.selectedVoice === voice.id"
                  :disabled="busy"
                  @click="edit('voice', 'selectedVoice', voice.id)"
                >
                  <span class="cv3-character-voice-avatar">
                    <i
                      :class="
                        voice.gender === '男'
                          ? 'ri-men-line'
                          : voice.gender === '女'
                            ? 'ri-women-line'
                            : 'ri-bear-smile-line'
                      "
                      aria-hidden="true"
                    />
                  </span>
                  <span>
                    {{ voice.name }}
                    <small>{{ voice.gender }} · {{ voice.tone }}</small>
                  </span>
                </button>
                <button
                  type="button"
                  :aria-label="`${voicePlaying === voice.id ? '停止' : '试听'}${voice.name}（系统音色）`"
                  :title="voicePlaying === voice.id ? '停止试听' : '系统音色试听'"
                  @click="playVoice(voice)"
                >
                  <i
                    :class="voicePlaying === voice.id ? 'ri-stop-fill' : 'ri-play-fill'"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <p v-if="!filteredVoices.length" class="cv3-character-field-hint">未找到匹配的音色</p>
            </div>
          </template>
          <div v-else-if="voiceTab === 'mine'" class="cv3-character-inline-empty">
            <i class="ri-mic-line" aria-hidden="true" />
            <p>暂无音色数据</p>
            <span>创建的专属音色将在接入语音服务后显示</span>
          </div>
          <template v-else>
            <label class="cv3-character-text-field">
              <span>音色描述</span>
              <textarea
                :value="draft.config.voice.designDescription"
                :disabled="busy"
                rows="6"
                maxlength="1200"
                placeholder="默认基于当前人设生成，可以补充输入音色特征…"
                @input="edit('voice', 'designDescription', $event.target.value)"
              />
            </label>
            <button
              class="cv3-character-outline-action"
              type="button"
              :disabled="busy"
              @click="
                emit('design-voice', {
                  character: clone(draft),
                  description: draft.config.voice.designDescription,
                })
              "
            >
              <i class="ri-sparkling-line" aria-hidden="true" />
              生成音色
            </button>
            <p class="cv3-character-field-hint">
              需要接入真实的音色设计服务；未配置时不会提交或扣费。
            </p>
            <h4 class="cv3-character-section-title">生成历史</h4>
            <div class="cv3-character-inline-empty">
              <i class="ri-history-line" aria-hidden="true" />
              <p>暂无生成历史</p>
            </div>
          </template>
          <p v-if="voiceNotice" class="cv3-character-section-note" role="status">
            {{ voiceNotice }}
          </p>
          <details class="cv3-character-voice-settings">
            <summary>音调设置</summary>
            <label
              v-for="control in CHARACTER_VOICE_CONTROLS"
              :key="control.key"
              class="cv3-character-slider-field"
            >
              <span>
                {{ control.label }}
                <input
                  type="number"
                  :aria-label="`${control.label}数值`"
                  :value="draft.config.voice[control.key]"
                  :min="control.min"
                  :max="control.max"
                  :disabled="busy"
                  @input="changeNumber('voice', control, $event)"
                />
              </span>
              <input
                type="range"
                :aria-label="control.label"
                :value="draft.config.voice[control.key]"
                :min="control.min"
                :max="control.max"
                :disabled="busy"
                @input="changeNumber('voice', control, $event)"
              />
            </label>
            <label
              v-for="field in CHARACTER_VOICE_FIELDS"
              :key="field.key"
              class="cv3-character-text-field"
            >
              <span>{{ field.label }}</span>
              <select
                v-if="field.choices"
                :value="draft.config.voice[field.key]"
                :disabled="busy"
                @change="edit('voice', field.key, $event.target.value)"
              >
                <option v-for="choice in field.choices" :key="choice" :value="choice">
                  {{ choice }}
                </option>
              </select>
              <textarea
                v-else
                :value="draft.config.voice[field.key]"
                :disabled="busy"
                :placeholder="field.placeholder"
                @input="edit('voice', field.key, $event.target.value)"
              />
            </label>
          </details>
        </template>
        <template v-else-if="activeTab === 'body'">
          <p class="cv3-character-section-note">以原图身材为基准进行相对调整，0 表示保持原样。</p>
          <label
            v-for="control in CHARACTER_BODY_CONTROLS"
            :key="control.key"
            class="cv3-character-slider-field"
          >
            <span>
              {{ control.label }}
              <input
                type="number"
                :aria-label="`${control.label}数值`"
                :value="draft.config.body[control.key]"
                :min="control.min"
                :max="control.max"
                :disabled="busy"
                @input="changeNumber('body', control, $event)"
              />
            </span>
            <input
              type="range"
              :aria-label="control.label"
              :value="draft.config.body[control.key]"
              :min="control.min"
              :max="control.max"
              :disabled="busy"
              @input="changeNumber('body', control, $event)"
            />
          </label>
        </template>
      </div>
      <div v-if="activeTab !== 'voice'" class="cv3-character-generation-actions">
        <button
          class="cv3-character-smart-action"
          type="button"
          :disabled="busy || !currentImage"
          @click="smartOpen = !smartOpen"
        >
          <i class="ri-sparkling-line" aria-hidden="true" />
          智能调整
          <i class="ri-arrow-down-s-line" aria-hidden="true" />
        </button>
        <div
          v-if="smartOpen"
          class="cv3-character-smart-popover"
          role="dialog"
          aria-label="智能调整模特"
        >
          <h4>描述你的调整想法</h4>
          <textarea
            :value="smartInstruction"
            autofocus
            maxlength="1200"
            rows="4"
            placeholder="例如：保留五官，换成浅色居家穿搭"
            @input="smartInstruction = $event.target.value"
          />
          <p>将使用实际已配置模型，确认费用后生成。</p>
          <button
            type="button"
            :disabled="busy || !smartInstruction.trim()"
            @click="generate(smartInstruction)"
          >
            确认调整
          </button>
        </div>
        <button
          class="cv3-character-confirm-generate"
          type="button"
          :disabled="busy || !currentImage"
          @click="generate()"
        >
          <i v-if="busy" class="ri-loader-4-line" aria-hidden="true" />
          {{ busy ? '处理中…' : '确认生成' }}
          <i v-if="!busy" class="ri-arrow-right-up-line" aria-hidden="true" />
        </button>
        <p>{{ models.length ? '生成前可选择模型并确认费用' : '生成前需配置可用的图片模型' }}</p>
      </div>
    </aside>
    <footer class="cv3-character-editor-footer">
      <label>
        <input
          :checked="withAssets"
          type="checkbox"
          :disabled="busy"
          @change="withAssets = $event.target.checked"
        />
        保存时生成模特资产
        <span title="将创建模特多视图图片，提交前需要确认生成参数和费用。">ⓘ</span>
      </label>
      <div>
        <button
          type="button"
          :disabled="busy || !draft.name.trim() || !currentImage"
          @click="save(false)"
        >
          保存
        </button>
        <button
          class="is-primary"
          type="button"
          :disabled="busy || !draft.name.trim() || !currentImage"
          @click="save(true)"
        >
          保存并添加到画布
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cv3-character-editor {
  --editor-border: #363636;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 240px;
  grid-template-rows: minmax(0, 1fr) 72px;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #ececec;
  background: #202020;
  font:
    13px/1.5 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Microsoft YaHei',
    sans-serif;
}
.cv3-character-editor button,
.cv3-character-editor input,
.cv3-character-editor select,
.cv3-character-editor textarea {
  font: inherit;
  color: inherit;
}
.cv3-character-editor button {
  cursor: pointer;
}
.cv3-character-editor button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cv3-character-editor button:focus-visible,
.cv3-character-editor input:focus-visible,
.cv3-character-editor select:focus-visible,
.cv3-character-editor textarea:focus-visible {
  outline: 2px solid #45d1e7;
  outline-offset: 2px;
}
.cv3-character-editor button:active:not(:disabled) {
  filter: brightness(1.25);
}
.cv3-character-editor-sidebar {
  padding: 20px 16px 16px;
  border-right: 1px solid var(--editor-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.cv3-character-back {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  align-self: flex-start;
  color: #a7a7a7 !important;
  background: none;
  border: none;
}
.cv3-character-back i {
  font-size: 21px;
}
.cv3-character-editor-identity {
  margin: 29px 8px 28px;
}
.cv3-character-name-label {
  display: block;
  color: #929292;
  font-size: 11px;
  margin-bottom: 6px;
}
.cv3-character-name-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cv3-character-name-field input {
  width: 100%;
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
  padding: 0;
  background: transparent;
  border: none;
}
.cv3-character-name-field i {
  color: #8b8b8b;
}
.cv3-character-editor-identity p,
.cv3-character-editor-identity > span {
  color: #8b8b8b;
  margin: 8px 0 0;
  font-size: 12px;
}
.cv3-character-editor-tabs {
  display: grid;
  gap: 9px;
}
.cv3-character-editor-tabs button {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 14px 13px;
  text-align: left;
  color: #aaa;
}
.cv3-character-editor-tabs button i {
  margin-left: auto;
}
.cv3-character-editor-tabs button.active {
  color: #f5f5f5;
  background: #323232;
  border-color: #454545;
}
.cv3-character-age-button {
  margin: 22px 8px 12px;
  display: flex;
  gap: 7px;
  align-items: center;
  border: none;
  background: none;
  color: #999 !important;
  font-size: 12px !important;
  text-align: left;
}
.cv3-character-editor-history {
  margin-top: auto;
  padding-top: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cv3-character-editor-history button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #414141;
  border-radius: 6px;
  background: #272727;
  min-width: 33px;
  height: 32px;
  color: #b2b2b2;
}
.cv3-character-editor-history .cv3-character-compare {
  margin-left: auto;
  gap: 6px;
  padding: 0 10px;
  font-size: 11px;
}
.cv3-character-editor-history .active {
  background: #414141;
  color: #fff;
}
.cv3-character-preview {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background-color: #191919;
  background-image: radial-gradient(#414141 1px, transparent 1px);
  background-size: 14px 14px;
  overflow: hidden;
}
.cv3-character-preview-toolbar {
  position: absolute;
  z-index: 1;
  left: 18px;
  top: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cv3-character-view-toggle {
  padding: 3px;
  display: flex;
  background: #252525;
  border: 1px solid #414141;
  border-radius: 7px;
}
.cv3-character-view-toggle button {
  padding: 5px 14px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8f8f8f;
  font-size: 12px;
}
.cv3-character-view-toggle button.active {
  color: #f6f6f6;
  background: #444;
}
.cv3-character-preview-badge {
  color: #bfc4c6;
  background: #262626;
  border: 1px solid #484848;
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 11px;
}
.cv3-character-preview-badge.is-pending {
  color: #d4c091;
}
.cv3-character-image-stage {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 70px 20px 32px;
}
.cv3-character-image-stage img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}
.cv3-character-image-stage.is-half img {
  object-fit: cover;
  object-position: center 24%;
  max-width: 540px;
}
.cv3-character-preview-empty {
  color: #666;
  text-align: center;
}
.cv3-character-preview-note {
  margin: 0;
  padding: 0 20px 12px;
  color: #777;
  font-size: 10px;
  text-align: center;
  background: #191919;
}
.cv3-character-preview-working {
  position: absolute;
  bottom: 54px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 14px;
  border: 1px solid #484848;
  border-radius: 9px;
  background: #262626ed;
  white-space: nowrap;
  box-shadow: 0 5px 24px #0004;
}
.cv3-character-preview-working i,
.cv3-character-confirm-generate .ri-loader-4-line {
  display: inline-block;
  animation: cv3-character-spin 1s linear infinite;
}
.cv3-character-editor-error {
  color: #f5a29b;
  margin: 0;
  padding: 9px 18px;
  background: #362323;
  font-size: 12px;
}
.cv3-character-editor-controls {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--editor-border);
}
.cv3-character-control-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  padding: 20px 18px 13px;
}
.cv3-character-control-heading h3 {
  font-size: 14px;
  margin: 0;
  font-weight: 600;
}
.cv3-character-control-heading button {
  color: #898989;
  background: none;
  border: 0;
  font-size: 11px;
}
.cv3-character-face-groups {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  padding: 0 8px 13px;
  border-bottom: 1px solid var(--editor-border);
  gap: 1px;
}
.cv3-character-face-groups button {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #888;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 7px 1px;
  font-size: 11px;
}
.cv3-character-face-groups button.active {
  color: #f3f3f3;
  background: #333;
}
.cv3-character-controls-scroll {
  padding: 20px 18px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #5d5d5d transparent;
  flex: 1;
}
.cv3-character-slider-field {
  display: block;
  margin-bottom: 23px;
}
.cv3-character-slider-field > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #b7b7b7;
  font-size: 12px;
  margin-bottom: 11px;
}
.cv3-character-slider-field input[type='number'] {
  width: 43px;
  border: 0;
  border-radius: 4px;
  background: #303030;
  padding: 3px 4px;
  text-align: center;
  font-size: 11px;
  appearance: textfield;
}
.cv3-character-slider-field input::-webkit-inner-spin-button {
  appearance: none;
}
.cv3-character-slider-field input[type='range'] {
  width: 100%;
  height: 3px;
  margin: 4px 0;
  appearance: none;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    #969696 var(--slider-progress, 50%),
    #444 var(--slider-progress, 50%)
  );
  cursor: pointer;
  accent-color: #eee;
}
.cv3-character-slider-field input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ededed;
  border: 1px solid #efefef;
}
.cv3-character-slider-field input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ededed;
  border: none;
}
.cv3-character-switch-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #b7b7b7;
  font-size: 12px;
}
.cv3-character-switch-field input {
  appearance: none;
  width: 29px;
  height: 17px;
  margin: 0;
  border: 1px solid #555;
  background: #424242;
  border-radius: 12px;
  cursor: pointer;
}
.cv3-character-switch-field input::after {
  content: '';
  display: block;
  margin: 2px;
  width: 11px;
  height: 11px;
  background: #aaa;
  border-radius: 50%;
}
.cv3-character-switch-field input:checked {
  background: #d6d6d6;
}
.cv3-character-switch-field input:checked::after {
  margin-left: 14px;
  background: #222;
}
.cv3-character-choice-field h4 {
  font-size: 12px;
  color: #c4c4c4;
  margin: 4px 0 12px;
  font-weight: 500;
}
.cv3-character-choice-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.cv3-character-choice-grid button {
  padding: 8px 2px;
  border: 1px solid #444;
  border-radius: 5px;
  background: #2b2b2b;
  color: #aaa;
  font-size: 11px;
}
.cv3-character-choice-grid button.active {
  color: #fff;
  border-color: #aaa;
  background: #454545;
}
.cv3-character-text-field {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
  color: #b7b7b7;
  font-size: 12px;
}
.cv3-character-text-field select,
.cv3-character-text-field input,
.cv3-character-text-field textarea,
.cv3-character-smart-popover textarea {
  min-width: 0;
  width: 100%;
  border: 1px solid #444;
  border-radius: 6px;
  background: #292929;
  padding: 9px 10px;
  resize: vertical;
  font-size: 12px;
  color: #e2e2e2;
}
.cv3-character-text-field input::placeholder,
.cv3-character-text-field textarea::placeholder,
.cv3-character-smart-popover textarea::placeholder {
  color: #686868;
}
.cv3-character-section-note,
.cv3-character-field-hint {
  font-size: 11px;
  color: #828282;
  margin: 0 0 18px;
  line-height: 1.7;
}
.cv3-character-makeup-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: -3px 0 20px;
}
.cv3-character-makeup-tabs button {
  border: none;
  background: #292929;
  color: #8f8f8f;
  border-radius: 4px;
  padding: 5px 7px;
  font-size: 11px;
}
.cv3-character-makeup-tabs button.active {
  color: #efefef;
  background: #444;
}
.cv3-character-makeup-choices {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
  margin-bottom: 20px;
}
.cv3-character-makeup-choices button {
  display: flex;
  flex-direction: column;
  gap: 7px;
  align-items: center;
  padding: 0;
  background: transparent;
  border: none;
  font-size: 11px;
  color: #999;
}
.cv3-character-makeup-swatch {
  display: flex;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid #444;
  border-radius: 6px;
  align-items: center;
  justify-content: center;
  color: #d3b7a7;
  background: radial-gradient(ellipse at center, var(--swatch-color), #2d2d2d 74%);
}
.cv3-character-makeup-choices button.active {
  color: #eee;
}
.cv3-character-makeup-choices button.active .cv3-character-makeup-swatch {
  border-color: #ddd;
  box-shadow: inset 0 0 0 1px #ddd;
}
.cv3-character-generation-actions {
  position: relative;
  padding: 13px 16px 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  border-top: 1px solid var(--editor-border);
}
.cv3-character-generation-actions > button {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  justify-content: center;
  border: 1px solid #4d4d4d;
  border-radius: 6px;
  background: #333;
  padding: 9px 5px;
  font-size: 12px;
  white-space: nowrap;
}
.cv3-character-generation-actions > .cv3-character-confirm-generate {
  color: #202020;
  background: #eee;
  border-color: #eee;
}
.cv3-character-generation-actions > p {
  grid-column: 1 / -1;
  margin: 0;
  text-align: center;
  font-size: 10px;
  color: #717171;
}
.cv3-character-smart-popover {
  position: absolute;
  bottom: calc(100% + 7px);
  right: 12px;
  width: 290px;
  max-width: calc(100vw - 50px);
  padding: 15px;
  border: 1px solid #555;
  border-radius: 10px;
  background: #292929;
  box-shadow: 0 8px 30px #0008;
  z-index: 3;
}
.cv3-character-smart-popover h4 {
  margin: 0 0 11px;
  font-weight: 500;
  font-size: 13px;
}
.cv3-character-smart-popover p {
  margin: 7px 0 11px;
  font-size: 10px;
  color: #999;
}
.cv3-character-smart-popover button {
  display: block;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  color: #222;
  background: #eee;
}
.cv3-character-editor-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-top: 1px solid var(--editor-border);
  background: #202020;
}
.cv3-character-editor-footer > label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9b9b9b;
  font-size: 12px;
}
.cv3-character-editor-footer input {
  accent-color: #eee;
  width: 14px;
  height: 14px;
  margin: 0;
}
.cv3-character-editor-footer label span {
  color: #777;
}
.cv3-character-editor-footer > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cv3-character-editor-footer button {
  border: 1px solid #4c4c4c;
  border-radius: 7px;
  background: #333;
  padding: 9px 20px;
  font-size: 12px;
}
.cv3-character-editor-footer button.is-primary {
  color: #222;
  background: #eee;
  border-color: #eee;
}
.cv3-character-subtabs {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 7px;
  background: #2b2b2b;
  margin: -4px -5px 18px;
}
.cv3-character-subtabs button {
  flex: 1;
  padding: 7px 1px;
  font-size: 12px;
  border: 0;
  border-radius: 5px;
  color: #8f8f8f;
  background: transparent;
}
.cv3-character-subtabs button.active {
  background: #454545;
  color: #f1f1f1;
}
.cv3-character-section-title {
  margin: 21px 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: #c2c2c2;
}
.cv3-character-category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 13px;
}
.cv3-character-category-tabs button {
  background: #2a2a2a;
  border: none;
  border-radius: 4px;
  color: #8f8f8f;
  padding: 4px 6px;
  font-size: 10px;
}
.cv3-character-category-tabs button.active {
  color: #f1f1f1;
  background: #484848;
}
.cv3-character-style-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.cv3-character-style-options button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 76px;
  background: #2a2a2a;
  border: 1px solid #393939;
  border-radius: 5px;
  font-size: 10px;
  color: #a0a0a0;
  padding: 7px 2px;
}
.cv3-character-style-options button > i {
  font-size: 24px;
  color: #8b8b8b;
}
.cv3-character-style-options button.active {
  color: #f1f1f1;
  border-color: #aaa;
  background: #3a3a3a;
}
.cv3-character-color-options {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
.cv3-character-color-options button,
.cv3-character-color-options label {
  width: 25px;
  height: 25px;
  border: 1px solid #666;
  border-radius: 50%;
  padding: 0;
  justify-self: center;
}
.cv3-character-color-options button.active {
  outline: 1px solid #ddd;
  outline-offset: 3px;
}
.cv3-character-color-options label {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 16px;
  cursor: pointer;
}
.cv3-character-color-options input {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.cv3-character-outline-action {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 4px;
  border: 1px solid #4b4b4b;
  border-radius: 6px;
  background: #2c2c2c;
  margin-bottom: 12px;
  font-size: 11px !important;
}
.cv3-character-styling-reference {
  display: block;
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 5px;
  margin-bottom: 20px;
}
.cv3-character-styling-references {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.cv3-character-styling-references > div {
  position: relative;
  width: 84px;
}
.cv3-character-styling-references img {
  width: 84px;
  height: 84px;
  margin: 0;
  object-fit: cover;
}
.cv3-character-styling-references button {
  position: absolute;
  right: -5px;
  top: -5px;
  border: 1px solid #666;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 1;
  background: #333;
}
.cv3-character-feature-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px 9px;
  margin-bottom: 20px;
}
.cv3-character-feature-tiles button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  padding: 0;
  color: #aaa;
  font-size: 10px;
}
.cv3-character-feature-example {
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 1px solid #4b4140;
  border-radius: 5px;
  background: radial-gradient(ellipse at center, #b68e7c, #745f54);
  font-size: 30px;
  color: #51352f;
}
.cv3-character-feature-example.is-scar-light {
  color: #d9b09e;
}
.cv3-character-feature-example.is-freckles-full,
.cv3-character-feature-example.is-freckles-cheeks {
  letter-spacing: 3px;
}
.cv3-character-feature-example.is-custom {
  background: #2c2c2c;
  border: 1px dashed #5b5b5b;
  color: #aaa;
}
.cv3-character-decals {
  position: absolute;
  inset: 70px 20px 32px;
  pointer-events: none;
}
.cv3-character-decal {
  position: absolute;
  pointer-events: auto;
  width: 50px;
  height: 50px;
  padding: 5px;
  border: 1px solid transparent;
  background: transparent;
  cursor: move !important;
  touch-action: none;
}
.cv3-character-decal.active {
  border: 1px dashed #3bdbf0;
}
.cv3-character-decal > span {
  display: block;
  width: 100%;
  height: 100%;
  position: relative;
}
.cv3-character-decal i {
  display: block;
  position: absolute;
  border-radius: 50%;
  width: 3px;
  height: 3px;
  background: #704439;
  left: 45%;
  top: 45%;
}
.cv3-character-decal i:nth-child(2) {
  left: 20%;
  top: 30%;
}
.cv3-character-decal i:nth-child(3) {
  left: 60%;
  top: 25%;
}
.cv3-character-decal i:nth-child(4) {
  left: 30%;
  top: 70%;
}
.cv3-character-decal i:nth-child(5) {
  left: 70%;
  top: 65%;
}
.cv3-character-decal i:nth-child(6) {
  left: 80%;
  top: 45%;
}
.cv3-character-decal.is-mole i {
  display: none;
}
.cv3-character-decal.is-mole i:first-child {
  display: block;
  width: 5px;
  height: 5px;
  background: #3f2722;
}
.cv3-character-decal.is-scar-dark i,
.cv3-character-decal.is-scar-light i {
  display: none;
}
.cv3-character-decal.is-scar-dark i:first-child,
.cv3-character-decal.is-scar-light i:first-child {
  display: block;
  width: 3px;
  height: 27px;
  transform: rotate(25deg);
  border-radius: 50%;
  background: #784d45;
}
.cv3-character-decal.is-scar-light i:first-child {
  background: #e0b5a7;
}
.cv3-character-decal img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.cv3-character-decal-tools {
  border-top: 1px solid #393939;
  padding-top: 12px;
}
.cv3-character-decal-tools h4 {
  font-size: 12px;
  margin: 0 0 12px;
  font-weight: 500;
}
.cv3-character-decal-tools label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #aaa;
  margin-bottom: 12px;
}
.cv3-character-decal-tools input[type='number'] {
  width: 50px;
  background: #303030;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px;
  font-size: 11px;
}
.cv3-character-decal-tools input[type='range'] {
  width: 130px;
  accent-color: #ddd;
}
.cv3-character-decal-tools button {
  width: 100%;
  padding: 8px;
  border: 1px solid #4d4141;
  border-radius: 5px;
  background: #322828;
  color: #d39797;
  font-size: 11px;
}
.cv3-character-voice-search {
  display: flex;
  gap: 8px;
  margin-bottom: 13px;
}
.cv3-character-voice-search input {
  width: 100%;
  min-width: 0;
  border: 1px solid #444;
  border-radius: 5px;
  background: #292929;
  padding: 8px 10px;
  font-size: 11px;
}
.cv3-character-voice-search button {
  border: 1px solid #444;
  border-radius: 5px;
  background: #292929;
  padding: 6px 8px;
  color: #aaa;
}
.cv3-character-voice-list {
  display: grid;
  gap: 8px;
  margin: 0 -5px 15px;
}
.cv3-character-voice-list > div {
  display: flex;
  align-items: center;
  border: 1px solid #363636;
  border-radius: 6px;
  background: #292929;
  padding: 7px;
  gap: 4px;
}
.cv3-character-voice-list > div.active {
  background: #393939;
  border-color: #8a8a8a;
}
.cv3-character-voice-list button {
  border: none;
  padding: 3px;
  background: transparent;
}
.cv3-character-voice-select {
  display: flex;
  align-items: center;
  text-align: left;
  gap: 9px;
  flex: 1;
  min-width: 0;
  font-size: 11px !important;
}
.cv3-character-voice-select > span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.cv3-character-voice-select small {
  display: block;
  color: #7f7f7f;
  font-size: 10px;
  margin-top: 2px;
}
.cv3-character-voice-avatar {
  display: grid;
  place-items: center;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  background: #414149;
  color: #aaa8bb;
  font-size: 15px;
}
.cv3-character-inline-empty {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  color: #777;
}
.cv3-character-inline-empty > i {
  font-size: 29px;
  color: #555;
}
.cv3-character-inline-empty p {
  margin: 0;
  font-size: 12px;
}
.cv3-character-inline-empty span {
  font-size: 10px;
}
.cv3-character-voice-settings {
  border-top: 1px solid #393939;
  padding-top: 14px;
}
.cv3-character-voice-settings summary {
  cursor: pointer;
  color: #aaa;
  margin-bottom: 18px;
  font-size: 12px;
}
@keyframes cv3-character-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1000px) {
  .cv3-character-editor {
    grid-template-columns: 185px minmax(0, 1fr) 235px;
  }
  .cv3-character-editor-sidebar {
    padding-inline: 10px;
  }
  .cv3-character-editor-tabs button {
    gap: 8px;
    padding-inline: 10px;
    font-size: 12px;
  }
  .cv3-character-preview-toolbar {
    left: 10px;
    right: 10px;
    flex-wrap: wrap;
  }
  .cv3-character-preview-badge {
    font-size: 10px;
  }
}
@media (max-width: 720px) {
  .cv3-character-editor {
    grid-template-columns: minmax(0, 1fr) 220px;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .cv3-character-editor-sidebar {
    grid-column: 1 / -1;
    border-bottom: 1px solid var(--editor-border);
    border-right: none;
    padding: 8px 12px;
  }
  .cv3-character-editor-identity {
    margin: 6px 0 10px;
  }
  .cv3-character-name-label,
  .cv3-character-editor-identity p,
  .cv3-character-editor-identity > span,
  .cv3-character-age-button,
  .cv3-character-editor-history {
    display: none;
  }
  .cv3-character-editor-tabs {
    display: flex;
    gap: 3px;
    overflow-x: auto;
  }
  .cv3-character-editor-tabs button {
    white-space: nowrap;
    padding: 8px;
    gap: 4px;
    font-size: 11px;
  }
  .cv3-character-editor-tabs button i {
    display: none;
  }
  .cv3-character-editor-tabs .cv3-icon {
    width: 15px;
  }
  .cv3-character-image-stage {
    padding: 70px 8px 15px;
  }
  .cv3-character-editor-footer {
    padding: 12px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .cv3-character-editor-footer > div {
    margin-left: auto;
  }
  .cv3-character-editor-footer button {
    padding: 8px 12px;
  }
  .cv3-character-preview-note {
    font-size: 9px;
    padding-inline: 8px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-character-preview-working i,
  .cv3-character-confirm-generate .ri-loader-4-line {
    animation: none;
  }
}
</style>
