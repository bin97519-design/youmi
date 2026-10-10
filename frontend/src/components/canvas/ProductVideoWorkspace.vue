<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import ProductVideoPromptField from './ProductVideoPromptField.vue'
import ProductVideoTaskList from './ProductVideoTaskList.vue'
import VideoEnhanceDialog from './VideoEnhanceDialog.vue'
import { useProductVideo } from '../../composables/useProductVideo'
import { useUserStore } from '../../stores/user'
import { fetchSelectionProducts, fetchSelectionProduct } from '../../utils/selectionPoolApi'
import { normalizeSelectionProduct } from '../../utils/selectionProductFormat'
import { uploadFileDirect } from '../../utils/ossUpload'
import { formatMiValue } from '../../utils/miValue'
import { writeTextToClipboard } from '../../utils/clipboard'
import { inspectReferenceVideoFile } from '../../utils/referenceVideo'
import {
  continuityEnabled,
  continuitySettings,
  setContinuitySetting,
  continuityUsesAnchor,
  continuityBaseShot,
  continuityAnchor,
  continuityImageBlocked,
  approveProductVideoFrame,
  setContinuityAnchor,
  CONTINUITY_IMAGE_FIELDS,
  continuityReferenceImages,
  productReferenceUrls,
  setContinuityReference,
} from '../../utils/productVideoContinuity'
import {
  productVideoShotLimit,
  ANMIAO_VIDEO_RESOLUTIONS,
  ANMIAO25_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  ANMIAO25_VIDEO_RESOLUTIONS,
  MINIMAX_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  isRetiredVideoModel,
  isPerSecondVideoModel,
  VIDEO_RATIOS,
  WHOLE_VIDEO_30_MODEL,
  WHOLE_VIDEO_30_MODELS,
  isWholeVideo,
  generationDuration,
  canGenerateVideo,
  buildPlanRequest,
  compositionFingerprint,
  pickImage,
  planningTimeoutMs,
  planningErrorMessage,
  normalizePromptLineBreaks,
  normalizeVideoPrompt,
  removeReference,
  removeImage,
  removeVideo,
  selectedImage,
  selectedVideo,
  videoGenerationNotices,
  videoGenerationStatus,
  uid,
} from '../../utils/productVideo'

const props = defineProps({
  open: Boolean,
  canvasId: { type: String, required: true },
  layers: { type: Array, default: () => [] },
  imageModels: { type: Array, default: () => ['gpt-image-2'] },
  saveEnhancedVideo: { type: Function, required: true },
})
const emit = defineEmits(['close'])
const enhanceSource = ref(null)
function openEnhancement(clip = false) {
  const source = clip ? video.value : workflow.value.composition
  if (!source?.url) return
  enhanceSource.value = {
    url: source.url,
    context: captureTask(),
    shotId: clip ? active.value.id : null,
  }
}
async function saveEnhancement(result) {
  const source = enhanceSource.value
  if (!source) throw new Error('超分源视频不存在，请重新打开任务')
  if (!source.shotId) {
    await props.saveEnhancedVideo({
      ...result,
      canvasId: source.context.docId,
      sourceUrl: source.url,
    })
    return
  }
  if (!getTask(source.context)?.shots.some((shot) => shot.id === source.shotId))
    throw new Error('原分镜已不存在，无法添加新版本')
  shotChange(
    source.shotId,
    (shot) => {
      const id = `enhance-${result.id}`
      if (!shot.videos.some((item) => item.id === id)) {
        shot.videos.push({
          id,
          url: result.resultUrl,
          duration: result.metadata.duration,
          source: 'enhance',
          status: 'completed',
        })
      }
      shot.videoId = id
    },
    source.context,
  )
}
const activeTaskId = ref(''),
  showingTasks = ref(true)
const {
  workflow,
  tasks,
  taskActivity,
  captureTask,
  getTask,
  isCurrent,
  createTask,
  change,
  shotChange,
  error,
  notice,
  planning,
  composing,
  capabilities,
  planningModelOptions,
  imageModelOptions,
  videoModelOptions,
  planningModelUnavailable,
  selectPlanningModel,
  selectImageModel,
  selectVideoModel,
  request,
  loadCapabilities,
  addShot,
  plan,
  retryPlan,
  generate,
  compose,
} = useProductVideo(
  computed(() => props.canvasId),
  activeTaskId,
)
const user = useUserStore()
const currentVideoModelOptions = computed(() => videoModelOptions.value)
const tab = ref('source'),
  activeId = ref(''),
  shotCount = ref(4),
  uploader = ref(null),
  continuityUploader = ref(null),
  referenceVideoInput = ref(null),
  videoInput = ref(null),
  musicInput = ref(null)
const dialog = ref(null),
  uploading = ref(false),
  referencePreparing = ref(false),
  picker = ref(''),
  keyword = ref(''),
  page = ref(1),
  products = ref([]),
  total = ref(0)
const searching = ref(false),
  sourceProduct = ref(null),
  publishing = ref(false)
const continuityUploading = ref('')
const continuityCanvasTarget = ref(null)
let continuityUploadTarget = null
const confirmation = ref(null)
const promptEdit = ref(null),
  promptTextarea = ref(null)
const refining = ref(false),
  refinement = ref(null)
let refineSequence = 0
const promptFields = computed(() => ({
  imagePrompt: { label: activeWholeVideo.value ? '开场首帧提示词' : '首帧提示词', maxLength: 3000 },
  motion: { label: activeWholeVideo.value ? '整片视频提示词' : '视频提示词', maxLength: 1800 },
}))
let promptFocus
let restoreFocus,
  requestSequence = 0
const active = computed(
  () => workflow.value.shots.find((shot) => shot.id === activeId.value) || workflow.value.shots[0],
)
const frame = computed(() => active.value && selectedImage(active.value))
const fixedContinuity = computed(() => continuityEnabled(workflow.value))
const fixedSettings = computed(() => continuitySettings(workflow.value))
const planningAnchor = computed(() => continuityAnchor(workflow.value))
const anchor = computed(() => continuityAnchor(workflow.value, active.value))
const activeUsesAnchor = computed(
  () => active.value && continuityUsesAnchor(workflow.value, active.value),
)
const baseShot = computed(() => continuityBaseShot(workflow.value))
const needsAnchor = computed(
  () => active.value && continuityImageBlocked(workflow.value, active.value),
)
const video = computed(() => active.value && selectedVideo(active.value))
const videoNotices = computed(() => videoGenerationNotices(active.value?.videos))
const referenceMode = computed(() => workflow.value.planningSource === 'reference')
const longReference = computed(
  () => referenceMode.value && Number(workflow.value.referenceVideo?.duration) > 30.5,
)
const highlightReference = computed(
  () => referenceMode.value && workflow.value.referenceStrategy === 'highlights',
)
const shotLimit = computed(() => productVideoShotLimit(workflow.value))
const singleVideoPlan = computed(() => isWholeVideo(workflow.value.productionMode))
const continuityFields = computed(() =>
  CONTINUITY_IMAGE_FIELDS.filter(
    ({ key }) => fixedContinuity.value || (singleVideoPlan.value && key === 'product'),
  ).map((field) =>
    singleVideoPlan.value && field.key === 'product'
      ? { ...field, label: '商品外观参考（选填）' }
      : field,
  ),
)
const activeWholeVideo = computed(() => active.value && isWholeVideo(active.value.productionMode))
const hasWholeVideos = computed(() =>
  workflow.value.shots.some((shot) => isWholeVideo(shot.productionMode)),
)
const onlyWholeVideos = computed(() =>
  workflow.value.shots.length
    ? workflow.value.shots.every((shot) => isWholeVideo(shot.productionMode))
    : singleVideoPlan.value,
)
const productionTabLabel = computed(() =>
  onlyWholeVideos.value ? '整片制作' : hasWholeVideos.value ? '视频制作' : '分镜制作',
)
const activeTimelineCount = computed(
  () => Number(active.value?.timelineCount ?? active.value?.timeline?.length) || 0,
)
const detectedShotCount = computed(() => {
  const reference = workflow.value.referenceVideo
  const detected = Number(reference?.suggestedShotCount ?? reference?.frames?.length)
  return Number.isInteger(detected) && detected >= 1 && detected <= shotLimit.value ? detected : 1
})
const plannedCount = computed(() =>
  singleVideoPlan.value ? 1 : referenceMode.value ? detectedShotCount.value : shotCount.value,
)
const timelineCount = computed(() =>
  referenceMode.value && !highlightReference.value
    ? detectedShotCount.value
    : Number(workflow.value.timelineCount ?? 4),
)
const validTimelineCount = computed(
  () =>
    Number.isInteger(timelineCount.value) && timelineCount.value >= 1 && timelineCount.value <= 8,
)
const kept = computed(() => workflow.value.shots.filter((shot) => shot.kept && selectedVideo(shot)))
const totalDuration = computed(() =>
  kept.value.reduce((sum, shot) => sum + Number(shot.duration || 0), 0).toFixed(1),
)
const stale = computed(
  () => workflow.value.composition?.fingerprint !== compositionFingerprint(workflow.value),
)
const canvasImages = computed(() =>
  props.layers.filter((layer) => layer.url && (!layer.type || layer.type === 'image')),
)
const canvasReferenceImage = computed(() => {
  const target = continuityCanvasTarget.value
  if (!target) return null
  const task = getTask(target.context)
  return task ? continuitySettings(task, target).images?.[target.role] : null
})
const canvasPickerTitle = computed(() => {
  const role = continuityCanvasTarget.value?.role
  const field = CONTINUITY_IMAGE_FIELDS.find((item) => item.key === role)
  return field ? `${field.label} · 画布图片` : '画布图片'
})
const modelOptions = imageModelOptions
const selectedImageModelOption = computed(
  () =>
    imageModelOptions.value.find((option) => option.value === workflow.value.imageModel) ||
    imageModelOptions.value.find((option) => option.model === workflow.value.imageModel),
)
const selectedImageModelValue = computed(
  () => selectedImageModelOption.value?.value || workflow.value.imageModel,
)
const imageModelIsMapped = computed(() => Boolean(selectedImageModelOption.value))
const effectiveImageModel = computed(
  () => selectedImageModelOption.value?.model || workflow.value.imageModel,
)
const ratioOptions = VIDEO_RATIOS.map((value) => ({ value, label: value }))
const productImages = computed(() =>
  sourceProduct.value
    ? [
        ...new Set([
          ...sourceProduct.value.mainImages,
          ...sourceProduct.value.portraitImages,
          ...sourceProduct.value.skuGroups.flatMap((group) =>
            group.values.map((value) => value.imageUrl),
          ),
          ...sourceProduct.value.skus.map((item) => item.imageUrl),
          ...sourceProduct.value.detailImages,
        ]),
      ].filter(Boolean)
    : [],
)
const imagePrice = computed(
  () => capabilities.value?.imagePrices?.[effectiveImageModel.value]?.['2K'],
)
function imageUsesReportedCost() {
  return imagePrice.value == null && imageModelIsMapped.value
}
const compositionBusy = computed(
  () => composing.value || ['queued', 'processing'].includes(workflow.value.composition?.status),
)

watch(
  () => props.open,
  async (value) => {
    if (!value) {
      picker.value = ''
      enhanceSource.value = null
      promptEdit.value = null
      refinement.value = null
      refineSequence++
      restoreFocus?.focus()
      return
    }
    restoreFocus = document.activeElement
    showTasks()
    void loadCapabilities()
    await nextTick()
    dialog.value?.focus()
  },
)
watch(
  picker,
  (value) => {
    if (value !== 'canvas') continuityCanvasTarget.value = null
  },
  { flush: 'sync' },
)

function showTasks() {
  showingTasks.value = true
  promptEdit.value = null
  refinement.value = null
  confirmation.value = null
  picker.value = ''
  requestSequence++
  refineSequence++
  error.value = ''
  notice.value = ''
}
function openTask(id) {
  activeTaskId.value = id
  activeId.value = ''
  tab.value = workflow.value.composition?.url
    ? 'output'
    : workflow.value.shots.length
      ? 'shots'
      : 'source'
  showingTasks.value = false
  error.value = ''
  notice.value = ''
}
function startTask() {
  openTask(createTask())
}

