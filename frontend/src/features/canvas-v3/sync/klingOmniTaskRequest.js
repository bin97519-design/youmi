import { klingOmniApiModelForMode, klingOmniModeForModel } from '../config/klingOmniIdentity.js'
import { klingOmniControls, klingOmniParams } from '../config/klingOmniParameters.js'
import {
  collectKlingOmniReferences,
  klingOmniReferenceState,
} from '../config/klingOmniReferences.js'

function textPrompt(data, references) {
  const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : ''
  return [
    prompt,
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

function activeParams(mode, rawParams) {
  const raw =
    rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {}
  const profile = klingOmniControls(mode, raw)
  for (const field of profile.fields) {
    if (!Object.hasOwn(raw, field.key) || raw[field.key] == null) continue
    const value =
      field.key === 'duration' && typeof raw[field.key] === 'number'
        ? String(raw[field.key])
        : raw[field.key]
    if (!field.options.some((option) => option.value === value))
      throw new Error(
        `可灵-Omni ${field.label}必须选择${field.options.map((option) => option.label).join(' / ')}`,
      )
  }
  return klingOmniParams(mode, raw)
}

function actualDuration(data) {
  const raw = data.mediaDuration ?? data.durationSeconds
  if (raw == null || raw === '' || typeof raw === 'boolean') return undefined
  const duration = Number(raw)
  return Number.isFinite(duration) && duration > 0 ? duration : undefined
}

// The store resolves a concrete provider route and uploads local image data
// before POST. This pure adapter validates intent and media without doing either.
export function klingOmniTaskRequest(node, references = [], clientTaskId, modelOption) {
  const data = node?.data || {}
  const refs = Array.isArray(references) ? references : []
  const mode = data.mode
  if (!klingOmniApiModelForMode(mode)) throw new Error('请选择可灵-Omni的视频生成模式')
  const routeMode = klingOmniModeForModel(modelOption || data.model)
  const directMode = klingOmniModeForModel(data.model)
  if (!routeMode || routeMode !== mode || (directMode && directMode !== mode))
    throw new Error('所选可灵-Omni线路与视频生成模式不匹配，请重新选择对应模式')
  if (typeof data.model !== 'string' || !data.model.trim())
    throw new Error('请选择已配置的可灵-Omni生成线路')

  const state = klingOmniReferenceState(mode, refs)
  if (state.errors.length) throw new Error(state.errors.join('；'))
  const media = collectKlingOmniReferences(refs)
  if (
    media.some(
      (item) => item.kind === 'image' && (item.assetUrl ?? item.url ?? '').startsWith('blob:'),
    )
  )
    throw new Error('本地参考图片尚待上传，请先上传图片再生成')
  const prompt = textPrompt(data, refs)
  if (!prompt && mode === '参考生' && !state.counts.image)
    throw new Error('请输入视频提示词或连接文本节点')

  return {
    model: data.model,
    prompt,
    parameter_profile: 'canvas-v3-kling-omni',
    omni_params: activeParams(mode, data.params),
    reference_image_urls: media
      .filter((item) => item.kind === 'image')
      .map((item) => item.assetUrl ?? item.url),
    reference_videos: media
      .filter((item) => item.kind === 'video')
      .map((item) => {
        const durationSeconds = actualDuration(item)
        return {
          url: item.assetUrl ?? item.url,
          ...(durationSeconds != null ? { durationSeconds } : {}),
        }
      }),
    reference_audios: [],
    client_task_id: clientTaskId,
    feature_code: 'canvas-video',
  }
}
