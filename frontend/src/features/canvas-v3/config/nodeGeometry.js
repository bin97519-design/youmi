const IMAGE_NODE_MAX_WIDTH = 624
const IMAGE_NODE_MAX_HEIGHT = 350

export function nodeSize(kind, data = {}) {
  if (
    ['image', 'video'].includes(kind) &&
    data.assetUrl &&
    data.mediaWidth > 0 &&
    data.mediaHeight > 0
  ) {
    const quarterTurn = kind === 'image' && Math.abs(Number(data.rotation) || 0) % 180 === 90
    const mediaWidth = quarterTurn ? data.mediaHeight : data.mediaWidth
    const mediaHeight = quarterTurn ? data.mediaWidth : data.mediaHeight
    const scale = Math.min(IMAGE_NODE_MAX_WIDTH / mediaWidth, IMAGE_NODE_MAX_HEIGHT / mediaHeight)
    return {
      width: Math.max(1, Math.round(mediaWidth * scale)),
      height: Math.max(1, Math.round(mediaHeight * scale)),
    }
  }
  return {
    width: ['image', 'video'].includes(kind) ? IMAGE_NODE_MAX_WIDTH : 350,
    height: ['text', 'reference'].includes(kind) ? 200 : IMAGE_NODE_MAX_HEIGHT,
  }
}

export function isStandaloneUploadedImage(data = {}) {
  if (data.kind !== 'image' || !data.assetUrl) return false
  if (data.mediaOrigin === 'upload') return true
  return (
    data.assetUrl.startsWith('data:image/') &&
    data.artifactStatus === 'ready' &&
    data.runState === 'idle' &&
    !data.generation &&
    !data.localEdit
  )
}
