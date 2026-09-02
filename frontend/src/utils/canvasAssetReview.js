export const CANVAS_ASSET_REVIEW_STATUS = Object.freeze({
  KEPT: 'kept',
})

export function isReviewableCanvasAsset(layer) {
  if (!layer?.url) return false
  if (layer.type === 'video') return true
  return layer.type === 'image' || (!layer.type && Boolean(layer.url))
}

export function isCanvasAssetKept(layer) {
  return (
    isReviewableCanvasAsset(layer) && layer.assetReviewStatus === CANVAS_ASSET_REVIEW_STATUS.KEPT
  )
}

export function reviewableCanvasAssets(layers) {
  return (Array.isArray(layers) ? layers : []).filter(isReviewableCanvasAsset)
}

export function selectedReviewableCanvasAssets(layers, selectedIds) {
  const ids = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String))
  return reviewableCanvasAssets(layers).filter((layer) => ids.has(String(layer.id)))
}

export function unmarkedCanvasAssets(layers) {
  return reviewableCanvasAssets(layers).filter((layer) => !isCanvasAssetKept(layer))
}
