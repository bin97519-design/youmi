<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { NODE_CONTROLS, parameterSummary } from '../config/nodeControls'
import { nodeSpec } from '../config/nodeSpecs'
import CanvasIcon from './CanvasIcon.vue'
import ImageShortcutMenu from './ImageShortcutMenu.vue'
import StyleGalleryModal from './StyleGalleryModal.vue'
import { IMAGE_SHORTCUT_COLUMNS, imageShortcutPatch } from '../config/imageShortcuts'
import { useCanvasV3TaskStore } from '../stores/tasks'
import { imageMiCost } from '../../../utils/imageMiPricing'
import { modelPresentation } from '../config/modelCatalog'
import { modelMenuPlacement, nodePopupPlacement } from '../config/popupPlacement'
import { isOutsidePopup } from '../config/popupDismissal'
import {
  imageEditHint,
  imageEditTemplate,
  PORTRAIT_FIELDS,
  portraitSettings,
} from '../config/imageEditPresets'
import { IMAGE_TASK_ACTIVE_STATES, imageTaskFeedback } from '../config/imageTaskState'
import { imageReferences } from '../sync/imageGenerationTarget'

const props = defineProps({
  node: { type: Object, required: true },
  position: { type: Object, required: true },
})
const emit = defineEmits(['panel', 'emotion', 'angles', 'generated'])
const graph = useCanvasV3GraphStore()
const tasks = useCanvasV3TaskStore()
const generating = computed(() => IMAGE_TASK_ACTIVE_STATES.includes(props.node.data.runState))
const interrupted = computed(
  () =>
    ['paused', 'uncertain'].includes(props.node.data.runState) ||
    Boolean(props.node.data.generation?.unresolvedTaskIds?.length),
)
const popup = ref('')
const composerElement = ref(null)
const modelTrigger = ref(null)
const modelMenu = ref(null)
const menuPlacement = ref({})
const nodePopup = ref(null)
const popupTrigger = ref(null)
const popupPlacement = ref({})
const expanded = ref(false)
const expandTrigger = ref(null)
const promptElement = ref(null)
const status = ref('')
const previewReferenceId = ref('')
const previewTrigger = ref(null)
const styleGalleryOpen = ref(false)
let promptEditStarted = false
const spec = computed(() => nodeSpec(props.node.data.kind))
const controls = computed(
  () =>
    NODE_CONTROLS[props.node.data.kind] || { defaults: {}, fields: {}, models: [], switches: [] },
)
const params = computed(() => ({ ...controls.value.defaults, ...props.node.data.params }))
const editTemplate = computed(() => imageEditTemplate(props.node.data.editTemplate?.id))
const shortcutIcon = computed(
  () =>
    IMAGE_SHORTCUT_COLUMNS.flat()
      .flatMap((group) => group.items)
      .find((item) => item.id === editTemplate.value?.id)?.icon || editTemplate.value?.icon,
)
const portrait = computed(() => portraitSettings(props.node.data.editTemplate?.settings))
const summary = computed(() => parameterSummary(props.node.data.kind, params.value))
const incoming = computed(() => graph.edges.filter((edge) => edge.target === props.node.id))
const references = computed(() => imageReferences(props.node, graph.nodes, graph.edges))
const possibleReferences = computed(() =>
  graph.nodes.filter(
    (node) => node.id !== props.node.id && !references.value.some((ref) => ref.id === node.id),
  ),
)
const modelOptions = computed(() =>
  props.node.data.kind === 'image' && tasks.imageModels.length
    ? tasks.imageModels
    : controls.value.models.map((value) => ({ value, label: value })),
)
const models = computed(() =>
  modelOptions.value.map((model) => modelPresentation(model, props.node.data.kind)),
)
const selectedModel = computed(() =>
  models.value.find((model) => model.value === props.node.data.model),
)
const modelLabel = computed(
  () =>
    modelOptions.value.find((model) => model.value === props.node.data.model)?.label ||
    props.node.data.model ||
    (props.node.data.directorRunId ? '请选择生图模型' : spec.value.model),
)
const cost = computed(() =>
  props.node.data.kind === 'image'
    ? imageMiCost(
        props.node.data.model,
        params.value.resolution,
        parseInt(params.value.count) || 1,
      ) || '—'
    : spec.value.cost === null
      ? '—'
      : spec.value.cost * (parseInt(params.value.count) || 1),
)

