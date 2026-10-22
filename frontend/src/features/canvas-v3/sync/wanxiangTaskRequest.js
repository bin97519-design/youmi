import {
  WANXIANG_MODEL,
  isWanxiangModel,
  wanxiangControls,
  wanxiangParams,
} from '../config/wanxiangParameters.js'
import { wanxiangReferenceState } from '../config/wanxiangReferences.js'

// A display name is never a credential. Only exact API identities returned by
// the managed model endpoint can be selected as concrete generation routes.
export function resolveWanxiangRoute(selection, configured = []) {
  const selected = typeof selection === 'object' ? selection?.value : selection
  const choices = configured.filter((option) => option?.value && isWanxiangModel(option))
  const explicit = choices.find((option) => option.value === selected)
  if (explicit) return explicit
  if (!isWanxiangModel(selection))
    throw new Error('所选万相 3.0 全能线路已失效，请在模型列表中重新选择')
  if (!choices.length)
    throw new Error(
      `万相 3.0 全能尚未配置对应接口 ${WANXIANG_MODEL}，请在模型管理中配置并绑定画布视频功能`,
    )
  if (choices.length > 1) throw new Error('万相 3.0 全能配置了多条线路，请在模型列表中明确选择一条')
  return choices[0]
}

function activeParams(rawParams) {
  const raw =
    rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {}
  for (const field of wanxiangControls().fields) {
    if (!Object.hasOwn(raw, field.key) || raw[field.key] == null) continue
    let value = raw[field.key]
    if (field.key === 'duration' && typeof value === 'number') value = String(value)
    if (['audio', 'prompt_extend'].includes(field.key) && ['true', 'false'].includes(value))
      value = value === 'true'
    if (!field.options.some((option) => option.value === value))
      throw new Error(`万相 3.0 全能${field.label}参数无效，请按接口支持的选项重新选择`)
  }
  return wanxiangParams(raw)
}

function textPrompt(data, references) {
  return [
    typeof data.prompt === 'string' ? data.prompt.trim() : '',
    ...references.flatMap((reference) => {
      const source = reference?.data || reference
      if (
        !['text', 'reference', 'script'].includes(source?.kind) ||
        typeof source.prompt !== 'string' ||
        !source.prompt.trim()
      )
        return []
      return [`${source.title || '参考文本'}：\n${source.prompt.trim()}`]
    }),
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Local data images are allowed only while the task store prepares/uploads
// them. It replaces BOTH image URL lists before the sole POST boundary.
export function wanxiangTaskRequest(node, references = [], clientTaskId, modelOption) {
  const data = node?.data || {}
  if (!isWanxiangModel(modelOption || data.model))
    throw new Error('所选视频模型与万相 3.0 全能参数配置不匹配')
  if (
    typeof data.model !== 'string' ||
    !data.model.trim() ||
    data.model.trim() === '万相 3.0' ||
    (!modelOption?.value && !isWanxiangModel(data.model)) ||
    (modelOption?.value && modelOption.value !== data.model)
  )
    throw new Error('请选择模型管理中已配置并绑定画布视频的万相 3.0 全能线路')
  const refs = Array.isArray(references) ? references : []
  const params = activeParams(data.params)
  const state = wanxiangReferenceState(refs, params)
  if (state.errors.length) throw new Error(state.errors.join('；'))
  const prompt = textPrompt(data, refs)
  if (!prompt && !state.hasMedia) throw new Error('请输入视频提示词或连接参考素材、文本节点')
  if (state.media.some((item) => item.kind === 'image' && item.url.startsWith('blob:')))
    throw new Error('本地参考图片尚待上传，请先上传图片再生成')
  const images = state.media.filter((item) => item.kind === 'image').map((item) => item.url)
  const videos = state.media
    .filter((item) => item.kind === 'video')
    .map(({ url, durationSeconds }) => ({ url, durationSeconds }))
  const audios = state.media
    .filter((item) => item.kind === 'audio')
    .map(({ url, durationSeconds }) => ({ url, durationSeconds }))
  const notify = data.notify_url ?? data.webhook_url
  return {
    model: data.model,
    prompt,
    parameter_profile: 'canvas-v3-wanxiang30',
    wanxiang_params: {
      ...params,
      ...(images.length ? { image_url: images } : {}),
      ...(videos.length ? { video_url: videos.map((item) => item.url) } : {}),
      ...(audios.length ? { audio_url: audios.map((item) => item.url) } : {}),
    },
    reference_image_urls: images,
    reference_videos: videos,
    reference_audios: audios.map((item) => item.url),
    reference_audio_media: audios,
    ...(typeof notify === 'string' && notify.trim() ? { webhook_url: notify.trim() } : {}),
    client_task_id: clientTaskId,
    feature_code: 'canvas-video',
  }
}

export function assertWanxiangRequestReady(request) {
  for (const field of ['image_url', 'video_url', 'audio_url']) {
    for (const value of request.wanxiang_params?.[field] || []) {
      let valid = false
      try {
        const url = new URL(value)
        valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      } catch {
        // Never let an incomplete upload/data/blob URL cross the POST boundary.
      }
      if (!valid) throw new Error('万相参考素材上传未完成，需要可访问的 HTTP(S) 地址')
    }
  }
}
