import { MAX_REFERENCE_SHOTS } from './referenceVideo.js'
import { SEEDANCE_ANCI_MODEL, isSeedanceAnciModel, videoVersionPayload } from './seedanceAnci.js'
import { MAIN_VIDEO_2, buildMainVideo2Request } from './productVideo2.js'
import { videoReferencePayload, videoReferenceLimit, videoRatioForRequest } from './chatVideoSettings.js'
import { newProductStudy, creativePlanningBrief, isProductStudyRunning } from './productVideoProductAnalysis.js'
import { usesReferenceVideoGeneration, referenceGenerationIssue, recreationMaterialIssue,
  recreationPrompt, recreationVideoPayload } from './productVideoRecreation.js'
import { setWholeMotion, wholeTimelineIssue, wholeTimeline, wholeStatePrompt } from './productVideoWholeTimeline.js'
import {
  continuityEnabled,
  planningContinuityReferences,
  productReferenceUrls,
  imageContinuityReferences,
  continuityReferenceImages,
} from './productVideoContinuity.js'
import {
  shotConnectionPrompt,
  shotMotionHandoffPrompt,
  usableShotConnectionFrame,
  validateShotConnectionVideo,
  usableMotionObservation,
  executionProductVideoShots,
  adjacentProductVideoShots,
  previousShotTailSource,
  shotConnection,
} from './productVideoShotConnections.js'

export const productVideoShotLimit = (workflow) =>
  workflow.planner === MAIN_VIDEO_2 ? Infinity :
  (workflow.referenceStrategy !== 'highlights' &&
    Number(workflow.referenceVideo?.duration) > 30.5) ||
  workflow.shots?.some((shot) => shot.referenceRange)
    ? MAX_REFERENCE_SHOTS
    : 8

export const VIDEO_MODELS = [
  { value: 'seedance-2.0-fast-0826-480p', label: 'SD2 Fast · 480p' },
  { value: 'seedance-2.0-fast-0826-720p', label: 'SD2 Fast · 720p' },
  { value: 'seedance-2.0-0826-480p', label: 'SD2 · 480p' },
  { value: 'seedance-2.0-0826-720p', label: 'SD2 · 720p' },
  { value: 'doubao-seedance-2-0-260128', label: 'SD2 满血按秒' },
  { value: 'doubao-seedance-2-5-260628', label: 'SD2.5 满血按秒' },
  { value: 'minimax-h3', label: 'MiniMax H3' },
  { value: SEEDANCE_ANCI_MODEL, label: 'SD 2.0 按次' },
]
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9']
export const DEFAULT_VIDEO_RATIO = '3:4'
export const ANMIAO_VIDEO_RESOLUTIONS = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
]
export const ANMIAO25_VIDEO_RESOLUTIONS = ANMIAO_VIDEO_RESOLUTIONS.filter(
  (option) => option.value !== '4k',
)
export const WHOLE_VIDEO_30_MODEL = 'ya-sd25-30s'
export const ANMIAO_VIDEO_MODEL = 'doubao-seedance-2-0-260128'
export const ANMIAO20_FAST_VIDEO_MODEL = 'doubao-seedance-2-0-fast-260128'
export const ANMIAO25_VIDEO_MODEL = 'doubao-seedance-2-5-260628'
export const MINIMAX_VIDEO_MODEL = 'minimax-h3'
export const HAILUO_H3_VIDEO_MODEL = 'hailuo-h3-shouweizhen'
export const NEXT_SHOT_FIRST_FRAME = '__next_shot_first_frame__'
export function mappedImageModelOption(model, options = []) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase()
  const requested = normalize(model)
  if (!requested) return undefined
  const matches = (value) => normalize(value) === requested
  // Image route names can distinguish providers that use the same model ID.
  return options.find((option) => matches(option.value)) ||
    options.find((option) => matches(option.model))
}
export function mappedVideoModelOption(model, options = [], hailuoH3Available = false) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase()
  const requested = normalize(model)
  if (!requested) return undefined
  const matches = (value) => normalize(value) === requested
  return (
    options.find((option) => matches(option.value)) ||
    options.find((option) => matches(option.label)) ||
    (hailuoH3Available && requested === MINIMAX_VIDEO_MODEL
      ? options.find((option) => normalize(option.value) === HAILUO_H3_VIDEO_MODEL)
      : undefined)
  )
}
export const isRetiredVideoModel = (model) => model === 'minimax-h3-max'
export const supportsVideoAudioToggle = (model) => Boolean(model) &&
  ![MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL, WHOLE_VIDEO_30_MODEL, SEEDANCE_ANCI_MODEL].includes(model) &&
  !isRetiredVideoModel(model)
