import {
  isMinimaxH3Model,
  isSeedance25Model,
  isSeedance20AnciModel,
} from './videoModelParameters.js'

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
const LIMITS = {
  seedance: Object.freeze({ image: 30, video: 10, audio: 10 }),
  h3: Object.freeze({ image: 9, video: 3, audio: 3 }),
  seedanceAnci: Object.freeze({ image: 9, video: 0, audio: 0 }),
}

/**
 * Incoming graph edge order is the media order. Duplicate edges to one source
 * are removed, but two separate image nodes with the same URL remain two
 * frames (for example a loop whose first and last images intentionally match).
 */
export function collectVideoInputMedia(references = []) {
  const result = []
  const ids = new Set()
  const objects = new WeakSet()
  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference || typeof reference !== 'object') continue
    const data = reference.data || reference
    if (!MEDIA_KINDS.has(data.kind)) continue
    const nodeId = reference.id || reference.nodeId || data.nodeId
    if (nodeId != null && String(nodeId)) {
      const key = String(nodeId)
      if (ids.has(key)) continue
      ids.add(key)
    } else {
      if (objects.has(reference)) continue
      objects.add(reference)
    }
    result.push({
      kind: data.kind,
      url: data.assetUrl ?? data.url ?? '',
      durationSeconds:
        data.mediaDuration ?? data.durationSeconds ?? data.generation?.params?.duration,
      ...(nodeId != null && String(nodeId) ? { nodeId: String(nodeId) } : {}),
    })
  }
  return result
}

function mediaError(media) {
  for (const item of media) {
    if (typeof item.url !== 'string' || !item.url.trim())
      return '连接的参考素材尚未就绪，请先生成或上传素材'
    if (
      item.kind === 'image' &&
      /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-zA-Z0-9+/]+={0,2}$/i.test(item.url)
    )
      continue
    try {
      const url = new URL(item.url)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) continue
    } catch {
      /* Report the same visible validation error for malformed and unsupported URLs. */
    }
    return '参考素材需要可访问的 HTTP(S) 地址，图片也可从本地上传'
  }
  return ''
}

/** Infer the native role family from actual connected media, never a saved UI mode. */
export function deriveVideoInputMode(model, references = []) {
  const seedance = isSeedance25Model(model)
  const anci = isSeedance20AnciModel(model)
  const h3 = isMinimaxH3Model(model)
  const media = collectVideoInputMedia(references)
  const counts = { image: 0, video: 0, audio: 0 }
  for (const item of media) counts[item.kind] += 1
  const multimodal = counts.video > 0 || counts.audio > 0
  const hasMedia = media.length > 0
  const frames = !anci && !multimodal && counts.image > 0 && counts.image <= 2
  const id = multimodal
    ? 'multimodal'
    : !counts.image
      ? 'text'
      : anci
        ? 'reference-image'
        : counts.image === 1
          ? 'first-frame'
          : counts.image === 2
            ? 'first-last'
            : 'reference-image'
  const mode = !hasMedia
    ? '文生视频'
    : anci
      ? '图片参考'
      : h3
        ? frames
          ? '首尾帧'
          : '参考生'
        : multimodal
          ? '全能参考'
          : counts.image === 1
            ? '图生视频'
            : counts.image === 2
              ? '首尾帧'
              : '图片参考'
  const limits = anci ? LIMITS.seedanceAnci : h3 ? LIMITS.h3 : LIMITS.seedance
  let error = !seedance && !h3 && !anci ? '该视频模型尚未接入生成服务' : mediaError(media)
  if (!error && anci && multimodal)
    error = 'Seedance 2.0 按次仅支持 0～9 张参考图片，不支持参考视频或音频'
  if (!error && Object.entries(limits).some(([kind, limit]) => counts[kind] > limit))
    error = anci
      ? 'Seedance 2.0 按次最多支持 9 张参考图片，不支持首尾帧'
      : h3
        ? 'H3 最多支持 2 张首尾帧，或 9 张参考图、3 个视频、3 段音频'
        : 'Seedance 2.5 最多支持 30 张参考图、10 个视频、10 段音频'
  return {
    id,
    mode,
    frames,
    hasMedia,
    counts,
    limits: { ...limits },
    supported: seedance || h3 || anci,
    error,
  }
}