function set(key, value) {
  change((data) => {
    data[key] = value
  })
}
function speedLabel(shot) {
  const speed = Number(selectedVideo(shot)?.duration || 15) / Number(shot.duration)
  return Number.isFinite(speed) && speed >= 1 ? `${speed.toFixed(2)} 倍速` : '--'
}
function updateShot(key, value) {
  if (active.value)
    shotChange(active.value.id, (shot) => {
      shot[key] =
        key === 'motion'
          ? normalizeVideoPrompt(shot, value)
          : promptFields.value[key]
            ? normalizePromptLineBreaks(value)
            : value
    })
}
async function copyPrompt(key) {
  try {
    await writeTextToClipboard(
      key === 'motion'
        ? normalizeVideoPrompt(active.value)
        : normalizePromptLineBreaks(active.value?.[key]),
    )
    error.value = ''
    notice.value = `${promptFields.value[key].label}已复制`
  } catch {
    error.value = '复制失败，请选中文字后复制'
  }
}
async function openPrompt(key, target) {
  if (!active.value) return
  promptFocus = target
  promptEdit.value = {
    ...promptFields.value[key],
    key,
    shotId: active.value.id,
    value:
      key === 'motion'
        ? normalizeVideoPrompt(active.value)
        : normalizePromptLineBreaks(active.value[key]),
  }
  await nextTick()
  promptTextarea.value?.focus()
}
async function closePrompt(apply = false) {
  const edit = promptEdit.value
  if (apply && edit)
    shotChange(edit.shotId, (shot) => {
      shot[edit.key] =
        edit.key === 'motion'
          ? normalizeVideoPrompt(shot, edit.value)
          : normalizePromptLineBreaks(edit.value)
    })
  promptEdit.value = null
  await nextTick()
  promptFocus?.focus({ preventScroll: true })
}
async function refineShot() {
  if (!active.value || refining.value) return
  if (planningModelUnavailable.value) {
    error.value = '所选策划模型不可用，请检查密钥配置或重新选择'
    return
  }
  if (continuityEnabled(workflow.value, active.value) && !capabilities.value?.fixedContinuity) {
    error.value = '当前服务尚未支持全片固定设定，请更新后端后重新打开工作区'
    return
  }
  const shot = active.value,
    sequence = ++refineSequence
  if (
    isWholeVideo(shot.productionMode) &&
    !referenceMode.value &&
    !capabilities.value?.wholeVideoOptionalContinuity
  ) {
    error.value = '当前服务尚未支持整片可选固定设定，请更新后端后重新打开工作区'
    return
  }
  const original = { imagePrompt: shot.imagePrompt, motion: shot.motion }
  const context = captureTask()
  if (
    continuityReferenceImages(workflow.value, shot).length &&
    !capabilities.value?.fixedContinuityImages
  ) {
    error.value = '当前服务尚未支持固定参考图，请更新后端后重新打开工作区'
    return
  }
  const images = productReferenceUrls(workflow.value, shot)
  if (!images.length) {
    error.value = '请先为当前分镜选择商品参考图'
    return
  }
  refining.value = true
  error.value = ''
  try {
    const result = await request(
      '/api/product-videos/plan',
      buildPlanRequest(workflow.value, 1, shot),
      planningTimeoutMs(shot.referenceRange ? 3 : 1, capabilities.value?.planStageTimeoutSeconds),
    )
    if (sequence !== refineSequence || !props.open || !isCurrent(context)) return
    const resultShot = result?.shots?.[0]
    if (!resultShot?.imagePrompt?.trim() || !resultShot?.motion?.trim())
      throw new Error('完善结果不完整，请重试')
    refinement.value = {
      shotId: shot.id,
      title: shot.title,
      original,
      imagePrompt: normalizePromptLineBreaks(resultShot.imagePrompt),
      motion: normalizePromptLineBreaks(resultShot.motion),
      purpose: resultShot.purpose || '',
      design: resultShot.design || '',
      concept: result.summary?.concept || '',
      timeline: resultShot.timeline || [],
    }
    await nextTick()
    dialog.value.querySelector('.pv-refine-dialog textarea')?.focus()
  } catch (e) {
    if (sequence === refineSequence) error.value = planningErrorMessage(e)
  } finally {
    refining.value = false
  }
}
function applyRefinement() {
  const result = refinement.value
  if (!result?.imagePrompt.trim() || !result?.motion.trim()) return
  const shot = workflow.value.shots.find((item) => item.id === result.shotId)
  if (
    !shot ||
    shot.imagePrompt !== result.original.imagePrompt ||
    shot.motion !== result.original.motion
  ) {
    error.value = '原分镜内容已经改变，请关闭预览后重新完善'
    return
  }
  shotChange(shot.id, (item) => {
    item.imagePrompt = normalizePromptLineBreaks(result.imagePrompt)
    item.motion = normalizePromptLineBreaks(result.motion)
    item.purpose = result.purpose
    item.design = result.design
    item.concept = result.concept
    item.timeline = result.timeline
    if (isWholeVideo(item.productionMode))
      item.timelineCount = result.timeline.length || item.timelineCount || 4
    item.approvedImageId = ''
  })
  refinement.value = null
  notice.value = '分镜提示词已更新，原素材已保留；首帧待重新确认'
}
function openShot(shot) {
  activeId.value = shot.id
  tab.value = 'shots'
}
function createShot() {
  addShot()
  activeId.value = workflow.value.shots.at(-1)?.id
  tab.value = 'shots'
}
function ask(title, detail, action) {
  confirmation.value = { title, detail, action }
}
function confirm() {
  const action = confirmation.value?.action
  confirmation.value = null
  void action?.()
}
function addReference(url, name, layerId = '', context = captureTask()) {
  const task = getTask(context)
  if (!task || task.references.some((item) => item.url === url)) return
  if (task.references.length >= 6) throw new Error('商品参考图最多 6 张')
  change((data) => {
    const id = uid()
    data.references.push({ id, url, name, layerId })
    data.shots.forEach((shot) => {
      if (!shot.images.length) shot.referenceIds.push(id)
    })
  }, context)
}
function openCanvasPicker(role = '') {
  continuityCanvasTarget.value = role
    ? { role, context: captureTask(), productionMode: workflow.value.productionMode }
    : null
  error.value = ''
  picker.value = 'canvas'
}
function chooseCanvas(layer) {
  try {
    const target = continuityCanvasTarget.value
    if (target) {
      const task = getTask(target.context)
      const sameImage = canvasReferenceImage.value?.url === layer.url
      picker.value = ''
      if (!task || sameImage) return
      const apply = () => {
        if (!getTask(target.context)) return
        change(
          (data) =>
            setContinuityReference(
              data,
              target.role,
              { id: uid(), url: layer.url, name: layer.name, layerId: layer.id },
              target,
            ),
          target.context,
        )
        if (isCurrent(target.context)) notice.value = '固定参考图已更新'
      }
      if (continuityAnchor(task, target))
        ask('更换固定参考图？', '会取消旧的全片基准，需要重新确认首帧。已有图片和视频保留。', apply)
      else apply()
      return
    }
    addReference(layer.url, layer.name, layer.id)
  } catch (e) {
    error.value = e.message
  }
}
async function uploadImages(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length) return
  const context = captureTask()
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
      if (getTask(context)?.references.length >= 6) throw new Error('商品参考图最多 6 张')
      addReference(
        await uploadFileDirect(file, { dir: 'product-video/references' }),
        file.name,
        '',
        context,
      )
    }
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    uploading.value = false
  }
}
async function uploadReferenceVideo(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('video/') || file.size > 150 * 1024 * 1024) {
    error.value = '请选择 150MB 以内的视频'
    return
  }
  const context = captureTask()
  referencePreparing.value = true
  error.value = ''
  notice.value = ''
  try {
    const inspection = await inspectReferenceVideoFile(file, 8)
    if (!isCurrent(context)) return
    const url = await uploadFileDirect(file, { dir: 'product-video/reference-videos' })
    const frameUrls = []
    for (let start = 0; start < inspection.frames.length; start += 4) {
      frameUrls.push(
        ...(await Promise.all(
          inspection.frames
            .slice(start, start + 4)
            .map((frame) =>
              uploadFileDirect(frame.file, { dir: 'product-video/reference-frames' }),
            ),
        )),
      )
    }
    if (!isCurrent(context)) return
    const suggested = inspection.suggestedShotCount
    change((data) => {
      data.planningSource = 'reference'
      if (inspection.segments) {
        data.productionMode =
          data.referenceStrategy === 'highlights' ? 'single_video_30' : 'storyboard'
        if (data.referenceStrategy === 'highlights') data.timelineCount = Math.min(4, suggested)
      } else data.referenceStrategy = 'faithful'
      data.referenceVideo = {
        id: uid(),
        url,
        name: file.name,
        duration: inspection.duration,
        width: inspection.width,
        height: inspection.height,
        audioSummary: inspection.audioSummary,
        suggestedShotCount: suggested,
        ...(inspection.segments ? { segments: inspection.segments } : {}),
        frames: inspection.frames.map((frame, index) => ({
          id: uid(),
          url: frameUrls[index],
          time: frame.time,
        })),
      }
    }, context)
    notice.value = `参考视频已读取，识别到 ${inspection.frames.length} 张关键画面和 ${suggested} 个镜头`
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    referencePreparing.value = false
  }
}
function setReferenceStrategy(strategy) {
  change((data) => {
    data.referenceStrategy = strategy
    if (strategy === 'highlights') {
      data.productionMode = 'single_video_30'
      data.timelineCount = Math.min(4, data.referenceVideo?.segments?.length || 4)
    } else if (Number(data.referenceVideo?.duration) > 30.5) data.productionMode = 'storyboard'
  })
}
function removeReferenceVideo() {
  if (!workflow.value.referenceVideo) return
  ask('移除参考视频？', '视频和关键帧将从这个任务中移除，已经生成的分镜和素材仍会保留。', () =>
    change((data) => {
      data.referenceVideo = null
      data.referenceStrategy = 'faithful'
      data.planningSource = 'creative'
    }),
  )
}
function approveFrame() {
  if (!active.value) return
  const id = active.value.id
  change((data) => {
    const shot = data.shots.find((item) => item.id === id)
    if (shot) approveProductVideoFrame(data, shot)
  })
}
function setContinuityField(key, value) {
  change((data) => {
    setContinuitySetting(data, key, value)
  })
}
function chooseContinuityImage(role) {
  continuityUploadTarget = {
    role,
    context: captureTask(),
    productionMode: workflow.value.productionMode,
  }
  continuityUploader.value?.click()
}
async function uploadContinuityImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  const target = continuityUploadTarget
  continuityUploadTarget = null
  if (!file || !target || uploading.value) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    error.value = '请选择 JPG、PNG 或 WebP 图片'
    return
  }
  const { role, context, productionMode } = target
  const upload = async () => {
    if (!getTask(context)) return
    uploading.value = true
    continuityUploading.value = role
    error.value = ''
    try {
      const url = await uploadFileDirect(file, { dir: `product-video/continuity/${role}` })
      change(
        (data) =>
          setContinuityReference(
            data,
            role,
            { id: uid(), url, name: file.name },
            { productionMode },
          ),
        context,
      )
      if (isCurrent(context)) notice.value = '固定参考图已更新'
    } catch (e) {
      if (isCurrent(context)) error.value = e.message
    } finally {
      uploading.value = false
      continuityUploading.value = ''
    }
  }
  if (continuityAnchor(getTask(context) || {}, { productionMode }))
    ask(
      '更换固定参考图？',
      '上传成功后会取消旧的全片基准，需要重新确认首帧。已有图片和视频保留。',
      upload,
    )
  else await upload()
}
function removeContinuityImage(role) {
  const context = captureTask()
  const productionMode = workflow.value.productionMode
  const remove = () =>
    change((data) => setContinuityReference(data, role, null, { productionMode }), context)
  if (planningAnchor.value)
    ask('移除固定参考图？', '会取消当前全片基准，需要重新确认首帧。已有图片和视频保留。', remove)
  else remove()
}
function useFrameAsAnchor() {
  const id = active.value?.id
  const context = captureTask()
  const apply = () =>
    change((data) => {
      const shot = data.shots.find((item) => item.id === id)
      if (shot) setContinuityAnchor(data, shot)
    }, context)
  if (anchor.value)
    ask(
      '更换全片基准？',
      '后续生图将沿用这张已确认首帧的场景和人物。已有图片和视频不会重新生成。',
      apply,
    )
  else apply()
}
function clearAnchor() {
  const context = captureTask()
  ask('取消全片基准？', '已有素材仍会保留；其他分镜生图前，需要重新确认一张基准首帧。', () =>
    change((data) => {
      data.continuity = { ...data.continuity, anchor: null }
    }, context),
  )
}
function useReferenceAsFrame(reference) {
  if (!active.value) return
  shotChange(active.value.id, (shot) => {
    const item = {
      id: uid(),
      url: reference.url,
      status: 'completed',
      source: 'reference',
      ratio: workflow.value.ratio,
    }
    shot.images.push(item)
    pickImage(shot, item.id)
  })
}
function setKeep(shot, keep) {
  shotChange(shot.id, (item, doc) => {
    item.kept = keep
    const layer = doc.payload.layers.find((value) => value.id === `pv-${item.videoId}`)
    if (layer) layer.assetReviewStatus = keep ? 'kept' : ''
  })
}
function selectVersion(kind, id) {
  shotChange(active.value.id, (shot) => {
    if (kind === 'image') pickImage(shot, id)
    else {
      shot.videoId = id
      shot.kept = false
      shot.start = 0
    }
  })
}
function moveShot(id, offset) {
  change((data) => {
    const index = data.shots.findIndex((shot) => shot.id === id),
      next = index + offset
    if (index < 0 || next < 0 || next >= data.shots.length) return
    const [shot] = data.shots.splice(index, 1)
    data.shots.splice(next, 0, shot)
  })
}
function deleteShot(shot) {
  ask('移除这个分镜？', '分镜记录将移除，已加入画布的图片和视频仍会保留。', () =>
    change((data) => {
      data.shots = data.shots.filter((item) => item.id !== shot.id)
    }),
  )
}
function deleteVideo() {
  if (!active.value || !video.value) return
  const shotId = active.value.id,
    videoId = video.value.id
  ask(
    '删除当前片段？',
    '仅从当前分镜移除这个视频片段，其他片段、画布素材和云端原文件仍会保留。',
    () => shotChange(shotId, (shot) => removeVideo(shot, videoId)),
  )
}
function deleteImage(imageId) {
  const image = active.value?.images.find((item) => item.id === imageId && item.url)
  if (!image || ['submitting', 'processing'].includes(image.status)) return
  const context = captureTask(),
    shotId = active.value.id
  ask(
    '删除这个首帧版本？',
    '仅从当前分镜移除这个首帧版本，已生成的视频、其他首帧版本、画布素材和云端原文件仍会保留。',
    () => shotChange(shotId, (shot) => removeImage(shot, imageId), context),
  )
}
function busy(shot, field) {
  return shot[field].some((item) => ['submitting', 'processing'].includes(item.status))
}
function videoModelForShot(shot) {
  return shot.productionMode === 'single_video_30'
    ? (workflow.value.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL)
    : workflow.value.videoModel
}
function perSecondVideo(shot) {
  return isPerSecondVideoModel(videoModelForShot(shot))
}
function videoResolutionForShot(shot) {
  if ([MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(videoModelForShot(shot)))
    return workflow.value.minimaxResolution ?? '768p'
  return (
    (shot.productionMode === 'single_video_30'
      ? workflow.value.wholeVideo30Resolution
      : workflow.value.videoResolution) ?? '720p'
  )
}
function resolutionOptionsForShot(shot) {
  if ([MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(videoModelForShot(shot)))
    return MINIMAX_VIDEO_RESOLUTIONS
  return videoModelForShot(shot) === ANMIAO25_VIDEO_MODEL
    ? ANMIAO25_VIDEO_RESOLUTIONS
    : ANMIAO_VIDEO_RESOLUTIONS
}
function invalidAnmiaoDuration(shot) {
  if (!perSecondVideo(shot)) return false
  const duration = generationDuration(shot, workflow.value)
  const maxDuration = videoModelForShot(shot) === ANMIAO25_VIDEO_MODEL ? 30 : 15
  return !Number.isInteger(duration) || duration < 4 || duration > maxDuration
}
function invalidAnmiaoResolution(shot) {
  return (
    perSecondVideo(shot) &&
    !resolutionOptionsForShot(shot).some((option) => option.value === videoResolutionForShot(shot))
  )
}
function videoPrice(shot) {
  if (isRetiredVideoModel(videoModelForShot(shot))) return null
  if (videoUsesReportedCost(shot)) return null
  if (perSecondVideo(shot)) {
    const model25 = videoModelForShot(shot) === ANMIAO25_VIDEO_MODEL
    const minimax = [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(videoModelForShot(shot))
    const available = minimax
      ? capabilities.value?.minimaxVideo
      : model25
        ? capabilities.value?.anmiao25Video
        : capabilities.value?.anmiaoVideo
    const rates = minimax
      ? capabilities.value?.minimaxMiPerSecondByResolution
      : model25
        ? capabilities.value?.anmiao25MiPerSecondByResolution
        : capabilities.value?.anmiaoMiPerSecondByResolution
    const rate = Number(rates?.[videoResolutionForShot(shot)])
    return available && rate > 0 ? rate * generationDuration(shot, workflow.value) : null
  }
  return capabilities.value?.videoPrice
}
function videoUsesReportedCost(shot) {
  const model = videoModelForShot(shot)
  if (model === HAILUO_H3_VIDEO_MODEL ||
      (model === MINIMAX_VIDEO_MODEL && capabilities.value?.hailuoH3Video === true)) return true
  const provider = String(videoModelOptions.value.find((option) => option.value === model)?.provider || '')
    .trim()
    .toLowerCase()
  return ['lk888', 'youmi888', 'lingke', 'model-api', '灵科ai', '灵科 ai']
    .some((prefix) => provider.startsWith(prefix))
}
function generateShot(kind) {
  const shot = active.value
  if (kind === 'video' && isRetiredVideoModel(videoModelForShot(shot))) {
    error.value = '原视频模型已移除，请重新选择视频模型'
    return
  }
  if (kind === 'video' && invalidAnmiaoDuration(shot)) {
    error.value = `按秒视频时长需为 4 至 ${videoModelForShot(shot) === ANMIAO25_VIDEO_MODEL ? 30 : 15} 的整数秒`
    return
  }
  if (kind === 'video' && invalidAnmiaoResolution(shot)) {
    error.value =
      videoModelForShot(shot) === MINIMAX_VIDEO_MODEL
        ? 'MiniMax H3 画质需选择 768P、1080P、2K 或 4K'
        : videoModelForShot(shot) === ANMIAO25_VIDEO_MODEL
          ? 'SD2.5 画质需选择 480p、720p 或 1080p'
          : '按秒视频画质需选择 480p、720p、1080p 或 4K'
    return
  }
  const price = kind === 'image' ? imagePrice.value : videoPrice(shot)
  if (
    price == null &&
    !(kind === 'video' && videoUsesReportedCost(shot)) &&
    !(kind === 'image' && imageUsesReportedCost())
  ) {
    error.value =
      kind === 'video' && perSecondVideo(shot)
        ? '按秒视频所选画质尚未配置密钥和每秒米值单价'
        : '计费信息尚未加载，请重新打开工作区'
    return
  }
  ask(
    kind === 'image'
      ? '生成分镜图片'
      : isWholeVideo(shot.productionMode)
        ? '生成整片视频'
        : '生成分镜视频',
    `${shot.title}：本次 ${price == null ? '费用以生成成功后接口返回为准' : `${formatMiValue(price)} 米值`}${kind === 'video' ? (isWholeVideo(shot.productionMode) ? `，生成 1 条 ${generationDuration(shot, workflow.value)} 秒整片` : `，生成 ${generationDuration(shot, workflow.value)} 秒原片`) : '，生成 1 张 2K 图片'}。`,
    () => generate(shot.id, kind),
  )
}
async function batchGenerate() {
  const context = captureTask()
  const shots = workflow.value.shots.filter(
    (shot) => canGenerateVideo(shot) && !selectedVideo(shot) && !busy(shot, 'videos'),
  )
  if (shots.some((shot) => isRetiredVideoModel(videoModelForShot(shot)))) {
    error.value = '原视频模型已移除，请重新选择视频模型'
    return
  }
  if (shots.some(invalidAnmiaoDuration)) {
    error.value = '所选按秒视频模型的时长不受支持'
    return
  }
  if (shots.some(invalidAnmiaoResolution)) {
    error.value = '所选按秒视频模型的画质不受支持'
    return
  }
  const prices = shots.map(videoPrice)
  if (!shots.length || prices.some((price, index) =>
    price == null && !videoUsesReportedCost(shots[index]),
  )) {
    error.value = !shots.length
      ? '没有可生成的视频分镜，请先确认图片'
      : '按秒视频所选画质尚未配置密钥和每秒米值单价'
    return
  }
  ask(
    '批量生成视频',
    `${shots.length} 个视频，共 ${shots.reduce((sum, shot) => sum + generationDuration(shot, workflow.value), 0)} 秒，${prices.every((price) => price != null) ? `预计 ${formatMiValue(prices.reduce((sum, price) => sum + price, 0))} 米值` : '费用以生成成功后接口返回为准'}。`,
    async () => {
      for (const shot of shots) await generate(shot.id, 'video', context)
    },
  )
}
async function generatePlan() {
  const context = captureTask()
  await plan(plannedCount.value)
  if (!error.value && isCurrent(context) && !showingTasks.value && workflow.value.shots.length)
    openPlannedShots()
}
function openPlannedShots() {
  const job = workflow.value.planJob
  if (isWholeVideo(job?.request?.productionMode)) {
    const shot = workflow.value.shots.find((item) => item.id === `plan-${job.id}-0`)
    if (shot) activeId.value = shot.id
  }
  tab.value = 'shots'
}
async function searchProducts(reset = false) {
  if (reset) page.value = 1
  const sequence = ++requestSequence
  searching.value = true
  error.value = ''
  try {
    const result = await fetchSelectionProducts(user, {
      keyword: keyword.value,
      page: page.value,
      pageSize: 10,
    })
    if (sequence !== requestSequence) return
    products.value = result.items
    total.value = result.total
  } catch (e) {
    if (sequence === requestSequence) error.value = e.message
  } finally {
    if (sequence === requestSequence) searching.value = false
  }
}
function openProducts(mode) {
  picker.value = mode
  sourceProduct.value = null
  products.value = []
  total.value = 0
  void searchProducts(true)
}
async function chooseProduct(product) {
  try {
    sourceProduct.value = {
      ...normalizeSelectionProduct(await fetchSelectionProduct(user, product.id)),
      id: product.id,
    }
  } catch (e) {
    error.value = e.message
  }
}
async function publish(product) {
  if (publishing.value || stale.value) return
  publishing.value = true
  const context = captureTask()
  error.value = ''
  try {
    await request('/api/product-videos/publish', {
      productId: product.id,
      compositionId: workflow.value.composition.id,
    })
    if (isCurrent(context)) {
      notice.value = `成片已添加到「${product.title}」的主图视频`
      picker.value = ''
    }
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    publishing.value = false
  }
}
function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      element = document.createElement('video')
    const timeout = setTimeout(() => done(null), 15000)
    const done = (value) => {
      clearTimeout(timeout)
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(url)
      value ? resolve(value) : reject(new Error('无法读取视频时长'))
    }
    element.preload = 'metadata'
    element.onloadedmetadata = () =>
      done(Number.isFinite(element.duration) ? element.duration : null)
    element.onerror = () => done(null)
    element.src = url
  })
}
async function uploadVideo(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !active.value) return
  if (!file.type.startsWith('video/') || file.size > 150 * 1024 * 1024) {
    error.value = '请选择 150MB 以内的视频'
    return
  }
  const shotId = active.value.id
  const context = captureTask()
  uploading.value = true
  try {
    const duration = await probeVideo(file),
      url = await uploadFileDirect(file, { dir: 'product-video/clips' })
    shotChange(
      shotId,
      (shot) => {
        const item = { id: uid(), url, duration, source: 'upload', status: 'completed' }
        shot.videos.push(item)
        shot.videoId = item.id
        shot.kept = false
        shot.start = 0
        if (!shot.referenceRange) shot.duration = Math.min(shot.duration, duration)
      },
      context,
    )
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    uploading.value = false
  }
}
async function uploadMusic(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('audio/') || file.size > 30 * 1024 * 1024) {
    error.value = '请选择 30MB 以内的音频'
    return
  }
  uploading.value = true
  const context = captureTask()
  try {
    const url = await uploadFileDirect(file, { dir: 'product-video/music' })
    change((data) => {
      data.musicUrl = url
      data.musicName = file.name
    }, context)
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    uploading.value = false
  }
}
async function download() {
  try {
    const response = await fetch(workflow.value.composition.url)
    if (!response.ok) throw new Error('下载失败，请稍后重试')
    const url = URL.createObjectURL(await response.blob()),
      a = document.createElement('a')
    a.href = url
    a.download = '主图视频.mp4'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (e) {
    error.value = e.message
  }
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    if (confirmation.value) confirmation.value = null
    else if (promptEdit.value) void closePrompt()
    else if (refinement.value) refinement.value = null
    else if (picker.value) picker.value = ''
    else emit('close')
  }
  if (event.key !== 'Tab') return
  const focusRoot =
    dialog.value.querySelector('.pv-confirm') ||
    dialog.value.querySelector('.pv-prompt-dialog') ||
    dialog.value.querySelector('.pv-refine-dialog') ||
    dialog.value.querySelector('.pv-picker') ||
    dialog.value
  const elements = [
    ...focusRoot.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea, [tabindex="0"]',
    ),
  ].filter((item) => item.getClientRects().length)
  const first = elements[0],
    last = elements.at(-1)
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pv-overlay" @pointerdown.stop @wheel.stop @keydown.stop="onKeydown">
      <section
        ref="dialog"
        class="pv-workspace"
        role="dialog"
        aria-modal="true"
        aria-label="主图视频"
        tabindex="-1"
      >
        <header class="pv-header">
          <div class="pv-title">
            <i aria-hidden="true" class="ri-movie-2-line"></i>
            <h2>主图视频</h2>
          </div>
          <template v-if="!showingTasks">
            <button class="pv-back-tasks" title="返回任务列表" @click="showTasks">
              <i aria-hidden="true" class="ri-arrow-left-line"></i>
              任务列表
            </button>
            <input
              class="pv-task-title"
              aria-label="任务名称"
              :value="workflow.title"
              maxlength="80"
              @change="set('title', $event.target.value.trim() || '未命名任务')"
            />
          </template>
          <nav v-if="!showingTasks" class="pv-tabs" aria-label="制作阶段">
            <button
              v-for="(label, key) in {
                source: '商品素材',
                shots: productionTabLabel,
                output: '成片导出',
              }"
              :key="key"
              :class="{ active: tab === key }"
              @click="tab = key"
            >
              {{ label }}
            </button>
          </nav>
          <button class="pv-icon" title="返回画布" aria-label="返回画布" @click="emit('close')">
            <i aria-hidden="true" class="ri-close-line"></i>
          </button>
        </header>
        <div
          v-if="!showingTasks && (error || notice)"
          :class="['pv-message', { error: error }]"
          role="status"
        >
          {{ error || notice }}
          <button
            class="pv-icon"
            title="关闭提示"
            aria-label="关闭提示"
            @click="
              () => {
                error = ''
                notice = ''
              }
            "
          >
            <i aria-hidden="true" class="ri-close-line"></i>
          </button>
        </div>

        <div v-if="!showingTasks && workflow.planJob" class="pv-plan-progress" role="status">
          <i
            aria-hidden="true"
            :class="
              planning
                ? 'ri-loader-4-line pv-spin'
                : workflow.planJob.status === 'failed'
                  ? 'ri-error-warning-line'
                  : 'ri-file-list-3-line'
            "
          ></i>
          <div>
            <strong>
              {{ workflow.planJob.status === 'failed' ? '分镜策划未完成' : workflow.planJob.stage }}
            </strong>
            <span>
              已保存 {{ workflow.planJob.appliedCount || 0 }} / {{ workflow.planJob.count }}
              {{ isWholeVideo(workflow.planJob.request?.productionMode) ? '条整片策划' : '个分镜' }}
            </span>
            <p v-if="workflow.planJob.error || workflow.planJob.pollError">
              {{ workflow.planJob.error || workflow.planJob.pollError }}
            </p>
          </div>
          <button v-if="workflow.shots.length && tab !== 'shots'" @click="openPlannedShots">
            <i aria-hidden="true" class="ri-list-check"></i>
            {{ isWholeVideo(workflow.planJob.request?.productionMode) ? '查看整片' : '查看分镜' }}
          </button>
          <button
            v-if="['failed', 'unknown'].includes(workflow.planJob.status)"
            :disabled="planning"
            @click="retryPlan"
          >
            <i aria-hidden="true" class="ri-restart-line"></i>
            {{ workflow.planJob.status === 'failed' ? '继续未完成分镜' : '确认任务状态' }}
          </button>
        </div>
        <ProductVideoTaskList
          v-show="showingTasks"
          :tasks="tasks"
          :activity="taskActivity"
          @open="openTask"
          @create="startTask"
        />
        <main v-if="!showingTasks && tab === 'source'" class="pv-source pv-scroll">
          <section class="pv-source-assets">
            <div class="pv-section-head">
              <h3>
                商品参考图
                <small>{{ workflow.references.length }}/6</small>
              </h3>
            </div>
            <div class="pv-actions">
              <button class="pv-primary" :disabled="uploading" @click="uploader.click()">
                <i aria-hidden="true" class="ri-upload-2-line"></i>
                {{ uploading ? '上传中' : '本地上传' }}
              </button>
              <button @click="openCanvasPicker()">
                <i aria-hidden="true" class="ri-artboard-2-line"></i>
                画布图片
              </button>
              <button @click="openProducts('source')">
                <i aria-hidden="true" class="ri-archive-line"></i>
                选品库
              </button>
            </div>
            <div class="pv-reference-grid">
              <figure v-for="item in workflow.references" :key="item.id">
                <img :src="item.url" :alt="item.name || '商品参考图'" />
                <figcaption>
                  <span :title="item.name">{{ item.name || '商品参考图' }}</span>
                  <button
                    class="pv-icon"
                    title="移除参考图"
                    aria-label="移除参考图"
                    @click="change((data) => removeReference(data, item.id))"
                  >
                    <i aria-hidden="true" class="ri-close-line"></i>
                  </button>
                </figcaption>
              </figure>
              <button
                v-if="!workflow.references.length"
                class="pv-empty-upload"
                :disabled="uploading"
                @click="uploader.click()"
              >
                <i aria-hidden="true" class="ri-image-add-line"></i>
                <span>添加商品参考图</span>
              </button>
            </div>
          </section>
          <section class="pv-brief">
            <div class="pv-plan-source">
              <span>策划依据</span>
              <div class="pv-production-modes" role="group" aria-label="策划依据">
                <button
                  :class="{ active: !referenceMode }"
                  :aria-pressed="!referenceMode"
                  :disabled="planning || workflow.planJob?.status === 'unknown'"
                  @click="set('planningSource', 'creative')"
                >
                  <i aria-hidden="true" class="ri-magic-line"></i>
                  自由策划
                </button>
                <button
                  :class="{ active: referenceMode }"
                  :aria-pressed="referenceMode"
                  :disabled="planning || workflow.planJob?.status === 'unknown'"
                  @click="set('planningSource', 'reference')"
                >
                  <i aria-hidden="true" class="ri-movie-2-line"></i>
                  参考视频反推
                </button>
              </div>
            </div>
            <div v-if="referenceMode" class="pv-reference-video-source">
              <div class="pv-section-head">
                <div>
                  <h3>参考视频</h3>
                </div>
                <button
                  v-if="workflow.referenceVideo"
                  class="pv-icon pv-danger"
                  title="移除参考视频"
                  aria-label="移除参考视频"
                  :disabled="referencePreparing || planning"
                  @click="removeReferenceVideo"
                >
                  <i aria-hidden="true" class="ri-delete-bin-line"></i>
                </button>
              </div>
              <div class="pv-production-modes" role="group" aria-label="反推方式">
                <button
                  :class="{ active: !highlightReference }"
                  :aria-pressed="!highlightReference"
                  :disabled="
                    planning || referencePreparing || workflow.planJob?.status === 'unknown'
                  "
                  @click="setReferenceStrategy('faithful')"
                >
                  <i aria-hidden="true" class="ri-film-line"></i>
                  按原片还原
                </button>
                <button
                  :class="{ active: highlightReference }"
                  :aria-pressed="highlightReference"
                  :disabled="
                    planning ||
                    referencePreparing ||
                    workflow.planJob?.status === 'unknown' ||
                    !longReference ||
                    !capabilities?.referenceVideoHighlights
                  "
                  title="长参考视频精华 30 秒"
                  @click="setReferenceStrategy('highlights')"
                >
                  <i aria-hidden="true" class="ri-scissors-cut-line"></i>
                  精华 30 秒
                </button>
              </div>
              <button
                v-if="!workflow.referenceVideo"
                class="pv-reference-video-upload"
                :disabled="referencePreparing"
                @click="referenceVideoInput.click()"
              >
                <i
                  aria-hidden="true"
                  :class="referencePreparing ? 'ri-loader-4-line pv-spin' : 'ri-video-upload-line'"
                ></i>
                <span>
                  {{ referencePreparing ? '正在读取镜头与声音' : '上传2分钟以内参考视频' }}
                </span>
              </button>
              <template v-else>
                <div class="pv-reference-video-preview">
                  <video :src="workflow.referenceVideo.url" controls preload="metadata"></video>
                  <div>
                    <strong :title="workflow.referenceVideo.name">
                      {{ workflow.referenceVideo.name }}
                    </strong>
                    <span>
                      {{ workflow.referenceVideo.duration }} 秒 ·
                      {{ workflow.referenceVideo.width }}×{{ workflow.referenceVideo.height }} ·
                      原片识别
                      {{ workflow.referenceVideo.suggestedShotCount || detectedShotCount }} 个分镜
                    </span>
                    <button
                      :disabled="referencePreparing || planning"
                      @click="referenceVideoInput.click()"
                    >
                      <i aria-hidden="true" class="ri-replace-line"></i>
                      更换视频
                    </button>
                  </div>
                </div>
                <div class="pv-reference-frames" aria-label="参考视频关键帧">
                  <figure v-for="frameItem in workflow.referenceVideo.frames" :key="frameItem.id">
                    <img :src="frameItem.url" alt="参考视频关键帧" />
                    <figcaption>{{ frameItem.time.toFixed(1) }}秒</figcaption>
                  </figure>
                </div>
                <p class="pv-audio-summary">
                  <i aria-hidden="true" class="ri-sound-module-line"></i>
                  {{ workflow.referenceVideo.audioSummary }}
                </p>
              </template>
            </div>
            <div class="pv-production-modes" role="group" aria-label="视频策划方式">
              <button
                :class="{ active: !singleVideoPlan }"
                :aria-pressed="!singleVideoPlan"
                :disabled="planning || workflow.planJob?.status === 'unknown' || highlightReference"
                @click="set('productionMode', 'storyboard')"
              >
                <i aria-hidden="true" class="ri-layout-grid-line"></i>
                多分镜制作
              </button>
              <button
                :class="{ active: workflow.productionMode === 'single_video' }"
                :aria-pressed="workflow.productionMode === 'single_video'"
                :disabled="
                  planning ||
                  workflow.planJob?.status === 'unknown' ||
                  longReference ||
                  highlightReference ||
                  !capabilities?.singleVideoPlan
                "
                @click="set('productionMode', 'single_video')"
              >
                <i aria-hidden="true" class="ri-film-line"></i>
                整片15秒
              </button>
              <button
                :class="{ active: workflow.productionMode === 'single_video_30' }"
                :aria-pressed="workflow.productionMode === 'single_video_30'"
                :disabled="
                  planning ||
                  workflow.planJob?.status === 'unknown' ||
                  (longReference && !highlightReference) ||
                  !capabilities?.singleVideo30
                "
                @click="set('productionMode', 'single_video_30')"
              >
                <i aria-hidden="true" class="ri-film-line"></i>
                整片 30 秒
              </button>
            </div>
            <label>
              商品信息与视频要求
              <textarea
                :value="workflow.brief"
                maxlength="5000"
                rows="9"
                placeholder="商品名称、已确认的卖点、使用场景和视频风格"
                @input="set('brief', $event.target.value)"
              ></textarea>
            </label>
            <div
              class="pv-settings pv-planning-settings"
              :class="{
                'pv-whole-settings': singleVideoPlan && (!referenceMode || highlightReference),
              }"
            >
              <label>
                成片比例
                <ThemedSelect
                  :model-value="workflow.ratio"
                  :options="ratioOptions"
                  aria-label="成片比例"
                  @update:model-value="set('ratio', $event)"
                />
              </label>
              <label v-if="singleVideoPlan || longReference">
                {{ longReference ? '目标成片时长' : '整片时长' }}
                <input
                  :value="`${longReference && !highlightReference ? workflow.referenceVideo.duration : generationDuration(workflow)} 秒`"
                  readonly
                  :aria-label="longReference ? '目标成片时长' : '整片时长'"
                />
              </label>
              <label v-if="singleVideoPlan && (!referenceMode || highlightReference)">
                {{ highlightReference ? '精华镜头数' : '分镜数量' }}
                <input
                  :value="timelineCount"
                  aria-label="整片分镜数量"
                  type="number"
                  min="1"
                  :max="
                    highlightReference
                      ? Math.min(8, workflow.referenceVideo?.segments?.length || 8)
                      : 8
                  "
                  step="1"
                  :disabled="
                    planning ||
                    workflow.planJob?.status === 'unknown' ||
                    !capabilities?.wholeVideoShotCount
                  "
                  @input="set('timelineCount', Number($event.target.value))"
                />
              </label>
              <label v-else-if="!referenceMode">
                策划镜头数
                <input
                  v-model.number="shotCount"
                  aria-label="策划镜头数"
                  type="number"
                  min="1"
                  :max="shotLimit - workflow.shots.length"
                />
              </label>
              <fieldset
                class="pv-planning-model"
                :disabled="planning || refining || workflow.planJob?.status === 'unknown'"
              >
                <label>
                  策划模型
                  <ThemedSelect
                    :model-value="workflow.planningModel || 'default'"
                    :options="planningModelOptions"
                    aria-label="策划模型"
                    @update:model-value="selectPlanningModel"
                  />
                </label>
              </fieldset>
            </div>
            <section v-if="!referenceMode" class="pv-continuity" aria-label="全片固定设定">
              <label class="pv-audio-option">
                <input
                  type="checkbox"
                  :checked="fixedContinuity"
                  :disabled="planning || refining || uploading"
                  @change="setContinuityField('enabled', $event.target.checked)"
                />
                {{ singleVideoPlan ? '固定场景和人物（选填）' : '固定场景、人物和商品' }}
              </label>
              <div v-if="continuityFields.length" class="pv-continuity-fields">
                <div v-for="field in continuityFields" :key="field.key" class="pv-continuity-field">
                  <div class="pv-continuity-field-head">
                    <span>{{ field.label }}</span>
                    <div class="pv-actions">
                      <button
                        :aria-label="`上传${field.label}图`"
                        :disabled="planning || refining || uploading"
                        @click="chooseContinuityImage(field.key)"
                      >
                        <i
                          aria-hidden="true"
                          :class="
                            continuityUploading === field.key
                              ? 'ri-loader-4-line pv-spin'
                              : 'ri-upload-2-line'
                          "
                        ></i>
                        {{
                          continuityUploading === field.key
                            ? '上传中'
                            : fixedSettings.images?.[field.key]?.url
                              ? '更换图片'
                              : '上传图片'
                        }}
                      </button>
                      <button
                        :aria-label="`从画布选择${field.label}图`"
                        :disabled="planning || refining || uploading"
                        @click="openCanvasPicker(field.key)"
                      >
                        <i aria-hidden="true" class="ri-layout-grid-line"></i>
                        画布图片
                      </button>
                    </div>
                  </div>
                  <div v-if="fixedSettings.images?.[field.key]?.url" class="pv-continuity-image">
                    <img :src="fixedSettings.images[field.key].url" :alt="`${field.label}参考图`" />
                    <span>
                      {{ fixedSettings.images[field.key].name || `${field.label}参考图` }}
                    </span>
                    <button
                      class="pv-icon"
                      :title="`移除${field.label}图`"
                      :aria-label="`移除${field.label}图`"
                      :disabled="planning || refining || uploading"
                      @click="removeContinuityImage(field.key)"
                    >
                      <i aria-hidden="true" class="ri-close-line"></i>
                    </button>
                  </div>
                  <textarea
                    :value="fixedSettings[field.key] || ''"
                    :aria-label="field.label"
                    rows="2"
                    maxlength="300"
                    :placeholder="field.placeholder"
                    :disabled="planning || refining || uploading || !!planningAnchor"
                    @input="setContinuityField(field.key, $event.target.value)"
                  ></textarea>
                </div>
              </div>
              <div v-if="planningAnchor" class="pv-continuity-anchor">
                <img :src="planningAnchor.url" alt="全片基准图" />
                <span>
                  <strong>全片基准已确认</strong>
                  <small>{{ planningAnchor.title }}</small>
                </span>
                <button
                  class="pv-icon"
                  title="取消全片基准"
                  aria-label="取消全片基准"
                  :disabled="planning || refining"
                  @click="clearAnchor"
                >
                  <i aria-hidden="true" class="ri-close-line"></i>
                </button>
              </div>
            </section>
            <label
              class="pv-audio-option"
              :title="
                [ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL].includes(
                  workflow.productionMode === 'single_video_30'
                    ? (workflow.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL)
                    : workflow.videoModel,
                )
                  ? '模型原生带声，此选项仅用于安排声音提示词，不控制接口音轨'
                  : workflow.productionMode === 'single_video_30'
                    ? '30 秒模型不支持音频开关参数，此选项仅写入声音提示词，不保证返回音轨'
                    : '生成与画面动作对应的音轨'
              "
            >
              <input
                type="checkbox"
                :checked="workflow.generateAudio === true"
                :disabled="
                  planning ||
                  workflow.planJob?.status === 'unknown' ||
                  !capabilities?.synchronizedAudio
                "
                @change="
                  change((data) => {
                    data.generateAudio = $event.target.checked
                    if (data.generateAudio) data.keepOriginalAudio = true
                  })
                "
              />
              {{
                [ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL].includes(
                  workflow.productionMode === 'single_video_30'
                    ? (workflow.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL)
                    : workflow.videoModel,
                )
                  ? '声音策划'
                  : '音画同步'
              }}
            </label>
            <div class="pv-actions">
              <button
                class="pv-primary"
                :disabled="
                  planning ||
                  workflow.planJob?.status === 'unknown' ||
                  uploading ||
                  referencePreparing ||
                  planningModelUnavailable ||
                  !workflow.brief.trim() ||
                  !productReferenceUrls(workflow).length ||
                  (referenceMode && !workflow.referenceVideo?.frames?.length) ||
                  (highlightReference &&
                    (!longReference ||
                      !capabilities?.referenceVideoHighlights ||
                      timelineCount > workflow.referenceVideo.segments.length)) ||
                  workflow.shots.length + plannedCount > shotLimit ||
                  plannedCount < 1 ||
                  (singleVideoPlan &&
                    (!validTimelineCount || !capabilities?.wholeVideoShotCount)) ||
                  (singleVideoPlan && !capabilities?.singleVideoPlan)
                "
                @click="generatePlan"
              >
                <i
                  aria-hidden="true"
                  :class="planning ? 'ri-loader-4-line pv-spin' : 'ri-sparkling-line'"
                ></i>
                {{
                  planning
                    ? referenceMode
                      ? '正在反推与策划'
                      : '正在分析与策划'
                    : referenceMode
                      ? '反推并生成策划'
                      : singleVideoPlan
                        ? '生成整片策划'
                        : '生成分镜策划'
                }}
              </button>
              <button
                :disabled="
                  planning ||
                  workflow.shots.length >= shotLimit ||
                  (singleVideoPlan && !validTimelineCount)
                "
                @click="createShot"
              >
                <i aria-hidden="true" class="ri-add-line"></i>
                {{ singleVideoPlan ? '手动添加整片' : '手动添加分镜' }}
              </button>
            </div>
            <details v-if="workflow.lastPlanSummary" class="pv-plan-summary">
              <summary>最近一次策划</summary>
              <h4>商品分析</h4>
              <p>{{ workflow.lastPlanSummary.analysis }}</p>
              <h4>整片思路</h4>
              <p>{{ workflow.lastPlanSummary.concept }}</p>
            </details>
          </section>
        </main>

        <main v-else-if="!showingTasks && tab === 'shots'" class="pv-shots">
          <aside class="pv-shot-list pv-scroll">
            <div class="pv-section-head">
              <h3>
                {{ hasWholeVideos ? '视频列表' : '分镜' }}
                <small>{{ workflow.shots.length }}/{{ shotLimit }}</small>
              </h3>
              <button
                class="pv-icon"
                title="添加分镜"
                aria-label="添加分镜"
                :disabled="workflow.shots.length >= shotLimit"
                @click="createShot"
              >
                <i aria-hidden="true" class="ri-add-line"></i>
              </button>
            </div>
            <button
              v-for="(shot, index) in workflow.shots"
              :key="shot.id"
              class="pv-shot-item"
              :class="{ active: active?.id === shot.id }"
              @click="activeId = shot.id"
            >
              <span class="pv-shot-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <img v-if="selectedImage(shot)" :src="selectedImage(shot).url" alt="分镜首帧" />
              <i v-else aria-hidden="true" class="ri-image-line"></i>
              <span>
                <strong>{{ shot.title }}</strong>
                <small v-if="shot.referenceRange">
                  原片 {{ shot.referenceRange.start }}-{{ shot.referenceRange.end }} 秒
                </small>
                <small>
                  <template v-if="isWholeVideo(shot.productionMode)">
                    {{ generationDuration(shot) }} 秒整片 ·
                  </template>
                  {{
                    shot.kept
                      ? '已保留'
                      : selectedVideo(shot)
                        ? '待选片'
                        : canGenerateVideo(shot)
                          ? '首帧已确认'
                          : '待确认首帧'
                  }}
                </small>
              </span>
            </button>
            <button v-if="workflow.shots.length > 1" class="pv-batch" @click="batchGenerate">
              <i aria-hidden="true" class="ri-video-add-line"></i>
              批量生成视频
            </button>
          </aside>
          <div v-if="!active" class="pv-empty">
            <i aria-hidden="true" class="ri-film-line"></i>
            <p>暂无分镜</p>
            <button @click="tab = 'source'">添加商品素材</button>
            <button @click="createShot">手动添加分镜</button>
          </div>
          <section v-else class="pv-shot-editor pv-scroll">
            <div class="pv-section-head pv-shot-heading">
              <input
                aria-label="分镜名称"
                :value="active.title"
                maxlength="80"
                @input="updateShot('title', $event.target.value)"
              />
              <button
                class="pv-icon"
                title="前移分镜"
                aria-label="前移分镜"
                :disabled="workflow.shots[0]?.id === active.id"
                @click="moveShot(active.id, -1)"
              >
                <i aria-hidden="true" class="ri-arrow-up-line"></i>
              </button>
              <button
                class="pv-icon"
                title="后移分镜"
                aria-label="后移分镜"
                :disabled="workflow.shots.at(-1)?.id === active.id"
                @click="moveShot(active.id, 1)"
              >
                <i aria-hidden="true" class="ri-arrow-down-line"></i>
              </button>
              <button
                class="pv-icon pv-danger"
                title="移除分镜"
                aria-label="移除分镜"
                :disabled="busy(active, 'images') || busy(active, 'videos')"
                @click="deleteShot(active)"
              >
                <i aria-hidden="true" class="ri-delete-bin-line"></i>
              </button>
            </div>
            <div class="pv-direction">
              <div class="pv-shot-intent">
                <strong>{{ activeWholeVideo ? '整片目标' : '镜头目的' }}</strong>
                <small v-if="activeWholeVideo" class="pv-whole-meta">
                  {{ generationDuration(active) }} 秒 · {{ activeTimelineCount }} 个分镜
                </small>
                <p>{{ active.purpose || '尚未策划' }}</p>
                <details v-if="active.design || active.concept">
                  <summary>镜头设计与衔接</summary>
                  <p>{{ active.design }}</p>
                  <ol
                    v-if="active.timeline?.length"
                    class="pv-story-timeline"
                    aria-label="整片时间轴"
                  >
                    <li v-for="(beat, index) in active.timeline" :key="index">
                      <strong>{{ beat.start }}-{{ beat.end }} 秒</strong>
                      <p>{{ beat.action }}</p>
                      <p>{{ beat.camera }} · {{ beat.transition }}</p>
                    </li>
                  </ol>
                  <p v-if="active.concept" class="pv-hint">{{ active.concept }}</p>
                </details>
              </div>
              <button
                :disabled="
                  refining ||
                  planning ||
                  uploading ||
                  planningModelUnavailable ||
                  !workflow.brief.trim() ||
                  !productReferenceUrls(workflow, active).length
                "
                @click="refineShot"
              >
                <i
                  aria-hidden="true"
                  :class="refining ? 'ri-loader-4-line pv-spin' : 'ri-sparkling-line'"
                ></i>
                {{ refining ? '正在完善' : activeWholeVideo ? '完善整片' : '完善分镜' }}
              </button>
            </div>
            <div v-if="activeUsesAnchor" class="pv-continuity-anchor" aria-label="分镜一致性">
              <img v-if="anchor" :src="anchor.url" alt="全片基准图" />
              <i v-else aria-hidden="true" class="ri-lock-line"></i>
              <span>
                <strong>{{ anchor ? '全片基准已确认' : '全片基准待确认' }}</strong>
                <small>{{ anchor ? anchor.title : '固定场景、人物和商品' }}</small>
              </span>
              <button v-if="needsAnchor" @click="activeId = baseShot.id">
                <i aria-hidden="true" class="ri-arrow-left-line"></i>
                确认基准首帧
              </button>
              <button
                class="pv-icon"
                title="全片固定设定"
                aria-label="全片固定设定"
                @click="tab = 'source'"
              >
                <i aria-hidden="true" class="ri-settings-3-line"></i>
              </button>
            </div>
            <div class="pv-editor-columns">
              <section>
                <div class="pv-shot-media">
                  <h3>
                    {{ activeWholeVideo ? '开场首帧' : '首帧图片' }}
                    <small>
                      {{ active.approvedImageId === frame?.id && frame ? '已确认' : '待确认' }}
                    </small>
                  </h3>
                  <div class="pv-preview">
                    <img v-if="frame" :src="frame.url" alt="当前分镜首帧" />
                    <span v-else>暂无首帧</span>
                  </div>
                  <div
                    v-if="active.images.some((item) => item.url)"
                    class="pv-versions"
                    aria-label="首帧版本"
                  >
                    <div
                      v-for="(item, index) in active.images.filter((entry) => entry.url)"
                      :key="item.id"
                      class="pv-image-version"
                      :class="{ 'is-selected': item.id === active.imageId }"
                    >
                      <button
                        class="pv-image-select"
                        :class="{ active: item.id === active.imageId }"
                        :title="`首帧版本 ${index + 1}`"
                        :aria-pressed="item.id === active.imageId"
                        @click="selectVersion('image', item.id)"
                      >
                        <img :src="item.url" :alt="`首帧版本 ${index + 1}`" />
                      </button>
                      <button
                        class="pv-image-remove"
                        :title="`删除首帧版本 ${index + 1}`"
                        :aria-label="`删除首帧版本 ${index + 1}`"
                        :disabled="['submitting', 'processing'].includes(item.status)"
                        @click.stop="deleteImage(item.id)"
                      >
                        <i aria-hidden="true" class="ri-close-line"></i>
                      </button>
                    </div>
                  </div>
                  <div class="pv-reference-picks" aria-label="分镜参考图">
                    <label v-for="item in workflow.references" :key="item.id" :title="item.name">
                      <input
                        type="checkbox"
                        :checked="active.referenceIds.includes(item.id)"
                        @change="
                          shotChange(active.id, (shot) => {
                            shot.referenceIds = $event.target.checked
                              ? [...shot.referenceIds, item.id]
                              : shot.referenceIds.filter((id) => id !== item.id)
                          })
                        "
                      />
                      <img :src="item.url" :alt="item.name || '参考图'" />
                    </label>
                    <button
                      class="pv-icon"
                      title="添加参考图"
                      aria-label="添加参考图"
                      @click="tab = 'source'"
                    >
                      <i aria-hidden="true" class="ri-add-line"></i>
                    </button>
                  </div>
                </div>
                <div class="pv-shot-controls">
                  <ProductVideoPromptField
                    :model-value="active.imagePrompt"
                    :label="promptFields.imagePrompt.label"
                    :kind="activeWholeVideo ? '第 0 秒' : '静态画面'"
                    :max-length="3000"
                    @update:model-value="updateShot('imagePrompt', $event)"
                    @copy="copyPrompt('imagePrompt')"
                    @expand="openPrompt('imagePrompt', $event)"
                  />
                  <label>
                    图片模型 · 2K PNG
                    <ThemedSelect
                      :model-value="selectedImageModelValue"
                      :options="modelOptions"
                      aria-label="图片模型"
                      @update:model-value="selectImageModel"
                    />
                  </label>
                  <p
                    v-if="imageModelIsMapped && imagePrice == null"
                    :class="['pv-task-status', { error: !imageUsesReportedCost() }]"
                    role="status"
                  >
                    {{
                      imageUsesReportedCost()
                        ? '单价以生成成功后接口返回为准'
                        : '当前图片模型未配置单价，暂不可生成'
                    }}
                  </p>
                  <p v-if="!modelOptions.length" class="pv-task-status error" role="status">
                    请先在控制台 AI 功能映射中配置分镜生图模型
                  </p>
                  <p
                    v-else-if="!imageModelIsMapped"
                    class="pv-task-status error"
                    role="status"
                  >
                    当前图片模型未映射，请重新选择
                  </p>
                  <div class="pv-actions">
                    <button
                      :disabled="
                        busy(active, 'images') ||
                        needsAnchor ||
                        uploading ||
                        (imagePrice == null && !imageUsesReportedCost()) ||
                        !imageModelIsMapped ||
                        !productReferenceUrls(workflow, active).length ||
                        !active.imagePrompt.trim()
                      "
                      @click="generateShot('image')"
                    >
                      <i aria-hidden="true" class="ri-sparkling-line"></i>
                      {{ busy(active, 'images') ? '生成中' : frame ? '重新生成' : '生成首帧' }}
                      <small v-if="imagePrice != null">{{ formatMiValue(imagePrice) }} 米值</small>
                    </button>
                    <button
                      class="pv-primary"
                      :disabled="!frame || active.approvedImageId === frame.id"
                      @click="approveFrame"
                    >
                      <i aria-hidden="true" class="ri-check-line"></i>
                      确认图片
                    </button>
                    <button
                      v-if="activeUsesAnchor && frame && active.approvedImageId === frame.id"
                      :disabled="anchor?.imageId === frame.id"
                      @click="useFrameAsAnchor"
                    >
                      <i aria-hidden="true" class="ri-pushpin-line"></i>
                      {{ anchor?.imageId === frame.id ? '全片基准' : '设为全片基准' }}
                    </button>
                  </div>
                  <details v-if="workflow.references.length">
                    <summary>直接使用已有图片</summary>
                    <div class="pv-direct-images">
                      <button
                        v-for="item in workflow.references"
                        :key="item.id"
                        :title="`使用 ${item.name || '参考图'} 作为首帧`"
                        @click="useReferenceAsFrame(item)"
                      >
                        <img :src="item.url" :alt="item.name || '参考图'" />
                      </button>
                    </div>
                  </details>
                  <p
                    v-for="item in active.images.filter((entry) => !entry.url).slice(-2)"
                    :key="item.id"
                    :class="['pv-task-status', { error: item.error }]"
                  >
                    {{ item.error || item.pollError || `首帧生成中 ${item.progress || 0}%` }}
                  </p>
                </div>
              </section>
              <section>
                <div class="pv-shot-media">
                  <h3>
                    {{ activeWholeVideo ? '整片视频' : '视频片段' }}
                    <small>{{ active.kept ? '已保留' : '待选片' }}</small>
                  </h3>
                  <div class="pv-preview">
                    <video
                      v-if="video"
                      :key="video.id"
                      :src="video.url"
                      :poster="active.images.find((item) => item.id === video.sourceImageId)?.url"
                      controls
                      playsinline
                      preload="metadata"
                    />
                    <span v-else>暂无片段</span>
                  </div>
                  <div v-if="active.videos.some((item) => item.url)" class="pv-video-versions">
                    <ThemedSelect
                      :model-value="active.videoId"
                      :options="
                        active.videos
                          .filter((item) => item.url)
                          .map((item, index) => ({
                            value: item.id,
                            label: `片段 ${index + 1}${item.source === 'upload' ? ' · 本地上传' : ''}`,
                          }))
                      "
                      aria-label="视频版本"
                      @update:model-value="selectVersion('video', $event)"
                    />
                    <label class="pv-check">
                      <input
                        type="checkbox"
                        :checked="active.kept"
                        @change="setKeep(active, $event.target.checked)"
                      />
                      保留此片段
                    </label>
                    <button
                      class="pv-icon pv-danger"
                      title="删除当前片段"
                      aria-label="删除当前片段"
                      :disabled="!video"
                      @click="deleteVideo"
                    >
                      <i aria-hidden="true" class="ri-delete-bin-line"></i>
                    </button>
                  </div>
                  <p
                    v-if="video?.sourceImageId && video.sourceImageId !== active.imageId"
                    class="pv-hint"
                  >
                    此片段来自其他首帧版本
                  </p>
                </div>
                <div class="pv-shot-controls">
                  <ProductVideoPromptField
                    :model-value="normalizeVideoPrompt(active)"
                    :label="promptFields.motion.label"
                    :kind="
                      activeWholeVideo
                        ? `${generationDuration(active)} 秒 · ${activeTimelineCount} 个分镜`
                        : '连续动作'
                    "
                    :max-length="1800"
                    @update:model-value="updateShot('motion', $event)"
                    @copy="copyPrompt('motion')"
                    @expand="openPrompt('motion', $event)"
                  />
                  <label>
                    视频模型 ·
                    {{
                      isWholeVideo(active.productionMode)
                        ? `${generationDuration(active)} 秒整片`
                        : `${generationDuration(active, workflow)} 秒原片`
                    }}
                    <ThemedSelect
                      v-if="active.productionMode === 'single_video_30'"
                      :model-value="workflow.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL"
                      :options="WHOLE_VIDEO_30_MODELS"
                      aria-label="视频模型"
                      @update:model-value="set('wholeVideo30Model', $event)"
                    />
                    <ThemedSelect
                      v-else
                      :model-value="workflow.videoModel"
                      :options="currentVideoModelOptions"
                      aria-label="视频模型"
                      @update:model-value="selectVideoModel"
                    />
                  </label>
                  <p
                    v-if="active.productionMode !== 'single_video_30' && !currentVideoModelOptions.length"
                    class="pv-task-status error"
                    role="status"
                  >
                    请先在控制台 AI 功能映射中配置分镜视频模型
                  </p>
                  <p
                    v-else-if="active.productionMode !== 'single_video_30' && !currentVideoModelOptions.some((option) => option.value === workflow.videoModel)"
                    class="pv-task-status error"
                    role="status"
                  >
                    当前视频模型未映射，请重新选择
                  </p>
                  <p
                    v-if="isRetiredVideoModel(videoModelForShot(active))"
                    class="pv-task-status error"
                    role="status"
                  >
                    原视频模型已移除，请重新选择视频模型
                  </p>
                  <label v-if="perSecondVideo(active)">
                    视频画质
                    <ThemedSelect
                      :model-value="videoResolutionForShot(active)"
                      :options="resolutionOptionsForShot(active)"
                      aria-label="按秒视频画质"
                      @update:model-value="
                        set(
                          videoModelForShot(active) === MINIMAX_VIDEO_MODEL
                            ? 'minimaxResolution'
                            : active.productionMode === 'single_video_30'
                              ? 'wholeVideo30Resolution'
                              : 'videoResolution',
                          $event,
                        )
                      "
                    />
                  </label>
                  <label v-if="perSecondVideo(active) && !activeWholeVideo">
                    原片时长（秒）
                    <input
                      :value="
                        active.referenceRange
                          ? generationDuration(active, workflow)
                          : (workflow.videoDurationSeconds ?? 15)
                      "
                      :readonly="Boolean(active.referenceRange)"
                      type="number"
                      min="4"
                      :max="videoModelForShot(active) === ANMIAO25_VIDEO_MODEL ? 30 : 15"
                      step="1"
                      aria-label="按秒视频时长"
                      @input="set('videoDurationSeconds', Number($event.target.value))"
                    />
                  </label>
                  <div class="pv-actions">
                    <button
                      class="pv-primary"
                      :disabled="
                        !canGenerateVideo(active) ||
                        (active.productionMode !== 'single_video_30' &&
                          !currentVideoModelOptions.some((option) => option.value === workflow.videoModel)) ||
                        isRetiredVideoModel(videoModelForShot(active)) ||
                        busy(active, 'videos') ||
                        (perSecondVideo(active) &&
                          (videoPrice(active) == null && !videoUsesReportedCost(active) ||
                            invalidAnmiaoDuration(active) ||
                            invalidAnmiaoResolution(active)))
                      "
                      @click="generateShot('video')"
                    >
                      <i aria-hidden="true" class="ri-video-add-line"></i>
                      {{ busy(active, 'videos') ? '生成中' : video ? '重新生成视频' : '生成视频' }}
                      <small v-if="videoPrice(active) != null">{{ formatMiValue(videoPrice(active)) }} 米值</small>
                    </button>
                    <button :disabled="uploading" @click="videoInput.click()">
                      <i aria-hidden="true" class="ri-upload-2-line"></i>
                      上传片段
                    </button>
                    <button :disabled="!video?.url" @click="openEnhancement(true)">
                      <i aria-hidden="true" class="ri-magic-line"></i>
                      视频超分
                    </button>
                  </div>
                  <p
                    v-for="item in videoNotices"
                    :key="item.id"
                    :class="['pv-task-status', { error: item.status === 'failed' || item.error }]"
                    :title="
                      item.lastSyncedAt
                        ? `最近同步：${new Date(item.lastSyncedAt).toLocaleTimeString()}`
                        : ''
                    "
                    role="status"
                  >
                    {{ item.id === active.videos.at(-1)?.id ? '本次生成：' : '上次生成：'
                    }}{{ videoGenerationStatus(item) }}
                  </p>
                </div>
              </section>
            </div>
          </section>
        </main>

        <main v-else-if="!showingTasks" class="pv-output pv-scroll">
          <section class="pv-timeline">
            <div class="pv-section-head">
              <h3>成片顺序</h3>
              <span>{{ kept.length }} 个片段 · {{ totalDuration }} 秒</span>
            </div>
            <div v-if="!kept.length" class="pv-empty">
              <i aria-hidden="true" class="ri-film-line"></i>
              <p>暂无保留片段</p>
              <button @click="tab = 'shots'">返回分镜选片</button>
            </div>
            <article v-for="(shot, index) in kept" :key="shot.id" class="pv-timeline-shot">
              <div class="pv-section-head">
                <strong>{{ index + 1 }}. {{ shot.title }}</strong>
                <div class="pv-actions">
                  <button
                    class="pv-icon"
                    title="前移"
                    aria-label="前移"
                    @click="moveShot(shot.id, -1)"
                  >
                    <i aria-hidden="true" class="ri-arrow-up-line"></i>
                  </button>
                  <button
                    class="pv-icon"
                    title="后移"
                    aria-label="后移"
                    @click="moveShot(shot.id, 1)"
                  >
                    <i aria-hidden="true" class="ri-arrow-down-line"></i>
                  </button>
                  <button
                    class="pv-icon"
                    title="编辑分镜"
                    aria-label="编辑分镜"
                    @click="openShot(shot)"
                  >
                    <i aria-hidden="true" class="ri-edit-line"></i>
                  </button>
                  <button
                    class="pv-icon"
                    title="取消保留"
                    aria-label="取消保留"
                    @click="setKeep(shot, false)"
                  >
                    <i aria-hidden="true" class="ri-close-line"></i>
                  </button>
                </div>
              </div>
              <div class="pv-timing-bar">
                <div
                  class="pv-timing-modes"
                  role="group"
                  :aria-label="`${shot.title} 片段处理方式`"
                >
                  <button
                    :class="{ active: shot.timingMode !== 'speed' }"
                    :aria-pressed="shot.timingMode !== 'speed'"
                    @click="
                      shotChange(shot.id, (item) => {
                        item.timingMode = 'trim'
                      })
                    "
                  >
                    <i aria-hidden="true" class="ri-scissors-cut-line"></i>
                    截取片段
                  </button>
                  <button
                    :class="{ active: shot.timingMode === 'speed' }"
                    :aria-pressed="shot.timingMode === 'speed'"
                    :disabled="!capabilities?.clipSpeed"
                    @click="
                      shotChange(shot.id, (item) => {
                        item.timingMode = 'speed'
                      })
                    "
                  >
                    <i aria-hidden="true" class="ri-speed-up-line"></i>
                    整段加速
                  </button>
                </div>
                <span v-if="shot.timingMode === 'speed'" class="pv-speed-value">
                  {{ speedLabel(shot) }}
                </span>
              </div>
              <div class="pv-settings">
                <label v-if="shot.timingMode === 'speed'">
                  原片时长（秒）
                  <input :value="selectedVideo(shot).duration || 15" readonly />
                </label>
                <label v-else>
                  起点（秒）
                  <input
                    type="number"
                    min="0"
                    :max="selectedVideo(shot).duration || 15"
                    step="0.1"
                    :value="shot.start"
                    @input="
                      shotChange(shot.id, (item) => {
                        item.start = Number($event.target.value)
                      })
                    "
                  />
                </label>
                <label>
                  {{
                    shot.referenceRange
                      ? '原片分段时长（秒）'
                      : shot.timingMode === 'speed'
                        ? '目标时长（秒）'
                        : '截取时长（秒）'
                  }}
                  <input
                    type="number"
                    :readonly="Boolean(shot.referenceRange)"
                    min="0.5"
                    :max="
                      Math.min(
                        30,
                        (selectedVideo(shot).duration || 15) -
                          (shot.timingMode === 'speed' ? 0 : Number(shot.start)),
                      )
                    "
                    step="0.1"
                    :value="shot.duration"
                    @input="
                      shotChange(shot.id, (item) => {
                        item.duration = Number($event.target.value)
                      })
                    "
                  />
                </label>
              </div>
              <label>
                字幕
                <input
                  :value="shot.caption"
                  maxlength="120"
                  @input="
                    shotChange(shot.id, (item) => {
                      item.caption = $event.target.value
                    })
                  "
                />
              </label>
            </article>
          </section>
          <section class="pv-output-preview">
            <h3>成片预览</h3>
            <div class="pv-preview">
              <video
                v-if="workflow.composition?.url"
                :src="workflow.composition.url"
                controls
                playsinline
              />
              <span v-else>
                {{
                  compositionBusy ? `合成中 ${workflow.composition?.progress || 0}%` : '暂无成片'
                }}
              </span>
            </div>
            <p v-if="workflow.composition?.url && stale" class="pv-hint">
              分镜或剪辑已修改，请重新合成
            </p>
            <p
              v-if="workflow.composition?.error || workflow.composition?.pollError"
              class="pv-task-status error"
            >
              {{ workflow.composition.error || workflow.composition.pollError }}
            </p>
            <div class="pv-settings">
              <label>
                成片比例
                <ThemedSelect
                  :model-value="workflow.ratio"
                  :options="ratioOptions"
                  aria-label="导出比例"
                  @update:model-value="set('ratio', $event)"
                />
              </label>
              <label>
                输出格式
                <input value="MP4 · 720p · 30fps" readonly />
              </label>
            </div>
            <div class="pv-section-head">
              <label class="pv-audio-option">
                <input
                  type="checkbox"
                  :checked="workflow.keepOriginalAudio === true"
                  :disabled="!capabilities?.synchronizedAudio"
                  @change="set('keepOriginalAudio', $event.target.checked)"
                />
                保留原声
              </label>
            </div>
            <div class="pv-section-head">
              <h3>背景音乐</h3>
              <button :disabled="uploading" @click="musicInput.click()">
                <i aria-hidden="true" class="ri-music-2-line"></i>
                {{ workflow.musicUrl ? '更换音乐' : '上传音乐' }}
              </button>
            </div>
            <template v-if="workflow.musicUrl">
              <div class="pv-music">
                <span>{{ workflow.musicName }}</span>
                <button
                  class="pv-icon"
                  title="移除音乐"
                  aria-label="移除音乐"
                  @click="
                    change((data) => {
                      data.musicUrl = ''
                      data.musicName = ''
                    })
                  "
                >
                  <i aria-hidden="true" class="ri-close-line"></i>
                </button>
              </div>
              <audio :src="workflow.musicUrl" controls />
              <label>
                音量 {{ Math.round(workflow.musicVolume * 100) }}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="workflow.musicVolume"
                  @input="set('musicVolume', Number($event.target.value))"
                />
              </label>
            </template>
            <p v-if="capabilities && !capabilities.composition" class="pv-task-status error">
              成片服务尚未就绪，请配置合成服务
            </p>
            <div class="pv-actions">
              <button
                class="pv-primary"
                :disabled="
                  !kept.length || compositionBusy || !capabilities?.composition || uploading
                "
                @click="compose"
              >
                <i
                  aria-hidden="true"
                  :class="compositionBusy ? 'ri-loader-4-line pv-spin' : 'ri-film-line'"
                ></i>
                {{ compositionBusy ? '合成中' : '合成视频' }}
              </button>
              <button :disabled="!workflow.composition?.url || stale" @click="download">
                <i aria-hidden="true" class="ri-download-line"></i>
                下载
              </button>
              <button :disabled="!workflow.composition?.url || stale" @click="openEnhancement()">
                <i aria-hidden="true" class="ri-magic-line"></i>
                视频超分
              </button>
              <button
                :disabled="!workflow.composition?.url || stale"
                @click="openProducts('publish')"
              >
                <i aria-hidden="true" class="ri-archive-line"></i>
                回传选品库
              </button>
            </div>
          </section>
        </main>
        <footer v-if="!showingTasks" class="pv-footer">
          <span>
            {{ workflow.shots.length }} {{ hasWholeVideos ? '条视频' : '个分镜' }} ·
            {{ kept.length }} 个已保留
          </span>
          <button @click="emit('close')">返回画布</button>
        </footer>

        <div v-if="picker" class="pv-sub-overlay">
          <section class="pv-picker" role="dialog" aria-label="选择素材或商品">
            <div class="pv-section-head">
              <h3>
                {{
                  picker === 'canvas'
                    ? canvasPickerTitle
                    : picker === 'publish'
                      ? '回传到商品'
                      : '选择商品图片'
                }}
              </h3>
              <button class="pv-icon" title="关闭" aria-label="关闭素材选择" @click="picker = ''">
                <i aria-hidden="true" class="ri-close-line"></i>
              </button>
            </div>
            <p v-if="error" class="pv-task-status error" role="status">{{ error }}</p>
            <p v-if="continuityCanvasTarget" class="pv-picker-count">
              已选择 {{ canvasReferenceImage?.url ? 1 : 0 }}/1 张
            </p>
            <p v-else-if="picker !== 'publish'" class="pv-picker-count">
              已选择 {{ workflow.references.length }}/6 张
            </p>
            <div v-if="picker === 'canvas'" class="pv-picker-grid pv-scroll">
              <button
                v-for="layer in canvasImages"
                :key="layer.id"
                :class="{
                  active: continuityCanvasTarget
                    ? canvasReferenceImage?.url === layer.url
                    : workflow.references.some((item) => item.url === layer.url),
                }"
                @click="chooseCanvas(layer)"
              >
                <img :src="layer.url" :alt="layer.name || '画布图片'" />
                <span>{{ layer.name || '画布图片' }}</span>
              </button>
              <p v-if="!canvasImages.length">画布中暂无图片</p>
            </div>
            <template v-else>
              <form class="pv-actions" @submit.prevent="searchProducts(true)">
                <input v-model="keyword" placeholder="搜索商品名称或 ID" aria-label="搜索商品" />
                <button :disabled="searching">
                  <i aria-hidden="true" class="ri-search-line"></i>
                  搜索
                </button>
              </form>
              <div v-if="sourceProduct && picker === 'source'" class="pv-product-images">
                <div class="pv-section-head">
                  <strong>{{ sourceProduct.title }}</strong>
                  <button @click="sourceProduct = null">返回商品</button>
                </div>
                <div class="pv-picker-grid pv-scroll">
                  <button
                    v-for="url in productImages"
                    :key="url"
                    :class="{ active: workflow.references.some((item) => item.url === url) }"
                    @click="chooseCanvas({ url, name: sourceProduct.title })"
                  >
                    <img :src="url" alt="商品图片" />
                  </button>
                </div>
              </div>
              <template v-else>
                <div class="pv-products pv-scroll">
                  <p v-if="searching">加载中</p>
                  <p v-else-if="!products.length">没有匹配商品</p>
                  <article v-for="product in products" :key="product.id">
                    <img v-if="product.coverImageUrl" :src="product.coverImageUrl" alt="商品封面" />
                    <span>
                      <strong>{{ product.title }}</strong>
                      <small>{{ product.sourcePlatform }} · {{ product.sourceProductId }}</small>
                    </span>
                    <button
                      v-if="picker === 'publish'"
                      :disabled="publishing"
                      @click="ask('将成片添加到此商品？', product.title, () => publish(product))"
                    >
                      {{ publishing ? '回传中' : '选择回传' }}
                    </button>
                    <button v-else @click="chooseProduct(product)">选择图片</button>
                  </article>
                </div>
                <div class="pv-section-head">
                  <span>共 {{ total }} 件 · 第 {{ page }} 页</span>
                  <div class="pv-actions">
                    <button
                      :disabled="page <= 1 || searching"
                      @click="
                        () => {
                          page--
                          searchProducts()
                        }
                      "
                    >
                      上一页
                    </button>
                    <button
                      :disabled="page * 10 >= total || searching"
                      @click="
                        () => {
                          page++
                          searchProducts()
                        }
                      "
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </template>
            </template>
          </section>
        </div>
        <div v-if="refinement" class="pv-sub-overlay">
          <section
            class="pv-refine-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="分镜完善预览"
          >
            <div class="pv-section-head">
              <h3>{{ refinement.title }} · 完善预览</h3>
              <button
                class="pv-icon"
                title="关闭预览"
                aria-label="关闭预览"
                @click="refinement = null"
              >
                <i aria-hidden="true" class="ri-close-line"></i>
              </button>
            </div>
            <div class="pv-refine-fields pv-scroll">
              <div v-if="refinement.purpose" class="pv-refine-intent">
                <strong>镜头目的</strong>
                <p>{{ refinement.purpose }}</p>
                <details>
                  <summary>镜头设计与衔接</summary>
                  <p>{{ refinement.design }}</p>
                </details>
              </div>
              <label v-for="(field, key) in promptFields" :key="key">
                {{ field.label }}
                <textarea
                  v-model="refinement[key]"
                  :aria-label="field.label"
                  :maxlength="field.maxLength"
                  spellcheck="false"
                ></textarea>
              </label>
            </div>
            <div class="pv-prompt-dialog-footer">
              <small>原素材保留，首帧待重新确认</small>
              <div class="pv-actions">
                <button @click="refinement = null">取消</button>
                <button
                  class="pv-primary"
                  :disabled="!refinement.imagePrompt.trim() || !refinement.motion.trim()"
                  @click="applyRefinement"
                >
                  应用到分镜
                </button>
              </div>
            </div>
          </section>
        </div>
        <div v-if="promptEdit" class="pv-sub-overlay">
          <section
            class="pv-prompt-dialog"
            role="dialog"
            aria-modal="true"
            :aria-label="`编辑${promptEdit.label}`"
          >
            <div class="pv-section-head">
              <h3>{{ promptEdit.label }}</h3>
              <button class="pv-icon" title="关闭编辑" aria-label="关闭编辑" @click="closePrompt()">
                <i aria-hidden="true" class="ri-close-line"></i>
              </button>
            </div>
            <textarea
              ref="promptTextarea"
              v-model="promptEdit.value"
              :aria-label="promptEdit.label"
              :maxlength="promptEdit.maxLength"
              spellcheck="false"
            ></textarea>
            <div class="pv-prompt-dialog-footer">
              <small>{{ promptEdit.value.length }} / {{ promptEdit.maxLength }}</small>
              <div class="pv-actions">
                <button @click="closePrompt()">取消</button>
                <button class="pv-primary" @click="closePrompt(true)">应用修改</button>
              </div>
            </div>
          </section>
        </div>
        <div v-if="confirmation" class="pv-sub-overlay pv-confirm-overlay">
          <section class="pv-confirm" role="alertdialog" aria-labelledby="pv-confirm-title">
            <h3 id="pv-confirm-title">{{ confirmation.title }}</h3>
            <p>{{ confirmation.detail }}</p>
            <div class="pv-actions">
              <button @click="confirmation = null">取消</button>
              <button class="pv-primary" @click="confirm">确定</button>
            </div>
          </section>
        </div>
        <input ref="uploader" type="file" accept="image/*" multiple hidden @change="uploadImages" />
        <input
          ref="continuityUploader"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="上传固定参考图"
          hidden
          @change="uploadContinuityImage"
        />
        <input
          ref="referenceVideoInput"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/*"
          hidden
          @change="uploadReferenceVideo"
        />
        <input ref="videoInput" type="file" accept="video/*" hidden @change="uploadVideo" />
        <input ref="musicInput" type="file" accept="audio/*" hidden @change="uploadMusic" />
      </section>
    </div>
  </Teleport>
  <VideoEnhanceDialog
    v-if="enhanceSource && open"
    :source-url="enhanceSource.url"
    :save-label="enhanceSource.shotId ? '添加为新版本' : '添加到画布'"
    :save-result="saveEnhancement"
    :saved-result-ids="
      enhanceSource.shotId
        ? []
        : layers
            .filter((layer) => String(layer.id).startsWith('enhance-'))
            .map((layer) => layer.id.slice('enhance-'.length))
    "
    :saved-action-label="enhanceSource.shotId ? '' : '定位到画布'"
    @close="enhanceSource = null"
  />
</template>

<style scoped>
.pv-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  padding: 24px;
  background: #0008;
  display: flex;
}
.pv-workspace {
  position: relative;
  width: 100%;
  max-width: 1480px;
  height: 100%;
  margin: auto;
  display: flex;
  flex-direction: column;
  background: var(--canvas-panel);
  color: var(--canvas-text);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;
  letter-spacing: 0;
}
.pv-workspace * {
  box-sizing: border-box;
  letter-spacing: 0;
}
.pv-header,
.pv-footer,
.pv-section-head,
.pv-actions,
.pv-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pv-header {
  padding: 12px 20px;
  border-bottom: 1px solid var(--canvas-border);
  flex-wrap: wrap;
}
.pv-header > .pv-icon {
  margin-left: auto;
}
.pv-title {
  margin-right: 24px;
}
.pv-header .pv-task-title {
  width: 200px;
  max-width: 100%;
  height: 34px;
  padding: 5px 8px;
  font-size: 12px;
}
@media (max-width: 900px) {
  .pv-header .pv-task-title {
    flex: 1;
    min-width: 100px;
  }
  .pv-header .pv-tabs {
    order: 2;
  }
}
.pv-title > i {
  color: var(--canvas-accent);
  font-size: 23px;
}
.pv-workspace h2 {
  font-size: 17px;
  margin: 0;
}
.pv-workspace h3 {
  font-size: 13px;
  margin: 0;
  font-weight: 600;
}
.pv-workspace small {
  color: var(--canvas-text-subtle);
  font-size: 11px;
  font-weight: 400;
}
.pv-workspace button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface);
  color: var(--canvas-text);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.pv-workspace button:hover:not(:disabled) {
  background: var(--canvas-surface-hover);
  border-color: var(--canvas-accent-border);
}
.pv-workspace button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pv-workspace button.pv-primary {
  background: var(--canvas-accent);
  color: var(--canvas-input);
  border-color: var(--canvas-accent);
  font-weight: 600;
}
.pv-workspace .pv-primary small {
  color: inherit;
}
.pv-workspace button.pv-icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  min-height: 32px;
  background: transparent;
}
.pv-icon i {
  font-size: 18px;
}
.pv-workspace button.pv-danger {
  color: var(--color-error);
}
.pv-timing-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.pv-timing-modes {
  display: flex;
  padding: 3px;
  gap: 3px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-input);
}
.pv-production-modes {
  display: flex;
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  padding: 3px;
  gap: 3px;
  margin-bottom: 16px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-input);
}
.pv-production-modes button {
  min-width: 126px;
  background: transparent;
  border-color: transparent;
}
.pv-plan-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.pv-plan-source > span {
  flex: 0 0 auto;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-reference-video-source {
  margin: 0 0 18px;
  padding: 14px 0 18px;
  border-top: 1px solid var(--canvas-border);
  border-bottom: 1px solid var(--canvas-border);
}
.pv-reference-video-source .pv-section-head {
  margin-bottom: 12px;
}
.pv-reference-video-source h3 {
  margin: 0 0 4px;
}
.pv-reference-video-source .pv-section-head p {
  margin: 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
}
.pv-workspace button.pv-reference-video-upload {
  width: 100%;
  min-height: 96px;
  justify-content: center;
  flex-direction: column;
  border-style: dashed;
  color: var(--canvas-text-muted);
  background: var(--canvas-input);
}
.pv-reference-video-upload i {
  color: var(--canvas-accent);
  font-size: 24px;
}
.pv-reference-video-preview {
  display: grid;
  grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.pv-reference-video-preview video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: #0d0f12;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
}
.pv-reference-video-preview > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.pv-reference-video-preview strong {
  display: block;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pv-reference-video-preview span {
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-reference-frames {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  margin-top: 12px;
}
.pv-reference-frames figure {
  position: relative;
  margin: 0;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
  background: var(--canvas-input);
}
.pv-reference-frames img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}
.pv-reference-frames figcaption {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 1px 3px;
  border-radius: 3px;
  color: #fff;
  background: rgb(0 0 0 / 72%);
  font-size: 10px;
  line-height: 1.4;
}
.pv-audio-summary {
  display: flex;
  gap: 7px;
  margin: 12px 0 0;
  color: var(--canvas-text-muted);
  font-size: 11px;
  line-height: 1.6;
}
.pv-audio-summary i {
  flex: 0 0 auto;
  margin-top: 2px;
  color: #54c28b;
  font-size: 14px;
}
.pv-story-timeline {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.pv-story-timeline li {
  padding: 0 0 8px 12px;
  margin-bottom: 12px;
  border-left: 2px solid var(--canvas-accent-border);
}
.pv-timing-modes button {
  min-width: 108px;
  border-color: transparent;
  background: transparent;
}
.pv-speed-value {
  color: var(--canvas-accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.pv-tabs {
  display: flex;
  padding: 3px;
  background: var(--canvas-input);
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  gap: 2px;
}
.pv-tabs button {
  background: transparent;
  border-color: transparent;
  min-width: 98px;
}
.pv-tabs button.active,
.pv-workspace button.active {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  border-color: var(--canvas-accent-border);
}
.pv-message {
  padding: 6px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--canvas-accent-soft);
  overflow-wrap: anywhere;
}
.pv-message.error,
.pv-task-status.error {
  color: var(--color-error);
}
.pv-plan-progress {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--canvas-border);
  background: var(--canvas-surface);
  font-size: 12px;
}
.pv-plan-progress > i {
  color: var(--canvas-accent);
}
.pv-plan-progress > div {
  flex: 1 1 240px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pv-plan-progress span {
  display: block;
  color: var(--canvas-text-subtle);
  margin-top: 3px;
}
.pv-plan-progress p {
  margin: 4px 0 0;
  color: var(--color-error);
}
.pv-scroll {
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--canvas-border-strong) transparent;
}
.pv-source {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
}
.pv-source > section {
  min-width: 0;
  padding: 24px;
}
.pv-source-assets {
  border-right: 1px solid var(--canvas-border);
}
.pv-section-head {
  justify-content: space-between;
  min-height: 34px;
  margin-bottom: 12px;
}
.pv-actions {
  flex-wrap: wrap;
}
.pv-reference-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}
.pv-reference-grid figure {
  margin: 0;
  min-width: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  overflow: hidden;
}
.pv-reference-grid img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--canvas-input);
}
.pv-reference-grid figcaption {
  display: flex;
  align-items: center;
  padding-left: 8px;
  min-width: 0;
}
.pv-reference-grid figcaption span {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
}
.pv-workspace button.pv-empty-upload {
  grid-column: 1 / -1;
  min-height: 270px;
  background: var(--canvas-input);
  border-style: dashed;
  flex-direction: column;
  color: var(--canvas-text-muted);
}
.pv-empty-upload i,
.pv-empty > i {
  font-size: 32px;
  color: var(--canvas-text-subtle);
}
.pv-workspace label:not(.pv-check) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--canvas-text-muted);
  margin-bottom: 14px;
  min-width: 0;
}
.pv-workspace input:not([type='checkbox']):not([type='range']),
.pv-workspace textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 6px;
  background: var(--canvas-input);
  color: var(--canvas-text);
  padding: 8px 10px;
  font: inherit;
  line-height: 1.6;
}
.pv-workspace textarea {
  resize: vertical;
  min-height: 96px;
  max-height: 280px;
}
.pv-workspace input:focus,
.pv-workspace textarea:focus {
  outline: 1px solid var(--canvas-accent);
}
.pv-workspace input[type='checkbox'],
.pv-workspace input[type='range'] {
  accent-color: var(--canvas-accent);
}
.pv-workspace :deep(.themed-select-trigger) {
  min-height: 36px;
  font-size: 12px;
}
.pv-workspace :deep(.themed-select-options) {
  max-height: 190px;
  overflow-y: auto;
}
.pv-settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.pv-whole-settings {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pv-planning-settings {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pv-planning-settings.pv-whole-settings {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.pv-planning-model {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.pv-workspace label.pv-audio-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: fit-content;
  min-height: 28px;
}
.pv-whole-meta {
  margin-left: 10px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-audio-option input {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin: 0;
}
.pv-continuity {
  border-top: 1px solid var(--canvas-border);
  padding-top: 12px;
}
.pv-continuity-fields {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.pv-continuity-fields textarea {
  min-height: 60px;
  resize: vertical;
}
.pv-continuity-field {
  min-width: 0;
  display: grid;
  gap: 8px;
}
.pv-continuity-field-head,
.pv-continuity-image {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pv-continuity-field-head {
  flex-wrap: wrap;
  justify-content: space-between;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-continuity-image img {
  width: 80px;
  height: 80px;
  flex: 0 0 80px;
  object-fit: contain;
  background: var(--canvas-bg);
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
}
.pv-continuity-image span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-continuity-anchor {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--canvas-border);
  margin-bottom: 12px;
}
.pv-continuity-anchor img {
  width: 44px;
  height: 52px;
  object-fit: contain;
  flex: 0 0 44px;
}
.pv-continuity-anchor span {
  flex: 1;
  min-width: 100px;
  overflow-wrap: anywhere;
}
.pv-continuity-anchor strong,
.pv-continuity-anchor small {
  display: block;
}
.pv-continuity-anchor small {
  color: var(--canvas-text-muted);
  margin-top: 4px;
}
.pv-footer {
  justify-content: space-between;
  border-top: 1px solid var(--canvas-border);
  padding: 10px 20px;
  color: var(--canvas-text-subtle);
  flex-shrink: 0;
}
.pv-shots {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.pv-shot-list {
  padding: 14px 10px;
  border-right: 1px solid var(--canvas-border);
  background: var(--canvas-input);
}
.pv-shot-list .pv-section-head {
  padding: 0 6px;
}
.pv-workspace button.pv-shot-item {
  display: flex;
  width: 100%;
  text-align: left;
  justify-content: flex-start;
  margin-bottom: 8px;
  padding: 8px;
  min-height: 70px;
}
.pv-shot-item img,
.pv-shot-item > i {
  width: 48px;
  height: 48px;
  object-fit: contain;
  flex: 0 0 48px;
}
.pv-shot-item > i {
  display: grid;
  place-items: center;
  font-size: 22px;
}
.pv-shot-number {
  color: var(--canvas-text-subtle);
  font-size: 10px;
}
.pv-shot-item > span:last-child {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.pv-shot-item strong {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pv-batch {
  width: 100%;
  margin-top: 12px;
}
.pv-shot-editor {
  padding: 18px 24px;
}
.pv-shot-heading input {
  max-width: 400px;
  margin-right: auto;
}
.pv-direction {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--canvas-border);
}
.pv-shot-intent {
  flex: 1;
  min-width: 0;
}
.pv-shot-intent strong,
.pv-refine-intent strong,
.pv-plan-summary h4 {
  font-size: 12px;
  color: var(--canvas-text);
}
.pv-shot-intent p,
.pv-refine-intent p,
.pv-plan-summary p {
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0 0;
  color: var(--canvas-text-muted);
}
.pv-refine-intent {
  grid-column: 1 / -1;
}
.pv-direction > button {
  flex-shrink: 0;
  height: 36px;
}
.pv-editor-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 24px;
  row-gap: 0;
}
.pv-editor-columns > section {
  display: grid;
  grid-template-rows: subgrid;
  grid-row: span 2;
  min-width: 0;
}
.pv-shot-media,
.pv-shot-controls {
  min-width: 0;
}
.pv-workspace :deep(.pv-prompt-field) {
  margin-bottom: 16px;
}
.pv-workspace :deep(.pv-prompt-heading) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin-bottom: 6px;
}
.pv-workspace :deep(.pv-prompt-heading strong) {
  font-size: 12px;
  white-space: nowrap;
}
.pv-workspace :deep(.pv-prompt-heading small) {
  font-size: 11px;
  color: var(--canvas-text-subtle);
}
.pv-workspace :deep(.pv-prompt-tools) {
  display: flex;
  margin-left: auto;
  gap: 2px;
}
.pv-workspace :deep(.pv-prompt-tools button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-height: 28px;
  height: 28px;
  flex-basis: 28px;
  padding: 0;
  color: var(--canvas-text-muted);
  background: transparent;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  cursor: pointer;
}
.pv-workspace :deep(.pv-prompt-tools button:hover) {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent);
}
.pv-workspace :deep(.pv-prompt-tools button:focus-visible) {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
.pv-workspace :deep(.pv-prompt-tools button:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}
.pv-workspace :deep(.pv-prompt-tools i) {
  font-size: 15px;
}
.pv-workspace :deep(.pv-prompt-field textarea) {
  display: block;
  width: 100%;
  height: 164px;
  min-height: 164px;
  resize: none;
  padding: 12px;
  font-size: 13px;
  line-height: 1.8;
  border-radius: 6px;
  border: 1px solid var(--canvas-border-strong);
  background: var(--canvas-input);
  color: var(--canvas-text);
  scrollbar-width: thin;
  scrollbar-color: var(--canvas-border-strong) transparent;
}
.pv-workspace :deep(.pv-prompt-field textarea:focus) {
  outline: 1px solid var(--canvas-accent);
}
.pv-workspace :deep(.pv-prompt-count) {
  text-align: right;
  font-size: 11px;
  color: var(--canvas-text-subtle);
  margin-top: 5px;
  font-variant-numeric: tabular-nums;
}
.pv-prompt-dialog,
.pv-refine-dialog {
  width: min(760px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  padding: 20px;
}
.pv-refine-dialog {
  width: min(1000px, 100%);
}
.pv-refine-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  min-height: 0;
}
.pv-workspace .pv-refine-fields textarea {
  height: 380px;
  max-height: none;
  line-height: 1.8;
  font-size: 13px;
  resize: none;
}
.pv-refine-dialog .pv-section-head {
  justify-content: space-between;
  flex-shrink: 0;
}
.pv-prompt-dialog .pv-section-head {
  justify-content: space-between;
  flex-shrink: 0;
}
.pv-workspace .pv-prompt-dialog textarea {
  height: min(420px, 55dvh);
  min-height: 160px;
  max-height: none;
  resize: none;
  font-size: 14px;
  line-height: 1.9;
  scrollbar-width: thin;
  scrollbar-color: var(--canvas-border-strong) transparent;
}
.pv-prompt-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 14px;
}
.pv-editor-columns h3,
.pv-output-preview > h3 {
  margin-bottom: 12px;
}
.pv-preview {
  width: 100%;
  aspect-ratio: 16/10;
  min-height: 0;
  max-height: 390px;
  background: var(--canvas-input);
  display: flex;
  justify-content: center;
  align-items: center;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  overflow: hidden;
  color: var(--canvas-text-subtle);
  margin-bottom: 12px;
}
.pv-preview img,
.pv-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pv-versions,
.pv-reference-picks,
.pv-direct-images {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 12px;
}
.pv-workspace .pv-image-select,
.pv-workspace .pv-direct-images button {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  padding: 3px;
}
.pv-versions {
  gap: 10px;
  padding: 6px 6px 0 0;
}
.pv-image-version {
  position: relative;
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
}
.pv-workspace button.pv-image-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border-radius: 50%;
  background: var(--canvas-surface);
  color: var(--canvas-text-muted);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.pv-image-remove i {
  font-size: 16px;
}
.pv-image-version:hover .pv-image-remove,
.pv-image-version:focus-within .pv-image-remove,
.pv-image-version.is-selected .pv-image-remove {
  opacity: 1;
  pointer-events: auto;
}
.pv-workspace .pv-image-remove:hover:not(:disabled) {
  border-color: var(--color-error);
  color: var(--color-error);
}
.pv-workspace .pv-image-remove:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
@media (hover: none) {
  .pv-workspace button.pv-image-remove {
    opacity: 1;
    pointer-events: auto;
  }
}
.pv-versions img,
.pv-direct-images img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pv-reference-picks {
  min-height: 54px;
  margin-top: 10px;
}
.pv-workspace .pv-reference-picks label {
  position: relative;
  margin: 0;
}
.pv-reference-picks img {
  width: 46px;
  height: 46px;
  object-fit: contain;
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
}
.pv-reference-picks input {
  position: absolute;
  top: 2px;
  left: 2px;
  margin: 0;
}
.pv-video-versions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}
.pv-video-versions > div {
  flex: 1;
}
.pv-check {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--canvas-accent);
  font-size: 12px;
}
.pv-workspace details {
  margin-top: 14px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-workspace summary {
  cursor: pointer;
  margin-bottom: 10px;
}
.pv-task-status,
.pv-hint {
  font-size: 12px;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.pv-hint {
  color: var(--color-warning);
}
.pv-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  gap: 8px;
  min-height: 240px;
  color: var(--canvas-text-muted);
}
.pv-output {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr);
  flex: 1;
}
.pv-output > section {
  padding: 20px 24px;
  min-width: 0;
}
.pv-timeline {
  border-right: 1px solid var(--canvas-border);
}
.pv-timeline-shot {
  border-bottom: 1px solid var(--canvas-border);
  padding: 14px 0 8px;
}
.pv-timeline-shot .pv-section-head strong {
  overflow-wrap: anywhere;
}
.pv-timeline-shot .pv-actions {
  flex-wrap: nowrap;
  gap: 4px;
}
.pv-music {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.pv-music span {
  overflow-wrap: anywhere;
}
.pv-workspace audio {
  width: 100%;
  height: 36px;
  margin: 10px 0;
}
.pv-sub-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: #0007;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.pv-picker,
.pv-confirm {
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  padding: 20px;
  width: 740px;
  max-width: 100%;
  max-height: 90%;
  overflow: auto;
  box-shadow: var(--canvas-panel-shadow);
}
.pv-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  max-height: 440px;
  margin-top: 14px;
}
.pv-workspace .pv-picker-grid button {
  flex-direction: column;
  min-width: 0;
}
.pv-picker-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}
.pv-picker-grid span {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pv-picker form input {
  flex: 1;
}
.pv-products {
  max-height: 420px;
  margin: 14px 0;
}
.pv-products article {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--canvas-border);
}
.pv-products article > img {
  width: 52px;
  height: 52px;
  object-fit: contain;
  flex-shrink: 0;
}
.pv-products article > span {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 6px;
}
.pv-products strong {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pv-products article > button {
  flex-shrink: 0;
}
.pv-product-images {
  margin-top: 14px;
}
.pv-confirm-overlay {
  z-index: 20;
}
.pv-confirm {
  width: 400px;
}
.pv-confirm p {
  line-height: 1.7;
  color: var(--canvas-text-muted);
  overflow-wrap: anywhere;
}
.pv-confirm .pv-actions {
  justify-content: flex-end;
}
.pv-spin {
  animation: pv-spin 1s linear infinite;
}
@keyframes pv-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 900px) {
  .pv-overlay {
    padding: 8px;
  }
  .pv-shots {
    grid-template-columns: 160px minmax(0, 1fr);
  }
  .pv-shot-number {
    display: none;
  }
  .pv-shot-item img,
  .pv-shot-item > i {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
  }
  .pv-editor-columns {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    gap: 28px;
  }
  .pv-editor-columns > section {
    display: block;
    grid-row: auto;
  }
  .pv-source > section,
  .pv-output > section,
  .pv-shot-editor {
    padding: 16px;
  }
  .pv-header {
    gap: 8px;
    padding: 10px 14px;
  }
  .pv-title {
    margin-right: 0;
  }
  .pv-tabs button {
    min-width: 80px;
  }
}
@media (max-width: 600px) {
  .pv-settings.pv-planning-settings {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pv-planning-model {
    grid-column: 1 / -1;
  }
  .pv-refine-fields {
    grid-template-columns: 1fr;
  }
  .pv-prompt-dialog-footer {
    flex-wrap: wrap;
  }
  .pv-overlay {
    padding: 0;
  }
  .pv-workspace {
    border-radius: 0;
  }
  .pv-header .pv-tabs {
    order: 3;
    width: 100%;
  }
  .pv-tabs button {
    flex: 1;
  }
  .pv-source,
  .pv-output {
    display: block;
  }
  .pv-plan-source,
  .pv-reference-video-preview {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .pv-plan-source .pv-production-modes,
  .pv-reference-video-preview video {
    width: 100%;
  }
  .pv-reference-frames {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .pv-source-assets,
  .pv-timeline {
    border-right: 0;
    border-bottom: 1px solid var(--canvas-border);
  }
  .pv-shots {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .pv-shot-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    max-height: 100px;
    padding: 8px;
    border-right: 0;
    border-bottom: 1px solid var(--canvas-border);
  }
  .pv-shot-list .pv-section-head {
    flex-shrink: 0;
    margin: 0;
  }
  .pv-shot-list h3 {
    display: none;
  }
  .pv-workspace button.pv-shot-item {
    min-width: 142px;
    width: 142px;
    margin: 0;
  }
  .pv-shot-list .pv-batch {
    width: 118px;
    min-width: 118px;
    margin: 0;
  }
  .pv-shot-heading {
    gap: 5px;
  }
  .pv-reference-grid {
    gap: 8px;
  }
  .pv-picker-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .pv-settings {
    gap: 8px;
  }
  .pv-timeline-shot .pv-section-head {
    flex-wrap: wrap;
  }
}
</style>
