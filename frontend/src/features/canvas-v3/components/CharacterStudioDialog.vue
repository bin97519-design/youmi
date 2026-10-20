<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useCanvasV3TaskStore } from '../stores/tasks'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { uploadFileDirect } from '../../../utils/ossUpload'
import { imageMiCost } from '../../../utils/imageMiPricing'
import {
  CHARACTER_STUDIO_TEMPLATES,
  characterStudioPortraitPreview,
  characterStudioAssetPreview,
} from '../config/characterStudioCatalog'
import { characterStudioVisualConfig } from '../config/characterStudioControls'
import { characterStudioAssetFormat } from '../config/characterStudioAssetFormats'
import {
  characterStudioGenerationSpec,
  characterStudioPayload,
  characterStudioPrompt,
} from '../config/characterStudioRuntime'
import { createCharacterAssetClient } from '../sync/characterAssetClient'
import CharacterStudioLibrary from './CharacterStudioLibrary.vue'
import CharacterStudioEditor from './CharacterStudioEditor.vue'
import CharacterStudioAssetViewer from './CharacterStudioAssetViewer.vue'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({ projectId: { type: String, required: true } })
const emit = defineEmits(['close'])
const graph = useCanvasV3GraphStore()
const tasks = useCanvasV3TaskStore()
const user = useUserStore()
const client = createCharacterAssetClient({ path: apiPath, headers: () => user.authHeaders() })
const dialog = ref(null)
const closeButton = ref(null)
const view = ref('library')
const items = ref([])
const loading = ref(false)
const saving = ref(false)
const personalLibraryBusy = ref(false)
const error = ref('')
const notice = ref('')
const character = ref(null)
const editorTab = ref('face')
const description = ref('')
const createReference = ref(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadInput = ref(null)
const uploadPurpose = ref('import')
const picker = ref('')
const inspected = ref(null)
const ageCharacter = ref(null)
const ageTarget = ref('青年')
const confirmation = ref(null)
const submitting = ref(false)
const resuming = ref(false)
const selectedModel = ref('')
const selectedRatio = ref('3:4')
const selectedResolution = ref('2K')
const deleteItems = ref([])
const pendingInsert = new Set()
const reconciled = new Set()
let disposed = false
let uploadController
let previousFocus
let requestVersion = 0
let reconciling = false
let reconcileQueued = false
let generationPreviousFocus
const clone = (value) => JSON.parse(JSON.stringify(value))
const assetLabels = Object.freeze(
  Object.fromEntries(
    ['full-body', 'half-body', 'emotion-grid', 'character-sheet'].map((type) => [
      type,
      characterStudioAssetFormat(type).label,
    ]),
  ),
)
const assetLabel = (type) =>
  Object.hasOwn(assetLabels, type) ? assetLabels[type] : assetLabels['character-sheet']
const displayLabel = (value) => value.replaceAll('角色', '模特')
const id = () => globalThis.crypto.randomUUID()
const canvasImages = computed(() =>
  graph.nodes.filter(
    (node) => node.data.kind === 'image' && /^https?:\/\//i.test(node.data.assetUrl || ''),
  ),
)
const cost = computed(() => imageMiCost(selectedModel.value, selectedResolution.value, 1))
const busy = computed(() => saving.value || submitting.value || uploading.value)
const assetFormat = computed(() =>
  confirmation.value?.kind === 'assets'
    ? characterStudioAssetFormat(confirmation.value.assetType)
    : null,
)
const assetPromptPreview = computed(() => {
  if (!assetFormat.value) return ''
  try {
    return characterStudioPrompt(
      confirmation.value.character,
      'assets',
      confirmation.value.instruction,
      confirmation.value.assetType,
      selectedRatio.value,
    )
  } catch {
    // Submission still runs the same validation and shows its actionable error.
    return ''
  }
})
const canConfirm = computed(
  () =>
    !busy.value &&
    !tasks.modelError &&
    tasks.imageModels.some((model) => model.value === selectedModel.value && !model.disabled),
)
const pendingJobs = computed(() =>
  items.value.filter(
    (item) =>
      item.config?.generation?.projectId === props.projectId && item.config.generation.nodeId,
  ),
)

function blankCharacter() {
  return {
    name: '未命名模特',
    description: '',
    gender: '',
    ageGroup: '',
    culture: '',
    imageUrl: '',
    coverUrl: '',
    config: {},
  }
}
function previewImage(record) {
  return characterStudioPortraitPreview(record)
}
async function loadLibrary() {
  const version = ++requestVersion
  error.value = ''
  if (!user.token) {
    error.value = '登录有米账号后即可保存并跨画布复用我的模特库'
    return
  }
  loading.value = true
  try {
    const result = await client.list()
    if (!disposed && version === requestVersion) {
      reconciled.clear()
      items.value = result
    }
  } catch (failure) {
    if (!disposed && version === requestVersion) error.value = failure.message
  } finally {
    if (!disposed && version === requestVersion) loading.value = false
  }
}
function createCharacter(method) {
  error.value = ''
  notice.value = ''
  description.value = ''
  createReference.value = null
  character.value = blankCharacter()
  view.value = method === 'import' ? 'import' : 'create'
}
function editCharacter(item, tab = 'face') {
  error.value = ''
  notice.value = ''
  editorTab.value = tab === 'voice' ? 'voice' : 'face'
  character.value = clone(item)
  if (item.official) {
    delete character.value.id
    delete character.value.official
    character.value.name += ' - 副本'
  }
  view.value = 'editor'
}
function updateCharacter(value) {
  character.value = clone(value)
}
function returnToLibrary() {
  view.value = 'library'
  error.value = ''
  notice.value = ''
}
async function saveCharacter(record, insert = false, background = false) {
  if (!user.requireLogin() || saving.value) return null
  saving.value = true
  error.value = ''
  try {
    const saved = await client.save(characterStudioPayload(record))
    if (disposed) return saved
    items.value = [saved, ...items.value.filter((item) => item.id !== saved.id)]
    if (!background) character.value = clone(saved)
    else if (character.value?.id === saved.id) {
      character.value = {
        ...character.value,
        imageUrl: saved.imageUrl,
        coverUrl: saved.coverUrl,
        config: {
          ...character.value.config,
          generation: saved.config?.generation,
          assets: saved.config?.assets,
          appliedVisualConfig: saved.config?.appliedVisualConfig,
        },
      }
    }
    if (insert) insertCharacters([saved])
    notice.value = '模特已保存到我的模特库，可在其他画布继续使用'
    return saved
  } catch (failure) {
    if (!disposed) error.value = failure.message
    return null
  } finally {
    saving.value = false
    if (reconcileQueued && !reconciling && !disposed) {
      reconcileQueued = false
      void reconcileGeneratedAssets()
    }
  }
}
function insertCharacters(records) {
  graph.remember()
  let inserted = 0
  for (const record of records) {
    if (!/^https?:\/\//i.test(record.imageUrl || record.coverUrl || '')) continue
    const node = graph.addNode('image', { x: 80 + inserted * 330, y: 120 })
    graph.updateNodeData(node.id, {
      title: record.name || '模特参考',
      assetUrl: record.imageUrl || record.coverUrl,
      artifactStatus: 'ready',
      mediaOrigin: 'upload',
      characterStudio: {
        assetId: record.id || '',
        name: record.name,
        config: clone(record.config || {}),
      },
    })
    inserted += 1
  }
  notice.value = inserted
    ? `已将 ${inserted} 个模特添加到当前画布`
    : '模特还没有可用图片，请先导入或生成'
}
function chooseUpload(purpose) {
  if (busy.value) return
  uploadPurpose.value = purpose
  uploadInput.value?.click()
}
async function uploadImage(file, purpose = uploadPurpose.value) {
  if (!file || uploading.value) return
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    error.value = '请选择 PNG、JPG、WebP 等图片文件'
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    error.value = '图片不能超过 20 MB'
    return
  }
  if (!user.requireLogin()) return
  uploading.value = true
  uploadProgress.value = 0
  error.value = ''
  uploadController = new AbortController()
  try {
    const result = await uploadFileDirect(file, {
      dir: 'character-studio',
      signal: uploadController.signal,
      onProgress: (value) => {
        uploadProgress.value = typeof value === 'number' ? value : value.percent || 0
      },
    })
    const url = typeof result === 'string' ? result : result.url
    if (!/^https?:\/\//i.test(url || '')) throw new Error('上传未返回可用图片地址，请重试')
    if (disposed) return
    applyImage({ url, name: file.name }, purpose)
  } catch (failure) {
    if (!disposed && failure.name !== 'AbortError')
      error.value = failure.message || '图片上传失败，请重试'
  } finally {
    uploading.value = false
    uploadController = null
    if (uploadInput.value) uploadInput.value.value = ''
  }
}
function applyImage(asset, purpose = picker.value) {
  const url = asset.url || asset.imageUrl || asset.data?.assetUrl
  if (!/^https?:\/\//i.test(url || '')) return
  if (purpose === 'create')
    createReference.value = { url, name: asset.name || asset.data?.title || '参考图片' }
  else if (purpose === 'styling') {
    character.value = {
      ...character.value,
      config: { ...character.value.config, styleReferenceUrls: [url] },
    }
  } else if (purpose === 'decal') {
    const config = character.value.config || {}
    character.value = {
      ...character.value,
      config: {
        ...config,
        features: {
          ...config.features,
          decals: [
            ...(config.features?.decals || []),
            { id: id(), kind: 'custom', url, x: 50, y: 50, rotation: 0, scale: 1 },
          ],
        },
      },
    }
  } else {
    character.value = {
      ...blankCharacter(),
      name: (asset.name || asset.data?.title || '未命名模特').replace(/\.[^.]+$/, ''),
      imageUrl: url,
      coverUrl: url,
    }
    view.value = 'editor'
  }
  picker.value = ''
}
function prepareCreate() {
  if (!description.value.trim()) return
  const record = {
    ...character.value,
    description: description.value.trim(),
    name:
      character.value.name === '未命名模特'
        ? description.value.trim().slice(0, 16)
        : character.value.name,
  }
  if (createReference.value)
    record.config = { ...record.config, styleReferenceUrls: [createReference.value.url] }
  requestGeneration({ character: record, kind: 'create' })
}
function requestGeneration(request, afterSave = null) {
  if (busy.value || !user.requireLogin()) return
  const latest = items.value.find((item) => item.id === request.character.id)
  const job = latest?.config?.generation || request.character.config?.generation
  if (job) {
    const node = graph.nodes.find((entry) => entry.id === job.nodeId)
    const failed =
      job.projectId === props.projectId &&
      node?.data.characterStudio?.assetId === request.character.id &&
      node.data.characterStudio.clientTaskId === job.clientTaskId &&
      node.data.generation?.clientTaskId === job.clientTaskId &&
      node.data.runState === 'failed' &&
      !node.data.generation.queryPending &&
      !node.data.generation.unresolvedTaskIds?.length
    if (!failed) {
      notice.value =
        job.projectId === props.projectId
          ? '此模特已有待确认的生成任务，请继续查询原任务；不会重复提交或扣费。'
          : '此模特在其他画布中有未确认任务，请回到原画布继续查询。'
      return
    }
  }
  confirmation.value = {
    ...clone(request),
    instruction:
      request.customInstruction ?? (request.kind === 'edit' ? '' : request.instruction || ''),
    clientTaskId: `character-${id()}`,
    afterSave,
  }
  if (job) confirmation.value.character.config.generation = null
  selectedRatio.value =
    request.kind === 'assets' ? characterStudioAssetFormat(request.assetType).ratio : '3:4'
  error.value = ''
  void tasks.loadModels()
}
function requestSave(request) {
  character.value = clone(request.character)
  if (request.withAssets)
    requestGeneration({ character: request.character, kind: 'assets' }, { insert: request.insert })
  else void saveCharacter(request.character, request.insert)
}
async function submitGeneration() {
  const request = confirmation.value
  if (!request || !canConfirm.value || submitting.value) return
  error.value = ''
  submitting.value = true
  let node
  try {
    const spec = characterStudioGenerationSpec({
      ...request,
      model: selectedModel.value,
      ratio: selectedRatio.value,
      resolution: selectedResolution.value,
      models: tasks.imageModels,
    })
    // Save a reusable draft before any paid work. The task's exact node and client key are
    // persisted, so closing/reopening never resubmits an uncertain generation.
    const saved = await saveCharacter(request.character)
    if (!saved) return
    graph.remember()
    const refs = spec.referenceUrls.map((url, index) => {
      const existing = graph.nodes.find(
        (candidate) => candidate.data.kind === 'image' && candidate.data.assetUrl === url,
      )
      if (existing) return existing
      const reference = graph.addNode('image', { x: 80 + index * 40, y: 80 })
      graph.updateNodeData(reference.id, {
        title: index ? '造型参考图' : saved.name,
        assetUrl: url,
        artifactStatus: 'ready',
        mediaOrigin: 'upload',
      })
      return reference
    })
    node = graph.addNode('image', { x: 440, y: 80 })
    graph.updateNodeData(node.id, {
      title: `${request.kind === 'assets' ? '模特资产' : '模特生成'} · ${saved.name}`,
      prompt: spec.prompt,
      model: spec.model,
      params: { ratio: spec.ratio, resolution: spec.resolution, count: 1 },
      characterStudio: {
        assetId: saved.id,
        operation: request.kind,
        ...(spec.assetType ? { assetType: spec.assetType } : {}),
        ...(spec.formatVersion
          ? { formatVersion: spec.formatVersion, promptSource: spec.promptSource }
          : {}),
        clientTaskId: request.clientTaskId,
      },
    })
    for (const reference of refs) graph.connect({ source: reference.id, target: node.id })
    const pending = {
      ...saved,
      config: {
        ...saved.config,
        generation: {
          nodeId: node.id,
          projectId: props.projectId,
          clientTaskId: request.clientTaskId,
          kind: request.kind,
          ...(spec.assetType ? { assetType: spec.assetType } : {}),
          ...(spec.formatVersion
            ? {
                formatVersion: spec.formatVersion,
                promptSource: spec.promptSource,
                imageSettings: {
                  model: spec.model,
                  ratio: spec.ratio,
                  resolution: spec.resolution,
                },
              }
            : {}),
          previousImageUrl: saved.imageUrl || '',
          visualConfig: characterStudioVisualConfig(request.character),
          insert: Boolean(request.afterSave?.insert),
        },
      },
    }
    const tracked = await saveCharacter(pending)
    if (!tracked) return
    if (request.afterSave?.insert) pendingInsert.add(saved.id)
    character.value = clone(tracked)
    if (request.source === 'asset-viewer') {
      inspected.value = clone(tracked)
      view.value = 'library'
    } else view.value = 'editor'
    confirmation.value = null
    await tasks.runImage(node.id, null, { clientTaskId: request.clientTaskId })
    notice.value = '任务已交给画布，结果由真实生成服务返回。关闭窗口不会重复提交。'
  } catch (failure) {
    error.value = failure.message || '模特生成未能提交，请检查配置'
    if (node) graph.updateNodeData(node.id, { error: error.value })
  } finally {
    submitting.value = false
  }
}
async function resumeGeneration(record) {
  if (resuming.value || busy.value) return
  const job = record.config?.generation
  const node = graph.nodes.find((entry) => entry.id === job?.nodeId)
  if (
    !job ||
    job.projectId !== props.projectId ||
    node?.data.characterStudio?.assetId !== record.id ||
    node.data.characterStudio.clientTaskId !== job.clientTaskId ||
    (node.data.generation && node.data.generation.clientTaskId !== job.clientTaskId)
  ) {
    error.value = '原任务节点不在当前画布或已被替换，请回到原画布核对，不会重新提交。'
    return
  }
  resuming.value = true
  try {
    if (!node.data.generation) {
      graph.updateNodeData(node.id, {
        runState: 'uncertain',
        generation: { clientTaskId: job.clientTaskId, taskIds: [], queryPending: true },
      })
    }
    reconciled.delete(job.clientTaskId)
    await tasks.resume(node.id)
    await reconcileGeneratedAssets()
    notice.value = '已查询原任务，未重新提交生成。进度与结果以画布任务状态为准。'
  } catch (failure) {
    error.value = failure.message || '原任务查询失败，请稍后继续查询'
  } finally {
    resuming.value = false
  }
}
async function reconcileGeneratedAssets() {
  if (saving.value || reconciling) {
    reconcileQueued = true
    return
  }
  reconciling = true
  try {
    for (const record of pendingJobs.value) {
      const job = record.config.generation
      const node = graph.nodes.find((entry) => entry.id === job.nodeId)
      const url = node?.data.assetUrl
      if (
        !/^https?:\/\//i.test(url || '') ||
        url === job.previousImageUrl ||
        node.data.kind !== 'image' ||
        node.data.runState !== 'succeeded' ||
        node.data.artifactStatus !== 'ready' ||
        node.data.characterStudio?.assetId !== record.id ||
        node.data.characterStudio?.clientTaskId !== job.clientTaskId ||
        node.data.generation?.clientTaskId !== job.clientTaskId ||
        !node.data.generation.results?.includes(url) ||
        reconciled.has(job.clientTaskId)
      )
        continue
      reconciled.add(job.clientTaskId)
      const config = { ...record.config, generation: null }
      if (job.kind !== 'assets') config.appliedVisualConfig = job.visualConfig || ''
      if (job.kind === 'assets')
        config.assets = [
          ...(config.assets || []),
          {
            name: assetLabel(job.assetType),
            type: Object.hasOwn(assetLabels, job.assetType) ? job.assetType : 'character-sheet',
            url,
            nodeId: node.id,
            ...(job.formatVersion
              ? {
                  formatVersion: job.formatVersion,
                  promptSource: job.promptSource,
                  imageSettings: job.imageSettings,
                }
              : {}),
          },
        ]
      const updated =
        job.kind === 'assets'
          ? { ...record, config }
          : { ...record, imageUrl: url, coverUrl: url, config }
      const saved = await saveCharacter(updated, false, true)
      if (!saved) {
        // A failed library write must not spin in a reactive retry loop. Reload or
        // explicitly query this original task to retry saving, never regenerate.
        continue
      }
      if (job.insert || pendingInsert.has(record.id)) {
        insertCharacters([saved])
        pendingInsert.delete(record.id)
      }
    }
  } finally {
    reconciling = false
    if (reconcileQueued && !disposed) {
      reconcileQueued = false
      void reconcileGeneratedAssets()
    }
  }
}
watch(
  () =>
    graph.nodes
      .map(
        (node) =>
          `${node.id}:${node.data.runState}:${node.data.artifactStatus}:${node.data.assetUrl || ''}:${JSON.stringify(node.data.generation || {})}`,
      )
      .join('|'),
  () => {
    if (!disposed) void reconcileGeneratedAssets()
  },
)
watch(items, () => {
  const latest = inspected.value && items.value.find((item) => item.id === inspected.value.id)
  if (latest) inspected.value = latest
  if (!disposed) void reconcileGeneratedAssets()
})
watch(confirmation, async (value) => {
  if (value) {
    generationPreviousFocus = typeof document !== 'undefined' ? document.activeElement : null
    await nextTick()
    if (confirmation.value === value)
      dialog.value?.querySelector('.cv3-character-generation-confirm button')?.focus()
  } else {
    generationPreviousFocus?.focus?.({ preventScroll: true })
    generationPreviousFocus = null
  }
})
function requestAgeVariant(record) {
  ageCharacter.value = clone(record)
  ageTarget.value = '青年'
}
function confirmAgeVariant() {
  const record = {
    ...ageCharacter.value,
    id: undefined,
    official: false,
    name: `${ageCharacter.value.name} · ${ageTarget.value}`,
    ageGroup: ageTarget.value,
    config: { ...ageCharacter.value.config, ageTarget: ageTarget.value },
  }
  ageCharacter.value = null
  requestGeneration({ character: record, kind: 'age' })
}
async function deleteCharacters() {
  if (busy.value || !deleteItems.value.length) return
  saving.value = true
  error.value = ''
  try {
    for (const record of deleteItems.value) {
      if (!record.official) {
        await client.remove(record.id)
        items.value = items.value.filter((item) => item.id !== record.id)
        if (inspected.value?.id === record.id) inspected.value = null
      }
    }
    deleteItems.value = []
    notice.value = '已从我的模特库移除所选模特，不影响已经添加到画布的图片'
  } catch (failure) {
    error.value = failure.message
  } finally {
    saving.value = false
  }
}
function close() {
  if (!submitting.value && !personalLibraryBusy.value) emit('close')
}
function insertInspected() {
  insertCharacters([inspected.value])
  inspected.value = null
}
function editInspected(tab = 'face') {
  const record = inspected.value
  if (!record || busy.value) return
  inspected.value = null
  editCharacter(record, tab)
}
function createFromAssets() {
  if (busy.value) return
  inspected.value = null
  createCharacter('generate')
}
function removeInspected() {
  if (inspected.value && !inspected.value.official && !busy.value)
    deleteItems.value = [inspected.value]
}
function requestAssetGeneration(type) {
  if (!inspected.value || busy.value) return
  if (!Object.hasOwn(assetLabels, type)) {
    error.value = '请选择支持的模特资产类型'
    return
  }
  requestGeneration({
    character: inspected.value,
    kind: 'assets',
    assetType: type,
    source: 'asset-viewer',
  })
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (confirmation.value) {
      if (!busy.value) confirmation.value = null
    } else if (picker.value) picker.value = ''
    else if (ageCharacter.value) ageCharacter.value = null
    else if (deleteItems.value.length) deleteItems.value = []
    else if (inspected.value) inspected.value = null
    else close()
  }
  if (event.key !== 'Tab') return
  const focusScope =
    [...dialog.value.querySelectorAll('.cv3-character-inner-scrim')].at(-1) || dialog.value
  const focusable = [
    ...focusScope.querySelectorAll(
      'button:not(:disabled),input:not(:disabled):not([hidden]),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
    ),
  ].filter((element) => element.getClientRects().length)
  const first = focusable[0],
    last = focusable.at(-1)
  if (!first) {
    event.preventDefault()
    ;(focusScope.querySelector('[role="dialog"],[role="alertdialog"]') || dialog.value)?.focus()
  } else if (!focusScope.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
onMounted(async () => {
  previousFocus = document.activeElement
  await nextTick()
  closeButton.value?.focus()
  void loadLibrary()
  void tasks.loadModels()
})
onBeforeUnmount(() => {
  disposed = true
  requestVersion += 1
  uploadController?.abort()
  previousFocus?.focus?.({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <div class="cv3-character-backdrop" @pointerdown.self="close">
      <section
        ref="dialog"
        class="cv3-character-studio"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="模特造型室"
        data-character-studio
        @keydown="keydown"
      >
        <button
          ref="closeButton"
          type="button"
          class="cv3-character-close"
          aria-label="关闭模特造型室"
          :disabled="submitting || personalLibraryBusy"
          @click="close"
        >
          <CanvasIcon name="close" :size="18" />
        </button>
        <input
          ref="uploadInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          hidden
          @change="uploadImage($event.target.files?.[0])"
        />
        <CharacterStudioLibrary
          v-if="view === 'library'"
          :inert="Boolean(inspected)"
          :my-items="items"
          :official-items="CHARACTER_STUDIO_TEMPLATES"
          :loading="loading"
          :error="error"
          @create="createCharacter"
          @open="editCharacter"
          @inspect="inspected = $event"
          @rename="editCharacter"
          @insert="insertCharacters"
          @remove="deleteItems = $event"
          @reload="loadLibrary"
          @age-variant="requestAgeVariant"
          @library-busy="personalLibraryBusy = $event"
        />
        <template v-else-if="view === 'create' || view === 'import'">
          <header class="cv3-character-page-header">
            <button type="button" aria-label="返回模特库" @click="returnToLibrary">
              <CanvasIcon name="chevron" :size="18" />
            </button>
          </header>
          <div
            class="cv3-character-create-page"
            @dragover.prevent
            @drop.prevent="
              uploadImage($event.dataTransfer.files?.[0], view === 'import' ? 'import' : 'create')
            "
          >
            <h2>{{ view === 'create' ? '创建你的新模特' : '导入已有模特' }}</h2>
            <div v-if="view === 'import'" class="cv3-character-import-drop">
              <CanvasIcon name="character" :size="60" />
              <p>上传清晰的人物图片，开始创建你的模特资产</p>
              <small>支持 JPG、PNG、WebP，单张不超过 20 MB</small>
              <button type="button" :disabled="uploading" @click="chooseUpload('import')">
                {{ uploading ? `正在上传 ${Math.round(uploadProgress)}%` : '从本地上传' }}
              </button>
              <button type="button" @click="picker = 'import'">从画布选择</button>
            </div>
            <div v-else class="cv3-character-create-ghost" aria-hidden="true">
              <CanvasIcon name="character" :size="180" />
            </div>
          </div>
          <footer v-if="view === 'create'" class="cv3-character-create-composer">
            <button
              type="button"
              class="cv3-character-reference-trigger"
              @click="picker = 'create'"
            >
              <img v-if="createReference" :src="createReference.url" alt="已选择的模特参考图" />
              <CanvasIcon v-else name="image" :size="22" />
              <span>{{ createReference ? createReference.name : '选择参考图' }}</span>
            </button>
            <button
              v-if="createReference"
              type="button"
              aria-label="移除模特参考图"
              @click="createReference = null"
            >
              ×
            </button>
            <textarea
              v-model="description"
              aria-label="描述你的模特特征"
              placeholder="描述你的模特特征"
              maxlength="4000"
              rows="2"
            />
            <button
              type="button"
              class="cv3-character-primary"
              :disabled="!description.trim() || busy"
              @click="prepareCreate"
            >
              生成模特
              <CanvasIcon name="arrowUp" :size="17" />
            </button>
          </footer>
        </template>
        <CharacterStudioEditor
          v-else-if="view === 'editor' && character"
          :character="character"
          :busy="busy"
          :error="error"
          :models="tasks.imageModels"
          :preview-url="previewImage(character)"
          :initial-tab="editorTab"
          @back="returnToLibrary"
          @change="updateCharacter"
          @generate="requestGeneration"
          @save="requestSave"
          @age-variant="requestAgeVariant"
          @upload-reference="uploadImage($event, 'styling')"
          @choose-reference="picker = 'styling'"
          @upload-decal="uploadImage($event, 'decal')"
          @design-voice="
            notice =
              '当前未配置 AI 音色生成服务；可以保存音色设定并使用系统试听，不会伪造生成结果或扣费。'
          "
        />
        <aside
          v-if="pendingJobs.length"
          class="cv3-character-pending-jobs"
          aria-label="模特生成任务"
        >
          <div v-for="record in pendingJobs" :key="record.id">
            <span>{{ record.name }} · 任务结果待确认</span>
            <button type="button" :disabled="busy || resuming" @click="resumeGeneration(record)">
              {{ resuming ? '正在查询…' : '继续查询原任务' }}
            </button>
          </div>
        </aside>
        <p v-if="notice" class="cv3-character-notice" role="status">{{ notice }}</p>
        <p
          v-if="error && view !== 'library' && view !== 'editor'"
          class="cv3-character-error"
          role="alert"
        >
          {{ error }}
        </p>
        <div v-if="uploading" class="cv3-character-upload-progress" role="status">
          图片上传中 {{ Math.round(uploadProgress) }}%
        </div>

        <div v-if="picker" class="cv3-character-inner-scrim">
          <section
            class="cv3-character-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择模特参考图"
          >
            <header>
              <h3>{{ picker === 'import' ? '导入已有模特' : '选择参考图' }}</h3>
              <button type="button" aria-label="关闭参考图选择" @click="picker = ''">×</button>
            </header>
            <button
              type="button"
              class="cv3-character-upload-button"
              :disabled="uploading"
              @click="chooseUpload(picker)"
            >
              <CanvasIcon name="image" :size="24" />
              从本地上传图片
            </button>
            <h4>当前画布</h4>
            <div v-if="canvasImages.length" class="cv3-character-picker-grid">
              <button
                v-for="node in canvasImages"
                :key="node.id"
                type="button"
                @click="applyImage(node)"
              >
                <img :src="node.data.assetUrl" :alt="node.data.title" />
                <span>{{ node.data.title }}</span>
              </button>
            </div>
            <p v-else>画布中还没有可用图片，请上传参考图</p>
          </section>
        </div>
        <CharacterStudioAssetViewer
          v-if="inspected"
          :character="inspected"
          :preview-url="characterStudioAssetPreview(inspected)"
          :busy="busy"
          :generation-cost="selectedModel && cost ? cost : null"
          :status="notice"
          :error="error"
          @close="inspected = null"
          @insert="insertInspected"
          @edit="editInspected()"
          @voice="editInspected('voice')"
          @create="createFromAssets"
          @remove="removeInspected"
          @generate="requestAssetGeneration"
        />
        <div v-if="confirmation" class="cv3-character-inner-scrim">
          <form
            class="cv3-character-small-dialog cv3-character-generation-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="模特生成确认"
            @submit.prevent="submitGeneration"
          >
            <header>
              <h3>{{ confirmation.kind === 'assets' ? '生成模特资产' : '确认模特生成' }}</h3>
              <button
                type="button"
                aria-label="关闭生成确认"
                :disabled="busy"
                @click="confirmation = null"
              >
                ×
              </button>
            </header>
            <p>
              {{ confirmation.character.name }} ·
              {{
                confirmation.kind === 'assets'
                  ? `生成 1 张${displayLabel(assetLabel(confirmation.assetType))}${!confirmation.assetType || confirmation.assetType === 'character-sheet' ? '（同一张图片包含多视图）' : ''}，不会拆成多笔任务`
                  : '生成 1 张模特图片'
              }}
            </p>
            <label>
              生图模型
              <select v-model="selectedModel" aria-label="模特生图模型" :disabled="busy">
                <option value="" disabled>请选择已配置模型</option>
                <option
                  v-for="model in tasks.imageModels"
                  :key="model.value"
                  :value="model.value"
                  :disabled="model.disabled"
                >
                  {{ model.label || model.value }}
                </option>
              </select>
            </label>
            <p v-if="tasks.modelError" role="alert">
              {{ tasks.modelError }}
              <button type="button" @click="tasks.loadModels(true)">重新加载模型</button>
            </p>
            <label>
              画面比例
              <select v-model="selectedRatio" aria-label="模特画面比例" :disabled="busy">
                <option
                  v-for="ratio in ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3']"
                  :key="ratio"
                >
                  {{ ratio }}
                </option>
              </select>
            </label>
            <label>
              分辨率
              <select v-model="selectedResolution" aria-label="模特分辨率" :disabled="busy">
                <option>1K</option>
                <option>2K</option>
                <option>4K</option>
              </select>
            </label>
            <details v-if="assetFormat && assetPromptPreview" class="cv3-character-prompt-preview">
              <summary>查看本张资产的生图提示词</summary>
              <p>{{ displayLabel(assetFormat.promptSourceLabel) }}</p>
              <pre>{{ assetPromptPreview }}</pre>
            </details>
            <div class="cv3-character-cost">
              {{ selectedModel && cost ? `预计 ${cost} 米值` : '费用以所选模型实际结算为准' }}
            </div>
            <p class="cv3-character-muted">
              只有点击下方按钮才提交付费生成。编辑参数、保存纯模特资料和添加已有图片均不触发生图。
            </p>
            <p v-if="error" role="alert">{{ error }}</p>
            <button type="submit" class="cv3-character-primary" :disabled="!canConfirm">
              {{ submitting ? '正在提交…' : '确认并生成' }}
            </button>
          </form>
        </div>
        <div v-if="ageCharacter" class="cv3-character-inner-scrim">
          <form
            class="cv3-character-small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="生成其他年龄版本"
            @submit.prevent="confirmAgeVariant"
          >
            <header>
              <h3>生成其他年龄版本</h3>
              <button type="button" aria-label="关闭年龄版本" @click="ageCharacter = null">
                ×
              </button>
            </header>
            <p>保持 {{ ageCharacter.name }} 的人物身份，生成所选年龄阶段。</p>
            <label>
              年龄段
              <select v-model="ageTarget" aria-label="目标年龄段">
                <option v-for="age in ['儿童', '少年', '青年', '中年', '老年']" :key="age">
                  {{ age }}
                </option>
              </select>
            </label>
            <button type="submit" class="cv3-character-primary">下一步，确认模型与费用</button>
          </form>
        </div>
        <div v-if="deleteItems.length" class="cv3-character-inner-scrim">
          <section class="cv3-character-small-dialog" role="alertdialog" aria-label="删除模特确认">
            <h3>从我的模特库移除 {{ deleteItems.length }} 个模特？</h3>
            <p>不影响已添加到画布的图片。</p>
            <div class="cv3-character-confirm-actions">
              <button type="button" :disabled="busy" @click="deleteItems = []">取消</button>
              <button type="button" :disabled="busy" @click="deleteCharacters">确认移除</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-character-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000b;
  color: #eee;
  font:
    13px/1.5 Inter,
    system-ui,
    sans-serif;
}
.cv3-character-studio {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1200px, calc(100vw - 32px));
  height: min(760px, calc(100dvh - 32px));
  overflow: hidden;
  border: 1px solid #3a3a3a;
  border-radius: 24px;
  background: #242424;
  box-shadow: 0 24px 90px #0008;
}
.cv3-character-close {
  position: absolute;
  right: 18px;
  top: 20px;
  z-index: 8;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #bbb;
  cursor: pointer;
}
.cv3-character-studio button,
.cv3-character-studio select,
.cv3-character-studio textarea {
  font: inherit;
}
.cv3-character-studio button:focus-visible,
.cv3-character-studio select:focus-visible,
.cv3-character-studio textarea:focus-visible {
  outline: 2px solid #aaa;
  outline-offset: 3px;
}
.cv3-character-close:hover {
  background: #343434;
  color: #fff;
}
.cv3-character-page-header {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  flex-shrink: 0;
}
.cv3-character-page-header button {
  border: 0;
  background: transparent;
  color: #ddd;
  transform: rotate(90deg);
  cursor: pointer;
}
.cv3-character-create-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  position: relative;
}
.cv3-character-create-page h2 {
  font-size: 28px;
  margin: 0;
  font-weight: 600;
}
.cv3-character-create-ghost {
  color: #555;
  opacity: 0.18;
}
.cv3-character-create-composer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 48px 28px;
  padding: 14px;
  border: 1px solid #555;
  border-radius: 18px;
  background: #292929;
}
.cv3-character-create-composer textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: #eee;
  font-size: 15px;
}
.cv3-character-reference-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 180px;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
}
.cv3-character-reference-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-character-reference-trigger img {
  width: 42px;
  height: 42px;
  object-fit: cover;
  border-radius: 5px;
}
.cv3-character-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  padding: 8px 16px;
  border: 0;
  border-radius: 12px;
  background: #f7f7f7;
  color: #191919;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}
.cv3-character-primary:disabled {
  background: #383838;
  color: #777;
  cursor: default;
}
.cv3-character-primary:active:enabled {
  background: #d7d7d7;
}
.cv3-character-import-drop {
  max-width: 500px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 50px 30px;
  border: 1px dashed #555;
  border-radius: 20px;
  text-align: center;
  color: #aaa;
}
.cv3-character-import-drop > svg {
  width: 100%;
}
.cv3-character-import-drop p,
.cv3-character-import-drop small {
  width: 100%;
  margin: 0;
}
.cv3-character-import-drop button {
  border: 1px solid #555;
  border-radius: 10px;
  padding: 8px 14px;
  background: #303030;
  color: #eee;
  cursor: pointer;
}
.cv3-character-notice,
.cv3-character-error,
.cv3-character-upload-progress {
  position: absolute;
  z-index: 12;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 75%;
  margin: 0;
  padding: 10px 16px;
  border: 1px solid #555;
  border-radius: 10px;
  background: #333;
  color: #eee;
  box-shadow: 0 6px 20px #0004;
  font-size: 12px;
}
.cv3-character-pending-jobs {
  position: absolute;
  z-index: 10;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  max-height: 100px;
  overflow: auto;
  border: 1px solid #565047;
  border-radius: 10px;
  padding: 8px 12px;
  background: #302b24;
  font-size: 12px;
}
.cv3-character-pending-jobs > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cv3-character-pending-jobs button {
  padding: 4px 8px;
  border: 1px solid #777;
  border-radius: 6px;
  background: #3e3830;
  color: #eee;
  cursor: pointer;
}
.cv3-character-error {
  color: #edba84;
}
.cv3-character-upload-progress {
  bottom: 120px;
}
.cv3-character-inner-scrim {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0009;
  padding: 20px;
}
.cv3-character-small-dialog {
  box-sizing: border-box;
  width: min(480px, 100%);
  max-height: 100%;
  overflow: auto;
  border: 1px solid #484848;
  border-radius: 18px;
  background: #252525;
  padding: 24px;
  box-shadow: 0 12px 50px #0009;
}
.cv3-character-small-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.cv3-character-small-dialog h3 {
  margin: 0;
  font-size: 17px;
}
.cv3-character-small-dialog header button {
  border: 0;
  background: transparent;
  color: #aaa;
  font-size: 23px;
  cursor: pointer;
}
.cv3-character-small-dialog > label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 16px 0;
}
.cv3-character-small-dialog select {
  min-width: 150px;
  max-width: 65%;
  padding: 8px;
  border: 1px solid #555;
  border-radius: 8px;
  background: #303030;
  color: #eee;
}
.cv3-character-small-dialog > .cv3-character-primary {
  width: 100%;
  margin-top: 18px;
}
.cv3-character-cost {
  padding: 12px 0;
  border-top: 1px solid #444;
  color: #eee;
}
.cv3-character-prompt-preview {
  margin: 16px 0;
  border: 1px solid #ffffff17;
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
}
.cv3-character-prompt-preview summary {
  cursor: pointer;
  color: #ddd;
}
.cv3-character-prompt-preview p {
  color: #aaa;
}
.cv3-character-prompt-preview pre {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  color: #ccc;
  scrollbar-color: #686868 transparent;
  scrollbar-width: thin;
}
.cv3-character-muted {
  font-size: 12px;
  line-height: 1.6;
  color: #999;
}
.cv3-character-upload-button {
  display: flex;
  width: 100%;
  gap: 12px;
  align-items: center;
  justify-content: center;
  padding: 18px;
  border: 1px dashed #666;
  background: #303030;
  color: #eee;
  border-radius: 12px;
  cursor: pointer;
}
.cv3-character-picker-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.cv3-character-picker-grid button {
  border: 1px solid #444;
  border-radius: 8px;
  background: #303030;
  color: #ccc;
  overflow: hidden;
  cursor: pointer;
  padding: 0;
}
.cv3-character-picker-grid img {
  width: 100%;
  height: 90px;
  object-fit: contain;
  background: #202020;
}
.cv3-character-picker-grid span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 6px;
}
.cv3-character-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.cv3-character-confirm-actions button {
  padding: 8px 16px;
  border: 1px solid #555;
  border-radius: 8px;
  background: #333;
  color: #eee;
  cursor: pointer;
}
@media (max-width: 700px) {
  .cv3-character-studio {
    width: calc(100vw - 16px);
    height: calc(100dvh - 16px);
    border-radius: 16px;
  }
  .cv3-character-create-composer {
    margin: 0 12px 16px;
    flex-wrap: wrap;
  }
  .cv3-character-create-composer textarea {
    min-width: 55%;
  }
  .cv3-character-create-page h2 {
    font-size: 22px;
  }
  .cv3-character-reference-trigger span {
    max-width: 90px;
  }
  .cv3-character-inner-scrim {
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-character-studio * {
    scroll-behavior: auto !important;
  }
}
</style>
