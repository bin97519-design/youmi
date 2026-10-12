import {
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  VIDEO_MODELS,
  VIDEO_RATIOS,
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
} from './chatVideoSettings.js'

export function normalizeVideoNodeDraft(value = {}, defaults = {}, modelOptions = VIDEO_MODELS) {
  const requested = { ...defaults, ...value.config }
  const model =
    !isRetiredVideoModel(requested.model) &&
    (modelOptions.some((option) => option.value === requested.model) ||
      isPerSecondVideoModel(requested.model))
    ? requested.model
    : VIDEO_MODELS[1].value
  let referenceMode = requested.referenceMode === 'cankaosheng' ? 'cankaosheng' : 'shouweizhen'
  if (model === HAILUO_H3_VIDEO_MODEL) referenceMode = 'shouweizhen'
  else if (supportsVideoFrameMode(model) && model !== MINIMAX_VIDEO_MODEL) {
    // Older Seedance drafts used generic reference images, not explicit frame slots.
    referenceMode =
      requested.referenceMode === SEEDANCE_FIRST_LAST_MODE ||
      (requested.referenceMode !== 'cankaosheng' && !value.references?.length)
        ? SEEDANCE_FIRST_LAST_MODE
        : 'cankaosheng'
  }
  const config = {
    model,
    ratio: ['adaptive', ...VIDEO_RATIOS].includes(requested.ratio) ? requested.ratio : '16:9',
    resolution: validVideoResolution(model, requested.resolution)
      ? requested.resolution
      : videoResolutionForModel(model),
    duration: validVideoDuration(model, Number(requested.duration))
      ? Number(requested.duration)
      : 15,
    referenceMode,
    generateAudio: !supportsVideoAudioToggle(model) || requested.generateAudio !== false,
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
    prompt: String(value.prompt || '').slice(0, 2500),
    config,
    references,
    ...(Array.isArray(value.connectedLayerIds)
      ? { connectedLayerIds: [...new Set(value.connectedLayerIds.map(String).filter(Boolean))] }
      : {}),
  }
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
) {
  const draft = normalizeVideoNodeDraft(value, {}, modelOptions)
  const previousIds = new Set(draft.connectedLayerIds || [])
  const connected = normalizeVideoNodeDraft({ references: connectedReferences }).references
  if (!connected.length && !previousIds.size) return draft

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
  const referenceMode =
    supportsVideoFrameMode(draft.config.model) &&
    new Set(references.map((item) => item.url)).size <= 2
      ? videoFrameModeValue(draft.config.model)
      : 'cankaosheng'
  return normalizeVideoNodeDraft(
    {
      ...draft,
      config: { ...draft.config, referenceMode },
      references,
      connectedLayerIds: connected.map((reference) => reference.layerId),
    },
    {},
    modelOptions,
  )
}

export function videoNodeReferenceError(draft) {
  const limit = videoReferenceLimit(draft.config.model, draft.config.referenceMode)
  return draft.references.length > limit ? `所选模式最多支持 ${limit} 张参考图` : ''
}
