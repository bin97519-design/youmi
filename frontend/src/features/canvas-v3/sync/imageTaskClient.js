import { imageEditInstructions } from '../config/imageEditPresets.js'
import { imageStyleInstructions } from '../config/styleGallery.js'
import {
  imageCustomSize,
  imageModelControls,
  imageModelParams,
} from '../config/imageModelParameters.js'
import {
  IMAGE_MODEL_VERSIONS,
  IMAGE_MODEL_QUALITIES,
  imageModelVersion,
  isTtImage25Model,
} from '../config/imageModelVersions.js'

const SUCCESS = new Set([
  'completed',
  'succeeded',
  'success',
  'done',
  'finished',
  'generated',
  'ready',
  'persisting',
])
const FAILURE = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired', 'aborted'])

export function imageTaskResult(payload) {
  const status = String(payload?.status || '').toLowerCase()
  const urls = [
    ...new Set(
      (payload?.imageUrls || payload?.image_urls || []).filter(
        (url) => typeof url === 'string' && url,
      ),
    ),
  ]
  const progress = payload?.progress == null ? null : Number(payload.progress)
  return {
    state: FAILURE.has(status)
      ? 'failed'
      : SUCCESS.has(status) && urls.length
        ? 'succeeded'
        : /queue|pending/.test(status)
          ? 'queued'
          : 'running',
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(99, Math.round(progress))) : null,
    urls,
    error: payload?.error || '',
    persistStatus: payload?.persistStatus || '',
    persistPending: /pending|persisting|processing/i.test(payload?.persistStatus || ''),
  }
}

// A failed status query is not proof that generation failed. Keep the original
// task ID so recovery never turns a 404/auth/transport error into a new POST.
export function imageTaskQueryFailure(error, taskId) {
  const status = Number(error?.status) || 0
  const missing = status === 404
  const auth = status === 401 || status === 403
  return {
    taskId,
    state: 'unavailable',
    progress: null,
    urls: [],
    error: '',
    queryIssue: missing ? 'missing' : auth ? 'auth' : 'temporary',
    queryMessage: missing
      ? '任务记录未找到（404），请继续查询原任务，不要重复生成'
      : auth
        ? '登录状态失效，请重新登录后继续查询原任务'
        : `任务状态查询暂时失败${status ? `（${status}）` : ''}，正在重试原任务`,
    retryable: !missing && !auth,
    persistPending: false,
  }
}

export function imageTaskBatchResult(results, previousProgress = null) {
  const terminal =
    results.length > 0 &&
    results.every(
      (result) =>
        ['failed', 'succeeded'].includes(result.state) ||
        (result.state === 'unavailable' && !result.retryable),
    )
  const urls = [...new Set(results.flatMap((result) => result.urls))]
  const errors = results
    .filter((result) => result.state === 'failed')
    .map((result) => result.error || '生成失败')
  const known = results.map((result) => (result.state === 'succeeded' ? 100 : result.progress))
  const unresolved = results.filter((result) => result.queryIssue)
  const queryMessages = [...new Set(unresolved.map((result) => result.queryMessage))]
  return {
    state: terminal
      ? urls.length
        ? 'succeeded'
        : unresolved.length
          ? 'blocked'
          : 'failed'
      : results.every((result) => result.state === 'queued')
        ? 'queued'
        : 'running',
    progress:
      terminal && urls.length
        ? 100
        : known.length && known.every((value) => value != null)
          ? Math.floor(known.reduce((sum, value) => sum + value, 0) / known.length)
          : previousProgress,
    urls,
    error: errors.length ? (urls.length ? '部分图片生成失败：' : '') + errors.join('；') : '',
    unresolvedTaskIds: unresolved.map((result) => result.taskId).filter(Boolean),
    queryMessage: queryMessages.length
      ? `${urls.length ? `已返回 ${urls.length} 张图片；` : ''}${queryMessages.join('；')}`
      : '',
    persistPending: results.some((result) => result.persistPending),
  }
}

export function imageModelOptions(options = []) {
  const seen = new Map()
  let gptIndex = 0
  for (const item of options) {
    const value = String(item.value || '').trim()
    if (!value) continue
    const label = String(item.label || value)
    const normalized = value.toLowerCase()
    let mapped = value
    if (normalized === 'banana-pro') mapped = 'banana-pro-api'
    if (['gpt-image2.5', 'tt-image-2.5', 'gpt-image-2.5'].includes(normalized)) {
      mapped =
        /高质|high|sunburst/i.test(label) || (!/快速|fast/i.test(label) && gptIndex > 0)
          ? 'gpt-image2.5-sunburst-api'
          : 'GPT-image2.5'
      gptIndex += 1
    }
    seen.set(mapped, { ...item, value: mapped, label })
  }
  return [...seen.values()]
}

