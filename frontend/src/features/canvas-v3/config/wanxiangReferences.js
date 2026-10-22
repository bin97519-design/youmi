import { wanxiangControls } from './wanxiangParameters.js'

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-zA-Z0-9+/]+={0,2}$/i
const EPSILON = 1e-9

function actualDuration(value) {
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null
  if (!['number', 'string'].includes(typeof value)) return null
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : null
}

// Edge order controls per-type numbering (图1/视频1/音频1). Repeated links to a
// single node collapse, while distinct nodes with the same URL remain distinct.
export function collectWanxiangReferences(references = []) {
  const media = []
  const ids = new Set()
  const objects = new WeakSet()
  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference || typeof reference !== 'object') continue
    const data = reference.data || reference
    if (!MEDIA_KINDS.has(data.kind)) continue
    const id = reference.id ?? reference.nodeId ?? data.nodeId
    if (id != null && String(id)) {
      if (ids.has(String(id))) continue
      ids.add(String(id))
    } else {
      if (objects.has(reference)) continue
      objects.add(reference)
    }
    media.push({
      kind: data.kind,
      url: data.assetUrl ?? data.url ?? '',
      ...(data.kind !== 'image'
        ? { durationSeconds: actualDuration(data.mediaDuration ?? data.durationSeconds) }
        : {}),
      ...(id != null && String(id) ? { nodeId: String(id) } : {}),
    })
  }
  return media
}

function inspectUrl(item, errors, warnings) {
  const label = item.kind === 'image' ? '参考图片' : item.kind === 'video' ? '参考视频' : '参考音频'
  if (typeof item.url !== 'string' || !item.url.trim()) {
    errors.push(`连接的${label}尚未就绪，请先生成或上传素材`)
    return
  }
  if (item.kind === 'image' && (IMAGE_DATA_URL.test(item.url) || item.url.startsWith('blob:'))) {
    warnings.push('本地参考图片尚待上传，生成前需转换为可访问的图片地址')
    return
  }
  try {
    const parsed = new URL(item.url)
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
      return
  } catch {
    // Malformed, local and credential-bearing URLs get the same visible error.
  }
  errors.push(`${label}需要可访问的 HTTP(S) 地址`)
}

// No network access: known actual metadata is mandatory for timed references.
// generation.params.duration is a requested length, not proof of media length.
export function wanxiangReferenceState(references = [], params = {}) {
  const media = collectWanxiangReferences(references)
  const counts = { image: 0, video: 0, audio: 0 }
  const limits = { image: 10, video: 5, audio: 5 }
  const errors = []
  const warnings = []
  const durations = { video: 0, audio: 0 }
  const known = { video: true, audio: true }
  for (const item of media) {
    counts[item.kind] += 1
    inspectUrl(item, errors, warnings)
    if (item.kind !== 'image') {
      if (item.durationSeconds == null) {
        known[item.kind] = false
        errors.push(
          `尚未读取参考${item.kind === 'video' ? '视频' : '音频'}的实际时长，请先读取媒体信息`,
        )
      } else durations[item.kind] += item.durationSeconds
    }
  }
  if (counts.image > limits.image) errors.push('万相 3.0 全能最多支持10张参考图片')
  if (counts.video > limits.video) errors.push('万相 3.0 全能最多支持5段参考视频')
  if (counts.audio > limits.audio) errors.push('万相 3.0 全能最多支持5段参考音频')
  if (durations.video > 15 + EPSILON) errors.push('参考视频总时长不能超过15秒')
  if (durations.audio > 15 + EPSILON) errors.push('参考音频总时长不能超过15秒')
  const rawDuration = params?.duration
  const duration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration)
  if (
    known.video &&
    Number.isInteger(duration) &&
    duration >= 2 &&
    duration <= 30 &&
    duration + durations.video > 30 + EPSILON
  )
    errors.push('成片时长与参考视频总时长合计不能超过30秒')
  const maxOutputDurationSeconds = known.video
    ? Math.max(0, Math.floor(30 - durations.video + EPSILON))
    : null
  if (rawDuration === 'auto')
    warnings.push(
      counts.video && known.video
        ? `智能时长由模型决定，成片与参考视频合计须不超过30秒；当前成片最多${maxOutputDurationSeconds}秒`
        : '智能时长由模型决定，先按30秒预扣，生成后按实际时长多退少补',
    )
  const uniqueErrors = [...new Set(errors)]
  return {
    id: 'omni',
    mode: '全能参考',
    frames: false,
    supported: true,
    hasMedia: media.length > 0,
    media,
    counts,
    limits,
    assetLimits: wanxiangControls().assetLimits,
    errors: uniqueErrors,
    warnings: [...new Set(warnings)],
    error: uniqueErrors[0] || '',
    videoDurationSeconds: known.video ? durations.video : null,
    audioDurationSeconds: known.audio ? durations.audio : null,
    maxOutputDurationSeconds,
  }
}
