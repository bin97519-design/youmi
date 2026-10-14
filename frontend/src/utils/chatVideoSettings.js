import {
  ANMIAO_VIDEO_MODEL,
  ANMIAO_VIDEO_RESOLUTIONS,
  ANMIAO25_VIDEO_RESOLUTIONS,
  ANMIAO20_FAST_VIDEO_RESOLUTIONS,
  isAnmiao20FastVideoModel,
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  isRetiredVideoModel,
  isPerSecondVideoModel,
  isAnmiao25VideoModel,
} from './productVideo.js'
import { canonicalModelApiProvider } from './modelApiKeyList.js'

export function isProviderReportedCostVideoModel(model, modelOptions = []) {
  const option = modelOptions.find((item) => item?.value === model)
  return canonicalModelApiProvider(option?.provider) === 'lingke'
}

const isAnmiao20VideoModel = (model) =>
  model === ANMIAO_VIDEO_MODEL ||
  model === 'seedance-2.0' ||
  isAnmiao20FastVideoModel(model) ||
  String(model || '').toLowerCase().includes('seedance-2.0-guanfang-anmiao')
export const SEEDANCE_FIRST_LAST_MODE = 'first_last_frame'
export const supportsVideoFrameMode = (model) =>
  isAnmiao20VideoModel(model) || isAnmiao25VideoModel(model) ||
  [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(model)
export const videoFrameModeValue = (model) =>
  [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(model) ? 'shouweizhen' : SEEDANCE_FIRST_LAST_MODE
export const videoReferenceModeForRequest = (model, mode) =>
  model === HAILUO_H3_VIDEO_MODEL ||
  (supportsVideoFrameMode(model) && ['shouweizhen', SEEDANCE_FIRST_LAST_MODE].includes(mode))
    ? videoFrameModeValue(model)
    : 'cankaosheng'
export const isVideoFrameMode = (model, mode) =>
  supportsVideoFrameMode(model) && mode === videoFrameModeValue(model)
export const supportsVideoAudioToggle = (model) =>
  ![MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(model) && !isRetiredVideoModel(model)
export const videoAudioPayload = (model, enabled) =>
  supportsVideoAudioToggle(model) ? { generate_audio: enabled !== false } : {}

export function videoResolutionForModel(model) {
  if (model === MINIMAX_VIDEO_MODEL || model === HAILUO_H3_VIDEO_MODEL) return '768p'
  return isAnmiao20VideoModel(model) ||
    isAnmiao25VideoModel(model) ||
    String(model).endsWith('-720p')
    ? '720p'
    : '480p'
}

export function videoResolutionOptions(model) {
  if (isRetiredVideoModel(model)) return []
  if (model === MINIMAX_VIDEO_MODEL || model === HAILUO_H3_VIDEO_MODEL)
    return MINIMAX_VIDEO_RESOLUTIONS.map((option) => option.value)
  if (isAnmiao20FastVideoModel(model))
    return ANMIAO20_FAST_VIDEO_RESOLUTIONS.map((option) => option.value)
  if (isAnmiao20VideoModel(model)) return ANMIAO_VIDEO_RESOLUTIONS.map((option) => option.value)
  if (isAnmiao25VideoModel(model)) return ANMIAO25_VIDEO_RESOLUTIONS.map((option) => option.value)
  return [videoResolutionForModel(model)]
}

export function videoDurationOptions(model) {
  if (isRetiredVideoModel(model)) return []
  if (isAnmiao20VideoModel(model) || model === MINIMAX_VIDEO_MODEL || model === HAILUO_H3_VIDEO_MODEL)
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

export function videoRatioForRequest(model, referenceCount, ratio, mode = '', videoCount = 0) {
  if (model === HAILUO_H3_VIDEO_MODEL) return 'adaptive'
  return !videoCount && isAnmiao25VideoModel(model) &&
    (referenceCount === 1 || (referenceCount > 0 && isVideoFrameMode(model, mode)))
    ? 'adaptive'
    : ratio
}

export function estimatedVideoMiCost(
  model,
  resolution,
  duration,
  capabilities,
  providerReportedCost = false,
) {
  if (!model || isRetiredVideoModel(model)) return null
  if (providerReportedCost) {
    return validVideoResolution(model, resolution) && validVideoDuration(model, duration) ? 0 : null
  }
  if (!isPerSecondVideoModel(model)) return 50
  if (!validVideoResolution(model, resolution) || !validVideoDuration(model, duration)) return null
  const model25 = isAnmiao25VideoModel(model)
  const minimax = model === MINIMAX_VIDEO_MODEL || model === HAILUO_H3_VIDEO_MODEL
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
  if (model === HAILUO_H3_VIDEO_MODEL) return 2
  if (isVideoFrameMode(model, mode)) return 2
  if (model === MINIMAX_VIDEO_MODEL) return 9
  return isAnmiao25VideoModel(model) ? 30 : isAnmiao20VideoModel(model) ? 9 : 15
}

export function videoReferenceVideoLimits(model) {
  if (isAnmiao25VideoModel(model)) return { count: 10, minSeconds: 2, maxSeconds: 30 }
  if (isAnmiao20VideoModel(model)) return { count: 3, minSeconds: 2, maxSeconds: 15 }
  return null
}

export function videoReferenceVideosError(model, mode, videos = [], requireDuration = false) {
  if (!videos.length) return ''
  const limits = videoReferenceVideoLimits(model)
  if (!limits) return '所选模型不支持参考视频，请更换模型或移除视频连线'
  if (isVideoFrameMode(model, mode)) return '参考视频不能与首尾帧模式混用，请选择参考生'
  if (videos.length > limits.count) return `所选模型最多支持 ${limits.count} 个参考视频`
  let total = 0
  for (const [index, video] of videos.entries()) {
    if (!/^https?:\/\//i.test(video?.url || '')) return `参考视频 ${index + 1} 的地址无效`
    const seconds = Number(video.duration)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      if (requireDuration) return `无法读取参考视频 ${index + 1} 的时长，请检查视频是否可播放`
      continue
    }
    if (seconds < limits.minSeconds || seconds > limits.maxSeconds)
      return `参考视频 ${index + 1} 时长需为 ${limits.minSeconds} 至 ${limits.maxSeconds} 秒`
    total += seconds
  }
  return total > limits.maxSeconds + 0.000001
    ? `参考视频总时长不能超过 ${limits.maxSeconds} 秒（当前 ${Number(total.toFixed(2))} 秒）`
    : ''
}

export function videoReferencePayload(model, mode, imageUrls, referenceVideos = []) {
  if (isRetiredVideoModel(model)) throw new Error('原视频模型已移除，请重新选择视频模型')
  if (imageUrls.length > videoReferenceLimit(model, mode))
    throw new Error('参考图数量超过所选模式上限')
  const videoError = videoReferenceVideosError(model, mode, referenceVideos, true)
  if (videoError) throw new Error(videoError)
  if (referenceVideos.length) {
    return {
      image_urls: imageUrls,
      reference_videos: referenceVideos.map(video => ({
        url: video.url,
        durationSeconds: Number(video.duration),
      })),
    }
  }
  if (model === HAILUO_H3_VIDEO_MODEL) {
    if (imageUrls.length < 1 || imageUrls.length > 2)
      throw new Error('Mini H3 首尾帧必须上传 1 至 2 张图片')
    return {
      first_frame_url: imageUrls[0],
      ...(imageUrls[1] ? { last_frame_url: imageUrls[1] } : {}),
    }
  }
  if (isVideoFrameMode(model, mode)) {
    return { first_frame_url: imageUrls[0], last_frame_url: imageUrls[1] }
  }
  return { image_urls: imageUrls }
}