function patch(data, history = false) {
  if (history) graph.remember()
  graph.updateNodeData(props.node.id, data)
  status.value = ''
}
function editPrompt(value) {
  // Snapshot only when text actually changes. Focusing the prompt after deleting
  // a chip must not add a no-op undo entry on top of that deletion.
  if (!promptEditStarted) graph.remember()
  promptEditStarted = true
  patch({ prompt: value })
}
function setParam(key, value) {
  patch({ params: { ...params.value, [key]: value } }, true)
}
function updateModelPlacement() {
  if (popup.value !== 'models' || !modelTrigger.value) return
  menuPlacement.value = modelMenuPlacement(
    modelTrigger.value.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    models.value.length,
  )
}
function updatePopupPlacement() {
  if (popup.value === 'models') return updateModelPlacement()
  if (!popup.value || !nodePopup.value || !popupTrigger.value) return
  const anchor =
    popup.value === 'shortcuts'
      ? composerElement.value?.querySelector('.cv3-template-chip') || popupTrigger.value
      : popupTrigger.value
  popupPlacement.value = nodePopupPlacement(
    anchor.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    {
      width:
        popup.value === 'shortcuts'
          ? 524
          : popup.value === 'params'
            ? 342
            : popup.value === 'template'
              ? editTemplate.value?.id === 'portrait-texture'
                ? 316
                : 380
              : popup.value === 'advanced'
                ? 260
                : 320,
      height:
        popup.value === 'shortcuts'
          ? nodePopup.value.scrollHeight + 2
          : Math.min(500, nodePopup.value.scrollHeight + 2),
    },
  )
}
function togglePopup(name, event) {
  popupTrigger.value = event?.currentTarget || modelTrigger.value
  popup.value = popup.value === name ? '' : name
  if (name === 'models') updateModelPlacement()
}
async function setExpanded(value) {
  const selection = promptElement.value && {
    start: promptElement.value.selectionStart,
    end: promptElement.value.selectionEnd,
    scroll: promptElement.value.scrollTop,
  }
  popup.value = ''
  expanded.value = value
  await nextTick()
  if (value) {
    promptElement.value?.focus({ preventScroll: true })
    if (selection) {
      promptElement.value.setSelectionRange(selection.start, selection.end)
      promptElement.value.scrollTop = selection.scroll
    }
  } else {
    expandTrigger.value?.focus({ preventScroll: true })
  }
}
function closePopup() {
  const trigger = popup.value === 'models' ? modelTrigger.value : popupTrigger.value
  popup.value = ''
  trigger?.focus({ preventScroll: true })
}
function trapExpandedFocus(event) {
  if (!expanded.value || event.key !== 'Tab') return
  const focusable = [composerElement.value, modelMenu.value, nodePopup.value]
    .filter(Boolean)
    .flatMap((root) => [
      ...root.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ),
    ])
    .filter((element) => element.getClientRects().length)
  if (!focusable.length) return
  event.preventDefault()
  const index = focusable.indexOf(document.activeElement)
  const next =
    index < 0
      ? event.shiftKey
        ? focusable.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
  focusable[next].focus()
}
function handleComposerKeydown(event) {
  trapExpandedFocus(event)
  if (event.key !== 'Escape') return
  if (previewReferenceId.value) {
    event.preventDefault()
    previewReferenceId.value = ''
    previewTrigger.value?.focus({ preventScroll: true })
  } else if (popup.value) {
    event.preventDefault()
    closePopup()
  } else if (expanded.value) {
    event.preventDefault()
    void setExpanded(false)
  }
}
async function openModelsFromKeyboard() {
  popup.value = 'models'
  updateModelPlacement()
  await nextTick()
  modelMenu.value?.querySelector('[role="option"]')?.focus()
}
function closeModels() {
  popup.value = ''
  modelTrigger.value?.focus()
}
function closeOnOutside(event) {
  if (previewReferenceId.value) {
    const card = composerElement.value?.querySelector(
      `[data-reference-id="${CSS.escape(previewReferenceId.value)}"]`,
    )
    if (!card?.contains(event.target)) previewReferenceId.value = ''
  }
  if (!popup.value) return
  const panel = popup.value === 'models' ? modelMenu.value : nodePopup.value
  const trigger = popup.value === 'models' ? modelTrigger.value : popupTrigger.value
  // Keep the trigger inside the boundary so its click can toggle the menu closed.
  // Outside clicks must keep their normal focus/click behavior (e.g. prompt editing).
  if (isOutsidePopup(event, panel, trigger)) popup.value = ''
}
function closeOnEscape(event) {
  if (event.key !== 'Escape') return
  if (previewReferenceId.value || popup.value || expanded.value) {
    event.preventDefault()
    event.stopPropagation()
    handleComposerKeydown(event)
  }
}
function focusModel(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = [...modelMenu.value.querySelectorAll('[role="option"]')]
  const index = options.indexOf(document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  options[next]?.focus()
}
watch(
  () => [props.position.x, props.position.y, expanded.value, models.value.length, popup.value],
  async () => {
    await nextTick()
    updatePopupPlacement()
  },
)
onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside, true)
  document.addEventListener('keydown', closeOnEscape)
  window.addEventListener('resize', updatePopupPlacement)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
  window.removeEventListener('resize', updatePopupPlacement)
})
function addReference(source) {
  graph.connect({
    source: source.id,
    target: props.node.id,
    sourceHandle: 'output',
    targetHandle: 'input',
  })
  closePopup()
}
function removeReference(reference) {
  if (generating.value || interrupted.value) return
  const edge = incoming.value.find((candidate) => candidate.source === reference.id)
  if (!edge) return
  graph.removeEdge(edge.id)
  if (previewReferenceId.value === reference.id) previewReferenceId.value = ''
}
function toggleReferencePreview(reference, event) {
  if (!reference.data.assetUrl) return
  previewTrigger.value = event.currentTarget
  previewReferenceId.value = previewReferenceId.value === reference.id ? '' : reference.id
}
function openReferenceTool(tool, event) {
  if (tool === '风格') {
    popup.value = ''
    previewReferenceId.value = ''
    styleGalleryOpen.value = true
    return
  }
  togglePopup('references', event)
}
function applyStyle(style) {
  patch({ stylePreset: style }, true)
  styleGalleryOpen.value = false
}
function removeStyle() {
  if (!props.node.data.stylePreset || generating.value || interrupted.value) return
  patch({ stylePreset: null }, true)
}
function selectModel(model) {
  patch({ model }, true)
  closePopup()
}
function selectMode(mode) {
  patch({ mode }, true)
  closePopup()
}
function selectShortcut(id) {
  if (generating.value) return
  const data = imageShortcutPatch(props.node.data, id)
  if (data) patch(data, true)
  closePopup()
  if (id === null) nextTick(() => promptElement.value?.focus({ preventScroll: true }))
}
async function openShortcutsFromKeyboard(event) {
  popupTrigger.value = event.currentTarget
  popup.value = 'shortcuts'
  await nextTick()
  updatePopupPlacement()
  const option =
    nodePopup.value?.querySelector('.cv3-shortcut-option.selected') ||
    nodePopup.value?.querySelector('.cv3-shortcut-option')
  option?.focus()
}
function focusShortcut(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = [...nodePopup.value.querySelectorAll('.cv3-shortcut-option')]
  const index = options.indexOf(document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  options[next]?.focus()
}
function requestAssets() {
  expanded.value = false
  emit('panel', 'assets')
  popup.value = ''
}
function run() {
  if (props.node.data.kind === 'image') {
    void tasks.runImage(props.node.id, (target) => emit('generated', target))
    return
  }
  if (
    props.node.data.kind === 'smartEdit' &&
    !references.value.some((node) => node.data.kind === 'video' && node.data.assetUrl)
  ) {
    status.value = incoming.value.length
      ? '已连接节点，但尚无可用视频产物。'
      : '请先连接已生成视频的节点。'
    return
  }
  status.value = '当前为交互演示，尚未接入该模型的生成服务，未提交任务或扣费。'
}
</script>

<template>
  <StyleGalleryModal
    :open="styleGalleryOpen"
    :current-style="node.data.stylePreset"
    @close="styleGalleryOpen = false"
    @select="applyStyle"
  />
  <Teleport to=".cv3-app-shell">
    <div
      v-if="expanded"
      class="cv3-composer-backdrop"
      aria-hidden="true"
      @mousedown.prevent
      @click.self="setExpanded(false)"
    />
  </Teleport>
  <section
    ref="composerElement"
    class="cv3-composer"
    :class="{ 'is-expanded': expanded }"
    :style="expanded ? undefined : { left: position.x + 'px', top: position.y + 'px' }"
    :role="expanded ? 'dialog' : undefined"
    :aria-modal="expanded ? true : undefined"
    :aria-label="expanded ? '编辑生成提示词' : '节点生成面板'"
    @keydown.stop="handleComposerKeydown"
  >
    <div class="cv3-composer-tools">
      <button
        v-for="tool in spec.referenceTools"
        :key="tool"
        type="button"
        :class="{
          'is-open': tool === '风格' ? styleGalleryOpen : popup === 'references',
          'has-value': tool === '风格' && node.data.stylePreset,
        }"
        :aria-pressed="tool === '风格' ? Boolean(node.data.stylePreset) : undefined"
        @click="openReferenceTool(tool, $event)"
      >
        <CanvasIcon
          :name="tool === '标记' ? 'referenceMark' : tool === '风格' ? 'referenceStyle' : 'plus'"
          :size="12"
        />
        {{ tool }}
        <b v-if="tool === spec.referenceTools[0] && references.length">{{ references.length }}</b>
        <i v-else-if="tool === '风格' && node.data.stylePreset" aria-hidden="true" />
      </button>
      <button
        ref="expandTrigger"
        class="cv3-expand-prompt"
        type="button"
        :title="expanded ? '收起提示词' : '展开提示词'"
        :aria-label="expanded ? '收起提示词' : '展开提示词'"
        :aria-expanded="expanded"
        :aria-controls="'cv3-prompt-' + node.id"
        @click="setExpanded(!expanded)"
      >
        <CanvasIcon :name="expanded ? 'collapse' : 'expand'" :size="18" />
      </button>
    </div>
    <div v-if="node.data.stylePreset" class="cv3-style-selection" aria-label="已选风格">
      <img
        v-if="node.data.stylePreset.image"
        :src="node.data.stylePreset.image"
        :alt="node.data.stylePreset.title"
      />
      <span>
        <small>当前风格</small>
        <strong>{{ node.data.stylePreset.title }}</strong>
      </span>
      <button
        type="button"
        aria-label="移除当前风格"
        :disabled="generating || interrupted"
        @click="removeStyle"
      >
        <CanvasIcon name="close" :size="11" />
      </button>
    </div>
    <div
      v-if="references.length"
      class="cv3-reference-chips"
      :class="{ 'is-template': editTemplate }"
      role="list"
      aria-label="已引用素材"
    >
      <div
        v-for="(reference, index) in references"
        :key="reference.id"
        class="cv3-reference-card"
        role="listitem"
        :data-reference-id="reference.id"
        :title="reference.data.title"
      >
        <span
          class="cv3-reference-thumbnail"
          :class="{ 'is-open': previewReferenceId === reference.id }"
          role="button"
          tabindex="0"
          aria-haspopup="dialog"
          :aria-expanded="previewReferenceId === reference.id"
          :aria-label="'预览引用：' + reference.data.title"
          @click="toggleReferencePreview(reference, $event)"
          @keydown.enter.prevent="toggleReferencePreview(reference, $event)"
          @keydown.space.prevent="toggleReferencePreview(reference, $event)"
        >
          <span class="cv3-reference-media">
            <img
              v-if="reference.data.assetUrl"
              :src="reference.data.assetUrl"
              :alt="reference.data.title"
              draggable="false"
            />
            <CanvasIcon
              v-else
              :name="NODE_CONTROLS[reference.data.kind] ? reference.data.kind : 'script'"
              :size="20"
            />
          </span>
          <span class="cv3-reference-index" aria-hidden="true">{{ index + 1 }}</span>
          <button
            type="button"
            class="cv3-reference-mention"
            aria-label="@"
            title="添加引用素材"
            :aria-expanded="popup === 'references'"
            @click.stop="togglePopup('references', $event)"
          >
            @
          </button>
          <button
            type="button"
            class="cv3-reference-remove"
            :aria-label="'移除引用：' + reference.data.title"
            :title="'移除 ' + reference.data.title"
            :disabled="generating || interrupted"
            @click.stop="removeReference(reference)"
          >
            <CanvasIcon name="close" :size="12" />
          </button>
          <span
            v-if="reference.data.assetUrl"
            class="cv3-reference-preview"
            role="dialog"
            :aria-label="'引用预览：' + reference.data.title"
            :aria-hidden="previewReferenceId !== reference.id"
          >
            <span class="cv3-reference-preview-frame">
              <img :src="reference.data.assetUrl" alt="" draggable="false" />
            </span>
          </span>
        </span>
      </div>
    </div>
    <p v-if="node.data.legacyReferenceNotice" class="cv3-composer-status" role="note">
      {{ node.data.legacyReferenceNotice }}
    </p>
    <div v-if="editTemplate" class="cv3-template-heading">
      <span
        class="cv3-template-chip"
        :class="{ 'is-open': popup === 'shortcuts' }"
        role="group"
        :aria-label="editTemplate.label + '快捷模块'"
      >
        <span class="cv3-template-symbol"><CanvasIcon :name="shortcutIcon" :size="12" /></span>
        <button
          type="button"
          class="cv3-template-remove"
          :aria-label="'删除' + editTemplate.label + '快捷模块'"
          :disabled="generating"
          @click="selectShortcut(null)"
        >
          <CanvasIcon name="close" :size="14" />
        </button>
        <button
          type="button"
          class="cv3-template-label"
          :aria-label="editTemplate.label + '预设设置'"
          :disabled="generating"
          @click="
            editTemplate.id === 'portrait-emotion'
              ? emit('emotion', node)
              : editTemplate.id === 'multi-angle'
                ? emit('angles', node)
                : togglePopup('template', $event)
          "
        >
          {{ editTemplate.label }}
        </button>
        <button
          type="button"
          class="cv3-template-adjust"
          aria-label="切换快捷模块"
          aria-haspopup="dialog"
          :aria-expanded="popup === 'shortcuts'"
          :disabled="generating"
          @click="togglePopup('shortcuts', $event)"
          @keydown.down.prevent="openShortcutsFromKeyboard"
        >
          <CanvasIcon name="shortcutAdjust" :size="14" />
        </button>
      </span>
      <span>{{ imageEditHint(editTemplate.id) }}</span>
    </div>
    <div
      v-if="
        node.data.kind === 'video' &&
        ['首尾帧', '图生视频', '图片参考', '全能参考'].includes(node.data.mode)
      "
      class="cv3-frame-slots"
    >
      <button type="button" @click="togglePopup('references', $event)">
        <CanvasIcon name="plus" :size="16" />
        {{ node.data.mode === '首尾帧' ? '首帧' : '添加参考图' }}
      </button>
      <button
        v-if="node.data.mode === '首尾帧'"
        type="button"
        @click="togglePopup('references', $event)"
      >
        <CanvasIcon name="plus" :size="16" />
        尾帧
      </button>
    </div>
    <textarea
      :id="'cv3-prompt-' + node.id"
      ref="promptElement"
      :value="node.data.prompt"
      :placeholder="editTemplate ? '补充画面要求（可选）' : spec.promptPlaceholder"
      :class="{ 'is-template-input': editTemplate }"
      :maxlength="node.data.kind === 'audio' ? 2000 : 12000"
      aria-label="生成提示词"
      @focus="promptEditStarted = false"
      @input="editPrompt($event.target.value)"
    />
    <div class="cv3-composer-footer">
      <button
        v-if="controls.models.length"
        ref="modelTrigger"
        type="button"
        class="cv3-model-trigger"
        :class="{ 'is-open': popup === 'models' }"
        aria-label="选择模型"
        aria-haspopup="listbox"
        :aria-expanded="popup === 'models'"
        @click="togglePopup('models')"
        @keydown.down.prevent="openModelsFromKeyboard"
      >
        <CanvasIcon :name="selectedModel?.icon || 'modelLib'" :size="16" />
        <span>{{ modelLabel }}</span>
        <CanvasIcon name="chevron" :size="10" />
      </button>
      <button
        v-if="controls.modes?.length"
        type="button"
        class="cv3-mode-trigger"
        aria-label="生成模式"
        @click="togglePopup('modes', $event)"
      >
        {{ node.data.mode || controls.modes[0] }}
        <CanvasIcon name="chevron" :size="10" />
      </button>
      <span v-if="controls.models.length || controls.modes?.length" class="cv3-composer-divider" />
      <button
        v-if="summary"
        type="button"
        class="cv3-params-trigger"
        aria-label="输出参数"
        aria-haspopup="dialog"
        :aria-expanded="popup === 'params'"
        @click="togglePopup('params', $event)"
      >
        <CanvasIcon name="rectangle" :size="16" />
        {{ summary }}
        <CanvasIcon name="chevron" :size="10" />
      </button>
      <button
        v-if="node.data.kind === 'image'"
        type="button"
        class="cv3-shortcut-trigger"
        :class="{ 'is-open': popup === 'shortcuts' }"
        aria-label="快捷模块"
        aria-haspopup="dialog"
        :aria-expanded="popup === 'shortcuts'"
        :disabled="generating"
        @click="togglePopup('shortcuts', $event)"
        @keydown.down.prevent="openShortcutsFromKeyboard"
      >
        <CanvasIcon name="materials" :size="18" />
        <i aria-hidden="true" />
      </button>
      <span class="cv3-composer-spacer" />
      <span v-if="node.data.kind === 'audio'" class="cv3-text-count">
        {{ node.data.prompt.length }}/2000
      </span>
      <button
        type="button"
        class="cv3-compact-action"
        title="高级设置"
        aria-label="高级设置"
        @click="togglePopup('advanced', $event)"
      >
        <CanvasIcon name="settings" :size="18" />
      </button>
      <span class="cv3-composer-cost" title="预计积分">
        <CanvasIcon name="power" :size="12" />
        {{ cost }}
      </span>
      <button
        type="button"
        class="cv3-generate-button"
        aria-label="生成"
        :aria-busy="generating"
        :disabled="
          generating ||
          (!interrupted && !editTemplate && !node.data.prompt?.trim() && !incoming.length)
        "
        :title="
          generating ? imageTaskFeedback(node.data) : interrupted ? '继续查询原任务' : '生成图片'
        "
        @click="run"
      >
        <span v-if="generating" class="cv3-loading-spinner" />
        <CanvasIcon v-else name="arrowUp" :size="20" />
      </button>
    </div>
    <p v-if="status" class="cv3-composer-status" role="status">{{ status }}</p>
    <p
      v-if="node.data.error || node.data.statusText"
      class="cv3-composer-status"
      :class="{ 'is-error': node.data.error }"
      role="status"
    >
      {{ node.data.error || node.data.statusText }}
    </p>

    <Teleport to=".cv3-app-shell">
      <div
        v-if="popup === 'models'"
        ref="modelMenu"
        class="cv3-model-menu"
        role="listbox"
        aria-label="选择生成模型"
        :data-direction="menuPlacement.direction"
        :style="{
          left: menuPlacement.left + 'px',
          top: menuPlacement.top + 'px',
          width: menuPlacement.width + 'px',
          height: menuPlacement.height + 'px',
        }"
        @keydown.stop="focusModel"
        @keydown.tab="trapExpandedFocus"
        @keydown.esc.stop="closeModels"
      >
        <button
          v-for="model in models"
          :key="model.value"
          type="button"
          role="option"
          class="cv3-model-option"
          :class="{ selected: model.value === node.data.model }"
          :aria-selected="model.value === node.data.model"
          @click="selectModel(model.value)"
        >
          <span class="cv3-model-badge"><CanvasIcon :name="model.icon" :size="16" /></span>
          <span class="cv3-model-copy">
            <span class="cv3-model-name">
              <strong>{{ model.label }}</strong>
              <span v-if="model.latency" class="cv3-model-latency" title="参考预计耗时">
                {{ model.latency }}
              </span>
            </span>
            <small>{{ model.description }}</small>
          </span>
        </button>
      </div>
    </Teleport>
    <Teleport to=".cv3-app-shell">
      <div
        v-if="popup && popup !== 'models'"
        ref="nodePopup"
        class="cv3-node-popup"
        :class="[
          'is-' + popup,
          {
            'is-portrait-settings': popup === 'template' && editTemplate?.id === 'portrait-texture',
          },
        ]"
        role="dialog"
        :aria-label="
          {
            params: '输出参数',
            modes: '生成模式',
            advanced: '高级设置',
            references: '引用画布素材',
            template: '预设提示词',
            shortcuts: '快捷模块',
          }[popup]
        "
        :data-direction="popupPlacement.direction"
        :style="{
          left: popupPlacement.left + 'px',
          top: popupPlacement.top + 'px',
          width: popupPlacement.width + 'px',
          height: popupPlacement.height + 'px',
        }"
        @keydown.stop="popup === 'shortcuts' && focusShortcut($event)"
        @keydown.tab="trapExpandedFocus"
        @keydown.esc.stop="closePopup"
      >
        <header v-if="popup !== 'shortcuts'">
          <strong>
            {{
              {
                params: '输出参数',
                modes: '生成模式',
                advanced: '高级设置',
                references: '引用画布素材',
                template: '预设提示词',
              }[popup]
            }}
          </strong>
          <button type="button" aria-label="关闭节点菜单" @click="closePopup">
            <CanvasIcon name="close" :size="16" />
          </button>
        </header>
        <ImageShortcutMenu
          v-if="popup === 'shortcuts'"
          :selected="editTemplate?.id"
          @select="selectShortcut"
        />
        <template v-else-if="popup === 'template' && editTemplate?.id === 'portrait-texture'">
          <section v-for="field in PORTRAIT_FIELDS" :key="field.key" class="cv3-param-field">
            <label>{{ field.label }}</label>
            <div class="cv3-param-options cv3-portrait-options">
              <button
                v-for="value in field.options"
                :key="value"
                type="button"
                :class="{ selected: portrait[field.key] === value }"
                :aria-pressed="portrait[field.key] === value"
                @click="
                  patch(
                    {
                      editTemplate: {
                        ...node.data.editTemplate,
                        settings: { ...portrait, [field.key]: value },
                      },
                    },
                    true,
                  )
                "
              >
                {{ value }}
              </button>
            </div>
          </section>
        </template>
        <template v-else-if="popup === 'template' && editTemplate">
          <p class="cv3-template-settings-title">{{ editTemplate.label }}</p>
          <textarea
            class="cv3-template-instructions"
            aria-label="模板提示词"
            :value="node.data.editTemplate.instructions ?? editTemplate.prompt"
            maxlength="11000"
            @focus="graph.remember()"
            @input="
              patch({
                editTemplate: { ...node.data.editTemplate, instructions: $event.target.value },
              })
            "
          />
          <button
            type="button"
            class="cv3-popup-row"
            @click="
              patch(
                { editTemplate: { ...node.data.editTemplate, instructions: editTemplate.prompt } },
                true,
              )
            "
          >
            恢复默认提示词
          </button>
        </template>
        <template v-else-if="popup === 'params'">
          <section v-for="(field, key) in controls.fields" :key="key" class="cv3-param-field">
            <label>{{ field[0] }}</label>
            <input
              v-if="field[1] === 'number'"
              :aria-label="field[0]"
              type="number"
              :min="key === 'pitch' ? -12 : key === 'speed' || key === 'volume' ? 0.1 : 1"
              :max="key === 'duration' ? 300 : key === 'pitch' ? 12 : 3"
              :step="key === 'duration' || key === 'pitch' ? 1 : 0.1"
              :value="params[key]"
              @change="setParam(key, Number($event.target.value))"
            />
            <div v-else class="cv3-param-options">
              <button
                v-for="value in field[1]"
                :key="value"
                type="button"
                :class="{ selected: params[key] === value }"
                :aria-pressed="params[key] === value"
                @click="setParam(key, value)"
              >
                {{ value }}
              </button>
            </div>
          </section>
        </template>
        <template v-else-if="popup === 'modes'">
          <button
            v-for="mode in controls.modes"
            :key="mode"
            type="button"
            class="cv3-popup-row"
            @click="selectMode(mode)"
          >
            {{ mode }}
            <CanvasIcon v-if="mode === node.data.mode" name="check" :size="16" />
          </button>
        </template>
        <template v-else-if="popup === 'advanced'">
          <label v-for="toggle in controls.switches" :key="toggle" class="cv3-switch-row">
            <span>{{ toggle }}</span>
            <input
              type="checkbox"
              :checked="node.data.switches?.[toggle] !== false"
              @change="
                patch(
                  { switches: { ...node.data.switches, [toggle]: $event.target.checked } },
                  true,
                )
              "
            />
          </label>
          <p v-if="!controls.switches.length" class="cv3-popup-empty">当前模型没有额外设置</p>
        </template>
        <template v-else-if="popup === 'references'">
          <button
            v-for="source in possibleReferences"
            :key="source.id"
            type="button"
            class="cv3-popup-row"
            @click="addReference(source)"
          >
            <CanvasIcon
              :name="NODE_CONTROLS[source.data.kind] ? source.data.kind : 'script'"
              :size="16"
            />
            {{ source.data.title }}
            <CanvasIcon name="plus" :size="14" />
          </button>
          <p v-if="!possibleReferences.length" class="cv3-popup-empty">
            画布暂无可引用节点。先添加素材或文本节点。
          </p>
          <button type="button" class="cv3-popup-row" @click="requestAssets">
            <i class="ri-upload-2-line" />
            上传或选择素材
          </button>
        </template>
      </div>
    </Teleport>
  </section>
</template>
