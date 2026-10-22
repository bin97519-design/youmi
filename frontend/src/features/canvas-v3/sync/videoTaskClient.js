import { imageTaskResult } from './imageTaskClient.js'
import {
  isSeedance25Model,
  isMinimaxH3Model,
  isSeedance20AnciModel,
  videoModelControls,
} from '../config/videoModelParameters.js'
import { collectVideoInputMedia, deriveVideoInputMode } from '../config/videoInputMode.js'
import { isKlingOmniApiModel } from '../config/klingOmniIdentity.js'
import { klingOmniTaskRequest } from './klingOmniTaskRequest.js'
import { isWanxiangModel } from '../config/wanxiangParameters.js'
import { wanxiangTaskRequest } from './wanxiangTaskRequest.js'

const ratios = new Set(['Auto', 'adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])

export function videoTaskRequest(node, references = [], clientTaskId, modelOption) {
  const data = node.data
  const model = modelOption || data.model
  if (isWanxiangModel(model) || isWanxiangModel(data.model))
    return wanxiangTaskRequest(node, references, clientTaskId, modelOption)
  if (isKlingOmniApiModel(model) || isKlingOmniApiModel(data.model))
    return klingOmniTaskRequest(node, references, clientTaskId, modelOption)
  const seedance = isSeedance25Model(model)
  const h3 = isMinimaxH3Model(model)
  const anci = isSeedance20AnciModel(model)
  if (!seedance && !h3 && !anci) throw new Error('该视频模型尚未接入生成服务')
  const modelLabel = anci ? 'Seedance 2.0 按次' : h3 ? 'MiniMax H3' : 'Seedance 2.5'
  const input = deriveVideoInputMode(model, references)
  if (input.error) throw new Error(input.error)
  const mode = input.mode
  const profile = videoModelControls(model, mode)
  const params = { ...profile.defaults, ...data.params }
  const resolution = String(params.resolution).toUpperCase()
  if (!profile.fields.resolution[1].includes(resolution))
    throw new Error(`${modelLabel} 不支持所选清晰度`)
  if (
    !Number.isInteger(params.duration) ||
    params.duration < 4 ||
    params.duration > profile.durationMax
  )
    throw new Error(`视频时长必须是 4～${profile.durationMax} 的整数秒`)
  if (!ratios.has(params.ratio)) throw new Error('请选择有效的视频比例')
  if (anci && !profile.fields.ratio[1].includes(params.ratio))
    throw new Error('Seedance 2.0 按次仅支持 16:9、9:16、1:1、4:3、3:4 比例')
  if (anci && !profile.fields.version[1].includes(params.version))
    throw new Error('Seedance 2.0 按次速度版本必须选择快速或标准')
  const assets = { image: [], video: [], audio: [] }
  for (const item of collectVideoInputMedia(references)) {
    assets[item.kind].push({ url: item.url, durationSeconds: item.durationSeconds })
  }
  const prompt = [
    data.prompt?.trim(),
    ...references
      .filter((ref) => {
        const source = ref?.data || ref
        return ['text', 'reference', 'script'].includes(source?.kind) && source.prompt?.trim()
      })
      .map((ref) => {
        const source = ref.data || ref
        return `${source.title || '参考文本'}：\n${source.prompt.trim()}`
      }),
  ]
    .filter(Boolean)
    .join('\n\n')
  const hasMedia = input.hasMedia
  if (!prompt && (h3 || anci || !hasMedia)) throw new Error('请输入视频提示词或连接文本节点')
  if (prompt.length > (h3 ? 7000 : 12000))
    throw new Error(`视频提示词不能超过 ${h3 ? 7000 : 12000} 字`)
  const frames = input.frames
  const images = assets.image.map((item) => item.url)
  const videos = assets.video
  const audios = assets.audio.map((item) => item.url)
  // Only Seedance 2.5 single-image first-frame tasks require adaptive. Two-image
  // first/last tasks and the H3 media API preserve the selected aspect ratio.
  const ratio =
    seedance && input.id === 'first-frame'
      ? 'adaptive'
      : ['Auto', 'adaptive'].includes(params.ratio)
        ? 'adaptive'
        : params.ratio
  return {
    model: data.model,
    prompt,
    parameter_profile: anci
      ? 'canvas-v3-seedance20-anci'
      : seedance
        ? 'canvas-v3-seedance25'
        : 'canvas-v3-minimax-h3',
    ratio,
    durationSeconds: params.duration,
    resolution: seedance || anci ? resolution.toLowerCase() : resolution,
    ...(frames && images.length
      ? { first_frame_url: images[0], ...(images[1] ? { last_frame_url: images[1] } : {}) }
      : {}),
    reference_image_urls: frames ? [] : images,
    reference_videos: videos,
    reference_audios: audios,
    ...(anci
      ? { mode: 'cankaosheng', version: params.version }
      : seedance
        ? { web_search: data.switches?.['联网搜索'] === true }
        : { mode: frames || !hasMedia ? 'shouweizhen' : 'cankaosheng' }),
    client_task_id: clientTaskId,
    feature_code: 'canvas-video',
  }
}

export function videoTaskResult(payload) {
  return {
    ...imageTaskResult({
      ...payload,
      imageUrls: payload?.videoUrls || payload?.video_urls || [],
      persistStatus: payload?.status === 'persisting' ? 'pending' : '',
    }),
    stage: payload?.stage || '',
  }
}

// Separate endpoints and adapter keep the legacy image/video callers untouched.
export function createVideoTaskClient({
  fetcher = fetch,
  path = (value) => value,
  headers = () => ({}),
} = {}) {
  async function request(url, options = {}) {
    const mutation = options.method === 'POST'
    let response
    try {
      response = await fetcher(path(url), {
        ...options,
        headers: { ...headers(), ...options.headers },
        signal: AbortSignal.timeout(120000),
      })
    } catch (cause) {
      const error = new Error('视频服务连接中断，请继续查询原任务，避免重复提交')
      error.deliveryUnknown = mutation
      error.cause = cause
      throw error
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || (payload.code != null && payload.code !== 0)) {
      const error = new Error(payload?.message || `视频接口暂不可用（${response.status}）`)
      error.status =
        response.status >= 400 ? response.status : Number(payload?.code) || response.status
      const retrySafe =
        payload?.retry_safe === true ||
        payload?.data?.retry_safe === true ||
        String(payload?.phase || payload?.data?.phase || '').toLowerCase() === 'pre_dispatch'
      error.deliveryUnknown =
        mutation &&
        !retrySafe &&
        (response.ok || [408, 409].includes(response.status) || response.status >= 500)
      throw error
    }
    return payload.data ?? payload
  }
  return {
    models: () => request('/api/video-tasks/canvas-models'),
    create: (body) =>
      request('/api/video-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id) => request('/api/video-tasks/' + encodeURIComponent(id)),
    resolve: (id) =>
      request('/api/video-tasks/by-client-task-id?client_task_id=' + encodeURIComponent(id)),
  }
}
