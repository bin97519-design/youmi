export const PRODUCT_VIDEO_CANVAS_WIDTH = 360
export const PRODUCT_VIDEO_CANVAS_SIZE_VERSION = 1

function positive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function productVideoAssetSize(item) {
  const width = PRODUCT_VIDEO_CANVAS_WIDTH
  const naturalWidth = positive(item.mediaWidth)
  const naturalHeight = positive(item.mediaHeight)
  const known = naturalWidth > 0 && naturalHeight > 0
  const ratio = String(item.ratio || item.request?.ratio || item.request?.size || '').split(':')
  const ratioWidth = positive(ratio[0])
  const ratioHeight = positive(ratio[1])
  const aspect = known
    ? naturalWidth / naturalHeight
    : ratio.length === 2 && ratioWidth && ratioHeight
      ? ratioWidth / ratioHeight
      : 16 / 9
  return {
    width,
    height: Math.max(1, Math.round(width / aspect)),
    naturalWidth: known ? naturalWidth : 0,
    naturalHeight: known ? naturalHeight : 0,
    productVideoMediaUrl: known ? item.url : '',
    productVideoCanvasSizeVersion: PRODUCT_VIDEO_CANVAS_SIZE_VERSION,
  }
}

export function productVideoDimensionsPatch(layer, size) {
  if (
    !layer?.productVideoShotId ||
    !['image', 'video'].includes(layer.type) ||
    layer.horizontalSlice ||
    !positive(size?.width) ||
    !positive(size?.height)
  )
    return null
  if (
    layer.productVideoCanvasSizeVersion === PRODUCT_VIDEO_CANVAS_SIZE_VERSION &&
    layer.productVideoMediaUrl === layer.url &&
    layer.naturalWidth === size.width &&
    layer.naturalHeight === size.height
  )
    return null
  // Migrate legacy sizes once, then preserve subsequent manual resizing.
  const width =
    layer.productVideoCanvasSizeVersion === PRODUCT_VIDEO_CANVAS_SIZE_VERSION
      ? positive(layer.width) || PRODUCT_VIDEO_CANVAS_WIDTH
      : PRODUCT_VIDEO_CANVAS_WIDTH
  return {
    width,
    height: Math.max(1, Math.round((width * size.height) / size.width)),
    naturalWidth: size.width,
    naturalHeight: size.height,
    productVideoMediaUrl: layer.url,
    productVideoCanvasSizeVersion: PRODUCT_VIDEO_CANVAS_SIZE_VERSION,
  }
}

const dimensionsCache = new Map()

export function readProductVideoMediaSize(url, kind, timeoutMs = 12000) {
  if (!url || !['image', 'video'].includes(kind)) return Promise.resolve(null)
  const key = `${kind}:${url}`
  if (dimensionsCache.has(key)) return dimensionsCache.get(key)
  const promise = new Promise((resolve) => {
    const media = kind === 'video' ? document.createElement('video') : new Image()
    let settled = false
    const finish = (size) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      media.onload = media.onloadedmetadata = media.onerror = null
      if (kind === 'video') {
        media.removeAttribute('src')
        media.load()
      }
      resolve(size)
    }
    const loaded = () => {
      const width = kind === 'video' ? media.videoWidth : media.naturalWidth
      const height = kind === 'video' ? media.videoHeight : media.naturalHeight
      finish(positive(width) && positive(height) ? { width, height } : null)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    media.onerror = () => finish(null)
    if (kind === 'video') {
      media.preload = 'metadata'
      media.onloadedmetadata = loaded
    } else media.onload = loaded
    media.src = url
  }).then((size) => {
    if (!size) dimensionsCache.delete(key)
    return size
  })
  if (dimensionsCache.size >= 100) dimensionsCache.delete(dimensionsCache.keys().next().value)
  dimensionsCache.set(key, promise)
  return promise
}