export const isAnmiao20FastVideoModel = (model) =>
  String(model || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .includes('doubao-seedance-2-0-fast')
export const ANMIAO20_FAST_VIDEO_RESOLUTIONS = ANMIAO_VIDEO_RESOLUTIONS.filter((option) =>
  ['480p', '720p'].includes(option.value),
)
export const MINIMAX_VIDEO_RESOLUTIONS = [
  { value: '768p', label: '768P' },
  { value: '1080p', label: '1080P' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]
export const isAnmiao25VideoModel = (model) =>
  model === ANMIAO25_VIDEO_MODEL ||
  String(model || '')
    .toLowerCase()
    .includes('seedance-2.5')
export const isPerSecondVideoModel = (model) =>
  [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(
    model,
  ) ||
  isAnmiao20FastVideoModel(model) ||
  String(model || '')
    .toLowerCase()
    .includes('seedance-2.0-guanfang-anmiao') ||
  isAnmiao25VideoModel(model)
export const WHOLE_VIDEO_30_MODELS = [
  { value: WHOLE_VIDEO_30_MODEL, label: 'SD2.5 整片 30 秒' },
  { value: ANMIAO25_VIDEO_MODEL, label: 'SD2.5 满血按秒 · 30 秒' },
]
export const isWholeVideo = (mode) => ['single_video', 'single_video_30'].includes(mode)
export function wholeVideoModelOptions(options = [], seconds = 15) {
  return options.filter((option) =>
    !isRetiredVideoModel(option.value) &&
    (seconds === 30
      ? option.value === WHOLE_VIDEO_30_MODEL || isAnmiao25VideoModel(option.value)
      : seconds === 15 && option.value !== WHOLE_VIDEO_30_MODEL),
  )
}
export function videoPromptDuration(value) {
  const text = normalizePromptLineBreaks(value)
  for (const pattern of [
    /(?:本镜|镜头|分镜|片段)时长\s*[:：=为是]?\s*(\d+(?:\.\d+)?)\s*(?:秒钟?|s(?:ec(?:ond)?s?)?)(?![a-z])/gi,
    /(?:总时长|视频时长|时长)\s*[:：=为是]?\s*(\d+(?:\.\d+)?)\s*(?:秒钟?|s(?:ec(?:ond)?s?)?)(?![a-z])/gi,
  ]) {
    const explicit = [...text.matchAll(pattern)]
      .map((match) => Number(match[1]))
      .filter((seconds) => seconds > 0)
    if (explicit.length) return Math.max(...explicit)
  }

  // Read the end of each script time range, not the length of its individual actions.
  const ranges = [
    ...text.matchAll(
      /(?<![\d./:+-])(\d+(?:\.\d+)?)\s*(?:秒钟?|s(?:ec(?:ond)?s?)?)?\s*[-~～—–至到]\s*(\d+(?:\.\d+)?)\s*(?:秒钟?|s(?:ec(?:ond)?s?)?)(?![a-z])/gi,
    ),
  ]
    .filter((match) => Number(match[2]) > Number(match[1]))
    .map((match) => Number(match[2]))
  const points = [
    ...text.matchAll(/(?<![\d./:+-])(\d+(?:\.\d+)?)\s*(?:秒钟?|s(?:ec(?:ond)?s?)?)(?![a-z])/gi),
  ]
    .map((match) => Number(match[1]))
    .filter((seconds) => seconds > 0)
  return ranges.length || points.length ? Math.max(...ranges, ...points) : null
}
export const generationDuration = (shot, workflow) => {
  if (shot.productionMode === 'single_video_30') return 30
  if (!isWholeVideo(shot.productionMode) && (isPerSecondVideoModel(workflow?.videoModel) || isSeedanceAnciModel(workflow?.videoModel))) {
    const planned = Number(shot.referenceRange ? shot.duration : shot.scriptDuration ?? shot.duration)
    const seconds =
      (!shot.referenceRange && videoPromptDuration(shot.motion)) ||
      (Number.isFinite(planned) && planned > 0
        ? planned
        : Number(workflow.videoDurationSeconds ?? 15))
    return Math.max(4, Math.ceil(seconds - 0.000001))
  }
  return 15
}
export function executionDuration(shot, workflow) {
  if (isWholeVideo(shot.productionMode)) return generationDuration(shot, workflow)
  if (shot.referenceRange) return Number(shot.duration)
  return videoPromptDuration(shot.motion) || Number(shot.scriptDuration) || Number(shot.duration) || 4
}

export function setShotMotion(shot, value) {
  if (isWholeVideo(shot.productionMode)) { setWholeMotion(shot, normalizeVideoPrompt(shot, value)); return }
  shot.motion = normalizeVideoPrompt(shot, value)
  if (isWholeVideo(shot.productionMode) || shot.referenceRange) return
  const seconds = videoPromptDuration(shot.motion)
  if (seconds) {
    shot.scriptDuration = seconds
    if (!selectedVideo(shot)) shot.duration = seconds
  }
}
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
export const copy = (value) => JSON.parse(JSON.stringify(value))

export function normalizePromptLineBreaks(value) {
  return String(value ?? '')
    .replace(/\\+r\\+n|\\+[rn]/g, '\n')
    .replace(/\r\n?/g, '\n')
}

export function normalizeVideoPrompt(shot, value = shot.motion) {
  const text = normalizePromptLineBreaks(value)
  if (!isWholeVideo(shot.productionMode)) return text
  const timePrefix =
    /^\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-~～—–至到]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)\s*[:：,，、]\s*/i
  return text
    .split('\n')
    .map((line) => {
      const first = timePrefix.exec(line)
      if (!first) return line
      let content = line.slice(first[0].length)
      let duplicate = timePrefix.exec(content)
      while (
        duplicate &&
        Number(duplicate[1]) === Number(first[1]) &&
        Number(duplicate[2]) === Number(first[2])
      ) {
        content = content.slice(duplicate[0].length)
        duplicate = timePrefix.exec(content)
      }
      return first[0] + content
    })
    .join('\n')
}

export function newProductVideo() {
  return {
    version: 1,
    planningSource: 'creative',
    planningModel: 'default',
    continuity: { enabled: true, scene: '', person: '', product: '', images: {}, anchor: null },
    referenceVideo: null,
    referenceStrategy: 'faithful',
    referenceRecreation: { generationMode: 'script', personMode: 'new', sceneMode: 'source', audioMode: 'new',
      person: '', scene: '', images: {} },
    productionMode: 'storyboard',
    timelineCount: 4,
    generateAudio: false,
    videoVersion: '快速',
    keepOriginalAudio: false,
    smoothAudio: false,
    brief: '',
    references: [],
    shots: [],
    ratio: DEFAULT_VIDEO_RATIO,
    imageModel: 'gpt-image-2',
    videoModel: 'seedance-2.0-fast-0826-720p',
    videoResolution: '720p',
    minimaxResolution: '768p',
    videoDurationSeconds: 15,
    wholeVideo30Model: WHOLE_VIDEO_30_MODEL,
    wholeVideo30Resolution: '720p',
    lastPlanSummary: null,
    musicUrl: '',
    musicName: '',
    musicVolume: 0.25,
    exportResolution: '1080p',
    composition: null,
  }
}

export function productVideoLibrary(value) {
  if (value?.version === 2 && Array.isArray(value.tasks)) return value
  const hasLegacy =
    value && (value.brief || value.references?.length || value.shots?.length || value.composition)
  return {
    version: 2,
    tasks: hasLegacy
      ? [
          {
            ...value,
            id: value.id || 'legacy',
            title: value.title || value.brief?.trim().split('\n')[0].slice(0, 40) || '历史主图视频',
            createdAt: value.createdAt || 0,
            updatedAt: value.updatedAt || 0,
          },
        ]
      : [],
  }
}

export function newProductVideoTask(title = '未命名任务') {
  return {
    ...newProductVideo(),
    productStudy: newProductStudy(),
    id: uid(),
    title: title.trim().slice(0, 80) || '未命名任务',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function productVideoTaskState(task, activity = '') {
  if (activity === 'plan' || activity === 'analysis' || isPlanRunning(task.planJob) || isProductStudyRunning(task.productStudy)) return 'planning'
  if (activity === 'compose' || ['queued', 'processing'].includes(task.composition?.status))
    return 'generating'
  const latestImages = task.shots.map((shot) => shot.images.at(-1)).filter(Boolean)
  const latestVideos = task.shots.map((shot) => shot.videos.at(-1)).filter(Boolean)
  const latest = [...latestImages, ...latestVideos]
  if (latestImages.some((item) => ['submitting', 'processing'].includes(item.status)) ||
      latestVideos.some((item) => item.status !== 'unknown' && videoGenerationPending(item))) return 'generating'
  if (task.productStudy?.job?.status === 'unknown' || task.planJob?.status === 'unknown' ||
      latestImages.some((item) => item.status === 'unknown') || latestVideos.some((item) => item.status === 'unknown' && videoGenerationPending(item)))
    return 'unknown'
  if (
    task.productStudy?.job?.status === 'failed' || task.planJob?.status === 'failed' ||
    task.composition?.status === 'failed' ||
    latest.some((item) => item.status === 'failed')
  )
    return 'failed'
  if (
    (task.planner === MAIN_VIDEO_2 && task.shots.some((shot) => selectedVideo(shot))) ||
    (task.composition?.status === 'completed' &&
    task.composition.fingerprint &&
    task.composition.fingerprint === compositionFingerprint(task))
  )
    return 'completed'
  return task.shots.length ? 'editing' : 'draft'
}

export function isPlanRunning(job) {
  return ['submitting', 'queued', 'processing'].includes(job?.status)
}

export function applyPlanningState(workflow, state) {
  const job = workflow.planJob
  if (!job || job.id !== state.id || Number(state.updatedAt) < Number(job.updatedAt || 0)) return
  const shots = state.result?.shots || []
  const applied = Number(job.appliedCount) || 0
  if (workflow.shots.length + Math.max(0, shots.length - applied) > productVideoShotLimit(workflow))
    throw new Error(
      `分镜数量超过 ${productVideoShotLimit(workflow)} 个，请移除多余分镜后重新查询；策划结果已在后台保存`,
    )
  for (let index = applied; index < shots.length; index++) {
    const id = `plan-${job.id}-${index}`
    if (!workflow.shots.some((shot) => shot.id === id))
      workflow.shots.push({
        ...newShot({ ...shots[index], concept: state.result?.summary?.concept }),
        id,
        referenceIds: [...job.referenceIds],
        ...(job.request?.referenceVideo?.strategy === 'highlights'
          ? { referenceStrategy: 'highlights' }
          : job.request?.referenceVideo?.segments?.[index]
            ? { referenceRange: { ...job.request.referenceVideo.segments[index] } }
            : {}),
      })
  }
  if (state.result?.summary) workflow.lastPlanSummary = state.result.summary
  Object.assign(job, {
    status: state.status,
    stage: state.stage,
    count: state.count,
    error: state.error || '',
    pollError: '',
    updatedAt: state.updatedAt,
    appliedCount: Math.max(applied, shots.length),
  })
}

export function queryProductVideoTasks(
  tasks,
  { keyword = '', status = '', page = 1, pageSize = 10, activity = {} } = {},
) {
  const term = keyword.trim().toLowerCase()
  const filtered = tasks
    .filter(
      (task) =>
        (!term || `${task.title} ${task.brief}`.toLowerCase().includes(term)) &&
        (!status || productVideoTaskState(task, activity[task.id]) === status),
    )
    .toSorted(
      (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) || a.id.localeCompare(b.id),
    )
  const size = [10, 20, 50].includes(Number(pageSize)) ? Number(pageSize) : 10
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const current = Math.max(1, Math.min(pages, Math.trunc(Number(page)) || 1))
  return {
    items: filtered.slice((current - 1) * size, current * size),
    total: filtered.length,
    pages,
    page: current,
    pageSize: size,
  }
}

export function newShot(plan = {}) {
  return {
    id: uid(),
    title: plan.title || '商品镜头',
    purpose: plan.purpose || '',
    design: plan.design || '',
    concept: plan.concept || '',
    productionMode: plan.productionMode || 'storyboard',
    timeline: plan.timeline || [],
    ...(plan.connection ? { connection: { ...plan.connection } } : {}),
    ...(plan.referenceRange ? { referenceRange: { ...plan.referenceRange } } : {}),
    ...(plan.referenceStrategy ? { referenceStrategy: plan.referenceStrategy } : {}),
    ...(isWholeVideo(plan.productionMode)
      ? { timelineCount: Number(plan.timelineCount ?? (plan.timeline?.length || 4)) }
      : {}),
    imagePrompt: normalizePromptLineBreaks(plan.imagePrompt),
    motion: normalizeVideoPrompt(plan, plan.motion || '固定镜头，商品保持原样，光线自然。'),
    caption: plan.caption || '',
    duration: Number(plan.duration) || 4,
    start: 0,
    timingMode: 'trim',
    images: [],
    videos: [],
    imageId: '',
    approvedImageId: '',
    lastFrameImageId: '',
    videoId: '',
    kept: false,
    referenceIds: [],
  }
}

export function planningTimeoutMs(count, stageTimeoutSeconds) {
  const shots = Math.min(8, Math.max(1, Math.floor(Number(count)) || 8))
  const seconds = Number(stageTimeoutSeconds)
  // Budget for the outline and each two-shot batch, plus transport overhead.
  const stage = Number.isFinite(seconds) && seconds > 0 ? Math.min(300, Math.max(30, seconds)) : 300
  return ((1 + Math.ceil(shots / 2)) * stage + 60) * 1000
}

export function planningErrorMessage(error) {
  if (error?.name === 'TimeoutError' || /^request timed out$/i.test(error?.message || ''))
    return '分镜策划等待超时，原有分镜和素材未改动，请稍后重试。'
  return error?.message || '分镜策划未完成，请稍后重试。'
}

export function buildPlanRequest(workflow, count, shot, features = {}) {
  if (workflow.planner === MAIN_VIDEO_2 && !shot) return buildMainVideo2Request(workflow)
  const materialIssue = recreationMaterialIssue(workflow)
  if (materialIssue) throw new Error(materialIssue)
  const mode = shot ? shot.productionMode : workflow.productionMode
  const singleVideo = isWholeVideo(mode)
  const highlights =
    !shot && workflow.planningSource === 'reference' && workflow.referenceStrategy === 'highlights'
  let sourceVideo =
    (!shot || shot.referenceRange) && workflow.planningSource === 'reference'
      ? workflow.referenceVideo
      : null
  if (shot?.referenceRange) {
    if (!sourceVideo?.segments?.length) throw new Error('原片参考资料已改变，请重新读取参考视频')
    const { start, end } = shot.referenceRange
    sourceVideo = {
      ...sourceVideo,
      duration: end - start,
      segments: [{ start: 0, end: end - start }],
      frames: sourceVideo.frames
        .filter((frame) => frame.time >= start && frame.time < end)
        .map((frame) => ({ ...frame, time: frame.time - start })),
      suggestedShotCount: 1,
    }
  }
  if (
    highlights &&
    (mode !== 'single_video_30' || !(sourceVideo?.duration > 30.5) || !sourceVideo.segments?.length)
  )
    throw new Error('精华压缩需使用 30 秒整片和已读取的长参考视频')
  if (!highlights && sourceVideo?.duration > 30.5 && (singleVideo || !sourceVideo.segments?.length))
    throw new Error('长参考视频需按原片时长分段制作，请重新读取参考视频')
  const detectedShotCount = Number(sourceVideo?.suggestedShotCount ?? sourceVideo?.frames?.length)
  const timelineCount = singleVideo
    ? Number(
        shot
          ? (shot.timelineCount ?? (shot.timeline?.length || 4))
          : highlights
            ? (workflow.timelineCount ?? 4)
            : sourceVideo && Number.isInteger(detectedShotCount)
              ? detectedShotCount
              : (workflow.timelineCount ?? 4),
      )
    : null
  if (singleVideo && (!Number.isInteger(timelineCount) || timelineCount < 1 || timelineCount > 8))
    throw new Error('整片内的分镜数量需为 1 至 8 个')
  if (highlights && timelineCount > sourceVideo.segments.length)
    throw new Error('精华镜头数量不能超过原片分段数')
  const shared = planningContinuityReferences(workflow, shot)
  const previousId = adjacentProductVideoShots(workflow, shot).previous?.id
  const observedMotion = usableMotionObservation(workflow, shot)?.results[0]
  return {
    brief: creativePlanningBrief(workflow),
    ...(shared.instruction ? { continuity: shared.instruction } : {}),
    planningModel: workflow.planningModel || 'default',
    images: shared.urls,
    ...(features?.imageEvidenceRoles && shared.imageRoles.length ? { imageRoles: shared.imageRoles } : {}),
    count:
      shot || singleVideo
        ? 1
        : sourceVideo && Number.isInteger(detectedShotCount)
          ? detectedShotCount
          : Number(count),
    ratio: workflow.ratio,
    ...(singleVideo ? { productionMode: mode, timelineCount } : {}),
    ...(workflow.generateAudio === true ? { generateAudio: true } : {}),
    ...(sourceVideo?.url && sourceVideo.frames?.length
      ? {
          referenceVideo: {
            url: sourceVideo.url,
            name: sourceVideo.name || '参考视频',
            duration: Number(sourceVideo.duration),
            width: Number(sourceVideo.width) || null,
            height: Number(sourceVideo.height) || null,
            audioSummary: sourceVideo.audioSummary || '',
            ...(highlights ? { strategy: 'highlights' } : {}),
            ...(sourceVideo.segments
              ? { segments: sourceVideo.segments.map(({ start, end }) => ({ start, end })) }
              : {}),
            frames: sourceVideo.frames.map((frame) => ({
              url: frame.url,
              time: Number(frame.time),
            })),
          },
        }
      : {}),
    currentShot: shot
      ? {
          title: shot.title,
          imagePrompt: normalizePromptLineBreaks(shot.imagePrompt),
          motion: normalizeVideoPrompt(shot),
          caption: shot.caption,
          duration: executionDuration(shot, workflow),
          purpose: shot.purpose || '',
          design: shot.design || '',
          ...(shot.connection ? { connection: { ...shot.connection } } : {}),
          ...(singleVideo ? { productionMode: mode, timeline: wholeTimeline(shot) } : {}),
        }
      : null,
    contextShots: executionProductVideoShots(workflow, shot).map((item) => ({
      title: item.title,
      purpose: item.purpose || '',
      design: item.id === previousId && observedMotion
        ? `${String(item.design || '').slice(0, 700)}\n实际视频结束状态：${observedMotion.previousState}\n实际运动：${observedMotion.motion}`
        : item.design || '',
      concept: item.concept || '',
      motion: normalizeVideoPrompt(item),
      duration: executionDuration(item, workflow),
      ...(item.connection ? { connection: { ...item.connection } } : {}),
      current: item.id === shot?.id,
    })),
  }
}

export function selectedImage(shot) {
  return shot.images.find((item) => item.id === shot.imageId && item.url)
}

export function selectedVideo(shot) {
  return shot.videos.find((item) => item.id === shot.videoId && item.url)
}

export function removeImage(shot, id) {
  const image = shot.images.find((item) => item.id === id && item.url)
  if (!image || ['submitting', 'processing'].includes(image.status)) return
  shot.images = shot.images.filter((item) => item.id !== id)
  if (shot.imageId === id) {
    const next = shot.images.findLast(
      (item) => item.url && !['submitting', 'processing'].includes(item.status),
    )
    shot.imageId = next?.id || ''
    shot.approvedImageId = ''
  } else if (shot.approvedImageId === id) {
    shot.approvedImageId = ''
  }
}

export function removeVideo(shot, id) {
  if (!shot.videos.some((item) => item.id === id && item.url)) return
  shot.videos = shot.videos.filter((item) => item.id !== id)
  if (shot.videoId !== id) return
  const next = shot.videos.findLast((item) => item.url)
  shot.videoId = next?.id || ''
  shot.kept = false
  shot.start = 0
  if (next && !shot.referenceRange) shot.duration = Math.min(shot.duration, next.duration || 15)
}

export const usesWholeReferenceImages = (workflow, shot) =>
  Boolean(workflow && isWholeVideo(shot?.productionMode) && shot.videoInputMode !== 'first_frame')

export function wholeVideoReferenceInputs(workflow, shot) {
  const shared = planningContinuityReferences(workflow, shot)
  const firstFrame = workflow.planner === MAIN_VIDEO_2 ? workflow.video2?.firstFrame?.url : ''
  if (firstFrame && !shared.urls.includes(firstFrame)) shared.urls.push(firstFrame)
  const roles = { primary_product: '商品主参考，商品外观以此图为准',
    person: '人物参考，只采用人物外观与服装', scene: '场景参考，只采用空间布局、家具与光线' }
  return { urls: shared.urls, instruction: shared.urls.map((url, index) => {
    const role = shared.imageRoles.find(item => item.imageIndex === index + 1 && item.role !== 'product')?.role
    return `图${index + 1}：${firstFrame === url ? '用户可选首帧参考，承接开场构图与氛围，产品外观仍以产品图为准' : roles[role] || '视频参考图，按脚本引用其商品、材质、人物或场景'}。`
  }).join('\n') }
}

export function wholeReferenceGenerationIssue(workflow, shot, model) {
  if (!usesWholeReferenceImages(workflow, shot)) return ''
  if (isRetiredVideoModel(model)) return '原视频模型已移除，请重新选择视频模型'
  if (model === HAILUO_H3_VIDEO_MODEL) return '当前模型只支持首尾帧，请改选支持参考图生成的模型，或切换为首帧生成'
  try {
    const { urls } = wholeVideoReferenceInputs(workflow, shot)
    if (!urls.length) return '请至少选择一张视频参考图'
    if (urls.length > videoReferenceLimit(model, 'cankaosheng')) return '视频参考图数量超过当前模型上限，请调整参考图或更换模型'
    return referenceGenerationIssue(workflow, model, shot)
  } catch (e) { return e.message }
}

export function canGenerateVideo(shot, workflow) {
  if (usesWholeReferenceImages(workflow, shot)) {
    const model = shot.productionMode === 'single_video_30' ? workflow.wholeVideo30Model : workflow.videoModel
    return Boolean(shot.motion?.trim() && !wholeReferenceGenerationIssue(workflow, shot, model))
  }
  return Boolean(selectedImage(shot) && shot.approvedImageId === shot.imageId && shot.motion.trim())
}

function productAppearanceConstraint(reference) {
  return `商品外观约束：以${reference}中商品的实际底色、冷暖、饱和度和纹理为准，文字色名或风格冲突时以图为准。光照只改变合理明暗和阴影，不改底色、不偏灰偏褐、不加调色滤镜。特写延续原材质及花纹尺度、位置，禁止新增原图没有的斑驳、印花、粗织纹或金属质感，也不得抹除原有图案；看不清的细节不臆造，保持原图表面观感。`
}

export function buildImageRequest(workflow, shot, clientId) {
  const materialIssue = recreationMaterialIssue(workflow)
  if (materialIssue) throw new Error(materialIssue)
  const refs = productReferenceUrls(workflow, shot)
  if (!refs.length) throw new Error('请为这个分镜选择商品参考图或上传固定商品图')
  if (!shot.imagePrompt.trim()) throw new Error('请填写首帧画面')
  const shared = imageContinuityReferences(workflow, shot, refs)
  const connectionFrame = isWholeVideo(shot.productionMode)
    ? null
    : usableShotConnectionFrame(workflow, shot)
  if (!isWholeVideo(shot.productionMode) && shot.connectionFrame && !connectionFrame)
    throw new Error('上一镜视频或裁剪范围已改变，请重新提取衔接帧或移除旧参考')
  const imageUrls = [
    ...new Set([...shared.urls, ...(connectionFrame ? [connectionFrame.url] : [])]),
  ]
  const frameDirection = connectionFrame
    ? `图${imageUrls.indexOf(connectionFrame.url) + 1}是上一镜成片结束时的真实画面。只用于承接人物位置、手部、商品开合、光线及动作阶段；按本镜构图和景别变化，不当作新的商品或人物参考。`
    : ''
  return {
    model: workflow.imageModel,
    size: workflow.ratio,
    resolution: '2K',
    n: 1,
    output_format: 'png',
    client_task_id: clientId,
    image_urls: imageUrls,
    prompt: `${productAppearanceConstraint('所选商品参考图')}\n\n${shared.instruction}\n\n${shotConnectionPrompt(workflow, shot)}\n${frameDirection}\n\n商品资料（仅供核对商品特征）：${workflow.brief}\n\n当前镜头首帧：\n${normalizePromptLineBreaks(shot.imagePrompt).trim()}\n\n生成要求：生成单张视频起始帧，以当前镜头描述安排人物、场景、构图和光线，不要把后续动作或多个镜头画成拼图。人物出镜时，按描述呈现服装、位置、视线、切入瞬间的起始姿势与手部接触状态。已经握住、接触或拉动商品时保留动作进度，不退回接触前，为后续运动留出空间。使用参考图中的同一商品，保持颜色、材质、结构、数量、比例和商品自带的品牌标识，不更换或编造品牌。不要额外叠加字幕、营销文案、水印或未经提供的产品功能。`,
  }
}

export function buildVideoRequest(workflow, shot, clientId) {
  const materialIssue = recreationMaterialIssue(workflow)
  if (materialIssue) throw new Error(materialIssue)
  const directReferences = usesWholeReferenceImages(workflow, shot)
  const model = shot.productionMode === 'single_video_30' ? (workflow.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL) : workflow.videoModel
  const directIssue = wholeReferenceGenerationIssue(workflow, shot, model)
  if (directIssue) throw new Error(directIssue)
  if (!canGenerateVideo(shot, workflow)) throw new Error(directReferences ? '请选择视频参考图并填写整片脚本' : '请先确认当前分镜图片')
  validateShotConnectionVideo(workflow, shot)
  const image = selectedImage(shot)
  const singleVideo = isWholeVideo(shot.productionMode)
  const timelineIssue = workflow.planner === MAIN_VIDEO_2 ? '' : wholeTimelineIssue(shot)
  if (timelineIssue) throw new Error(timelineIssue)
  const whole30 = shot.productionMode === 'single_video_30'
  const duration = generationDuration(shot, workflow)
  const executionShot = { ...shot, duration: executionDuration(shot, workflow) }
  const useReferenceVideo = usesReferenceVideoGeneration(workflow)
  const referenceIssue = referenceGenerationIssue(workflow, model, shot)
  if (referenceIssue) throw new Error(referenceIssue)
  if (isRetiredVideoModel(model)) throw new Error('原视频模型已移除，请重新选择视频模型')
  const anmiaoVideo = isPerSecondVideoModel(model)
  const anciVideo = isSeedanceAnciModel(model)
  if (anciVideo && (!Number.isInteger(duration) || duration < 4 || duration > 15))
    throw new Error('SD 2.0 按次时长需为 4 至 15 的整数秒')
  const minimax = model === MINIMAX_VIDEO_MODEL || model === HAILUO_H3_VIDEO_MODEL
  const anmiao25Video = isAnmiao25VideoModel(model)
  let lastFrame = null
  if (!directReferences && minimax && shot.lastFrameImageId === NEXT_SHOT_FIRST_FRAME) {
    const nextShot = workflow.shots?.[workflow.shots.findIndex((item) => item.id === shot.id) + 1]
    lastFrame = nextShot && selectedImage(nextShot)
  } else if (!directReferences && minimax) {
    lastFrame = workflow.references?.find((item) => item.id === shot.lastFrameImageId && item.url)
  }
  const anmiao20Fast = isAnmiao20FastVideoModel(model)
  const maxDuration = anmiao25Video ? 30 : 15
  const minDuration = 4
  if (
    anmiaoVideo &&
    (!Number.isInteger(duration) || duration < minDuration || duration > maxDuration)
  )
    throw new Error(`按秒视频时长需为 ${minDuration} 至 ${maxDuration} 的整数秒`)
  const anmiaoResolution = minimax
    ? (workflow.minimaxResolution ?? '768p')
    : ((whole30 ? workflow.wholeVideo30Resolution : workflow.videoResolution) ?? '720p')
  const resolutions = minimax
    ? MINIMAX_VIDEO_RESOLUTIONS
    : anmiao25Video
      ? ANMIAO25_VIDEO_RESOLUTIONS
      : anmiao20Fast
        ? ANMIAO20_FAST_VIDEO_RESOLUTIONS
        : ANMIAO_VIDEO_RESOLUTIONS
  if (anmiaoVideo && !resolutions.some((option) => option.value === anmiaoResolution))
    throw new Error(
      minimax
        ? 'MiniMax H3 画质需选择 768P、1080P、2K 或 4K'
        : anmiao25Video
          ? 'SD2.5 视频画质需选择 480p、720p 或 1080p'
          : anmiao20Fast
            ? 'Seedance 2.0 快速版画质需选择 480p 或 720p'
            : '按秒视频画质需选择 480p、720p、1080p 或 4K',
    )
  const timelineCount = workflow.planner === MAIN_VIDEO_2
    ? [...String(shot.motion || '').matchAll(/^\s*分镜\d+\s*(?:[（(][^）)\r\n]+[）)]\s*)?[：:]/gm)].length
    : Number(shot.timelineCount ?? shot.timeline?.length)
  const countDirection =
    singleVideo && Number.isInteger(timelineCount) && timelineCount >= 1 &&
    (workflow.planner === MAIN_VIDEO_2 || timelineCount <= 8)
      ? timelineCount === 1
        ? '全片只用一个连续镜头，不切镜、不换场，在同一镜头内完成全部动作。'
        : `全片共 ${timelineCount} 个分镜，严格按时间轴依次呈现，不额外增加、删减或重复分镜。`
      : ''
  const direction = singleVideo
    ? `这是一条完整的 ${duration} 秒电商视频，必须按提示词里的全部时间段完成开场、展示和收尾。需要切换镜头时按策划的衔接执行；明确要求一镜到底时保持连续。不要仅做第一个动作后一直停留。`
    : shot.referenceRange
      ? `本片段对应参考视频第 ${shot.referenceRange.start} 至 ${shot.referenceRange.end} 秒，成片使用 ${shot.duration} 秒。复现本段的动作阶段和原有转场，不补整套操作或人为停留；超出成片范围时自然延续已有运动，不新增剧情。`
      : '本镜内部连续拍摄，不换场、不跳切、不突然变焦。'
  const continuity = directReferences || anciVideo
    ? `参考图共同约束商品、人物和场景外观，按脚本指定的图号和用途使用，不要求把某一张图复刻为第0秒。整片按时间轴完成连续动作与镜头切换，不做静态图片轮播。同一角色再次出镜时保持身份与服装；${continuityEnabled(workflow, shot) ? '固定场景人物已开启，保持房间和人物设定' : '按脚本安排场景与人物'}。`
    : useReferenceVideo
    ? '图1是已确认的开场参考图，用于固定新人物、商品和场景外观；原视频只提供动作、运镜与镜头节奏，替换设定始终优先，不从原视频带回旧商品或被替换的人物。'
    : singleVideo
    ? `首帧只定义第 0 秒开场，后续按时间轴切换机位和景别，不锁定首帧构图。同一角色再次出镜时保持身份与服装；${continuityEnabled(workflow, shot) ? '固定场景人物已开启，全片不得换房间、换人换装' : '允许按脚本切换场景或角色，不强制同一房间或同一人物'}。商品始终不变。第一段从首帧已有状态开始，不凭空变出或替换人物、商品。`
    : '沿用首帧中的同一人物、服装、商品、场景和光线。动作从首帧已有的姿势和手部位置自然开始，不要凭空增加人物或道具。'
  const audioEnabled = anciVideo || (workflow.planner === MAIN_VIDEO_2
    ? !supportsVideoAudioToggle(model) || workflow.generateAudio !== false
    : workflow.generateAudio === true)
  const audio =
    audioEnabled
      ? '\n声音要求：生成与画面同步的音轨，按策划时间轴安排环境声和动作音效，接触、摩擦等声音与实际动作同时发生。仅在策划明确安排说话时生成对白并对齐口型，不额外添加旁白、广告语或背景音乐。'
      : workflow.planner === MAIN_VIDEO_2
        ? '\n声音要求：仅生成无声画面，不生成口播、对白、旁白、背景音乐、环境音或音效。脚本中的声音设计不执行，画面动作与镜头安排保持。'
        : ''
  const opening = `以提供的首帧图片作为第 0 秒画面。首帧与已确认的实际动作衔接优先于旧稿起点，不回退或重演。${lastFrame ? '\n以尾帧图片作为结束画面，并在首尾帧之间自然完成动作与镜头变化。' : ''}\n${productAppearanceConstraint('已确认首帧')}`
  const directInputs = directReferences ? wholeVideoReferenceInputs(workflow, shot) : null
  const recreationImages = useReferenceVideo && !directReferences ? [...new Set([image.url,
    ...productReferenceUrls(workflow, shot), ...continuityReferenceImages(workflow, shot).map(item => item.url)])] : []
  const recreationOpening = useReferenceVideo ? recreationImages.map((url, index) => {
    const role = continuityReferenceImages(workflow, shot).find(item => item.url === url)?.role
    return `图${index + 1}：${index === 0 ? '已确认的开场参考图，决定新商品、人物与场景外观；属于参考图，不是严格首帧参数'
      : role === 'person' ? '指定人物图，只参考人物身份与服装'
        : role === 'scene' ? '新场景图，只参考空间布局与环境'
          : '商品细节图，只参考商品本身，不照搬其他人物与背景'}。`
  }).join('\n') + '\n原参考视频用于动作、运镜、剪辑与节奏参考，按以下脚本执行替换。' : ''
  const statePrompt = workflow.planner === MAIN_VIDEO_2 ? '' : wholeStatePrompt(shot)
  const action = `${singleVideo ? '整片时间轴与镜头安排' : '当前镜头动作与运镜'}：\n${normalizeVideoPrompt(shot).trim()}${statePrompt ? `\n${statePrompt}` : ''}`
  const requirements = `连续性要求：${continuity}商品结构、数量和品牌不变，避免肢体畸变、商品变形和穿模。${direction}${countDirection}${shotMotionHandoffPrompt(workflow, executionShot)}不要额外添加字幕、水印或营销文案。${audio}`
  const appliedOpening = directReferences
    ? `直接使用以下原始参考图与整片脚本生成视频。图号对应实际附图顺序。\n${directInputs.instruction}\n${productAppearanceConstraint('商品参考图')}\n${useReferenceVideo ? '原参考视频用于动作、运镜、剪辑与节奏参考，按脚本执行商品、人物与场景替换。' : ''}`
    : anciVideo ? '使用所附原始图片作为商品、人物、场景与构图参考，按完整脚本生成视频。图片是外观参考，不作为严格首尾帧。'
    : useReferenceVideo ? recreationOpening : opening
  const recreation = recreationPrompt(workflow)
  const baseLength = [appliedOpening, action, requirements, recreation].join('\n\n').length
  const connectionBudget = directReferences || workflow.planningSource === 'reference' ? Infinity : Math.max(0, 2400 - baseLength - 2)
  const observation = usableMotionObservation(workflow, shot)?.results[0]
  if (observation && connectionBudget < String(observation.previousState || '').length + String(observation.motion || '').length + 160)
    throw new Error('视频提示词过长，无法保留实际动作衔接，请精简本镜动作描述')
  const connection = shotConnectionPrompt(workflow, executionShot, connectionBudget)
  const prompt = [appliedOpening, connection, action, requirements, recreation].filter(Boolean).join('\n\n')
  if (!directReferences && workflow.planningSource !== 'reference' && prompt.length > 2400)
    throw new Error('视频提示词过长，请精简当前镜头动作与运镜')
  return {
    prompt,
    model,
    ratio: anciVideo ? videoRatioForRequest(model, 0, workflow.ratio) : directReferences
      ? videoRatioForRequest(model, directInputs.urls.length, workflow.ratio, 'cankaosheng', useReferenceVideo ? 1 : 0)
      : useReferenceVideo ? workflow.ratio : anmiao25Video || model === HAILUO_H3_VIDEO_MODEL ? 'adaptive' : workflow.ratio,
    resolution:
      anciVideo || (whole30 && !anmiao25Video)
        ? '720p'
        : anmiaoVideo
          ? anmiaoResolution
          : model.endsWith('720p')
            ? '720p'
            : '480p',
    durationSeconds: duration,
    ...videoVersionPayload(model, workflow.videoVersion),
    ...(workflow.planner === MAIN_VIDEO_2
      ? supportsVideoAudioToggle(model) ? { generate_audio: audioEnabled } : {}
      : whole30 || anmiaoVideo || anciVideo ? {} : { generate_audio: workflow.generateAudio === true }),
    ...(directReferences
      ? useReferenceVideo
        ? recreationVideoPayload(workflow, model, directInputs.urls, shot)
        : videoReferencePayload(model, 'cankaosheng', directInputs.urls)
      : useReferenceVideo
      ? recreationVideoPayload(workflow, model, recreationImages, shot)
      : anciVideo ? { image_urls: [image.url] }
      : { first_frame_url: image.url, ...(lastFrame ? { last_frame_url: lastFrame.url } : {}), image_urls: [image.url] }),
    client_task_id: clientId,
  }
}

export function buildCompositionRequest(workflow) {
  const shots = workflow.shots.filter((shot) => shot.kept)
  if (!shots.length) throw new Error('请先保留至少一个视频片段')
  const segments =
    workflow.planningSource === 'reference' &&
    !shots.every((shot) => shot.referenceStrategy === 'highlights') &&
    workflow.referenceVideo?.segments
  if (segments?.length) {
    if (
      shots.length !== segments.length ||
      shots.some(
        (shot, index) =>
          !shot.referenceRange ||
          Math.abs(shot.referenceRange.start - segments[index].start) > 0.001 ||
          Math.abs(shot.referenceRange.end - segments[index].end) > 0.001 ||
          Math.abs(Number(shot.duration) - (segments[index].end - segments[index].start)) > 0.001,
      )
    )
      throw new Error('原片等长合成需按顺序保留全部分段，且各段成片时长须与参考时间段一致')
  }
  const clips = shots.map((shot) => {
    const video = selectedVideo(shot)
    if (!video) throw new Error(`${shot.title} 尚无可用视频`)
    if (video.sourceConnectionKey) {
      const sequence = { ...workflow, shots }
      const previous = adjacentProductVideoShots(sequence, shot).previous
      const source = previousShotTailSource(sequence, shot)
      if (!previous?.kept || video.sourceConnectionKey !== source?.sourceKey)
        throw new Error(`${shot.title} ${shotConnection(workflow, shot).type === 'continue' ? '动作接力' : ''}使用的衔接参考已过期，请更新本镜视频或恢复对应的前镜版本和裁剪`)
    }
    if (!isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue') {
      const sequence = { ...workflow, shots }
      const previous = adjacentProductVideoShots(sequence, shot).previous
      const source = previousShotTailSource(sequence, shot)
      if (!previous?.kept || !source || video.sourceConnectionKey !== source.sourceKey)
        throw new Error(
          `${shot.title} 的动作接力与上一镜成片不一致，请保留对应前镜并重新生成，或改用景别匹配`,
        )
    }
    const mode = shot.timingMode || 'trim'
    if (!['trim', 'speed'].includes(mode)) throw new Error(`${shot.title} 的片段处理方式无效`)
    const start = mode === 'speed' ? 0 : Number(shot.start),
      duration = Number(shot.duration)
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      start < 0 ||
      duration < 0.5 ||
      duration > Math.min(30, video.duration || 15) ||
      start + duration > (video.duration || 15) + 0.05
    ) {
      throw new Error(
        mode === 'speed'
          ? `${shot.title} 的目标时长需为 0.5 至 ${Math.min(30, video.duration || 15)} 秒，且不能超过原片时长`
          : `${shot.title} 的裁剪范围超出视频时长`,
      )
    }
    return {
      url: video.url,
      start,
      duration,
      caption: shot.caption.trim(),
      ...(mode === 'speed' ? { timingMode: 'speed' } : {}),
    }
  })
  return {
    clips,
    ...(workflow.exportResolution ? { resolution: workflow.exportResolution } : {}),
    ratio: workflow.ratio,
    musicUrl: workflow.musicUrl,
    musicVolume: Number(workflow.musicVolume),
    ...(workflow.keepOriginalAudio === true ? { keepOriginalAudio: true } : {}),
    ...(workflow.smoothAudio === true && (workflow.keepOriginalAudio === true || workflow.musicUrl) ? { smoothAudio: true } : {}),
  }
}

export function compositionFingerprint(workflow) {
  try {
    return JSON.stringify(buildCompositionRequest(workflow))
  } catch {
    return ''
  }
}

export function taskState(value) {
  const status = String(value || '').toLowerCase()
  if (/fail|error|cancel|expired|aborted/.test(status)) return 'failed'
  if (
    ['completed', 'succeeded', 'success', 'done', 'finished', 'generated', 'ready'].includes(status)
  )
    return 'completed'
  return 'processing'
}

export function returnedVideoTaskUrl(task) {
  if (taskState(task?.status) === 'failed') return ''
  const urls = task?.videoUrls || task?.video_urls || task?.videos || []
  const url = Array.isArray(urls) ? urls.find(value => typeof value === 'string' && value.trim()) : ''
  return String(url || task?.videoUrl || task?.video_url || task?.url || '').trim()
}

export function videoGenerationPending(entry) {
  return ['submitting', 'processing', 'unknown'].includes(entry?.status) && !returnedVideoTaskUrl(entry)
}

export function videoTaskPollDue(entry, now = Date.now()) {
  if (!entry?.taskId || entry.status !== 'processing') return false
  if (!returnedVideoTaskUrl(entry)) return true
  const lastSynced = Number(entry.lastSyncedAt)
  return !Number.isFinite(lastSynced) || lastSynced <= 0 || now < lastSynced || now - lastSynced >= 30000
}

export function videoTaskStatusText(task, progress) {
  if (taskState(task?.status) === 'completed') return '视频生成完成'
  const stage = String(task?.stage || '').trim()
  if (returnedVideoTaskUrl(task)) return stage || '视频已生成，正在核对任务状态'
  if (stage) return stage
  if (task?.status === 'persisting') return '视频已生成，正在转存到素材空间…'
  if (progress >= 100) return '模型进度已满，等待成片地址'
  return progress == null || !Number.isFinite(Number(progress))
    ? '视频生成中' : `视频生成中 ${Math.round(progress)}%`
}

function generationNotices(entries) {
  const lastPlayable = entries.findLastIndex((entry) => entry.url)
  return entries
    .filter((entry, index) => !entry.url && (entry.status !== 'failed' || index > lastPlayable))
    .slice(-2)
}

export function imageGenerationNotices(images = []) {
  return generationNotices(images)
}

export function videoGenerationNotices(videos = []) {
  return generationNotices(videos)
}

export function imageSubmissionRejected(error) {
  return error?.status === 503 && /^凭证中心主密钥未配置(?:[。.]|$)/.test(error.message || '')
}

export function videoGenerationStatus(entry) {
  if (entry.status === 'failed') return entry.error || '视频生成失败'
  if (returnedVideoTaskUrl(entry)) {
    const text = entry.status === 'completed' ? '视频已完成'
      : /费用|结算/.test(entry.stage || '') ? '视频已完成 · 费用待结算' : '视频已生成，正在核对最终状态'
    return entry.pollError && entry.status !== 'completed' ? `${text} · ${entry.pollError}` : text
  }
  if (entry.status === 'unknown') return entry.error || '提交结果待确认'
  if (entry.status === 'submitting') return '正在提交到中转站'
  if (entry.status === 'completed') return '视频已完成'
  const stage =
    entry.stage || (entry.providerStatus === 'persisting' ? '正在保存视频' : '中转站生成中')
  const progress = entry.progress == null || entry.progress === '' ? NaN : Number(entry.progress)
  const percentage =
    Number.isFinite(progress) && progress >= 0 && progress <= 100 ? ` ${progress}%` : ''
  const text = `${stage}${stage === '正在保存视频' ? '' : percentage}`
  return entry.pollError ? `${text} · ${entry.pollError}` : text
}

export function pickImage(shot, id) {
  if (shot.imageId === id) return
  shot.imageId = id
  shot.approvedImageId = ''
}

export function removeReference(workflow, id) {
  workflow.references = workflow.references.filter((item) => item.id !== id)
  workflow.shots.forEach((shot) => {
    shot.referenceIds = shot.referenceIds.filter((value) => value !== id)
    if (shot.lastFrameImageId === id) shot.lastFrameImageId = ''
  })
}
