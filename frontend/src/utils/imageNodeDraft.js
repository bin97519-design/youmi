import { normalizeReferenceTexts, syncConnectedReferenceTexts, canvasReferenceTextPrompt } from './canvasReferenceTexts.js'

export function normalizeImageNodeDraft(value = {}, defaults = {}, modelOptions = []) {
  const requested = { ...defaults, ...value.config }
  const available = modelOptions.map((option) =>
    typeof option === 'string' ? option : option.value,
  )
  const models = [
    ...new Set(
      (Array.isArray(requested.models) && requested.models.length
        ? requested.models
        : [requested.model]
      ).filter((model) => available.includes(model)),
    ),
  ]
  if (!models.length && available.length)
    models.push(available.includes(defaults.model) ? defaults.model : available[0])
  const seen = new Set()
  const references = (Array.isArray(value.references) ? value.references : [])
    .filter((reference) => {
      const url = String(reference?.url || '').trim()
      if (!url || url.startsWith('blob:') || reference.uploading || seen.has(url)) return false
      seen.add(url)
      return true
    })
    .map((reference) => ({
      id: String(reference.id || reference.layerId || reference.url),
      url: String(reference.url).trim(),
      name: String(reference.name || '参考图'),
      layerId: String(reference.layerId || ''),
      isSource: Boolean(reference.isSource),
    }))
  return {
    prompt: String(value.prompt || '').slice(0, 10000),
    config: {
      model: models[0] || '',
      models,
      ratio: [
        'auto',
        '1:1',
        '2:3',
        '3:2',
        '3:4',
        '4:3',
        '4:5',
        '5:4',
        '9:16',
        '16:9',
        '21:9',
      ].includes(requested.ratio)
        ? requested.ratio
        : 'auto',
      resolution: ['1K', '2K', '4K'].includes(requested.resolution) ? requested.resolution : '2K',
      count: Math.max(1, Math.min(4, Math.round(Number(requested.count) || 1))),
    },
    references,
    referenceTexts: normalizeReferenceTexts(value.referenceTexts),
    connectedTextLayerIds: [...new Set((Array.isArray(value.connectedTextLayerIds) ? value.connectedTextLayerIds : []).map(String).filter(Boolean))],
    connectedLayerIds: [
      ...new Set(
        (Array.isArray(value.connectedLayerIds) ? value.connectedLayerIds : [])
          .filter(Boolean)
          .map(String),
      ),
    ],
  }
}

export function syncImageNodeConnectedReferences(value, connectedReferences, modelOptions = [], connectedTexts = []) {
  const draft = normalizeImageNodeDraft(value, {}, modelOptions)
  const connected = normalizeImageNodeDraft(
    { references: connectedReferences },
    {},
    modelOptions,
  ).references
  const previousIds = new Set(draft.connectedLayerIds)
  const textPatch = syncConnectedReferenceTexts(draft, connectedTexts)
  if (!connected.length && !previousIds.size) return { ...draft, ...textPatch }
  const byId = new Map(connected.map((reference) => [reference.layerId, reference]))
  const byUrl = new Map(connected.map((reference) => [reference.url, reference]))
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
  return normalizeImageNodeDraft(
    { ...draft, ...textPatch, references, connectedLayerIds: connected.map((reference) => reference.layerId) },
    {},
    modelOptions,
  )
}

export function imageNodeGenerationOptions(layer, draft) {
  const prompt = canvasReferenceTextPrompt(draft.prompt, draft.referenceTexts, 10000)
  const references = draft.references.filter(
    (reference) => reference.url && !reference.url.startsWith('blob:'),
  )
  return {
    displayText: draft.prompt.trim(),
    ...(draft.referenceTexts?.length ? {
      fullPrompt: prompt,
      displayText: prompt,
    } : {}),
    selectedElements: [],
    targetLayerId: layer.id,
    referenceImageUrls: references.map((reference) => reference.url),
    referenceLayerIds: references.map((reference) => reference.layerId).filter(Boolean),
    ...(draft.referenceTexts?.length ? { referenceTextLayerIds: draft.referenceTexts.map(reference => reference.layerId).filter(Boolean) } : {}),
    messageReferenceImages: references.map((reference) => ({
      url: reference.url,
      layerId: reference.layerId,
    })),
    generationCount: draft.config.count,
    taskConfig: { ...draft.config },
    preserveComposer: true,
    nodeGeneration: true,
    ...(!layer.url && layer.type === 'image-placeholder' ? { reuseLayerId: layer.id } : {}),
  }
}
