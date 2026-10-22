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
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { buildCanvasPricingRequest } from '../config/canvasPricingRequest.js'
import { useCanvasPricing } from '../composables/useCanvasPricing.js'
import { canvasPricingWarning } from '../sync/canvasPricingClient.js'
import { modelPresentation, videoModelOptions } from '../config/modelCatalog'
import {
  isMinimaxH3Model,
  isSeedance20AnciModel,
  isSeedance25Model,
  videoModelControls,
  videoModelParams,
} from '../config/videoModelParameters.js'
import { deriveVideoInputMode } from '../config/videoInputMode.js'
import {
  imageCustomSize,
  imageModelControls,
  imageModelParams,
} from '../config/imageModelParameters.js'
import {
  IMAGE_MODEL_VERSIONS,
  imageModelLabel,
  imageModelMenuOptions,
  imageModelVersion,
} from '../config/imageModelVersions'
import {
  klingModeMenuPlacement,
  modelMenuPlacement,
  nodePopupPlacement,
} from '../config/popupPlacement'
import { isKling30Model, KLING_VIDEO_MODES, klingVideoMode } from '../config/klingVideoModes.js'
import {
  klingOmniControls,
  klingOmniParams,
  klingOmniSummary,
} from '../config/klingOmniParameters.js'
import { klingOmniReferenceState } from '../config/klingOmniReferences.js'
import { isKlingOmniApiModel } from '../config/klingOmniIdentity.js'
import {
  isWanxiangModel,
  wanxiangControls,
  wanxiangParams,
  wanxiangSummary,
} from '../config/wanxiangParameters.js'
import { wanxiangReferenceState } from '../config/wanxiangReferences.js'
import { isOutsidePopup } from '../config/popupDismissal'
import {
  imageEditHint,
  imageEditTemplate,
  imageEditTemplatePrompt,
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
const user = useUserStore()
const generating = computed(() => IMAGE_TASK_ACTIVE_STATES.includes(props.node.data.runState))
const interrupted = computed(
  () =>
    ['paused', 'uncertain'].includes(props.node.data.runState) ||
    Boolean(props.node.data.generation?.unresolvedTaskIds?.length),
)
const popup = ref('')
const composerElement = ref(null)
const composerHeight = ref(188)
const viewportHeight = ref(typeof window === 'undefined' ? 900 : window.innerHeight)
let composerObserver
const composerPosition = computed(() => ({
  left: props.position.x + 'px',
  top:
    Math.max(48, Math.min(props.position.y, viewportHeight.value - composerHeight.value - 16)) +
    'px',
  maxHeight: 'calc(100dvh - 64px)',
  overflowY: composerHeight.value >= viewportHeight.value - 64 ? 'auto' : undefined,
}))
const modelTrigger = ref(null)
const modelMenu = ref(null)
const menuPlacement = ref({})
const nodePopup = ref(null)
const popupTrigger = ref(null)
const popupPlacement = ref({})
const expanded = ref(false)
const advancedOpen = ref(false)
const advancedTrigger = ref(null)
const advancedHelpOpen = ref(false)
const advancedHelpPosition = ref({})
const expandTrigger = ref(null)
const promptElement = ref(null)
const status = ref('')
const previewReferenceId = ref('')
const previewTrigger = ref(null)
const styleGalleryOpen = ref(false)
let promptEditStarted = false
let customSizeEditStarted = false
const spec = computed(() => nodeSpec(props.node.data.kind))
const versionModel = computed(
  () =>
    tasks.imageModels.find((model) => model.value === props.node.data.model) ||
    props.node.data.model,
)
const videoModel = computed(
  () =>
    (tasks.videoModels || []).find((model) => model.value === props.node.data.model) ||
    props.node.data.model,
)
const klingVideo = computed(
  () =>
    props.node.data.kind === 'video' &&
    (isKling30Model(videoModel.value) || isKlingOmniApiModel(videoModel.value)),
)
const wanxiangVideo = computed(
  () => props.node.data.kind === 'video' && isWanxiangModel(videoModel.value),
)
const wanxiangProfile = computed(() => wanxiangControls())
const selectedKlingMode = computed(() => klingVideoMode(props.node.data.mode))
const klingProfile = computed(() =>
  klingOmniControls(selectedKlingMode.value.label, props.node.data.params),
)
const modesVisible = computed(
  () =>
    Boolean(controls.value.modes?.length) && (props.node.data.kind !== 'video' || klingVideo.value),
)
const incoming = computed(() => graph.edges.filter((edge) => edge.target === props.node.id))
const references = computed(() => imageReferences(props.node, graph.nodes, graph.edges))
const klingReferenceState = computed(() =>
  klingOmniReferenceState(selectedKlingMode.value.label, references.value),
)
const wanxiangReferences = computed(() =>
  wanxiangReferenceState(references.value, props.node.data.params),
)
const wanxiangReferenceLabels = computed(() => {
  const counters = { image: 0, video: 0, audio: 0 }
  const prefix = { image: '图', video: '视频', audio: '音频' }
  return references.value.map((reference, index) => {
    const kind = reference.data.kind
    return Object.hasOwn(counters, kind) ? `${prefix[kind]}${++counters[kind]}` : index + 1
  })
})
const videoInput = computed(() =>
  props.node.data.kind === 'video'
    ? wanxiangVideo.value
      ? wanxiangReferences.value
      : deriveVideoInputMode(videoModel.value, references.value)
    : null,
)
const integratedVideo = computed(
  () =>
    props.node.data.kind === 'video' &&
    (isSeedance20AnciModel(videoModel.value) ||
      isSeedance25Model(videoModel.value) ||
      isMinimaxH3Model(videoModel.value) ||
      wanxiangVideo.value),
)
const seedanceAnciPromptMissing = computed(
  () =>
    props.node.data.kind === 'video' &&
    isSeedance20AnciModel(videoModel.value) &&
    !props.node.data.prompt?.trim() &&
    !references.value.some((reference) => {
      const source = reference.data || reference
      return ['text', 'reference', 'script'].includes(source.kind) && source.prompt?.trim()
    }),
)
const videoInputError = computed(() =>
  klingVideo.value ? klingReferenceState.value.errors[0] || '' : videoInput.value?.error || '',
)
const controls = computed(() => {
  const base = NODE_CONTROLS[props.node.data.kind] || {
    defaults: {},
    fields: {},
    models: [],
    switches: [],
  }
  const configured =
    props.node.data.kind === 'image'
      ? { ...base, ...imageModelControls(versionModel.value) }
      : wanxiangVideo.value
        ? { ...base, defaults: {}, fields: {}, switches: [], modes: [] }
        : klingVideo.value
          ? { ...base, defaults: {}, fields: {}, switches: [] }
          : integratedVideo.value
            ? { ...base, ...videoModelControls(videoModel.value, videoInput.value.mode) }
            : base
  if (props.node.data.kind !== 'video') return configured
  const { count: _countDefault, ...defaults } = configured.defaults
  const { count: _countField, ...fields } = configured.fields
  return { ...configured, defaults, fields }
})
const imageVersion = computed(() =>
  props.node.data.kind === 'image'
    ? imageModelVersion(versionModel.value, props.node.data.params?.version)
    : undefined,
)
const params = computed(() =>
  props.node.data.kind === 'image'
    ? imageModelParams(versionModel.value, props.node.data.params)
    : wanxiangVideo.value
      ? wanxiangParams(props.node.data.params)
      : klingVideo.value
        ? klingOmniParams(selectedKlingMode.value.label, props.node.data.params)
        : integratedVideo.value
          ? videoModelParams(videoModel.value, props.node.data.params, videoInput.value.mode)
          : { ...controls.value.defaults, ...props.node.data.params },
)
const customSizeEnabled = computed(
  () => controls.value.customSize && props.node.data.switches?.['自定义尺寸'] === true,
)
const customSizeError = computed(() => {
  if (!customSizeEnabled.value) return ''
  try {
    imageCustomSize(params.value.customSize)
    return ''
  } catch (error) {
    return error.message
  }
})
const editTemplate = computed(() => imageEditTemplate(props.node.data.editTemplate?.id))
const shortcutIcon = computed(
  () =>
    IMAGE_SHORTCUT_COLUMNS.flat()
      .flatMap((group) => group.items)
      .find((item) => item.id === editTemplate.value?.id)?.icon || editTemplate.value?.icon,
)
const portrait = computed(() => portraitSettings(props.node.data.editTemplate?.settings))
const summary = computed(() =>
  wanxiangVideo.value
    ? wanxiangSummary(props.node.data.params)
    : klingVideo.value
      ? klingOmniSummary(selectedKlingMode.value.label, props.node.data.params)
      : [
          parameterSummary(
            props.node.data.kind,
            props.node.data.kind === 'video'
              ? { ...params.value, count: undefined }
              : customSizeEnabled.value
                ? { ...params.value, ratio: params.value.customSize, resolution: undefined }
                : params.value,
          ),
          props.node.data.kind === 'image' && params.value.thinkingLevel
            ? params.value.thinkingLevel + '思考'
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
)
const possibleReferences = computed(() =>
  graph.nodes.filter(
    (node) => node.id !== props.node.id && !references.value.some((ref) => ref.id === node.id),
  ),
)
const modelOptions = computed(() =>
  props.node.data.kind === 'image' && tasks.imageModels.length
    ? imageModelMenuOptions(tasks.imageModels, props.node.data.model)
    : props.node.data.kind === 'video'
      ? videoModelOptions(controls.value.models, tasks.videoModels || [], props.node.data.model)
      : controls.value.models.map((value) => ({ value, label: value })),
)
const models = computed(() =>
  modelOptions.value.map((model) => modelPresentation(model, props.node.data.kind)),
)
const selectedModel = computed(
  () =>
    models.value.find((model) => model.value === props.node.data.model) ||
    (integratedVideo.value || klingVideo.value
      ? modelPresentation(
          {
            value: props.node.data.model,
            model: typeof videoModel.value === 'object' ? videoModel.value.model : videoModel.value,
          },
          'video',
        )
      : undefined),
)
const modelLabel = computed(
  () =>
    modelOptions.value.find((model) => model.value === props.node.data.model)?.label ||
    (props.node.data.kind === 'image'
      ? imageModelLabel(versionModel.value)
      : klingVideo.value
        ? '可灵-Omni'
        : wanxiangVideo.value
          ? '万相 3.0 全能'
          : integratedVideo.value
            ? isSeedance20AnciModel(videoModel.value)
              ? 'Seedance 2.0 按次'
              : isSeedance25Model(videoModel.value)
                ? 'Seedance 2.5 全能'
                : 'MiniMax H3'
            : props.node.data.model) ||
    (props.node.data.directorRunId ? '请选择生图模型' : spec.value.model),
)
const pricedMedia = computed(() => ['image', 'video'].includes(props.node.data.kind))
const pricingInput = computed(() =>
  buildCanvasPricingRequest({
    kind: props.node.data.kind,
    model: props.node.data.model,
    modelOption: props.node.data.kind === 'image' ? versionModel.value : videoModel.value,
    modelOptions: props.node.data.kind === 'image' ? tasks.imageModels : tasks.videoModels,
    params: props.node.data.params,
    mode: klingVideo.value ? selectedKlingMode.value.label : props.node.data.mode,
    // Editing an existing image creates a result node referencing the source
    // image. Quote that same input without creating a draft or mutating the graph.
    references:
      props.node.data.kind === 'image'
        ? imageReferences(props.node, graph.nodes, graph.edges, { draft: true })
        : references.value,
    switches: props.node.data.switches,
  }),
)
const pricing = useCanvasPricing({
  request: pricingInput,
  scope: computed(() => ({
    userId: user.profile?.id,
    token: user.token,
    projectId: graph.projectId,
    nodeId: props.node.id,
  })),
  enabled: computed(() => pricedMedia.value && user.isAuthenticated),
  headers: () => user.authHeaders(),
  path: apiPath,
})
const cost = computed(() =>
  pricedMedia.value
    ? pricing.display.value
    : selectedModel.value?.uiOnly || spec.value.cost === null
      ? '—'
      : (spec.value.cost * (parseInt(params.value.count) || 1)).toFixed(2),
)
const pricingWarning = computed(() => canvasPricingWarning(pricing.quote.value))

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
  if (wanxiangVideo.value) {
    const field = wanxiangProfile.value.fields.find((entry) => entry.key === key)
    if (!field?.options.some((option) => option.value === value) || params.value[key] === value)
      return
    patch({ params: wanxiangParams({ ...props.node.data.params, [key]: value }) }, true)
    return
  }
  if (klingVideo.value) {
    const field = klingProfile.value.fields.find((entry) => entry.key === key)
    if (!field?.options.some((option) => option.value === value) || params.value[key] === value)
      return
    patch(
      {
        params: klingOmniParams(selectedKlingMode.value.label, {
          ...props.node.data.params,
          [key]: value,
        }),
      },
      true,
    )
    return
  }
  if (
    integratedVideo.value &&
    key === 'duration' &&
    (!Number.isInteger(value) ||
      value < controls.value.durationMin ||
      value > controls.value.durationMax)
  ) {
    status.value = `视频时长必须是 ${controls.value.durationMin}～${controls.value.durationMax} 的整数秒`
    return
  }
  patch({ params: { ...params.value, [key]: value } }, true)
}
function recordReferenceMetadata(reference, event) {
  if (!wanxiangVideo.value || !['video', 'audio'].includes(reference.data.kind)) return
  const source = graph.nodes.find((node) => node.id === reference.id)
  if (!source || !references.value.some((node) => node === source)) return
  const media = event.target
  try {
    if (new URL(media.currentSrc || media.src).href !== new URL(source.data.assetUrl).href) return
  } catch {
    return
  }
  if (
    Number.isFinite(media.duration) &&
    media.duration > 0 &&
    source.data.mediaDuration !== media.duration
  )
    graph.updateNodeData(source.id, { mediaDuration: media.duration })
}
function toggleCustomSize(enabled) {
  patch(
    {
      switches: { ...props.node.data.switches, 自定义尺寸: enabled },
      ...(enabled
        ? { params: { ...params.value, customSize: params.value.customSize ?? 'auto' } }
        : {}),
    },
    true,
  )
}
function editCustomSize(value) {
  if (!customSizeEditStarted) graph.remember()
  customSizeEditStarted = true
  patch({ params: { ...params.value, customSize: value } })
}
function updateModelPlacement() {
  if (popup.value !== 'models' || !modelTrigger.value) return
  menuPlacement.value = modelMenuPlacement(
    modelTrigger.value.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    models.value.length,
    props.node.data.kind === 'video' ? { width: 440, itemHeight: 68 } : undefined,
  )
}
function updatePopupPlacement() {
  if (popup.value === 'models') return updateModelPlacement()
  if (!popup.value || !nodePopup.value || !popupTrigger.value) return
  if (popup.value === 'modes' && klingVideo.value) {
    popupPlacement.value = klingModeMenuPlacement(popupTrigger.value.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    return
  }
  const anchor =
    popup.value === 'shortcuts'
      ? composerElement.value?.querySelector('.cv3-template-chip') || popupTrigger.value
      : popupTrigger.value
  let popupHeight = nodePopup.value.scrollHeight + 2
  if (popup.value === 'params' && (klingVideo.value || wanxiangVideo.value)) {
    // Conditional fields can make this panel much shorter. Measure intrinsic
    // content rather than the previous fixed overlay height after a type switch.
    const previousHeight = nodePopup.value.style.height
    nodePopup.value.style.height = 'auto'
    popupHeight = nodePopup.value.scrollHeight + 2
    nodePopup.value.style.height = previousHeight
  }
  popupPlacement.value = nodePopupPlacement(
    anchor.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    {
      width:
        popup.value === 'shortcuts'
          ? 524
          : popup.value === 'params'
            ? klingVideo.value || wanxiangVideo.value
              ? 360
              : 342
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
          : Math.min(
              popup.value === 'params' && (klingVideo.value || wanxiangVideo.value) ? 600 : 500,
              popupHeight,
            ),
    },
  )
}
function updateComposerViewport() {
  viewportHeight.value = window.innerHeight
  updatePopupPlacement()
}
function togglePopup(name, event) {
  if (name === 'modes' && !modesVisible.value) return
  popupTrigger.value = event?.currentTarget || modelTrigger.value
  popup.value = popup.value === name ? '' : name
  if (name === 'models') {
    if (popup.value === 'models' && props.node.data.kind === 'video')
      void tasks.loadVideoModels?.(true)
    updateModelPlacement()
  }
}
function toggleAdvanced(event) {
  if (props.node.data.kind !== 'image') return togglePopup('advanced', event)
  popup.value = ''
  advancedOpen.value = !advancedOpen.value
}
function showAdvancedHelp(event) {
  const anchor = event.currentTarget.getBoundingClientRect()
  advancedHelpPosition.value = {
    left: Math.max(8, Math.min(anchor.left + anchor.width / 2 - 100, window.innerWidth - 208)),
    top: anchor.top - 8,
  }
  advancedHelpOpen.value = true
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
  } else if (advancedOpen.value) {
    event.preventDefault()
    advancedOpen.value = false
    advancedTrigger.value?.focus({ preventScroll: true })
  } else if (expanded.value) {
    event.preventDefault()
    void setExpanded(false)
  }
}
async function openModelsFromKeyboard() {
  popup.value = 'models'
  if (props.node.data.kind === 'video') void tasks.loadVideoModels?.(true)
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
  if (previewReferenceId.value || popup.value || advancedOpen.value || expanded.value) {
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
async function openModesFromKeyboard(event) {
  if (!modesVisible.value) return
  popupTrigger.value = event.currentTarget
  popup.value = 'modes'
  await nextTick()
  updatePopupPlacement()
  const options = nodePopup.value?.querySelectorAll('[role="menuitemradio"]:not(:disabled)')
  if (!options?.length) return
  const selected = [...options].find((option) => option.getAttribute('aria-checked') === 'true')
  const target = selected || options[event.key === 'ArrowUp' ? options.length - 1 : 0]
  target?.focus()
}
function handlePopupKeydown(event) {
  if (popup.value === 'shortcuts') return focusShortcut(event)
  if (popup.value !== 'modes' || !klingVideo.value) return
  if (event.key === 'Tab' && !expanded.value) {
    // Let native Tab navigation keep its destination instead of returning focus
    // to the trigger. Expanded composers retain their existing focus trap.
    popup.value = ''
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const options = [...nodePopup.value.querySelectorAll('[role="menuitemradio"]:not(:disabled)')]
  if (!options.length) return
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
  [() => props.node.id, () => props.node.data.kind, () => props.node.data.model, klingVideo],
  () => {
    // A mode popover belongs to this exact node/model; never carry it to another
    // model or normalize the saved mode just because the composer was opened.
    if (
      popup.value === 'modes' ||
      ((klingVideo.value || wanxiangVideo.value) && popup.value === 'advanced')
    )
      popup.value = ''
  },
)
watch(
  () => [
    props.position.x,
    props.position.y,
    composerHeight.value,
    viewportHeight.value,
    expanded.value,
    models.value.length,
    klingVideo.value ? selectedKlingMode.value.label : '',
    klingVideo.value ? klingProfile.value.fields.length : 0,
    klingVideo.value ? JSON.stringify(klingReferenceState.value) : '',
    wanxiangVideo.value ? JSON.stringify(wanxiangReferences.value) : '',
    popup.value,
  ],
  async () => {
    await nextTick()
    updatePopupPlacement()
  },
)
watch(
  [() => props.node.id, () => props.node.data.kind],
  () => {
    advancedOpen.value = false
    advancedHelpOpen.value = false
    customSizeEditStarted = false
    if (props.node.data.kind === 'video') void tasks.loadVideoModels?.()
  },
  { immediate: true },
)
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    composerObserver = new ResizeObserver(() => {
      composerHeight.value = composerElement.value?.getBoundingClientRect().height || 188
    })
    if (composerElement.value) composerObserver.observe(composerElement.value)
  }
  document.addEventListener('pointerdown', closeOnOutside, true)
  document.addEventListener('keydown', closeOnEscape)
  window.addEventListener('resize', updateComposerViewport)
})
onBeforeUnmount(() => {
  composerObserver?.disconnect()
  document.removeEventListener('pointerdown', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
  window.removeEventListener('resize', updateComposerViewport)
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
  const data = { model }
  if (props.node.data.kind === 'image' && model !== props.node.data.model) {
    const { version: _previousVersion, ...otherParams } = props.node.data.params || {}
    const targetModel = tasks.imageModels.find((option) => option.value === model) || model
    data.params = imageModelParams(targetModel, otherParams)
  }
  if (props.node.data.kind === 'video' && model !== props.node.data.model) {
    const targetModel = (tasks.videoModels || []).find((option) => option.value === model) || model
    const inferred = deriveVideoInputMode(targetModel, references.value)
    const profile = videoModelControls(targetModel, inferred.mode)
    if (isWanxiangModel(targetModel)) {
      data.params = wanxiangParams(props.node.data.params)
    } else if (isKling30Model(targetModel) || isKlingOmniApiModel(targetModel)) {
      data.params = klingOmniParams(props.node.data.mode, props.node.data.params)
    } else if (profile.id !== 'generic') {
      data.params = videoModelParams(targetModel, props.node.data.params, inferred.mode)
    }
  }
  patch(data, true)
  closePopup()
}
function selectMode(mode) {
  if (props.node.data.kind === 'video') {
    if (
      !klingVideo.value ||
      !KLING_VIDEO_MODES.some((item) => item.label === mode && !item.disabled)
    )
      return
    if (
      props.node.data.mode === mode ||
      (!props.node.data.mode && selectedKlingMode.value.label === mode)
    ) {
      closePopup()
      return
    }
  }
  patch(
    klingVideo.value ? { mode, params: klingOmniParams(mode, props.node.data.params) } : { mode },
    true,
  )
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
  if (integratedVideo.value || klingVideo.value) {
    void tasks.runVideo(props.node.id, (target) => emit('generated', target))
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
    :class="{ 'is-expanded': expanded, 'is-wanxiang': wanxiangVideo }"
    :style="expanded ? undefined : composerPosition"
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
              v-if="reference.data.assetUrl && reference.data.kind === 'image'"
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
          <span class="cv3-reference-index" aria-hidden="true">
            {{ wanxiangVideo ? wanxiangReferenceLabels[index] : index + 1 }}
          </span>
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
            :class="{ 'is-playable': ['video', 'audio'].includes(reference.data.kind) }"
            role="dialog"
            :aria-label="'引用预览：' + reference.data.title"
            :aria-hidden="previewReferenceId !== reference.id"
          >
            <span class="cv3-reference-preview-frame">
              <img
                v-if="reference.data.kind === 'image'"
                :src="reference.data.assetUrl"
                alt=""
                draggable="false"
              />
              <video
                v-else-if="reference.data.kind === 'video'"
                :src="reference.data.assetUrl"
                controls
                preload="metadata"
                :aria-label="reference.data.title"
                @loadedmetadata="recordReferenceMetadata(reference, $event)"
                @click.stop
                @keydown.stop
              />
              <audio
                v-else-if="reference.data.kind === 'audio'"
                :src="reference.data.assetUrl"
                controls
                preload="metadata"
                :aria-label="reference.data.title"
                @loadedmetadata="recordReferenceMetadata(reference, $event)"
                @click.stop
                @keydown.stop
              />
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
    <textarea
      :id="'cv3-prompt-' + node.id"
      ref="promptElement"
      :value="node.data.prompt"
      :placeholder="editTemplate ? '补充画面要求（可选）' : spec.promptPlaceholder"
      :class="{ 'is-template-input': editTemplate }"
      :maxlength="
        node.data.kind === 'audio'
          ? 2000
          : integratedVideo && isMinimaxH3Model(videoModel)
            ? 7000
            : 12000
      "
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
        v-if="modesVisible"
        type="button"
        class="cv3-mode-trigger"
        :class="{ 'cv3-kling-mode-trigger': klingVideo, 'is-open': popup === 'modes' }"
        aria-label="生成模式"
        :aria-haspopup="klingVideo ? 'menu' : 'dialog'"
        :aria-expanded="popup === 'modes'"
        :aria-controls="klingVideo ? 'cv3-kling-modes-' + node.id : undefined"
        @click="togglePopup('modes', $event)"
        @keydown.down.prevent="openModesFromKeyboard"
        @keydown.up.prevent="openModesFromKeyboard"
      >
        <CanvasIcon v-if="klingVideo" :name="selectedKlingMode.icon" :size="14" />
        {{ klingVideo ? selectedKlingMode.label : node.data.mode || controls.modes[0] }}
        <CanvasIcon name="chevron" :size="10" />
      </button>
      <span v-if="controls.models.length || controls.modes?.length" class="cv3-composer-divider" />
      <button
        v-if="summary"
        type="button"
        class="cv3-params-trigger"
        :class="{ 'cv3-omni-params-trigger': klingVideo || wanxiangVideo }"
        aria-label="输出参数"
        :title="klingVideo || wanxiangVideo ? summary : undefined"
        aria-haspopup="dialog"
        :aria-expanded="popup === 'params'"
        @click="togglePopup('params', $event)"
      >
        <CanvasIcon name="rectangle" :size="16" />
        <span v-if="klingVideo || wanxiangVideo" class="cv3-omni-summary">{{ summary }}</span>
        <template v-else>{{ summary }}</template>
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
        v-if="!klingVideo && !wanxiangVideo"
        ref="advancedTrigger"
        type="button"
        class="cv3-compact-action"
        :class="{ 'is-open': node.data.kind === 'image' ? advancedOpen : popup === 'advanced' }"
        title="高级设置"
        aria-label="高级设置"
        :aria-expanded="node.data.kind === 'image' ? advancedOpen : popup === 'advanced'"
        :aria-controls="node.data.kind === 'image' ? 'cv3-image-advanced-' + node.id : undefined"
        :aria-haspopup="node.data.kind === 'image' ? undefined : 'dialog'"
        @click="toggleAdvanced"
      >
        <svg
          v-if="node.data.kind === 'image'"
          class="cv3-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M14 17H5M19 7h-9" />
          <circle cx="17" cy="17" r="3" />
          <circle cx="7" cy="7" r="3" />
        </svg>
        <CanvasIcon v-else name="settings" :size="18" />
      </button>
      <span
        class="cv3-composer-cost"
        :title="pricedMedia ? pricing.title.value : '预计米值，以实际结算为准'"
        :data-pricing-state="pricedMedia ? pricing.status.value : undefined"
        :aria-busy="pricedMedia && pricing.status.value === 'loading'"
        aria-live="polite"
      >
        预计 {{ cost }} 米值
      </span>
      <button
        type="button"
        class="cv3-generate-button"
        aria-label="生成"
        :aria-busy="generating"
        :disabled="
          generating ||
          (!interrupted && (integratedVideo || klingVideo) && Boolean(videoInputError)) ||
          (!interrupted && seedanceAnciPromptMissing) ||
          (!interrupted && !editTemplate && !node.data.prompt?.trim() && !incoming.length)
        "
        :title="
          generating
            ? imageTaskFeedback(node.data)
            : interrupted
              ? '继续查询原任务'
              : (integratedVideo || klingVideo) && videoInputError
                ? videoInputError
                : seedanceAnciPromptMissing
                  ? 'Seedance 2.0 按次必须提供提示词，可输入文字或连接文本节点'
                  : node.data.kind === 'video'
                    ? '生成视频'
                    : '生成图片'
        "
        @click="run"
      >
        <span v-if="generating" class="cv3-loading-spinner" />
        <CanvasIcon v-else name="arrowUp" :size="20" />
      </button>
    </div>
    <section
      v-if="node.data.kind === 'image'"
      :id="'cv3-image-advanced-' + node.id"
      class="cv3-image-advanced"
      :class="{ 'is-open': advancedOpen }"
      role="region"
      aria-label="高级设置"
      :aria-hidden="!advancedOpen"
      :inert="!advancedOpen"
    >
      <div class="cv3-image-advanced-inner">
        <div class="cv3-image-advanced-content">
          <h3>高级设置</h3>
          <div v-if="controls.webSearch" class="cv3-image-advanced-row">
            <span class="cv3-image-advanced-label">联网搜索</span>
            <label class="cv3-autolink-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label="联网搜索"
                :checked="node.data.switches?.['联网搜索'] !== false"
                @change="
                  patch(
                    { switches: { ...node.data.switches, 联网搜索: $event.target.checked } },
                    true,
                  )
                "
              />
              <span aria-hidden="true" />
            </label>
          </div>
          <template v-if="controls.customSize">
            <div class="cv3-image-advanced-row">
              <div class="cv3-image-advanced-label">
                <span>自定义尺寸</span>
                <span class="cv3-autolink-help">
                  <button
                    type="button"
                    aria-label="关于自定义尺寸"
                    :aria-describedby="
                      advancedHelpOpen ? 'cv3-custom-size-tooltip-' + node.id : undefined
                    "
                    @mouseenter="showAdvancedHelp"
                    @mouseleave="advancedHelpOpen = false"
                    @focus="showAdvancedHelp"
                    @blur="advancedHelpOpen = false"
                  >
                    <CanvasIcon name="help" :size="14" />
                  </button>
                </span>
              </div>
              <label class="cv3-autolink-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="自定义尺寸"
                  :checked="customSizeEnabled"
                  @change="toggleCustomSize($event.target.checked)"
                />
                <span aria-hidden="true" />
              </label>
            </div>
            <div v-if="customSizeEnabled" class="cv3-custom-size">
              <input
                type="text"
                aria-label="自定义像素尺寸"
                placeholder="1536x864 或 auto"
                autocomplete="off"
                spellcheck="false"
                :value="params.customSize"
                :aria-invalid="Boolean(customSizeError)"
                :aria-describedby="'cv3-custom-size-help-' + node.id"
                @input="editCustomSize($event.target.value)"
                @blur="customSizeEditStarted = false"
              />
              <p :id="'cv3-custom-size-help-' + node.id">
                启用后覆盖比例与清晰度。宽高须为 16 的倍数，比例 1:3～3:1，总像素 655360～8294400。
              </p>
              <p v-if="customSizeError" class="is-error" role="alert">{{ customSizeError }}</p>
            </div>
          </template>
          <p v-if="!controls.customSize && !controls.webSearch" class="cv3-popup-empty">
            当前模型没有额外设置
          </p>
        </div>
      </div>
    </section>
    <p v-if="pricingWarning" class="cv3-composer-status cv3-pricing-warning" role="status">
      {{ pricingWarning }}
    </p>
    <p v-if="status" class="cv3-composer-status" role="status">{{ status }}</p>
    <p
      v-if="(integratedVideo || klingVideo) && videoInputError && !interrupted"
      class="cv3-composer-status is-error"
      role="status"
    >
      {{ videoInputError }}
    </p>
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
        v-if="advancedHelpOpen && advancedOpen && controls.customSize"
        :id="'cv3-custom-size-tooltip-' + node.id"
        class="cv3-autolink-tooltip"
        role="tooltip"
        :style="{ left: advancedHelpPosition.left + 'px', top: advancedHelpPosition.top + 'px' }"
      >
        支持像素宽x高（如 1536x864）或 auto。宽高须为 16 的倍数，比例 1:3～3:1，总像素
        655360～8294400。启用后覆盖比例与清晰度。
        <i aria-hidden="true" />
      </div>
      <div
        v-if="popup === 'models'"
        ref="modelMenu"
        class="cv3-model-menu"
        :class="{ 'cv3-video-model-menu': node.data.kind === 'video' }"
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
          <CanvasIcon
            v-if="node.data.kind === 'video' && model.value === node.data.model"
            name="check"
            :size="18"
          />
        </button>
      </div>
    </Teleport>
    <Teleport to=".cv3-app-shell">
      <div
        v-if="popup && popup !== 'models' && (popup !== 'modes' || modesVisible)"
        :id="popup === 'modes' && klingVideo ? 'cv3-kling-modes-' + node.id : undefined"
        ref="nodePopup"
        class="cv3-node-popup"
        :class="[
          'is-' + popup,
          {
            'is-portrait-settings': popup === 'template' && editTemplate?.id === 'portrait-texture',
            'is-kling-modes': popup === 'modes' && klingVideo,
            'is-omni-params': popup === 'params' && (klingVideo || wanxiangVideo),
          },
        ]"
        :role="popup === 'modes' && klingVideo ? 'menu' : 'dialog'"
        :aria-label="
          {
            params: '输出参数',
            modes: klingVideo ? '视频生成模式' : '生成模式',
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
        @keydown.stop="handlePopupKeydown"
        @keydown.tab="trapExpandedFocus"
        @keydown.esc.stop="closePopup"
      >
        <header v-if="popup !== 'shortcuts' && !(popup === 'modes' && klingVideo)">
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
        <template v-if="popup === 'modes' && klingVideo">
          <p class="cv3-kling-modes-heading">视频生成模式</p>
          <button
            v-for="mode in KLING_VIDEO_MODES"
            :key="mode.label"
            type="button"
            role="menuitemradio"
            class="cv3-kling-mode-option"
            :class="{ selected: selectedKlingMode.label === mode.label }"
            :aria-checked="selectedKlingMode.label === mode.label"
            :disabled="mode.disabled"
            :title="mode.reason"
            @click="selectMode(mode.label)"
          >
            <CanvasIcon :name="mode.icon" :size="14" />
            <span>{{ mode.label }}</span>
          </button>
        </template>
        <ImageShortcutMenu
          v-else-if="popup === 'shortcuts'"
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
            :value="imageEditTemplatePrompt(node.data)"
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
              patch({ editTemplate: { ...node.data.editTemplate, instructions: undefined } }, true)
            "
          >
            恢复默认提示词
          </button>
        </template>
        <template v-else-if="popup === 'params'">
          <template v-if="wanxiangVideo">
            <div class="cv3-omni-param-context" :data-api-model="wanxiangProfile.apiModel">
              <CanvasIcon name="modelWanxiang" :size="16" />
              <strong>万相 3.0 全能 · 全能参考</strong>
            </div>
            <section
              v-for="field in wanxiangProfile.fields"
              :key="field.key"
              class="cv3-param-field cv3-omni-param-field"
              :data-param="field.key"
            >
              <label>{{ field.label }}</label>
              <span v-if="field.required" class="cv3-omni-required">必填</span>
              <div
                class="cv3-param-options"
                :class="{ 'cv3-wanxiang-duration-options': field.key === 'duration' }"
              >
                <button
                  v-for="option in field.options"
                  :key="String(option.value)"
                  type="button"
                  :class="{ selected: params[field.key] === option.value }"
                  :aria-pressed="params[field.key] === option.value"
                  :data-value="String(option.value)"
                  @click="setParam(field.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </section>
            <section class="cv3-omni-material-requirements" aria-label="万相参考素材要求">
              <div class="cv3-omni-material-counts">
                <span>
                  <CanvasIcon name="image" :size="13" />
                  图片 {{ wanxiangReferences.counts.image }}/10
                </span>
                <span>
                  <CanvasIcon name="video" :size="13" />
                  视频 {{ wanxiangReferences.counts.video }}/5
                </span>
                <span>
                  <CanvasIcon name="audio" :size="13" />
                  音频 {{ wanxiangReferences.counts.audio }}/5
                </span>
              </div>
              <p class="cv3-omni-material-hint">
                素材来自画布连线或「参考」中已添加的节点，可用“图1”“视频1”“音频1”指代。
              </p>
              <p class="cv3-omni-material-hint">
                参考视频和参考音频各自总时长不超过15秒；成片与参考视频合计不超过30秒。
              </p>
              <p
                v-if="
                  wanxiangReferences.counts.video &&
                  Number.isFinite(wanxiangReferences.videoDurationSeconds)
                "
                class="cv3-omni-material-hint"
              >
                已引用视频
                {{ Number(wanxiangReferences.videoDurationSeconds.toFixed(2)) }} 秒，成片最多
                {{ Number(wanxiangReferences.maxOutputDurationSeconds.toFixed(2)) }} 秒。
              </p>
              <p
                v-if="
                  wanxiangReferences.counts.audio &&
                  Number.isFinite(wanxiangReferences.audioDurationSeconds)
                "
                class="cv3-omni-material-hint"
              >
                已引用音频 {{ Number(wanxiangReferences.audioDurationSeconds.toFixed(2)) }} 秒。
              </p>
              <p
                v-for="error in wanxiangReferences.errors"
                :key="error"
                class="cv3-omni-material-error"
                role="alert"
              >
                {{ error }}
              </p>
              <p
                v-for="warning in wanxiangReferences.warnings"
                :key="warning"
                class="cv3-omni-material-warning"
              >
                {{ warning }}
              </p>
            </section>
            <aside class="cv3-omni-param-notes" aria-label="万相参数说明">
              <p v-for="note in wanxiangProfile.notes" :key="note">{{ note }}</p>
            </aside>
          </template>
          <template v-else-if="klingVideo">
            <div class="cv3-omni-param-context" :data-api-model="klingProfile.apiModel">
              <CanvasIcon :name="selectedKlingMode.icon" :size="16" />
              <strong>可灵-Omni · {{ klingProfile.label }}</strong>
            </div>
            <section
              v-for="field in klingProfile.fields"
              :key="field.key"
              class="cv3-param-field cv3-omni-param-field"
              :data-param="field.key"
            >
              <label>{{ field.label }}</label>
              <span v-if="field.required" class="cv3-omni-required">必填</span>
              <div class="cv3-param-options">
                <button
                  v-for="option in field.options"
                  :key="option.value"
                  type="button"
                  :class="{ selected: params[field.key] === option.value }"
                  :aria-pressed="params[field.key] === option.value"
                  :data-value="option.value"
                  @click="setParam(field.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </section>
            <section class="cv3-omni-material-requirements" aria-label="画布素材要求">
              <div class="cv3-omni-material-counts">
                <span>
                  <CanvasIcon name="image" :size="13" />
                  {{ klingProfile.assetLimits.images.label }}
                  {{ klingReferenceState.counts.image }}/{{ klingProfile.assetLimits.images.max }}
                </span>
                <span v-if="klingProfile.assetLimits.video">
                  <CanvasIcon name="video" :size="13" />
                  参考视频 {{ klingReferenceState.counts.video }}/1
                </span>
              </div>
              <p class="cv3-omni-material-hint">素材使用画布连线或「参考」中已添加的节点。</p>
              <p
                v-for="error in klingReferenceState.errors"
                :key="error"
                class="cv3-omni-material-error"
                role="alert"
              >
                {{ error }}
              </p>
              <p
                v-for="warning in klingReferenceState.warnings"
                :key="warning"
                class="cv3-omni-material-warning"
              >
                {{ warning }}
              </p>
            </section>
            <aside class="cv3-omni-param-notes" aria-label="当前模式参数说明">
              <p v-for="note in klingProfile.notes" :key="note">{{ note }}</p>
            </aside>
          </template>
          <template v-else>
            <p v-if="customSizeEnabled" class="cv3-custom-size-notice">
              已启用自定义尺寸，比例与清晰度由自定义尺寸决定。
            </p>
            <section v-if="imageVersion" class="cv3-param-field">
              <label>版本</label>
              <div class="cv3-param-options">
                <button
                  v-for="version in IMAGE_MODEL_VERSIONS"
                  :key="version.value"
                  type="button"
                  :class="{ selected: imageVersion === version.value }"
                  :aria-pressed="imageVersion === version.value"
                  @click="setParam('version', version.value)"
                >
                  {{ version.label }}
                </button>
              </div>
            </section>
            <section v-for="(field, key) in controls.fields" :key="key" class="cv3-param-field">
              <label>{{ field[0] }}</label>
              <input
                v-if="field[1] === 'number'"
                :aria-label="field[0]"
                type="number"
                :min="
                  key === 'duration' && controls.durationMin != null
                    ? controls.durationMin
                    : key === 'pitch'
                      ? -12
                      : key === 'speed' || key === 'volume'
                        ? 0.1
                        : 1
                "
                :max="key === 'duration' ? (controls.durationMax ?? 300) : key === 'pitch' ? 12 : 3"
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
                  :disabled="customSizeEnabled && ['ratio', 'resolution'].includes(key)"
                  @click="setParam(key, value)"
                >
                  {{ value }}
                </button>
              </div>
              <p
                v-if="
                  key === 'ratio' &&
                  integratedVideo &&
                  isSeedance25Model(videoModel) &&
                  videoInput.id === 'first-frame'
                "
                class="cv3-video-ratio-note"
                role="note"
              >
                当前 Seedance 2.5 单张图片的首帧任务仅支持自适应比例。
              </p>
            </section>
            <p
              v-if="
                integratedVideo &&
                isSeedance20AnciModel(videoModel) &&
                params.version === '标准' &&
                params.duration === 15
              "
              class="cv3-video-ratio-note"
              role="note"
            >
              标准版选择15秒时，上游实际成片约10秒，仍按次计费。
            </p>
          </template>
        </template>
        <template v-else-if="popup === 'modes' && node.data.kind !== 'video'">
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
              :checked="
                integratedVideo
                  ? node.data.switches?.[toggle] === true
                  : node.data.switches?.[toggle] !== false
              "
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

<style scoped>
.is-wanxiang .cv3-reference-index {
  width: auto;
  min-width: 14px;
  padding: 0 2px;
}
.cv3-wanxiang-duration-options {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.cv3-wanxiang-duration-options button {
  min-width: 0;
  padding-inline: 4px;
}
.cv3-wanxiang-duration-options button:first-child {
  grid-column: span 2;
}
.cv3-video-ratio-note {
  margin: 8px 0 0;
  color: #929292;
  font-size: 12px;
  line-height: 1.5;
}
.cv3-reference-preview.is-playable {
  pointer-events: auto;
}
.cv3-reference-preview.is-playable .cv3-reference-preview-frame {
  width: 280px;
  max-height: 180px;
}
.cv3-reference-preview-frame video {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: contain;
}
.cv3-reference-preview-frame audio {
  display: block;
  width: 100%;
}
</style>
