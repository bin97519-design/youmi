import { MAX_REFERENCE_SHOTS } from './referenceVideo.js'
import {
  continuityEnabled,
  planningContinuityReferences,
  productReferenceUrls,
  imageContinuityReferences,
} from './productVideoContinuity.js'

export const productVideoShotLimit = (workflow) =>
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
]
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9']
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
export const isRetiredVideoModel = (model) => model === 'minimax-h3-max'
export const isAnmiao20FastVideoModel = (model) =>
  String(model || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').includes('doubao-seedance-2-0-fast')
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
  model === ANMIAO25_VIDEO_MODEL || String(model || '').toLowerCase().includes('seedance-2.5-guanfang-anmiao')
export const isPerSecondVideoModel = (model) =>
  [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(model) ||
  isAnmiao20FastVideoModel(model) ||
  String(model || '').toLowerCase().includes('seedance-2.0-guanfang-anmiao') ||
  isAnmiao25VideoModel(model)
export const WHOLE_VIDEO_30_MODELS = [
  { value: WHOLE_VIDEO_30_MODEL, label: 'SD2.5 整片 30 秒' },
  { value: ANMIAO25_VIDEO_MODEL, label: 'SD2.5 满血按秒 · 30 秒' },
]
export const isWholeVideo = (mode) => ['single_video', 'single_video_30'].includes(mode)
export const generationDuration = (shot, workflow) => {
  if (shot.productionMode === 'single_video_30') return 30
  if (shot.referenceRange && isPerSecondVideoModel(workflow?.videoModel))
    return Math.max(4, Math.ceil(Number(shot.duration) - 0.000001))
  if (!isWholeVideo(shot.productionMode) && isPerSecondVideoModel(workflow?.videoModel))
    return Number(workflow.videoDurationSeconds ?? 15)
  return 15
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
    productionMode: 'storyboard',
    timelineCount: 4,
    generateAudio: false,
    keepOriginalAudio: false,
    brief: '',
    references: [],
    shots: [],
    ratio: '16:9',
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
    id: uid(),
    title: title.trim().slice(0, 80) || '未命名任务',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function productVideoTaskState(task, activity = '') {
  if (activity === 'plan' || isPlanRunning(task.planJob)) return 'planning'
  if (activity === 'compose' || ['queued', 'processing'].includes(task.composition?.status))
    return 'generating'
  const latest = task.shots
    .flatMap((shot) => [shot.images.at(-1), shot.videos.at(-1)])
    .filter(Boolean)
  if (latest.some((item) => ['submitting', 'processing'].includes(item.status))) return 'generating'
  if (task.planJob?.status === 'unknown' || latest.some((item) => item.status === 'unknown'))
    return 'unknown'
  if (
    task.planJob?.status === 'failed' ||
    task.composition?.status === 'failed' ||
    latest.some((item) => item.status === 'failed')
  )
    return 'failed'
  if (
    task.composition?.status === 'completed' &&
    task.composition.fingerprint &&
    task.composition.fingerprint === compositionFingerprint(task)
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

export function buildPlanRequest(workflow, count, shot) {
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
  return {
    brief: workflow.brief,
    ...(shared.instruction ? { continuity: shared.instruction } : {}),
    planningModel: workflow.planningModel || 'default',
    images: shared.urls,
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
          duration: shot.duration,
          purpose: shot.purpose || '',
          design: shot.design || '',
          ...(singleVideo ? { productionMode: mode, timeline: shot.timeline || [] } : {}),
        }
      : null,
    contextShots: workflow.shots.map((item) => ({
      title: item.title,
      purpose: item.purpose || '',
      design: item.design || '',
      concept: item.concept || '',
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

export function canGenerateVideo(shot) {
  return Boolean(selectedImage(shot) && shot.approvedImageId === shot.imageId && shot.motion.trim())
}

function productAppearanceConstraint(reference) {
  return `商品外观约束：以${reference}中商品的实际底色、冷暖、饱和度和纹理为准，文字色名或风格冲突时以图为准。光照只改变合理明暗和阴影，不改底色、不偏灰偏褐、不加调色滤镜。特写延续原材质及花纹尺度、位置，禁止新增原图没有的斑驳、印花、粗织纹或金属质感，也不得抹除原有图案；看不清的细节不臆造，保持原图表面观感。`
}

export function buildImageRequest(workflow, shot, clientId) {
  const refs = productReferenceUrls(workflow, shot)
  if (!refs.length) throw new Error('请为这个分镜选择商品参考图或上传固定商品图')
  if (!shot.imagePrompt.trim()) throw new Error('请填写首帧画面')
  const shared = imageContinuityReferences(workflow, shot, refs)
  return {
    model: workflow.imageModel,
    size: workflow.ratio,
    resolution: '2K',
    n: 1,
    output_format: 'png',
    client_task_id: clientId,
    image_urls: shared.urls,
    prompt: `${productAppearanceConstraint('所选商品参考图')}\n\n${shared.instruction}\n\n商品资料（仅供核对商品特征）：${workflow.brief}\n\n当前镜头首帧：\n${normalizePromptLineBreaks(shot.imagePrompt).trim()}\n\n生成要求：生成单张视频起始帧，以当前镜头描述安排人物、场景、构图和光线，不要把后续动作或多个镜头画成拼图。人物出镜时，按描述呈现服装、位置、视线、手部与商品接触前的起始姿势，为下一步动作留出空间。使用参考图中的同一商品，保持颜色、材质、结构、数量、比例和商品自带的品牌标识，不更换或编造品牌。不要额外叠加字幕、营销文案、水印或未经提供的产品功能。`,
  }
}

export function buildVideoRequest(workflow, shot, clientId) {
  if (!canGenerateVideo(shot)) throw new Error('请先确认当前分镜图片')
  const image = selectedImage(shot)
  const singleVideo = isWholeVideo(shot.productionMode)
  const whole30 = shot.productionMode === 'single_video_30'
  const duration = generationDuration(shot, workflow)
  const model = whole30 ? (workflow.wholeVideo30Model ?? WHOLE_VIDEO_30_MODEL) : workflow.videoModel
  if (isRetiredVideoModel(model)) throw new Error('原视频模型已移除，请重新选择视频模型')
  const anmiaoVideo = isPerSecondVideoModel(model)
  const minimax = model === MINIMAX_VIDEO_MODEL
  const anmiao25Video = model === ANMIAO25_VIDEO_MODEL
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
  const timelineCount = Number(shot.timelineCount ?? shot.timeline?.length)
  const countDirection =
    singleVideo && Number.isInteger(timelineCount) && timelineCount >= 1 && timelineCount <= 8
      ? timelineCount === 1
        ? '全片只用一个连续镜头，不切镜、不换场，在同一镜头内完成全部动作。'
        : `全片共 ${timelineCount} 个分镜，严格按时间轴依次呈现，不额外增加、删减或重复分镜。`
      : ''
  const direction = singleVideo
    ? `这是一条完整的 ${duration} 秒电商视频，必须按提示词里的全部时间段完成开场、展示和收尾。需要切换镜头时按策划的衔接执行；明确要求一镜到底时保持连续。不要仅做第一个动作后一直停留。`
    : shot.referenceRange
      ? `本片段对应参考视频第 ${shot.referenceRange.start} 至 ${shot.referenceRange.end} 秒，成片使用 ${shot.duration} 秒。严格在前 ${shot.duration} 秒完成全部动作与转场，之后自然停留；按提示词衔接，不新增剧情。`
      : '单个连续镜头，不换场、不跳切、不突然变焦，动作完成后自然停留。'
  const continuity = singleVideo
    ? `首帧只定义第 0 秒开场，后续按时间轴切换机位和景别，不锁定首帧构图。同一角色再次出镜时保持身份与服装；${continuityEnabled(workflow, shot) ? '固定场景人物已开启，全片不得换房间、换人换装' : '允许按脚本切换场景或角色，不强制同一房间或同一人物'}。商品始终不变。第一段从首帧已有状态开始，不凭空变出或替换人物、商品。`
    : '沿用首帧中的同一人物、服装、商品、场景和光线。动作从首帧已有的姿势和手部位置自然开始，不要凭空增加人物或道具。'
  const audio =
    workflow.generateAudio === true
      ? '\n声音要求：生成与画面同步的音轨，按策划时间轴安排环境声和动作音效，接触、摩擦等声音与实际动作同时发生。仅在策划明确安排说话时生成对白并对齐口型，不额外添加旁白、广告语或背景音乐。'
      : ''
  return {
    prompt: `以提供的首帧图片作为第 0 秒画面。\n${productAppearanceConstraint('已确认首帧')}\n\n${singleVideo ? '整片时间轴与镜头安排' : '当前镜头动作与运镜'}：\n${normalizeVideoPrompt(shot).trim()}\n\n连续性要求：${continuity}保持商品颜色、材质、结构、数量和品牌标识，避免肢体畸变、商品变形和穿模。${direction}${countDirection}不要额外添加字幕、水印或营销文案。${audio}`,
    model,
    ratio: anmiao25Video ? 'adaptive' : workflow.ratio,
    resolution:
      whole30 && !anmiao25Video
        ? '720p'
        : anmiaoVideo
          ? anmiaoResolution
          : model.endsWith('720p')
            ? '720p'
            : '480p',
    durationSeconds: duration,
    ...(whole30 || anmiaoVideo ? {} : { generate_audio: workflow.generateAudio === true }),
    first_frame_url: image.url,
    image_urls: [image.url],
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
    ratio: workflow.ratio,
    musicUrl: workflow.musicUrl,
    musicVolume: Number(workflow.musicVolume),
    ...(workflow.keepOriginalAudio === true ? { keepOriginalAudio: true } : {}),
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

export function videoGenerationNotices(videos = []) {
  const lastPlayable = videos.findLastIndex((entry) => entry.url)
  return videos
    .filter((entry, index) => !entry.url && (entry.status !== 'failed' || index > lastPlayable))
    .slice(-2)
}

export function videoGenerationStatus(entry) {
  if (entry.status === 'failed') return entry.error || '视频生成失败'
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
  })
}
