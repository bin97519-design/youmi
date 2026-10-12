import { isReviewableCanvasAsset } from './canvasAssetReview.js'

export function isCopyableCanvasMedia(layer) {
  return isReviewableCanvasAsset(layer) && !layer.generating
}

const CLIPBOARD_MEDIA_FIELDS = [
  'url',
  'type',
  'name',
  'width',
  'height',
  'naturalWidth',
  'naturalHeight',
  'thumbnailUrl',
  'posterUrl',
  'duration',
  'sourceType',
  'genMeta',
  'videoMeta',
  'videoNodeDraft',
  'prompt',
  'zIndex',
  'x',
  'y',
]

export function canvasMediaClipboardEntries(layers, selectedIds, detectedElements = {}) {
  const ids = new Set(selectedIds)
  return layers
    .filter((layer) => ids.has(layer.id) && isCopyableCanvasMedia(layer))
    .slice()
    .sort((left, right) => (left.zIndex || 0) - (right.zIndex || 0))
    .map((layer) =>
      JSON.parse(
        JSON.stringify({
          layerId: layer.id,
          ...Object.fromEntries(CLIPBOARD_MEDIA_FIELDS.map((field) => [field, layer[field]])),
          elements: layer.type === 'video' ? [] : detectedElements[layer.id] || [],
        }),
      ),
    )
}

export function canvasMediaClipboardLayerFields(entry, imageThumbnailUrl) {
  const fields = Object.fromEntries(
    CLIPBOARD_MEDIA_FIELDS.filter((field) => Object.hasOwn(entry, field)).map((field) => [
      field,
      entry[field],
    ]),
  )
  fields.type = entry.type === 'video' ? 'video' : 'image'
  if (fields.type === 'image') fields.thumbnailUrl = imageThumbnailUrl
  return JSON.parse(JSON.stringify(fields))
}

export function canvasMediaSummary(layers = []) {
  const media = layers.filter(isCopyableCanvasMedia)
  const videos = media.filter((layer) => layer.type === 'video').length
  const images = media.length - videos
  return (
    [images && `${images} 张图片`, videos && `${videos} 个视频`].filter(Boolean).join('、') ||
    '0 项素材'
  )
}

export function transferableMediaKey(layer, baseUrl) {
  if (!isCopyableCanvasMedia(layer)) return ''
  const url = String(layer.url).trim()
  const type = layer.type === 'video' ? 'video' : 'image'
  if (url.startsWith('data:')) return `${type}:${url}`
  try {
    const parsed = new URL(url, baseUrl)
    return `${type}:${parsed.origin}${parsed.pathname}`
  } catch {
    return `${type}:${url.split('?')[0]}`
  }
}

export function partitionCanvasMediaCopies(sourceLayers, existingLayers, sourceCanvasId, baseUrl) {
  const keys = new Set(
    existingLayers.map((layer) => transferableMediaKey(layer, baseUrl)).filter(Boolean),
  )
  const sourceIds = new Set(
    existingLayers
      .filter(
        (layer) => isCopyableCanvasMedia(layer) && layer.copiedFromCanvasId === sourceCanvasId,
      )
      .map((layer) => layer.copiedFromLayerId)
      .filter(Boolean),
  )
  const copies = []
  const skipped = []
  for (const layer of sourceLayers.filter(isCopyableCanvasMedia)) {
    const key = transferableMediaKey(layer, baseUrl)
    if (sourceIds.has(layer.id) || keys.has(key)) skipped.push(layer)
    else {
      copies.push(layer)
      keys.add(key)
      sourceIds.add(layer.id)
    }
  }
  return { copies, skipped }
}
