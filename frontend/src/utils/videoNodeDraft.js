import {
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  VIDEO_MODELS,
  VIDEO_RATIOS,
  DEFAULT_VIDEO_RATIO,
  isPerSecondVideoModel,
  isRetiredVideoModel,
} from './productVideo.js'
import {
  validVideoDuration,
  validVideoResolution,
  videoReferenceLimit,
  videoResolutionForModel,
  SEEDANCE_FIRST_LAST_MODE,
  supportsVideoFrameMode,
  videoFrameModeValue,
  supportsVideoAudioToggle,
  videoReferenceVideosError,
  videoRatioForRequest,
} from './chatVideoSettings.js'
import { isSeedanceAnciModel, seedanceAnciVersion } from './seedanceAnci.js'

export function normalizeVideoNodeDraft(value = {}, defaults = {}, modelOptions = VIDEO_MODELS) {
  const requested = { ...defaults, ...value.config }
  const model =
    !isRetiredVideoModel(requested.model) &&
    (modelOptions.some((option) => option.value === requested.model) ||
      isPerSecondVideoModel(requested.model))
    ? requested.model
    : VIDEO_MODELS[1].value
  let referenceMode = requested.referenceMode === 'cankaosheng' ? 'cankaosheng' : 'shouweizhen'
  if (isSeedanceAnciModel(model)) referenceMode = 'cankaosheng'
  if (model === HAILUO_H3_VIDEO_MODEL) referenceMode = 'shouweizhen'
  else if (supportsVideoFrameMode(model) && model !== MINIMAX_VIDEO_MODEL) {
    // Older Seedance drafts used generic reference images, not explicit frame slots.
    referenceMode =
      requested.referenceMode === SEEDANCE_FIRST_LAST_MODE ||
      (requested.referenceMode !== 'cankaosheng' && !value.references?.length)
        ? SEEDANCE_FIRST_LAST_MODE
        : 'cankaosheng'
  }
  const referenceVideos = normalizeVideoReferences(value.referenceVideos)
  if (referenceVideos.length) referenceMode = 'cankaosheng'
  const config = {
    model,
    ratio: isSeedanceAnciModel(model) ? videoRatioForRequest(model, 0, requested.ratio)
      : ['adaptive', ...VIDEO_RATIOS].includes(requested.ratio) ? requested.ratio : DEFAULT_VIDEO_RATIO,
    resolution: validVideoResolution(model, requested.resolution)
      ? requested.resolution
      : videoResolutionForModel(model),
    duration: validVideoDuration(model, Number(requested.duration))
      ? Number(requested.duration)
      : 15,
    referenceMode,
    generateAudio: !supportsVideoAudioToggle(model) || requested.generateAudio !== false,
    ...(isSeedanceAnciModel(model) ? { version: seedanceAnciVersion(requested.version) } : {}),
  }
  const seen = new Set()
  const references = (Array.isArray(value.references) ? value.references : [])
    .filter((reference) => {
      const url = String(reference?.url || '').trim()
      if (!url || url.startsWith('blob:') || seen.has(url)) return false
      seen.add(url)
      return true
    })
    .map((reference) => ({
      url: String(reference.url).trim(),
      name: String(reference.name || '参考图'),
      layerId: String(reference.layerId || ''),
    }))
  return {
    prompt: String(value.prompt || ''),
    config,
    references,
    referenceVideos,
    referenceTexts: normalizeReferenceTexts(value.referenceTexts),
    connectedTextLayerIds: [...new Set((Array.isArray(value.connectedTextLayerIds) ? value.connectedTextLayerIds : []).map(String).filter(Boolean))],
    ...(Array.isArray(value.connectedLayerIds)
      ? { connectedLayerIds: [...new Set(value.connectedLayerIds.map(String).filter(Boolean))] }
      : {}),
    ...(Array.isArray(value.connectedVideoLayerIds)
      ? { connectedVideoLayerIds: [...new Set(value.connectedVideoLayerIds.map(String).filter(Boolean))] }
      : {}),
  }
}

