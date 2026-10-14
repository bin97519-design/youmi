export const CANVAS_TEXT_NODE_LAYOUT = { width: 360, height: 480, fontSize: 24 }

export function emptyMediaNodeDimensions(layer, defaultWidth = 360) {
  if (
    !['image-placeholder', 'video'].includes(layer?.type) ||
    layer.url ||
    layer.generating ||
    layer.locked ||
    layer.taskId ||
    layer.videoMeta
  )
    return {}
  const width = Number.isFinite(defaultWidth) && defaultWidth > 0 ? defaultWidth : 360
  return { width, height: Math.round((width * 4) / 3) }
}

export function canvasGenerationDimensions(
  ratio,
  width = 360,
  reference = { width: 3, height: 4 },
) {
  const parts = String(ratio || '').match(/^(\d+):(\d+)$/)
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
  const explicit = parts && positive(parts[1]) && positive(parts[2])
  const aspectWidth = explicit
    ? Number(parts[1])
    : positive(reference.width)
      ? Number(reference.width)
      : 3
  const aspectHeight = explicit
    ? Number(parts[2])
    : positive(reference.height)
      ? Number(reference.height)
      : 4
  const safeWidth = positive(width) ? Number(width) : 360
  return {
    width: safeWidth,
    height: Math.max(1, Math.round((safeWidth * aspectHeight) / aspectWidth)),
  }
}

export function legacyEmptyTextNodeLayout(layer) {
  if (
    layer?.type !== 'text' ||
    layer.videoReversePrompt ||
    layer.locked ||
    String(layer.text || '').trim()
  )
    return {}
  const original =
    Number(layer.width) === 440 &&
    Number(layer.height) === 320 &&
    Number(layer.fontSize || 14) === 14
  const interim =
    Number(layer.width) === 360 && Number(layer.height) === 200 && Number(layer.fontSize) === 24
  return original || interim ? { ...CANVAS_TEXT_NODE_LAYOUT } : {}
}
