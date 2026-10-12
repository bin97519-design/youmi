export function isCanvasDocumentImageLayer(layer) {
  return (
    Boolean(layer?.url) &&
    !['placeholder', 'text', 'image-placeholder', 'video'].includes(layer.type)
  )
}

export function canvasDocumentAssetCounts(doc) {
  const counts = { images: 0, videos: 0, texts: 0 }
  const layers = Array.isArray(doc?.payload?.layers) ? doc.payload.layers : []
  for (const layer of layers) {
    if (layer?.type === 'video') counts.videos += 1
    else if (layer?.type === 'text') counts.texts += 1
    else if (isCanvasDocumentImageLayer(layer)) counts.images += 1
  }
  return counts
}