export function normalizeVideoReferences(value) {
  const byUrl = new Map()
  for (const reference of Array.isArray(value) ? value : []) {
    const url = String(reference?.url || '').trim()
    if (!url || url.startsWith('blob:') || byUrl.has(url)) continue
    byUrl.set(url, {
      url,
      name: String(reference.name || '参考视频'),
      layerId: String(reference.layerId || ''),
      thumbnailUrl: String(reference.thumbnailUrl || ''),
      duration: Number.isFinite(Number(reference.duration)) && Number(reference.duration) > 0
        ? Number(reference.duration) : 0,
    })
  }
  return [...byUrl.values()]
}

export function syncVideoNodeGenerationSettings(value, settings, modelOptions = VIDEO_MODELS) {
  const config = { ...value.config, ...settings }
  if (supportsVideoFrameMode(config.model)) {
    config.referenceMode =
      config.referenceMode === 'cankaosheng' ? 'cankaosheng' : videoFrameModeValue(config.model)
  }
  return normalizeVideoNodeDraft({ ...value, config }, {}, modelOptions)
}

export function syncVideoNodeConnectedReferences(
  value,
  connectedReferences,
  modelOptions = VIDEO_MODELS,
  connectedVideos = [],
  connectedTexts = [],
) {
  const draft = normalizeVideoNodeDraft(value, {}, modelOptions)
  const previousIds = new Set(draft.connectedLayerIds || [])
  const connected = normalizeVideoNodeDraft({ references: connectedReferences }).references
  const previousVideoIds = new Set(draft.connectedVideoLayerIds || [])
  const videos = normalizeVideoReferences(connectedVideos)
  const textPatch = syncConnectedReferenceTexts(draft, connectedTexts)
  if (!connected.length && !previousIds.size && !videos.length && !previousVideoIds.size) return { ...draft, ...textPatch }

  const byId = new Map(connected.map((reference) => [reference.layerId, reference]))
  const byUrl = new Map(connected.map((reference) => [reference.url, reference]))
  // Keep explicit swaps and uploaded references; refresh or remove graph-owned images.
  const references = draft.references
    .map((reference) => {
      if (byId.has(reference.layerId)) return byId.get(reference.layerId)
      if (previousIds.has(reference.layerId)) return byUrl.get(reference.url) || null
      return byUrl.get(reference.url) || reference
    })
    .filter(Boolean)
  for (const reference of connected) {
    if (!references.some((item) => item.url === reference.url)) references.push(reference)
  }
  const videosById = new Map(videos.map(reference => [reference.layerId, reference]))
  const videosByUrl = new Map(videos.map(reference => [reference.url, reference]))
  const referenceVideos = draft.referenceVideos.map(reference => {
    const current = videosById.get(reference.layerId) || videosByUrl.get(reference.url)
    if (current) return {
      ...current,
      duration: current.duration || (current.url === reference.url ? reference.duration : 0),
    }
    return previousVideoIds.has(reference.layerId) ? null : reference
  }).filter(Boolean)
  for (const reference of videos) {
    if (!referenceVideos.some(item => item.url === reference.url)) referenceVideos.push(reference)
  }
  const referenceMode =
    !referenceVideos.length && supportsVideoFrameMode(draft.config.model) &&
    new Set(references.map((item) => item.url)).size <= 2
      ? videoFrameModeValue(draft.config.model)
      : 'cankaosheng'
  return normalizeVideoNodeDraft(
    {
      ...draft,
      ...textPatch,
      config: { ...draft.config, referenceMode },
      references,
      referenceVideos,
      connectedLayerIds: connected.map((reference) => reference.layerId),
      connectedVideoLayerIds: videos.map(reference => reference.layerId),
    },
    {},
    modelOptions,
  )
}

export function videoNodeReferenceError(draft) {
  const limit = videoReferenceLimit(draft.config.model, draft.config.referenceMode)
  return videoReferenceVideosError(draft.config.model, draft.config.referenceMode, draft.referenceVideos) ||
    (draft.references.length > limit ? `所选模式最多支持 ${limit} 张参考图` : '') ||
    canvasReferenceTextError(draft.prompt, draft.referenceTexts, Infinity)
}
import { normalizeReferenceTexts, syncConnectedReferenceTexts, canvasReferenceTextError } from './canvasReferenceTexts.js'