export function imageTaskRequest(node, references, clientTaskId, modelOption) {
  const rawParams = node.data.params || {}
  const model = modelOption || node.data.model
  const profile = imageModelControls(model)
  const params = imageModelParams(model, rawParams)
  if (
    isTtImage25Model(model) &&
    rawParams.version != null &&
    !IMAGE_MODEL_VERSIONS.some((version) => version.value === rawParams.version)
  )
    throw new Error('请选择有效的 TT Image 2.5 版本：标准版或增强版')
  const version = imageModelVersion(model, params.version)
  const isTt = isTtImage25Model(model)
  const qualitySelection = rawParams.quality ?? '标准画质'
  const quality =
    IMAGE_MODEL_QUALITIES.find(
      (option) => option.label === qualitySelection || option.value === qualitySelection,
    )?.value || (qualitySelection === 'auto' ? 'auto' : undefined)
  if (isTt && !quality) throw new Error('请选择有效的 image-2.5 画质')
  const backgroundSelection = rawParams.background ?? '自动'
  const background =
    { 自动: 'auto', 保留背景: 'opaque', 透明背景: 'transparent' }[backgroundSelection] ||
    (['auto', 'opaque', 'transparent'].includes(backgroundSelection)
      ? backgroundSelection
      : undefined)
  if (isTt && !background) throw new Error('请选择有效的 image-2.5 背景')
  if (
    profile.id === 'banana-2.1' &&
    rawParams.thinkingLevel != null &&
    !['快速', '深度', 'minimal', 'high'].includes(rawParams.thinkingLevel)
  )
    throw new Error('请选择有效的 banana-2.1 思考等级')
  const texts = references.filter(
    (ref) => ['text', 'reference'].includes(ref.data.kind) && ref.data.prompt?.trim(),
  )
  const prompt = [
    imageEditInstructions(node.data),
    imageStyleInstructions(node.data),
    node.data.prompt?.trim(),
    ...texts.map((ref) => `${ref.data.title}：\n${ref.data.prompt}`),
  ]
    .filter(Boolean)
    .join('\n\n')
  if (!prompt) throw new Error('请输入提示词或连接文本节点')
  if (!node.data.model) throw new Error('请选择已接入的图片模型')
  if (prompt.length > 12000) throw new Error('提示词与引用文本合计不能超过 12000 字')
  const imageUrls = [
    ...new Set(
      references
        .filter((ref) => ref.data.kind === 'image' && ref.data.assetUrl)
        .map((ref) => ref.data.assetUrl),
    ),
  ]
  if (['banana-2.1', 'banana-pro'].includes(profile.id) && imageUrls.length > 14)
    throw new Error(`${profile.id} 最多支持 14 张参考图，请减少引用后再生成`)
  return {
    prompt,
    model: node.data.model,
    ...(version ? { version } : {}),
    // Only this V3 client opts in; old canvas callers retain their protocol.
    ...(profile.id !== 'generic' ? { parameter_profile: 'canvas-v3-image' } : {}),
    ...(isTt
      ? { quality, background, output_format: background === 'transparent' ? 'png' : undefined }
      : {}),
    ...(isTt && node.data.switches?.['自定义尺寸'] === true
      ? { custom_size: imageCustomSize(rawParams.customSize) }
      : {}),
    ...(profile.id === 'banana-2.1'
      ? {
          thinking_level: params.thinkingLevel === '深度' ? 'high' : 'minimal',
          web_search: node.data.switches?.['联网搜索'] !== false,
        }
      : {}),
    size: params.ratio === 'Auto' ? 'auto' : params.ratio || '16:9',
    resolution: params.resolution || '2K',
    n: 1,
    image_urls: imageUrls,
    client_task_id: clientTaskId,
    feature_code: 'canvas-image',
  }
}

export function createImageTaskClient({
  fetcher = fetch,
  path = (value) => value,
  headers = () => ({}),
} = {}) {
  async function request(url, options = {}) {
    let response
    const mutation = String(options.method || 'GET').toUpperCase() !== 'GET'
    try {
      response = await fetcher(path(url), {
        ...options,
        headers: { ...headers(), ...options.headers },
        signal: options.signal || AbortSignal.timeout(60000),
      })
    } catch (cause) {
      const error = new Error('生成服务连接中断，请继续查询原任务')
      error.deliveryUnknown = mutation
      error.cause = cause
      throw error
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || (payload.code != null && payload.code !== 0)) {
      const error = new Error(payload?.message || `图片接口暂不可用（${response.status}）`)
      error.status =
        response.status >= 400 ? response.status : Number(payload?.code) || response.status
      const retrySafe =
        payload?.retry_safe === true ||
        payload?.data?.retry_safe === true ||
        String(payload?.phase || payload?.data?.phase || '').toLowerCase() === 'pre_dispatch'
      const ambiguousSuccessfulMutation =
        mutation && response.ok && (!payload || (payload.code != null && payload.code !== 0))
      error.deliveryUnknown =
        mutation &&
        !retrySafe &&
        (ambiguousSuccessfulMutation ||
          response.status === 409 ||
          response.status === 408 ||
          response.status >= 500)
      throw error
    }
    return payload.data ?? payload
  }
  return {
    models: () => request('/api/image-tasks/canvas-models'),
    status: () => request('/api/image-tasks/status'),
    create: (body) =>
      request('/api/image-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id) => request('/api/image-tasks/' + encodeURIComponent(id)),
    resolve: (id) =>
      request('/api/image-tasks/by-client-task-id?client_task_id=' + encodeURIComponent(id)),
  }
}
