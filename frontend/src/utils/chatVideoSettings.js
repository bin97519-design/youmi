import {
  ANMIAO_VIDEO_MODEL,
  ANMIAO_VIDEO_RESOLUTIONS,
  ANMIAO25_VIDEO_MODEL,
  ANMIAO25_VIDEO_RESOLUTIONS,
  MINIMAX_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  isRetiredVideoModel,
  isPerSecondVideoModel,
  isAnmiao25VideoModel,
} from './productVideo.js'

const isAnmiao20VideoModel = (model) =>
  model === ANMIAO_VIDEO_MODEL || String(model || '').toLowerCase().includes('seedance-2.0-guanfang-anmiao')

export function videoResolutionForModel(model) {
  if (model === MINIMAX_VIDEO_MODEL) return '768p'
  return isAnmiao20VideoModel(model) || isAnmiao25VideoModel(model) ||
    String(model).endsWith('-720p')
    ? '720p'
    : '480p'
}

export function videoResolutionOptions(model) {
  if (isRetiredVideoModel(model)) return []
  if (model === MINIMAX_VIDEO_MODEL) return MINIMAX_VIDEO_RESOLUTIONS.map((option) => option.value)
  if (isAnmiao20VideoModel(model)) return ANMIAO_VIDEO_RESOLUTIONS.map((option) => option.value)
  if (isAnmiao25VideoModel(model))
    return ANMIAO25_VIDEO_RESOLUTIONS.map((option) => option.value)
  return [videoResolutionForModel(model)]
}

export function videoDurationOptions(model) {
  if (isRetiredVideoModel(model)) return []
  if (isAnmiao20VideoModel(model) || model === MINIMAX_VIDEO_MODEL)
    return Array.from({ length: 12 }, (_, index) => index + 4)
  if (isAnmiao25VideoModel(model)) return Array.from({ length: 27 }, (_, index) => index + 4)
  return [15]
}

export function validVideoResolution(model, resolution) {
  return videoResolutionOptions(model).includes(resolution)
}

export function validVideoDuration(model, duration) {
  return videoDurationOptions(model).includes(duration)
}

export function videoRatioForRequest(model, referenceCount, ratio) {
  return isAnmiao25VideoModel(model) && referenceCount === 1 ? 'adaptive' : ratio
}

export function estimatedVideoMiCost(model, resolution, duration, capabilities) {
  if (!model || isRetiredVideoModel(model)) return null
  if (!isPerSecondVideoModel(model)) return 50
  if (!validVideoResolution(model, resolution) || !validVideoDuration(model, duration)) return null
  const model25 = isAnmiao25VideoModel(model)
  const minimax = model === MINIMAX_VIDEO_MODEL
  const rates = minimax
    ? capabilities?.minimaxMiPerSecondByResolution
    : model25
      ? capabilities?.anmiao25MiPerSecondByResolution
      : capabilities?.anmiaoMiPerSecondByResolution
  const rate = Number(rates?.[resolution])
  const available = minimax
    ? capabilities?.minimaxVideo
    : model25
      ? capabilities?.anmiao25Video
      : capabilities?.anmiaoVideo
  return available && rate > 0 ? rate * duration : null
}

export function videoReferenceLimit(model, mode) {
  if (isRetiredVideoModel(model)) return 0
  if (model === MINIMAX_VIDEO_MODEL) return mode === 'shouweizhen' ? 2 : 9
  return isAnmiao25VideoModel(model) ? 30 : isAnmiao20VideoModel(model) ? 9 : 15
}

export function videoReferencePayload(model, mode, imageUrls) {
  if (isRetiredVideoModel(model)) throw new Error('原视频模型已移除，请重新选择视频模型')
  if (imageUrls.length > videoReferenceLimit(model, mode))
    throw new Error('参考图数量超过所选模式上限')
  if (model === MINIMAX_VIDEO_MODEL && mode === 'shouweizhen') {
    return { first_frame_url: imageUrls[0], last_frame_url: imageUrls[1] }
  }
  return { image_urls: imageUrls }
}
