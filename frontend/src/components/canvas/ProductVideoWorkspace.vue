<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import ProductVideoPromptField from './ProductVideoPromptField.vue'
import ProductVideoTaskList from './ProductVideoTaskList.vue'
import ProductVideoContinuityPanel from './ProductVideoContinuityPanel.vue'
import ProductVideoWholeTimeline from './ProductVideoWholeTimeline.vue'
import { wholeTimeline, wholeSeconds, wholeTimelineIssue, updateWholeTimeline, moveWholeBoundary, selectProductionMode } from '../../utils/productVideoWholeTimeline.js'
import VideoEnhanceDialog from './VideoEnhanceDialog.vue'
import { useProductVideo } from '../../composables/useProductVideo'
import { useUserStore } from '../../stores/user'
import { productVideoBatchCandidates } from '../../utils/productVideoBatch'
import { exportTimeline, moveExportClip, exportClipRange, exportTime } from '../../utils/productVideoExport'
import { buildContinuityReview, buildWholeVideoReview, currentWholeVideoReview, wholeVideoReviewIssue, currentContinuityReview, continuityReviewIssue, applyContinuityCut, reviewRunning, motionObservationRequired } from '../../utils/productVideoContinuityReview'
import { fetchSelectionProducts, fetchSelectionProduct } from '../../utils/selectionPoolApi'
import { normalizeSelectionProduct } from '../../utils/selectionProductFormat'
import { uploadFileDirect } from '../../utils/ossUpload'
import { formatMiValue } from '../../utils/miValue'
import { writeTextToClipboard } from '../../utils/clipboard'
import { inspectReferenceVideoFile, extractReferenceVideoFrame } from '../../utils/referenceVideo'
import {
  SHOT_TRANSITIONS,
  adjacentProductVideoShots,
  shotConnection,
  previousShotTailSource,
  usableShotConnectionFrame,
  validateShotConnectionVideo,
  shotConnectionIssue,
  shotBoundaryPreview,
  usableMotionObservation,
} from '../../utils/productVideoShotConnections'
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
  isAnmiao25VideoModel,
  isAnmiao20FastVideoModel,
  ANMIAO20_FAST_VIDEO_RESOLUTIONS,
  HAILUO_H3_VIDEO_MODEL,
  NEXT_SHOT_FIRST_FRAME,
  ANMIAO25_VIDEO_RESOLUTIONS,
  MINIMAX_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  isRetiredVideoModel,
  isPerSecondVideoModel,
  VIDEO_RATIOS,
  isWholeVideo,
  generationDuration,
  canGenerateVideo,
  buildPlanRequest,
  buildCompositionRequest,
  compositionFingerprint,
  pickImage,
  planningTimeoutMs,
  planningErrorMessage,
  normalizePromptLineBreaks,
  normalizeVideoPrompt,
  setShotMotion,
  removeReference,
  removeImage,
  removeVideo,
  selectedImage,
  selectedVideo,
  imageGenerationNotices,
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
          ...shot.videos.find((item) => item.url === source.url),
          id,
          url: result.resultUrl,
          duration: result.metadata.duration,
          source: 'enhance',
          status: 'completed',
        })
      }
      shot.videoId = id
      shot.kept = false
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
  capabilitiesLoading,
  capabilitiesError,
  planningModelOptions,
  imageModelOptions,
  selectedImageModelValue,
  effectiveImageModel,
  imageModelIsMapped,
  videoModelOptions,
  wholeVideo15ModelOptions,
  wholeVideo30ModelOptions,
  effectiveWholeVideo15Model,
  effectiveWholeVideo30Model,
  effectiveVideoModel,
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
  retryVideoSubmission,
  batchConfig,
  startBatchGeneration,
  cancelBatch,
  startContinuityReview,
  cancelContinuityReview,
  compose,
} = useProductVideo(
  computed(() => props.canvasId),
  activeTaskId,
)
const user = useUserStore()
const currentVideoModelOptions = computed(() =>
  active.value?.productionMode === 'single_video' ? wholeVideo15ModelOptions.value : videoModelOptions.value,
)
const videoWorkflow = computed(() => ({
  ...workflow.value,
  videoModel: effectiveVideoModel.value,
  wholeVideo30Model: effectiveWholeVideo30Model.value,
}))
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
const linkingShotId = ref('')
const boundaryPreview = ref(null)
const boundaryVideo = ref(null)
const manualPreviousState = ref('')
const manualMotion = ref('')
const wholeBeatIndex = ref(0)
let connectionController = null
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
watch(activeId, () => { wholeBeatIndex.value = 0 })
const frame = computed(() => active.value && selectedImage(active.value))
const nextShot = computed(() => {
  const index = workflow.value.shots.findIndex((shot) => shot.id === active.value?.id)
  return index >= 0 ? workflow.value.shots[index + 1] : null
})
const nextShotFrame = computed(() => nextShot.value && selectedImage(nextShot.value))
const isH3VideoModel = computed(
  () =>
    active.value &&
    [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(videoModelForShot(active.value)),
)
const tailFrameOptions = computed(() => [
  { value: '', label: '不设置尾帧' },
  ...workflow.value.references.map((item) => ({
    value: item.id,
    label: item.name || '参考图',
  })),
  ...(nextShot.value && nextShotFrame.value
    ? [
        {
          value: NEXT_SHOT_FIRST_FRAME,
          label: `下一镜头首帧 · ${nextShot.value.title}`,
        },
      ]
    : []),
])
const tailFrame = computed(() => {
  if (active.value?.lastFrameImageId === NEXT_SHOT_FIRST_FRAME && nextShotFrame.value)
    return { ...nextShotFrame.value, name: `下一镜头首帧 · ${nextShot.value.title}` }
  return workflow.value.references.find((item) => item.id === active.value?.lastFrameImageId)
})
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
const adjacentShots = computed(() =>
  active.value ? adjacentProductVideoShots(workflow.value, active.value) : {},
)
const activeConnection = computed(() =>
  active.value ? shotConnection(workflow.value, active.value) : {},
)
const transitionOptions = computed(() =>
  SHOT_TRANSITIONS.filter((item) =>
    adjacentShots.value.previous ? item.value !== 'opening' : item.value === 'opening',
  ),
)
const connectionSource = computed(
  () => active.value && previousShotTailSource(workflow.value, active.value),
)
watch([activeTaskId, activeId, () => connectionSource.value?.sourceKey], () => {
  manualPreviousState.value = ''
  manualMotion.value = ''
})
const connectionFrame = computed(
  () => active.value && usableShotConnectionFrame(workflow.value, active.value),
)
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
const stale = computed(() => {
  const fingerprint = compositionFingerprint(workflow.value)
  return !fingerprint || workflow.value.composition?.fingerprint !== fingerprint
})
const outputShotId = ref('')
const outputPreviewMode = ref('composition')
const outputVideo = ref(null)
const outputVideoAspect = ref(0)
const outputDrag = ref(null)
const outputDrop = ref(null)
const outputTimeline = computed(() => exportTimeline(workflow.value.shots))
const outputShot = computed(() => kept.value.find((shot) => shot.id === outputShotId.value) || kept.value[0])
const outputRange = computed(() => exportClipRange(outputShot.value))
const outputPreviewUrl = computed(() => outputPreviewMode.value === 'clip' ? outputRange.value?.url : workflow.value.composition?.url)
const outputPreviewIssue = computed(() => outputPreviewMode.value === 'clip'
  ? !outputRange.value ? '当前裁剪范围无效' : !outputRange.value.previewSupported ? '此倍速超出浏览器预览范围，请查看合成成片' : '' : '')
const outputAspect = computed(() => {
  const [width, height] = String(workflow.value.ratio || '3:4').split(':').map(Number)
  return outputVideoAspect.value || (width > 0 && height > 0 ? width / height : 0.75)
})
const outputOrderLocked = computed(() => workflow.value.planningSource === 'reference' &&
  workflow.value.referenceVideo?.segments?.length && !kept.value.every((shot) => shot.referenceStrategy === 'highlights'))
const outputIssue = computed(() => {
  if (!kept.value.length) return ''
  for (const shot of kept.value) {
    const issue = wholeVideoReviewIssue(workflow.value, shot, capabilities.value?.wholeTimelineReview === true)
    if (issue) return issue
  }
  try { buildCompositionRequest(workflow.value); return continuityReviewIssue(workflow.value, capabilities.value?.continuityReview === true) } catch (e) { return e.message }
})
const motionReady = computed(() => !capabilities.value?.continuityReview || !active.value ||
  !motionObservationRequired(workflow.value, active.value) || Boolean(usableMotionObservation(workflow.value, active.value)))
function askContinuityReview(shotId = '') {
  const context = captureTask()
  ask(shotId ? '分析前镜实际动作' : '检查整片衔接', '使用当前策划模型分析实际视频采样，可能产生模型接口费用；不会生成或重生成视频。检查结果需人工确认。', () => {
    if (isCurrent(context)) return startContinuityReview(shotId)
  })
}
function acknowledgeReview(index, accepted) {
  if (!currentContinuityReview(workflow.value) || workflow.value.continuityReview.status !== 'completed') return
  change(data => {
    const job = data.continuityReview
    const ids = new Set(job.acknowledged || [])
    if (accepted) ids.add(index); else ids.delete(index)
    job.acknowledged = [...ids]
  })
}
function acknowledgeWholeReview(accepted) {
  if (currentContinuityReview(workflow.value) && workflow.value.continuityReview.status === 'completed')
    change(data => { data.continuityReview.wholeAcknowledged = accepted })
}
function confirmManualContinuity() {
  const context = captureTask()
  let snapshot
  try { snapshot = buildContinuityReview(workflow.value, globalThis.crypto.randomUUID()) }
  catch (e) { error.value = e.message; return }
  ask('确认人工审片', '请确认已查看各片段与镜间预览，人物、商品、动作及整片结构可接受。这里只记录人工判断，不代表AI检查通过，也不会调用模型。', () => {
    try {
      change(data => {
        if (buildContinuityReview(data, snapshot.request.id).fingerprint !== snapshot.fingerprint) throw new Error('成片内容已改变，请重新审片')
        data.compositionEditing = true
        data.manualContinuityApproval = { id: snapshot.request.id, fingerprint: snapshot.fingerprint, confirmedAt: Date.now() }
      }, context)
    } catch (e) { if (isCurrent(context)) error.value = e.message }
  })
}
function confirmManualMotion() {
  const shot = active.value, source = shot && previousShotTailSource(workflow.value, shot)
  if (!source || !manualPreviousState.value.trim() || !manualMotion.value.trim() ||
    reviewRunning(shot.motionObservation) || shot.motionObservation?.status === 'unknown') return
  try {
    const snapshot = buildContinuityReview(workflow.value, globalThis.crypto.randomUUID(), shot)
    shotChange(shot.id, item => {
      if (item.motionObservation) {
        item.motionObservationHistory ||= []
        item.motionObservationHistory.push(item.motionObservation)
      }
      item.motionObservation = { id: snapshot.request.id, fingerprint: snapshot.fingerprint, snapshot: snapshot.request,
        sourceKey: source.sourceKey, status: 'completed', confirmed: true, confirmedAt: Date.now(), manual: true, targetMotion: shot.motion,
        stage: '实际动作已人工确认', results: [{ previousState: manualPreviousState.value.trim(), motion: manualMotion.value.trim() }] }
      if (shotConnection(workflow.value, item).type !== 'continue') item.approvedImageId = ''
    })
  } catch (e) { error.value = e.message }
}
function previewPreviousMotion() {
  const shot = active.value, source = shot && previousShotTailSource(workflow.value, shot)
  const previous = shot && adjacentProductVideoShots(workflow.value, shot).previous
  if (!source || !previous) return
  const factor = previous.timingMode === 'speed' ? Number(selectedVideo(previous)?.duration) / Number(previous.duration) : 1
  const end = source.time + .04, start = previous.timingMode === 'speed' ? 0 : Number(previous.start)
  boundaryPreview.value = { clips: [{ url: source.url, start: Math.max(start, end - .8 * factor), end, playbackRate: factor,
    label: '前镜实际结尾' }], index: 0, playing: true }
}
function confirmMotionObservation() {
  const shot = active.value
  if (!shot || shot.motionObservation?.status !== 'completed' ||
    previousShotTailSource(workflow.value, shot)?.sourceKey !== shot.motionObservation.sourceKey) return
  shotChange(shot.id, item => {
    item.motionObservation.confirmed = true
    item.motionObservation.confirmedAt = Date.now()
    item.motionObservation.targetMotion = item.motion
    if (shotConnection(workflow.value, item).type !== 'continue') item.approvedImageId = ''
  })
}
function applyReviewCut(result) {
  const context = captureTask(), jobId = workflow.value.continuityReview?.id
  const changes = [result.suggestedPreviousEnd != null ? `前镜结束位置改为 ${result.suggestedPreviousEnd.toFixed(2)} 秒` : '',
    result.suggestedCurrentStart != null ? `本镜起点改为 ${result.suggestedCurrentStart.toFixed(2)} 秒` : ''].filter(Boolean).join('；')
  ask('应用剪辑点建议', `${changes}。原视频不变，成片时长会改变，应用后需重新检查。`, () => {
    try {
      change(data => {
        if (data.continuityReview?.id !== jobId) throw new Error('检查结果已经改变')
        applyContinuityCut(data, result)
      }, context)
      if (isCurrent(context)) notice.value = '剪辑点已调整，原视频保留；衔接检查待更新'
    } catch (e) { if (isCurrent(context)) error.value = e.message }
  })
}
function previewReviewBoundary(result) {
  const sequence = { ...workflow.value, shots: workflow.value.shots.filter(shot => shot.kept) }
  const shot = sequence.shots.find(item => item.id === result.currentId)
  const clips = shot && shotBoundaryPreview(sequence, shot)
  if (clips?.length === 2) boundaryPreview.value = { clips, index: 0, playing: true }
}
function editReviewShot(id) {
  const shot = workflow.value.shots.find(item => item.id === id)
  if (shot) openShot(shot, true)
}
function wholeLabels(shot) {
  return Object.fromEntries((shot.wholeReview?.snapshot?.timeline || wholeTimeline(shot)).map((beat, i) => [`segment-${i}`, `${i + 1}. ${beat.start}-${beat.end} 秒`]))
}
function askWholeReview(shot) {
  const context = captureTask()
  ask('检查整片时段', '使用当前策划模型检查实际视频的各时段与内部衔接，可能产生模型接口费用；不会重生成视频。', () => {
    if (isCurrent(context)) return startContinuityReview(shot.id, 'timeline')
  })
}
function acknowledgeWholeSegment(shot, index, accepted) {
  if (!currentWholeVideoReview(workflow.value, shot) || shot.wholeReview.status !== 'completed') return
  shotChange(shot.id, item => {
    const values = new Set(item.wholeReview.acknowledged || [])
    if (accepted) values.add(index); else values.delete(index)
    item.wholeReview.acknowledged = [...values]
  })
}
function acknowledgeWholeStructure(shot, accepted) {
  if (currentWholeVideoReview(workflow.value, shot) && shot.wholeReview.status === 'completed')
    shotChange(shot.id, item => { item.wholeReview.wholeAcknowledged = accepted })
}
function confirmWholeManual(shot) {
  const context = captureTask()
  let snapshot
  try { snapshot = buildWholeVideoReview(workflow.value, globalThis.crypto.randomUUID(), shot) }
  catch (e) { error.value = e.message; return }
  ask('确认整片人工审片', '请确认已查看实际整片，各时段的动作、商品、人物、内部衔接和收尾可接受。这里只记录人工判断，不调用模型。', () => {
    try {
      shotChange(shot.id, item => {
        const task = getTask(context)
        if (buildWholeVideoReview(task, snapshot.request.id, item).fingerprint !== snapshot.fingerprint) throw new Error('整片内容已经改变，请重新审片')
        if (item.wholeManualApproval) { item.wholeManualApprovalHistory ||= []; item.wholeManualApprovalHistory.push(item.wholeManualApproval) }
        item.wholeManualApproval = { id: snapshot.request.id, fingerprint: snapshot.fingerprint, confirmedAt: Date.now() }
      }, context)
    } catch (e) { if (isCurrent(context)) error.value = e.message }
  })
}
function previewWholeSegment(shot, result) {
  const beat = (shot.wholeReview?.snapshot?.timeline || wholeTimeline(shot))[result.index]
  const video = selectedVideo(shot)
  if (!beat || !video?.url || !currentWholeVideoReview(workflow.value, shot)) return
  boundaryPreview.value = { clips: [{ url: video.url, start: beat.start, end: beat.end, playbackRate: 1,
    label: `第 ${result.index + 1} 时段 ${beat.start}-${beat.end} 秒` }], index: 0, playing: true }
}
async function editWholeSegment(shot, segmentId) {
  openShot(shot, true)
  await nextTick()
  const index = Number(String(segmentId).replace('segment-', ''))
  if (Number.isInteger(index) && index >= 0 && index < wholeTimeline(shot).length) wholeBeatIndex.value = index
}
function mutateWholeTimeline(action) {
  if (!active.value) return
  try { shotChange(active.value.id, action); error.value = '' }
  catch (e) { error.value = e.message }
}
function updateWholeBeat(index, key, value) {
  mutateWholeTimeline(shot => {
    const beats = wholeTimeline(shot).map(beat => ({ ...beat }))
    if (!beats[index]) throw new Error('时段不存在')
    beats[index][key] = value
    if (key === 'description') Object.assign(beats[index], { action: '', camera: '', transition: '' })
    updateWholeTimeline(shot, beats)
    if (index === 0 && ['startState', 'description'].includes(key)) shot.approvedImageId = ''
  })
}
function splitWholeBeat(index) {
  mutateWholeTimeline(shot => {
    const beats = wholeTimeline(shot).map(beat => ({ ...beat })), old = beats[index]
    if (!old || beats.length >= 8 || old.end - old.start < 2) throw new Error('当前时段不能拆分')
    const middle = Math.round((old.start + old.end) * 5) / 10
    beats.splice(index, 1, { ...old, end: middle, endState: '' },
      { ...old, start: middle, startState: '', transitionType: 'continue' })
    updateWholeTimeline(shot, beats)
  })
}
function removeWholeBeat(index) {
  const shotId = active.value?.id, context = captureTask()
  ask('合并移除时段', '所选时段会与相邻时段合并，整片时长保持不变，原视频保留。', () => {
    try { shotChange(shotId, shot => {
      const beats = wholeTimeline(shot).map(beat => ({ ...beat }))
      if (beats.length < 2 || !beats[index]) throw new Error('当前时段不能移除')
      const target = index ? index - 1 : 1
      beats[target].description = index ? `${beats[target].description}；${beats[index].description}` : `${beats[index].description}；${beats[target].description}`
      if (index) { beats[target].end = beats[index].end; beats[target].endState = beats[index].endState }
      else { beats[target].start = 0; beats[target].startState = beats[index].startState; beats[target].transitionType = 'opening' }
      beats.splice(index, 1); updateWholeTimeline(shot, beats)
      wholeBeatIndex.value = Math.max(0, index - 1)
    }, context) } catch (e) { if (isCurrent(context)) error.value = e.message }
  })
}
function initializeWholeTimeline() {
  mutateWholeTimeline(shot => updateWholeTimeline(shot, [{ start: 0, end: wholeSeconds(shot), action: '', camera: '', transition: '',
    startState: '', endState: '', transitionType: 'opening', description: shot.motion?.trim() || '连续镜头完成商品展示与收尾。' }]))
}
async function refineWholeBeat(index) {
  if (!active.value || refining.value || !capabilities.value?.wholeTimelineRefinement) return
  if (planningModelUnavailable.value || !productReferenceUrls(workflow.value, active.value).length) {
    error.value = '请先选择可用策划模型和商品参考图'
    return
  }
  const context = captureTask(), shotId = active.value.id
  const original = JSON.stringify({ timeline: wholeTimeline(active.value), motion: active.value.motion })
  ask('完善当前时段', '只完善选中的整片时段，可能产生策划模型接口费用；不会修改其他时段或生成视频。', async () => {
    if (!isCurrent(context)) return
    const task = getTask(context), shot = task?.shots.find(item => item.id === shotId)
    if (!shot || JSON.stringify({ timeline: wholeTimeline(shot), motion: shot.motion }) !== original) { error.value = '原时段已经改变'; return }
    refining.value = true
    try {
      const problem = wholeTimelineIssue(shot)
      if (problem) throw new Error(problem)
      const beat = await request('/api/product-videos/refine-timeline', { request: buildPlanRequest(task, 1, shot, capabilities.value), index }, (Number(capabilities.value?.planStageTimeoutSeconds) || 300) * 1000 + 30000)
      if (!props.open || !isCurrent(context)) return
      ask('采用时段完善结果', `第 ${index + 1} 时段：\n${beat.description}\n\n开始：${beat.startState}\n结束：${beat.endState}`, () => {
        try { shotChange(shotId, item => {
          if (JSON.stringify({ timeline: wholeTimeline(item), motion: item.motion }) !== original) throw new Error('原时段已改变，未覆盖你的修改')
          const beats = wholeTimeline(item)
          if (!beat || beat.start !== beats[index].start || beat.end !== beats[index].end) throw new Error('完善结果改变了时间范围')
          const firstChanged = index === 0 && (beat.startState !== beats[0].startState || beat.description !== beats[0].description)
          beats[index] = beat; updateWholeTimeline(item, beats)
          if (firstChanged) item.approvedImageId = ''
        }, context) } catch (e) { if (isCurrent(context)) error.value = e.message }
      })
    } catch (e) { if (isCurrent(context)) error.value = e.message }
    finally { refining.value = false }
  })
}
watch(activeTaskId, () => {
  outputShotId.value = ''
  outputPreviewMode.value = 'composition'
  outputVideoAspect.value = 0
  outputDrag.value = outputDrop.value = null
})
watch(() => kept.value.map((shot) => shot.id), (ids) => {
  if (!ids.includes(outputShotId.value)) outputShotId.value = ids[0] || ''
})
watch(() => [outputPreviewUrl.value, outputShot.value?.id, outputShot.value?.start,
  outputShot.value?.duration, outputShot.value?.timingMode], async () => {
  outputVideoAspect.value = 0
  await nextTick()
  if (outputVideo.value?.readyState >= 1) prepareOutputPreview()
})
function selectOutputShot(shot, preview = false) {
  outputShotId.value = shot.id
  if (preview) outputPreviewMode.value = 'clip'
  else void nextTick(() => dialog.value?.querySelector('.pv-export-clip-editor')?.scrollIntoView({ block: 'nearest' }))
}
function prepareOutputPreview() {
  const element = outputVideo.value
  if (!element) return
  element.pause()
  if (element.videoWidth && element.videoHeight) outputVideoAspect.value = element.videoWidth / element.videoHeight
  const range = outputPreviewMode.value === 'clip' && outputRange.value
  element.playbackRate = range?.previewSupported ? range.playbackRate : 1
  element.currentTime = range ? range.start : 0
}
function boundOutputPreview(event) {
  const range = outputPreviewMode.value === 'clip' && outputRange.value
  if (!range || !event.target) return
  const element = event.target
  if (element.currentTime < range.start - 0.05) element.currentTime = range.start
  if (element.currentTime >= range.end - 0.02) {
    element.pause()
    if (element.currentTime > range.end + 0.05) element.currentTime = range.end
  }
}
function playOutputPreview(event) {
  const range = outputPreviewMode.value === 'clip' && outputRange.value
  if (range && event.target.currentTime >= range.end - 0.05) event.target.currentTime = range.start
}
function moveOutputShot(shot, offset) {
  const index = kept.value.findIndex((item) => item.id === shot.id)
  const target = kept.value[index + offset]
  if (!target || outputOrderLocked.value) return
  change((data) => { data.shots = moveExportClip(data.shots, shot.id, target.id, offset > 0) })
}
function dragOutputShot(event, shot) {
  if (outputOrderLocked.value) { event.preventDefault(); return }
  outputDrag.value = { id: shot.id, taskId: activeTaskId.value }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', shot.id)
}
function overOutputShot(event, shot) {
  if (!outputDrag.value || outputDrag.value.taskId !== activeTaskId.value || outputOrderLocked.value) return
  event.preventDefault()
  const bounds = event.currentTarget.getBoundingClientRect()
  outputDrop.value = { id: shot.id, after: event.clientY > bounds.top + bounds.height / 2 }
}
function dropOutputShot(event, shot) {
  event.preventDefault()
  const source = outputDrag.value
  const after = outputDrop.value?.id === shot.id && outputDrop.value.after
  outputDrag.value = outputDrop.value = null
  if (!source || source.taskId !== activeTaskId.value || outputOrderLocked.value) return
  change((data) => { data.shots = moveExportClip(data.shots, source.id, shot.id, after) })
}
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
      connectionController?.abort()
      picker.value = ''
      enhanceSource.value = null
      promptEdit.value = null
      refinement.value = null
      boundaryPreview.value = null
      outputDrag.value = outputDrop.value = null
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
watch(activeTaskId, () => connectionController?.abort())
onBeforeUnmount(() => connectionController?.abort())
watch(
  picker,
  (value) => {
    if (value !== 'canvas') continuityCanvasTarget.value = null
  },
  { flush: 'sync' },
)

function showTasks() {
  boundaryPreview.value = null
  outputDrag.value = outputDrop.value = null
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
  if (key === 'productionMode') {
    change(data => selectProductionMode(data, value))
    return
  }
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
      if (key === 'motion') { setShotMotion(shot, value); return }
      shot[key] = promptFields.value[key]
            ? normalizePromptLineBreaks(value)
            : value
    })
}
function updateConnection(key, value) {
  const shot = active.value
  if (!shot) return
  const connection = shotConnection(workflow.value, shot)
  shotChange(shot.id, (item) => {
    item.connection = { ...connection, [key]: String(value).slice(0, 200) }
    item.approvedImageId = ''
  })
}
async function extractConnectionFrame() {
  if (!active.value || activeWholeVideo.value || linkingShotId.value) return
  const context = captureTask()
  const shot = active.value
  const source = previousShotTailSource(workflow.value, shot)
  if (!source) {
    error.value = '请先完成上一镜视频，并确定它的成片裁剪范围'
    return
  }
  const controller = new AbortController()
  connectionController = controller
  linkingShotId.value = shot.id
  const timer = setTimeout(() => controller.abort(new Error('提取衔接帧超时，请重试')), 180000)
  error.value = ''
  try {
    let connection = usableShotConnectionFrame(workflow.value, shot)
    if (!connection) {
      const result = await extractReferenceVideoFrame(source.url, source.time, {
        signal: controller.signal,
      })
      const url = await uploadFileDirect(result.file, {
        dir: 'product-video/shot-connections',
        signal: controller.signal,
      })
      connection = { ...source, url, sourceUrl: source.url, time: result.time }
    }
    controller.signal.throwIfAborted()
    const currentTask = getTask(context)
    const currentShot = currentTask?.shots.find((item) => item.id === shot.id)
    if (
      !currentShot ||
      previousShotTailSource(currentTask, currentShot)?.sourceKey !== source.sourceKey
    )
      throw new Error('上一镜视频或裁剪范围已经改变，请重新提取')
    shotChange(
      shot.id,
      (item) => {
        item.connectionFrame = connection
        if (shotConnection(currentTask, item).type === 'continue') {
          let image = item.images.find(
            (entry) =>
              entry.url === connection.url && entry.sourceConnectionKey === source.sourceKey,
          )
          if (!image) {
            image = {
              id: uid(),
              url: connection.url,
              source: 'shot-connection',
              status: 'completed',
              sourceConnectionKey: source.sourceKey,
            }
            item.images.push(image)
          }
          pickImage(item, image.id)
        }
      },
      context,
    )
    if (isCurrent(context))
      notice.value =
        shotConnection(currentTask, currentShot).type === 'continue'
          ? '上一镜结束帧已作为本镜首帧，待确认'
          : '上一镜结束帧已加入本镜衔接参考'
  } catch (e) {
    if (e.name !== 'AbortError' && isCurrent(context)) error.value = e.message
  } finally {
    clearTimeout(timer)
    if (connectionController === controller) {
      connectionController = null
      linkingShotId.value = ''
    }
  }
}
function removeConnectionFrame() {
  shotChange(active.value.id, (shot) => {
    shot.connectionFrame = null
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
      if (edit.key === 'motion') setShotMotion(shot, edit.value)
      else shot[edit.key] = normalizePromptLineBreaks(edit.value)
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
  const original = {
    imagePrompt: shot.imagePrompt,
    motion: shot.motion,
    connection: JSON.stringify(shot.connection || null),
  }
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
    const local = capabilities.value?.localShotRefinement && !shot.referenceRange
    const payload = buildPlanRequest(workflow.value, 1, shot, capabilities.value)
    const result = await request(
      local ? '/api/product-videos/refine' : '/api/product-videos/plan',
      local ? { planJobId: workflow.value.planJob?.id, shotId: shot.id, request: payload } : payload,
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
      connection: resultShot.connection || null,
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
    shot.motion !== result.original.motion ||
    JSON.stringify(shot.connection || null) !== result.original.connection
  ) {
    error.value = '原分镜内容已经改变，请关闭预览后重新完善'
    return
  }
  shotChange(shot.id, (item) => {
    item.imagePrompt = normalizePromptLineBreaks(result.imagePrompt)
    setShotMotion(item, normalizePromptLineBreaks(result.motion))
    item.purpose = result.purpose
    item.design = result.design
    item.concept = result.concept
    item.timeline = result.timeline
    item.connection = result.connection
    if (isWholeVideo(item.productionMode))
      item.timelineCount = result.timeline.length || item.timelineCount || 4
    item.approvedImageId = ''
  })
  refinement.value = null
  notice.value = '分镜提示词已更新，原素材已保留；首帧待重新确认'
}
function openShot(shot, composition = false) {
  if (composition) change(data => { data.compositionEditing = true })
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
  return shot[field].some((item) => ['submitting', 'processing', 'unknown'].includes(item.status))
}
function retryUnknownVideo(item) {
  const context = captureTask(), shotId = active.value.id
  ask('核对并重试原提交', '使用原请求编号，不新建第二条视频；已接收的任务会直接返回原任务。',
    () => retryVideoSubmission(shotId, item.id, context))
}
function openBoundaryPreview() {
  const clips = shotBoundaryPreview(workflow.value, active.value)
  if (clips.length !== 2) return
  boundaryPreview.value = { clips, index: 0, playing: true }
}
async function replayBoundaryVideo() {
  boundaryPreview.value.index = 0
  boundaryPreview.value.playing = true
  await nextTick()
  if (boundaryVideo.value?.readyState >= 1) startBoundaryVideo({ target: boundaryVideo.value })
}
function startBoundaryVideo(event) {
  const media = event.target, preview = boundaryPreview.value
  const index = Number(media.dataset.previewIndex)
  const item = preview?.clips[index]
  if (!item || preview.index !== index) return
  media.playbackRate = item.playbackRate
  media.currentTime = item.start
  const play = () => {
    if (boundaryVideo.value === media && boundaryPreview.value?.index === index && boundaryPreview.value.playing)
      void media.play().catch(() => {})
  }
  if (media.seeking) media.addEventListener('seeked', play, { once: true })
  else play()
}
function advanceBoundaryVideo(event) {
  const preview = boundaryPreview.value
  if (!preview || Number(event.target.dataset.previewIndex) !== preview.index
    || event.target.currentTime < preview.clips[preview.index].end - .025) return
  event.target.pause()
  if (preview.index === 0) preview.index = 1
  else preview.playing = false
}
function videoModelForShot(shot) {
  return shot.productionMode === 'single_video_30'
    ? effectiveWholeVideo30Model.value
    : shot.productionMode === 'single_video'
      ? effectiveWholeVideo15Model.value
      : effectiveVideoModel.value
}
function videoModelsForShot(shot) {
  return shot.productionMode === 'single_video_30' ? wholeVideo30ModelOptions.value
    : shot.productionMode === 'single_video' ? wholeVideo15ModelOptions.value : videoModelOptions.value
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
  if (isAnmiao20FastVideoModel(videoModelForShot(shot))) return ANMIAO20_FAST_VIDEO_RESOLUTIONS
  return isAnmiao25VideoModel(videoModelForShot(shot))
    ? ANMIAO25_VIDEO_RESOLUTIONS
    : ANMIAO_VIDEO_RESOLUTIONS
}
function invalidAnmiaoDuration(shot) {
  if (!perSecondVideo(shot)) return false
  const duration = generationDuration(shot, videoWorkflow.value)
  const maxDuration = isAnmiao25VideoModel(videoModelForShot(shot)) ? 30 : 15
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
    const model25 = isAnmiao25VideoModel(videoModelForShot(shot))
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
    return available && rate > 0 ? rate * generationDuration(shot, videoWorkflow.value) : null
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
  const context = captureTask()
  if (kind === 'video') {
    if (!videoModelsForShot(shot).length) {
      error.value = shot.productionMode === 'single_video_30'
        ? '当前没有支持 30 秒整片的可用视频模型' : '当前没有可用的视频模型，请刷新模型列表'
      return
    }
    try {
      validateShotConnectionVideo(workflow.value, shot)
    } catch (e) {
      error.value = e.message
      return
    }
  }
  if (kind === 'video' && isRetiredVideoModel(videoModelForShot(shot))) {
    error.value = '原视频模型已移除，请重新选择视频模型'
    return
  }
  if (kind === 'video' && invalidAnmiaoDuration(shot)) {
    error.value = `按秒视频时长需为 4 至 ${isAnmiao25VideoModel(videoModelForShot(shot)) ? 30 : 15} 的整数秒`
    return
  }
  if (kind === 'video' && invalidAnmiaoResolution(shot)) {
    error.value =
      videoModelForShot(shot) === MINIMAX_VIDEO_MODEL
        ? 'MiniMax H3 画质需选择 768P、1080P、2K 或 4K'
        : isAnmiao25VideoModel(videoModelForShot(shot))
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
    `${shot.title}：本次 ${price == null ? '费用以生成成功后接口返回为准' : `${formatMiValue(price)} 米值`}${kind === 'video' ? (isWholeVideo(shot.productionMode) ? `，生成 1 条 ${generationDuration(shot, videoWorkflow.value)} 秒整片` : `，生成 ${generationDuration(shot, videoWorkflow.value)} 秒原片`) : '，生成 1 张 2K 图片'}。`,
    () => generate(shot.id, kind, context),
  )
}
async function batchGenerate() {
  if (!capabilities.value?.videoSubmissionRecovery) { error.value = '请刷新模型列表后再批量生成'; return }
  const context = captureTask()
  const shots = productVideoBatchCandidates(workflow.value)
  if (shots.some((shot) => !videoModelsForShot(shot).length)) {
    error.value = '部分视频没有支持其整片时长的可用模型，请刷新模型列表'
    return
  }
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
  try {
    shots.filter(shot => shotConnection(workflow.value, shot).type !== 'continue')
      .forEach((shot) => validateShotConnectionVideo(workflow.value, shot))
  } catch (e) {
    error.value = e.message
    return
  }
  if (!shots.length || prices.some((price, index) =>
    price == null && !videoUsesReportedCost(shots[index]),
  )) {
    error.value = !shots.length
      ? '没有可生成的视频分镜，请先确认图片'
      : '按秒视频所选画质尚未配置密钥和每秒米值单价'
    return
  }
  const configuration = batchConfig(workflow.value, shots.map(shot => shot.id))
  ask(
    '批量生成视频',
    `${shots.length} 个视频，共 ${shots.reduce((sum, shot) => sum + generationDuration(shot, videoWorkflow.value), 0)} 秒，${prices.every((price) => price != null) ? `预计 ${formatMiValue(prices.reduce((sum, price) => sum + price, 0))} 米值` : '费用以生成成功后接口返回为准'}。`,
    () => startBatchGeneration(shots.map(shot => shot.id), configuration, context),
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
    if (boundaryPreview.value) boundaryPreview.value = null
    else if (confirmation.value) confirmation.value = null
    else if (promptEdit.value) void closePrompt()
    else if (refinement.value) refinement.value = null
    else if (picker.value) picker.value = ''
    else emit('close')
  }
  if (event.key !== 'Tab') return
  const focusRoot =
    dialog.value.querySelector('.pv-boundary-preview') ||
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
            <label v-if="singleVideoPlan">
              视频模型
              <ThemedSelect
                :model-value="workflow.productionMode === 'single_video_30' ? effectiveWholeVideo30Model : effectiveWholeVideo15Model"
                :options="workflow.productionMode === 'single_video_30' ? wholeVideo30ModelOptions : wholeVideo15ModelOptions"
                aria-label="整片视频模型"
                @update:model-value="workflow.productionMode === 'single_video_30' ? set('wholeVideo30Model', $event) : selectVideoModel($event)"
              />
            </label>
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
                    ? effectiveWholeVideo30Model
                    : workflow.productionMode === 'single_video' ? effectiveWholeVideo15Model : effectiveVideoModel,
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
                    ? effectiveWholeVideo30Model
                    : workflow.productionMode === 'single_video' ? effectiveWholeVideo15Model : effectiveVideoModel,
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
            <button v-if="workflow.shots.length > 1" class="pv-batch"
              :disabled="['running', 'waiting_confirmation', 'waiting_submission'].includes(workflow.batchVideoJob?.status)"
              @click="batchGenerate">
              <i aria-hidden="true" class="ri-video-add-line"></i>
              批量生成视频
            </button>
            <div v-if="workflow.batchVideoJob" class="pv-batch-status" role="status">
              <span>{{ workflow.batchVideoJob.stage }}</span>
              <small v-if="workflow.batchVideoJob.error">{{ workflow.batchVideoJob.error }}</small>
              <button v-if="['running', 'waiting_confirmation', 'waiting_submission'].includes(workflow.batchVideoJob.status)"
                class="pv-icon" title="停止后续提交" aria-label="停止后续提交" @click="cancelBatch()">
                <i aria-hidden="true" class="ri-stop-line"></i>
              </button>
            </div>
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
                    v-if="active.timeline?.length && !capabilities?.wholeTimelineEditing"
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
            <ProductVideoWholeTimeline v-if="activeWholeVideo && capabilities?.wholeTimelineEditing"
              :shot="active" :selected-index="wholeBeatIndex" :refining="refining" :disabled="busy(active, 'videos') || refining"
              :can-refine="capabilities?.wholeTimelineRefinement && !planningModelUnavailable && Boolean(productReferenceUrls(workflow, active).length)"
              @select="wholeBeatIndex = $event" @update="updateWholeBeat" @boundary="(index, end) => mutateWholeTimeline(shot => moveWholeBoundary(shot, index, end))"
              @initialize="initializeWholeTimeline" @refine="refineWholeBeat" @split="splitWholeBeat" @remove="removeWholeBeat" />
            <p v-if="activeWholeVideo && wholeTimelineIssue(active)" class="pv-hint" role="status">{{ wholeTimelineIssue(active) }}</p>
            <ProductVideoContinuityPanel v-if="activeWholeVideo && capabilities?.wholeTimelineReview && selectedVideo(active)?.url"
              :workflow="workflow" :model-options="planningModelOptions" :job-override="active.wholeReview"
              :current-override="currentWholeVideoReview(workflow, active)" :manual-approved="Boolean(active.wholeManualApproval && currentWholeVideoReview(workflow, active, active.wholeManualApproval))"
              :heading="`${active.title} · 整片时段检查`" :labels="wholeLabels(active)"
              @start="askWholeReview(active)" @cancel="cancelContinuityReview(active.id, 'timeline')" @model="selectPlanningModel" @manual="confirmWholeManual(active)"
              @acknowledge="(index, value) => acknowledgeWholeSegment(active, index, value)" @acknowledge-whole="acknowledgeWholeStructure(active, $event)"
              @preview="previewWholeSegment(active, $event)" @edit="editWholeSegment(active, $event)" />
            <details v-if="!activeWholeVideo" class="pv-shot-connection" aria-label="镜头衔接">
              <summary>
                镜头衔接
                <span>
                  {{ adjacentShots.previous?.title || '开场' }} → {{ active.title }} →
                  {{ adjacentShots.next?.title || '收尾' }}
                </span>
              </summary>
              <div class="pv-connection-toolbar">
                <label>
                  进入方式
                  <ThemedSelect
                    :model-value="activeConnection.type"
                    :options="transitionOptions"
                    aria-label="进入本镜的方式"
                    @update:model-value="updateConnection('type', $event)"
                  />
                </label>
                <button
                  v-if="adjacentShots.previous"
                  :disabled="
                    !connectionSource ||
                    Boolean(linkingShotId) ||
                    busy(active, 'images') ||
                    busy(active, 'videos')
                  "
                  @click="extractConnectionFrame"
                >
                  <i
                    :class="
                      linkingShotId === active.id ? 'ri-loader-4-line pv-spin' : 'ri-film-line'
                    "
                    aria-hidden="true"
                  ></i>
                  {{ linkingShotId === active.id ? '正在提取' : '提取衔接帧' }}
                </button>
                <button :disabled="shotBoundaryPreview(workflow, active).length !== 2" @click="openBoundaryPreview">
                  <i class="ri-play-circle-line" aria-hidden="true"></i>衔接预览
                </button>
                <button v-if="capabilities?.continuityReview && adjacentShots.previous"
                  :disabled="!connectionSource || reviewRunning(active.motionObservation) || planningModelUnavailable"
                  @click="askContinuityReview(active.id)">
                  <i :class="reviewRunning(active.motionObservation) ? 'ri-loader-4-line pv-spin' : 'ri-scan-2-line'" aria-hidden="true"></i>
                  {{ reviewRunning(active.motionObservation) ? '分析中' : active.motionObservation?.status === 'unknown' ? '核对原分析' : '分析前镜动作' }}
                </button>
                <button v-if="adjacentShots.previous" :disabled="!connectionSource" @click="previewPreviousMotion">
                  <i class="ri-film-line" aria-hidden="true"></i>前镜动作预览
                </button>
                <button v-if="reviewRunning(active.motionObservation)" class="pv-icon" title="停止后续分析" aria-label="停止后续分析"
                  :disabled="active.motionObservation.status === 'stopping'" @click="cancelContinuityReview(active.id)">
                  <i class="ri-stop-line" aria-hidden="true"></i>
                </button>
              </div>
              <div v-if="active.motionObservation" class="pv-motion-observation" role="status">
                <strong>{{ usableMotionObservation(workflow, active) ? '实际动作已确认' :
                  currentContinuityReview(workflow, active.motionObservation, active) ? active.motionObservation.stage : '前镜或提示词已改变，动作分析待更新' }}</strong>
                <p v-if="active.motionObservation.results?.[0]">{{ active.motionObservation.results[0].previousState }}</p>
                <p v-if="active.motionObservation.results?.[0]">{{ active.motionObservation.results[0].motion }}</p>
                <p v-if="active.motionObservation.error || active.motionObservation.pollError">{{ active.motionObservation.error || active.motionObservation.pollError }}</p>
                <button v-if="active.motionObservation.status === 'completed' && !usableMotionObservation(workflow, active)"
                  :disabled="connectionSource?.sourceKey !== active.motionObservation.sourceKey" @click="confirmMotionObservation">
                  <i class="ri-check-line" aria-hidden="true"></i>确认实际动作参考
                </button>
              </div>
              <details v-if="capabilities?.continuityReview && connectionSource" class="pv-manual-motion">
                <summary>人工确认前镜动作</summary>
                <label>实际结束状态<textarea v-model="manualPreviousState" maxlength="400" rows="2" aria-label="人工观察的前镜结束状态" /></label>
                <label>动作阶段、方向与速度<textarea v-model="manualMotion" maxlength="400" rows="2" aria-label="人工观察的前镜动作" /></label>
                <button :disabled="!manualPreviousState.trim() || !manualMotion.trim() || reviewRunning(active.motionObservation) || active.motionObservation?.status === 'unknown'"
                  @click="confirmManualMotion"><i class="ri-check-line" aria-hidden="true"></i>确认人工动作观察</button>
              </details>
              <p v-if="shotConnectionIssue(workflow, active)" class="pv-hint" role="status">
                {{ shotConnectionIssue(workflow, active) }}
              </p>
              <p v-if="adjacentShots.previous?.connection?.endState" class="pv-connection-state">
                上一镜结束：{{ adjacentShots.previous.connection.endState }}
              </p>
              <div class="pv-connection-fields">
                <label>
                  本镜开始状态
                  <textarea
                    :value="activeConnection.startState"
                    aria-label="本镜开始状态"
                    maxlength="200"
                    @input="updateConnection('startState', $event.target.value)"
                  ></textarea>
                </label>
                <label>
                  本镜结束状态
                  <textarea
                    :value="activeConnection.endState"
                    aria-label="本镜结束状态"
                    maxlength="200"
                    @input="updateConnection('endState', $event.target.value)"
                  ></textarea>
                </label>
              </div>
              <label>
                进入本镜的转场
                <textarea
                  :value="activeConnection.transition"
                  aria-label="进入本镜的转场"
                  maxlength="200"
                  @input="updateConnection('transition', $event.target.value)"
                ></textarea>
              </label>
              <p v-if="adjacentShots.next?.connection?.startState" class="pv-connection-state">
                下一镜开始：{{ adjacentShots.next.connection.startState }}
              </p>
              <div v-if="active.connectionFrame" class="pv-connection-frame">
                <img :src="active.connectionFrame.url" alt="上一镜成片结束画面" />
                <span>
                  {{ active.connectionFrame.title }} · {{ active.connectionFrame.time }} 秒
                  <strong>{{ connectionFrame ? '衔接帧已就绪' : '来源已变更，待重新提取' }}</strong>
                </span>
                <button
                  class="pv-icon"
                  title="移除衔接帧"
                  aria-label="移除衔接帧"
                  @click="removeConnectionFrame"
                >
                  <i class="ri-close-line" aria-hidden="true"></i>
                </button>
              </div>
            </details>
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
                  <label v-if="isH3VideoModel" class="pv-tail-frame">
                    尾帧图片（可选）
                    <ThemedSelect
                      :model-value="active.lastFrameImageId || ''"
                      :options="tailFrameOptions"
                      aria-label="尾帧图片"
                      @update:model-value="
                        shotChange(active.id, (shot) => (shot.lastFrameImageId = $event))
                      "
                    />
                    <img
                      v-if="tailFrame"
                      :src="tailFrame.url"
                      :alt="tailFrame.name || '尾帧图片'"
                    />
                    <small v-else>仅上传首帧时按单帧生成；选择图片后将作为结束帧。</small>
                  </label>
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
                  <p
                    v-if="!imageModelOptions.length"
                    :class="['pv-task-status', { error: !capabilitiesLoading }]"
                    role="status"
                  >
                    {{ capabilitiesError || (capabilitiesLoading ? '模型列表加载中' : '请先在控制台 AI 功能映射中配置分镜生图模型') }}
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
                    v-for="item in imageGenerationNotices(active.images)"
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
                    {{ activeWholeVideo ? '整片字幕' : '分镜字幕' }}
                    <input
                      :value="active.caption"
                      :aria-label="activeWholeVideo ? '整片字幕' : '分镜字幕'"
                      maxlength="120"
                      @input="updateShot('caption', $event.target.value)"
                    />
                  </label>
                  <label>
                    视频模型 ·
                    {{
                      isWholeVideo(active.productionMode)
                        ? `${generationDuration(active)} 秒整片`
                        : `${generationDuration(active, videoWorkflow)} 秒原片`
                    }}
                    <ThemedSelect
                      v-if="active.productionMode === 'single_video_30'"
                      :model-value="effectiveWholeVideo30Model"
                      :options="wholeVideo30ModelOptions"
                      aria-label="视频模型"
                      @update:model-value="set('wholeVideo30Model', $event)"
                    />
                    <ThemedSelect
                      v-else
                      :model-value="videoModelForShot(active)"
                      :options="currentVideoModelOptions"
                      aria-label="视频模型"
                      @update:model-value="selectVideoModel"
                    />
                  </label>
                  <p
                    v-if="!videoModelsForShot(active).length"
                    :class="['pv-task-status', { error: !capabilitiesLoading }]"
                    role="status"
                  >
                    {{ capabilitiesError || (capabilitiesLoading ? '模型列表加载中' : active.productionMode === 'single_video_30' ? '当前没有支持 30 秒整片的可用视频模型' : '请先在控制台 AI 功能映射中配置分镜视频模型') }}
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
                          [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(videoModelForShot(active))
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
                    生成时长（秒）
                    <input
                      :value="generationDuration(active, videoWorkflow)"
                      readonly
                      type="number"
                      min="4"
                      :max="isAnmiao25VideoModel(videoModelForShot(active)) ? 30 : 15"
                      step="1"
                      aria-label="按秒视频时长"
                    />
                  </label>
                  <p
                    v-if="invalidAnmiaoDuration(active)"
                    class="pv-task-status error"
                    role="status"
                  >
                    脚本时长超出模型范围（4 至
                    {{ isAnmiao25VideoModel(videoModelForShot(active)) ? 30 : 15 }}
                    秒），请调整脚本或更换模型
                  </p>
                  <p
                    v-if="perSecondVideo(active) && videoPrice(active) == null && !videoUsesReportedCost(active)"
                    class="pv-task-status error"
                    role="status"
                  >
                    所选画质尚未配置接口密钥和每秒米值单价
                  </p>
                  <div class="pv-actions">
                    <button
                      class="pv-primary"
                      :disabled="
                        !canGenerateVideo(active) || !motionReady || Boolean(wholeTimelineIssue(active)) ||
                        !videoModelsForShot(active).length ||
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
                      <small v-if="videoPrice(active) != null">
                        {{ formatMiValue(videoPrice(active)) }} 米值
                      </small>
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
                  <button v-for="item in videoNotices.filter(value => value.status === 'unknown' && value.submissionTracked)"
                    :key="`retry-${item.id}`" :disabled="!capabilities?.videoSubmissionRecovery" @click="retryUnknownVideo(item)">
                    <i class="ri-refresh-line" aria-hidden="true"></i>核对原提交
                  </button>
                </div>
              </section>
            </div>
          </section>
        </main>

        <main v-else-if="!showingTasks" class="pv-output">
          <section class="pv-timeline pv-scroll" aria-label="成片片段编辑">
            <div class="pv-section-head">
              <h3>成片顺序</h3>
              <span>{{ kept.length }} 个片段 · {{ totalDuration }} 秒</span>
            </div>
            <div v-if="!kept.length" class="pv-empty">
              <i aria-hidden="true" class="ri-film-line"></i>
              <p>暂无保留片段</p>
              <button @click="tab = 'shots'">返回分镜选片</button>
            </div>
            <article v-for="(shot, index) in kept" :key="shot.id"
              class="pv-timeline-shot" :class="{ selected: outputShot?.id === shot.id,
                'drop-before': outputDrop?.id === shot.id && !outputDrop.after,
                'drop-after': outputDrop?.id === shot.id && outputDrop.after }"
              :data-shot-id="shot.id" @dragover="overOutputShot($event, shot)" @drop="dropOutputShot($event, shot)">
              <div class="pv-export-clip-head">
                <button class="pv-icon pv-drag-handle" :title="outputOrderLocked ? '原片等长分段需保留原顺序' : '拖动排序'" aria-label="拖动排序"
                  :draggable="!outputOrderLocked" :disabled="Boolean(outputOrderLocked)"
                  @dragstart="dragOutputShot($event, shot)" @dragend="outputDrag = outputDrop = null">
                  <i class="ri-draggable" aria-hidden="true"></i>
                </button>
                <button class="pv-export-clip-select" :aria-label="`选择片段 ${shot.title}`"
                  :title="shot.title"
                  :aria-pressed="outputShot?.id === shot.id" @click="selectOutputShot(shot)">
                  <img v-if="selectedImage(shot)?.url" :src="selectedImage(shot).url" alt="" />
                  <i v-else class="ri-film-line" aria-hidden="true"></i>
                  <span><strong>{{ String(index + 1).padStart(2, '0') }} · {{ shot.title }}</strong>
                    <small>{{ Number(shot.duration || 0).toFixed(1) }} 秒 · {{ shot.timingMode === 'speed' ? speedLabel(shot) : '截取片段' }}</small>
                  </span>
                </button>
                <div class="pv-actions">
                  <button
                    class="pv-icon"
                    title="前移"
                    aria-label="前移"
                    :disabled="index === 0 || Boolean(outputOrderLocked)"
                    @click="moveOutputShot(shot, -1)"
                  >
                    <i aria-hidden="true" class="ri-arrow-up-line"></i>
                  </button>
                  <button
                    class="pv-icon"
                    title="后移"
                    aria-label="后移"
                    :disabled="index === kept.length - 1 || Boolean(outputOrderLocked)"
                    @click="moveOutputShot(shot, 1)"
                  >
                    <i aria-hidden="true" class="ri-arrow-down-line"></i>
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
            </article>
              <div v-if="outputShot" class="pv-export-clip-editor">
              <div class="pv-export-editor-head">
                <div><strong>片段设置</strong><small>{{ outputShot.title }}</small></div>
                <div class="pv-actions">
                  <button class="pv-icon" title="预览片段" aria-label="预览片段" @click="selectOutputShot(outputShot, true)">
                    <i class="ri-play-circle-line" aria-hidden="true"></i>
                  </button>
                  <button class="pv-icon" title="编辑分镜" aria-label="编辑分镜" @click="openShot(outputShot, true)">
                    <i class="ri-edit-line" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
              <div class="pv-timing-bar">
                <div
                  class="pv-timing-modes"
                  role="group"
                  :aria-label="`${outputShot.title} 片段处理方式`"
                >
                  <button
                    :class="{ active: outputShot.timingMode !== 'speed' }"
                    :aria-pressed="outputShot.timingMode !== 'speed'"
                    @click="
                      shotChange(outputShot.id, (item) => {
                        item.timingMode = 'trim'
                      })
                    "
                  >
                    <i aria-hidden="true" class="ri-scissors-cut-line"></i>
                    截取片段
                  </button>
                  <button
                    :class="{ active: outputShot.timingMode === 'speed' }"
                    :aria-pressed="outputShot.timingMode === 'speed'"
                    :disabled="!capabilities?.clipSpeed"
                    @click="
                      shotChange(outputShot.id, (item) => {
                        item.timingMode = 'speed'
                      })
                    "
                  >
                    <i aria-hidden="true" class="ri-speed-up-line"></i>
                    整段加速
                  </button>
                </div>
                <span v-if="outputShot.timingMode === 'speed'" class="pv-speed-value">
                  {{ speedLabel(outputShot) }}
                </span>
              </div>
              <div class="pv-settings">
                <label v-if="outputShot.timingMode === 'speed'">
                  原片时长（秒）
                  <input :value="selectedVideo(outputShot).duration || 15" readonly />
                </label>
                <label v-else>
                  起点（秒）
                  <input
                    :aria-label="`${outputShot.title} 起点（秒）`"
                    type="number"
                    min="0"
                    :max="selectedVideo(outputShot).duration || 15"
                    step="0.1"
                    :value="outputShot.start"
                    @input="
                      shotChange(outputShot.id, (item) => {
                        item.start = Number($event.target.value)
                      })
                    "
                  />
                </label>
                <label>
                  {{
                    outputShot.referenceRange
                      ? '原片分段时长（秒）'
                      : outputShot.timingMode === 'speed'
                        ? '目标时长（秒）'
                        : '截取时长（秒）'
                  }}
                  <input
                    :aria-label="`${outputShot.title} 时长（秒）`"
                    type="number"
                    :readonly="Boolean(outputShot.referenceRange)"
                    min="0.5"
                    :max="
                      Math.min(
                        30,
                        (selectedVideo(outputShot).duration || 15) -
                          (outputShot.timingMode === 'speed' ? 0 : Number(outputShot.start)),
                      )
                    "
                    step="0.1"
                    :value="outputShot.duration"
                    @input="
                      shotChange(outputShot.id, (item) => {
                        item.duration = Number($event.target.value)
                      })
                    "
                  />
                </label>
              </div>
              <label>
                字幕
                <input
                  :aria-label="`${outputShot.title} 字幕`"
                  :value="outputShot.caption"
                  maxlength="120"
                  @input="
                    shotChange(outputShot.id, (item) => {
                      item.caption = $event.target.value
                    })
                  "
                />
              </label>
              </div>
          </section>
          <section class="pv-output-preview">
            <div class="pv-section-head pv-output-preview-head">
              <h3>{{ outputPreviewMode === 'clip' ? '片段预览' : '成片预览' }}</h3>
              <span v-if="workflow.composition?.url && stale" class="pv-preview-stale" role="status">预览待更新</span>
              <div class="pv-timing-modes" role="group" aria-label="预览范围">
                <button :class="{ active: outputPreviewMode === 'composition' }" :aria-pressed="outputPreviewMode === 'composition'"
                  @click="outputPreviewMode = 'composition'">成片</button>
                <button :class="{ active: outputPreviewMode === 'clip' }" :aria-pressed="outputPreviewMode === 'clip'"
                  :disabled="!outputShot" @click="outputPreviewMode = 'clip'">片段</button>
              </div>
            </div>
            <div class="pv-output-player" :style="{ '--pv-output-aspect': outputAspect }">
              <video
                v-if="outputPreviewUrl && !outputPreviewIssue"
                ref="outputVideo" :key="`${outputPreviewMode}-${outputPreviewUrl}-${outputShot?.id || ''}`"
                :src="outputPreviewUrl"
                controls
                playsinline
                preload="metadata"
                @loadedmetadata="prepareOutputPreview" @timeupdate="boundOutputPreview"
                @seeked="boundOutputPreview" @play="playOutputPreview"
              />
              <span v-else>
                {{
                  outputPreviewIssue || (compositionBusy ? `合成中 ${workflow.composition?.progress || 0}%` : '暂无成片')
                }}
              </span>
            </div>
            <div class="pv-output-preview-meta">
              <span>{{ outputPreviewMode === 'clip' ? outputShot?.title : `${kept.length} 个片段 · ${totalDuration} 秒` }}</span>
              <small>MP4 · 30fps</small>
            </div>
            <div class="pv-output-settings pv-scroll">
            <template v-for="shot in kept.filter(item => isWholeVideo(item.productionMode))" :key="shot.id">
            <ProductVideoContinuityPanel v-if="capabilities?.wholeTimelineReview"
              :workflow="workflow" :model-options="planningModelOptions" :job-override="shot.wholeReview"
              :current-override="currentWholeVideoReview(workflow, shot)" :manual-approved="Boolean(shot.wholeManualApproval && currentWholeVideoReview(workflow, shot, shot.wholeManualApproval))"
              :heading="`${shot.title} · 整片时段检查`" :labels="wholeLabels(shot)"
              @start="askWholeReview(shot)" @cancel="cancelContinuityReview(shot.id, 'timeline')" @model="selectPlanningModel" @manual="confirmWholeManual(shot)"
              @acknowledge="(index, value) => acknowledgeWholeSegment(shot, index, value)" @acknowledge-whole="acknowledgeWholeStructure(shot, $event)"
              @preview="previewWholeSegment(shot, $event)" @edit="editWholeSegment(shot, $event)" />
            </template>
            <ProductVideoContinuityPanel v-if="capabilities?.continuityReview && kept.length > 1"
              :workflow="workflow" :model-options="planningModelOptions"
              @start="askContinuityReview()" @cancel="cancelContinuityReview()" @model="selectPlanningModel" @manual="confirmManualContinuity"
              @acknowledge="acknowledgeReview" @acknowledge-whole="acknowledgeWholeReview"
              @apply-cut="applyReviewCut" @preview="previewReviewBoundary" @edit="editReviewShot" />
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
                导出画质
                <ThemedSelect :model-value="workflow.exportResolution || '720p'"
                  :options="(capabilities?.compositionResolutions || ['720p']).map(value => ({ value, label: value }))"
                  aria-label="导出画质" @update:model-value="set('exportResolution', $event)" />
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
            <label v-if="capabilities?.audioSmoothing" class="pv-audio-option">
              <input type="checkbox" :checked="workflow.smoothAudio === true"
                @change="set('smoothAudio', $event.target.checked)" />响度统一与切点柔化
            </label>
            <details class="pv-output-music">
              <summary><i class="ri-music-2-line" aria-hidden="true"></i>背景音乐
                <small>{{ workflow.musicName || '未添加' }}</small>
              </summary>
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
            </details>
            <p v-if="capabilities && !capabilities.composition" class="pv-task-status error">
              成片服务尚未就绪，请配置合成服务
            </p>
            </div>
          </section>
          <section v-if="kept.length" class="pv-cut-timeline" aria-label="成片时间轴">
            <div class="pv-section-head"><h3>时间轴</h3><span>{{ exportTime(totalDuration) }}</span></div>
            <div class="pv-cut-timeline-scroll">
              <div class="pv-cut-timeline-track" :style="{
                gridTemplateColumns: outputTimeline.map(item => `${Math.max(item.duration, 0.5)}fr`).join(' '),
                minWidth: `${outputTimeline.length * 90}px`,
              }">
                <button v-for="(item, index) in outputTimeline" :key="item.shot.id" class="pv-cut-segment"
                  :class="{ active: outputShot?.id === item.shot.id }" :aria-label="`时间轴片段 ${item.shot.title}`"
                  :aria-pressed="outputShot?.id === item.shot.id" @click="selectOutputShot(item.shot, true)">
                  <img v-if="selectedImage(item.shot)?.url" :src="selectedImage(item.shot).url" alt="" />
                  <span><strong>{{ index + 1 }} · {{ item.shot.title }}</strong>
                    <small>{{ exportTime(item.start) }} – {{ exportTime(item.end) }}</small></span>
                </button>
              </div>
            </div>
          </section>
        </main>
        <footer v-if="!showingTasks" class="pv-footer" :class="{ 'pv-export-footer': tab === 'output' }">
          <div v-if="tab === 'output'" class="pv-export-summary" role="status">
            <strong>{{ kept.length }} 个片段 · {{ totalDuration }} 秒</strong>
            <span v-if="compositionBusy">合成中 {{ workflow.composition?.progress || 0 }}%</span>
            <span v-else-if="outputIssue" class="pv-export-warning">{{ outputIssue }}</span>
            <span v-else-if="workflow.composition?.url">{{ stale ? '预览待更新' : '成片已就绪' }}</span>
            <span v-else>{{ kept.length ? '待合成' : '暂无保留片段' }}</span>
            <progress v-if="compositionBusy" :value="workflow.composition?.progress || 0" max="100" aria-label="合成进度" />
          </div>
          <span v-else>
            {{ workflow.shots.length }} {{ hasWholeVideos ? '条视频' : '个分镜' }} ·
            {{ kept.length }} 个已保留
          </span>
            <div v-if="tab === 'output'" class="pv-actions pv-export-actions">
              <button v-if="capabilities?.continuityReview && kept.length > 1"
                :disabled="reviewRunning(workflow.continuityReview) || planningModelUnavailable || compositionBusy"
                @click="askContinuityReview()">
                <i :class="reviewRunning(workflow.continuityReview) ? 'ri-loader-4-line pv-spin' : 'ri-scan-2-line'" aria-hidden="true"></i>
                {{ reviewRunning(workflow.continuityReview) ? '检查中' : workflow.continuityReview?.status === 'unknown' ? '核对原检查' : '检查整片' }}
              </button>
              <button
                class="pv-primary"
                :disabled="
                  !kept.length || Boolean(outputIssue) || compositionBusy || !capabilities?.composition || uploading
                "
                @click="compose"
              >
                <i
                  aria-hidden="true"
                  :class="compositionBusy ? 'ri-loader-4-line pv-spin' : 'ri-film-line'"
                ></i>
                {{ compositionBusy ? '合成中' : '合成视频' }}
              </button>
              <button :disabled="!workflow.composition?.url || stale || compositionBusy" @click="download">
                <i aria-hidden="true" class="ri-download-line"></i>
                下载成片
              </button>
              <button class="pv-icon" title="视频超分" aria-label="视频超分" :disabled="!workflow.composition?.url || stale || compositionBusy" @click="openEnhancement()">
                <i aria-hidden="true" class="ri-magic-line"></i>
              </button>
              <button
                class="pv-icon" title="回传选品库" aria-label="回传选品库"
                :disabled="!workflow.composition?.url || stale || compositionBusy"
                @click="openProducts('publish')"
              >
                <i aria-hidden="true" class="ri-archive-line"></i>
              </button>
            </div>
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
        <div v-if="boundaryPreview" class="pv-sub-overlay">
          <section class="pv-boundary-preview" role="dialog" aria-modal="true" aria-label="衔接预览">
            <div class="pv-section-head">
              <h3>衔接预览</h3>
              <button class="pv-icon" title="关闭预览" aria-label="关闭预览" @click="boundaryPreview = null">
                <i class="ri-close-line" aria-hidden="true"></i>
              </button>
            </div>
            <video ref="boundaryVideo" :key="boundaryPreview.index" :src="boundaryPreview.clips[boundaryPreview.index].url"
              :data-preview-index="boundaryPreview.index"
              controls playsinline @loadedmetadata="startBoundaryVideo" @timeupdate="advanceBoundaryVideo" @ended="advanceBoundaryVideo" />
            <div class="pv-actions">
              <span>{{ boundaryPreview.clips[boundaryPreview.index].label }}</span>
              <button title="重播衔接" aria-label="重播衔接" @click="replayBoundaryVideo">
                <i class="ri-restart-line" aria-hidden="true"></i>
              </button>
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
.pv-boundary-preview {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 16px;
  border: 1px solid var(--border-color, #3b3c41);
  border-radius: 8px;
  background: var(--bg-panel, #222329);
}
.pv-boundary-preview video {
  display: block;
  width: 100%;
  height: min(54vh, 420px);
  object-fit: contain;
  background: #15161a;
}
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
.pv-shot-connection {
  margin: 12px 0;
  padding: 10px 0;
  border-top: 1px solid var(--canvas-border);
  border-bottom: 1px solid var(--canvas-border);
}
.pv-shot-connection summary {
  cursor: pointer;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.pv-shot-connection summary span {
  margin-left: 10px;
  color: var(--canvas-text-muted);
  font-weight: 400;
}
.pv-connection-toolbar {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.pv-workspace .pv-connection-toolbar > label:not(.pv-check) {
  width: 200px;
  max-width: 100%;
  margin-bottom: 0;
}
.pv-workspace .pv-connection-toolbar > button {
  height: 36px;
  min-height: 36px;
  flex-shrink: 0;
  white-space: nowrap;
}
.pv-connection-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 10px 0;
}
.pv-shot-connection label {
  display: grid;
  gap: 6px;
  color: var(--canvas-text-muted);
}
.pv-workspace .pv-shot-connection textarea {
  width: 100%;
  min-width: 0;
  height: 66px;
  min-height: 66px;
  padding: 8px;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
.pv-connection-state {
  color: var(--canvas-text-muted);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pv-motion-observation {
  margin: 10px 0;
  padding: 10px 0;
  border-top: 1px solid var(--canvas-border);
  font-size: 12px;
}
.pv-motion-observation p {
  margin: 6px 0;
  color: var(--canvas-text-muted);
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.pv-connection-frame {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.pv-connection-frame img {
  width: 72px;
  height: 54px;
  object-fit: contain;
  background: var(--canvas-node-bg);
}
.pv-connection-frame span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pv-connection-frame strong {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
@media (max-width: 700px) {
  .pv-connection-fields {
    grid-template-columns: minmax(0, 1fr);
  }
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
.pv-batch-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pv-batch-status small {
  grid-column: 1 / -1;
  color: var(--canvas-text-subtle);
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
.pv-tail-frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  gap: 6px 10px;
  margin: 0 0 12px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.pv-tail-frame :deep(.themed-select) {
  grid-column: 1;
}
.pv-tail-frame img {
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 48px;
  height: 48px;
  object-fit: contain;
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
}
.pv-tail-frame small {
  grid-column: 1;
  color: var(--canvas-text-subtle);
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
  grid-template-columns: minmax(320px, 0.95fr) minmax(320px, 1.25fr);
  grid-template-rows: minmax(0, 1fr) auto;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pv-output > section {
  padding: 16px 20px;
  min-width: 0;
}
.pv-timeline {
  border-right: 1px solid var(--canvas-border);
}
.pv-timeline-shot {
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  margin-top: 8px;
  position: relative;
}
.pv-timeline-shot.selected {
  border-color: var(--canvas-accent-border);
}
.pv-timeline-shot.drop-before::before,
.pv-timeline-shot.drop-after::after {
  content: '';
  position: absolute;
  height: 3px;
  background: var(--canvas-accent);
  left: 0;
  right: 0;
  z-index: 1;
}
.pv-timeline-shot.drop-before::before {
  top: -6px;
}
.pv-timeline-shot.drop-after::after {
  bottom: -6px;
}
.pv-export-clip-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px;
}
.pv-export-clip-head .pv-actions {
  flex-wrap: nowrap;
  gap: 3px;
  margin: 0;
}
.pv-workspace button.pv-drag-handle {
  flex-basis: 20px;
  width: 20px;
  cursor: grab;
  color: var(--canvas-text-subtle);
}
.pv-workspace button.pv-export-clip-select {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  justify-content: flex-start;
  gap: 10px;
}
.pv-export-clip-select img,
.pv-export-clip-select > i {
  width: 32px;
  height: 40px;
  flex: 0 0 32px;
  object-fit: cover;
  border-radius: 3px;
}
.pv-export-clip-select > i {
  display: grid;
  place-items: center;
  background: var(--canvas-input);
  font-size: 22px;
}
.pv-export-clip-select > span {
  min-width: 0;
}
.pv-export-clip-select strong {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
}
.pv-export-clip-select small {
  display: block;
  margin-top: 3px;
}
.pv-export-clip-editor {
  border-top: 1px solid var(--canvas-border);
  margin-top: 16px;
  padding: 10px 0 0;
}
.pv-export-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 6px;
}
.pv-export-editor-head .pv-actions {
  margin: 0;
  flex-shrink: 0;
}
.pv-export-editor-head > div:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pv-export-editor-head small {
  display: block;
  margin-top: 3px;
}
.pv-export-clip-editor .pv-settings {
  margin: 10px 0;
}
.pv-workspace .pv-export-clip-editor label {
  margin-bottom: 10px;
  gap: 4px;
}
.pv-workspace .pv-export-clip-editor .pv-settings label {
  margin-bottom: 0;
}
.pv-output-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pv-output-preview > :not(.pv-output-settings) {
  flex-shrink: 0;
}
.pv-output-settings {
  min-height: 0;
  flex: 1;
  padding-top: 10px;
}
.pv-workspace .pv-output-settings label {
  margin-bottom: 12px;
  gap: 4px;
}
.pv-output-settings .pv-settings {
  margin: 0;
}
.pv-output-preview-head {
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.pv-output-preview-head .pv-timing-modes {
  margin-left: auto;
}
.pv-preview-stale {
  font-size: 11px;
  color: var(--warning-color, #e9ba68);
}
.pv-output-player {
  --pv-player-height: clamp(140px, 25vh, 270px);
  height: var(--pv-player-height);
  max-height: 100%;
  display: grid;
  place-items: center;
  min-width: 0;
  overflow: hidden;
}
.pv-output-player video {
  display: block;
  width: min(100%, calc(var(--pv-player-height) * var(--pv-output-aspect)));
  aspect-ratio: var(--pv-output-aspect);
  height: auto;
  max-height: 100%;
  object-fit: contain;
  background: #111215;
  border-radius: 4px;
}
.pv-output-player > span {
  color: var(--canvas-text-subtle);
  font-size: 12px;
  overflow-wrap: anywhere;
  text-align: center;
}
.pv-output-preview-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--canvas-text-muted);
}
.pv-output-preview-meta > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pv-output-preview-meta small {
  white-space: nowrap;
}
.pv-output-music summary {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
}
.pv-output-music summary::before {
  content: '+';
  width: 12px;
}
.pv-output-music[open] summary::before {
  content: '-';
}
.pv-output-music summary small {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
.pv-output > .pv-cut-timeline {
  grid-column: 1 / -1;
  padding: 10px 20px 12px;
  border-top: 1px solid var(--canvas-border);
  background: var(--canvas-input);
}
.pv-cut-timeline .pv-section-head {
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--canvas-text-muted);
}
.pv-cut-timeline-scroll {
  overflow-x: auto;
  scrollbar-width: thin;
}
.pv-cut-timeline-track {
  display: grid;
  width: 100%;
  gap: 4px;
}
.pv-workspace button.pv-cut-segment {
  height: 48px;
  min-width: 0;
  padding: 4px 6px;
  justify-content: flex-start;
  text-align: left;
  overflow: hidden;
}
.pv-cut-segment img {
  width: 28px;
  height: 36px;
  object-fit: cover;
  border-radius: 2px;
  flex-shrink: 0;
}
.pv-cut-segment span {
  min-width: 0;
}
.pv-cut-segment strong,
.pv-cut-segment small {
  display: block;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.pv-cut-segment strong {
  font-size: 11px;
  font-weight: 500;
}
.pv-cut-segment small {
  margin-top: 2px;
  font-size: 10px;
}
.pv-export-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
}
.pv-export-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.pv-export-summary strong {
  color: var(--canvas-text);
  font-size: 12px;
}
.pv-export-summary .pv-export-warning {
  color: var(--warning-color, #e9ba68);
}
[data-theme='light'] .pv-preview-stale,
[data-theme='light'] .pv-export-summary .pv-export-warning {
  color: #8a5b12;
}
.pv-export-summary progress {
  width: min(100%, 220px);
  height: 4px;
  accent-color: var(--canvas-accent);
}
.pv-export-actions {
  margin: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.pv-export-clip-select:focus-visible,
.pv-cut-segment:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
@media (min-width: 1200px) {
  .pv-output-preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(190px, 0.9fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    column-gap: 20px;
  }
  .pv-output-preview-head {
    grid-column: 1 / -1;
  }
  .pv-output-player {
    --pv-player-height: clamp(140px, calc(100dvh - 550px), 360px);
    grid-column: 1;
    grid-row: 2;
    align-self: center;
  }
  .pv-output-preview-meta {
    grid-column: 1;
    grid-row: 3;
  }
  .pv-output-settings {
    grid-column: 2;
    grid-row: 2 / 4;
    padding-top: 0;
  }
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
  .pv-source {
    display: block;
  }
  .pv-output {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .pv-output > section {
    padding: 12px;
    overflow: visible;
    flex-shrink: 0;
  }
  .pv-output-preview {
    order: -1;
    border-bottom: 1px solid var(--canvas-border);
  }
  .pv-output-settings {
    overflow: visible;
    flex: none;
  }
  .pv-output-player {
    --pv-player-height: 210px;
  }
  .pv-output > .pv-cut-timeline {
    padding: 10px 12px;
  }
  .pv-export-footer {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 10px 12px;
  }
  .pv-export-footer > button {
    display: none;
  }
  .pv-export-actions {
    justify-content: flex-start;
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
