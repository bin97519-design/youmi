export function selectedConnectionImages(layers, selectedIds, renderedIds) {
  const selected = selectedConnectionMedia(layers, selectedIds, renderedIds)
  return selected.every(layer => isConnectionImage(layer, renderedIds)) ? selected : []
}

export function selectedConnectionMedia(layers, selectedIds, renderedIds) {
  const ids = [...new Set(selectedIds)]
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  const selected = ids.map((id) => byId.get(id))
  if (
    selected.length < 2 ||
    selected.some(layer => !isRenderedCanvasNode(layer, renderedIds) ||
      !(layer.type === 'video' ? Boolean(layer.url && !String(layer.url).startsWith('blob:')) : layer.type === 'text' ? !layer.generating : isConnectionImage(layer, renderedIds)))
  )
    return []
  return selected.sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)))
}

export function isRenderedCanvasNode(layer, renderedIds) {
  // Older documents can retain hidden flags on nodes that the current renderer displays.
  return Boolean(layer?.id && (renderedIds ? renderedIds.has(layer.id) : layer.visible !== false))
}

export function isConnectionImage(layer, renderedIds) {
  return Boolean(
    layer?.url &&
    isRenderedCanvasNode(layer, renderedIds) &&
    !layer.generating &&
    !['text', 'video', 'placeholder', 'image-placeholder'].includes(layer.type),
  )
}

export function selectionBounds(rects, padding = 0) {
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.x)) - padding
  const top = Math.min(...rects.map((rect) => rect.y)) - padding
  const right = Math.max(...rects.map((rect) => rect.x + rect.width)) + padding
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) + padding
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export function missingNodeConnections(sourceIds, sourcePort, targetId, targetPort, connections) {
  if (!targetId || sourceIds.includes(targetId)) return []
  const key = (edge) =>
    JSON.stringify([edge.fromLayerId, edge.fromPort, edge.toLayerId, edge.toPort])
  const existing = new Set(connections.map(key))
  return [...new Set(sourceIds)]
    .filter(Boolean)
    .map((fromLayerId) => ({
      fromLayerId,
      fromPort: sourcePort,
      toLayerId: targetId,
      toPort: targetPort,
    }))
    .filter((edge) => !existing.has(key(edge)))
}

export function incomingImageReferences(layers, connections, targetId, renderedIds) {
  return incomingImageReferencesByNode(layers, connections, renderedIds).get(targetId) || []
}

export function incomingImageReferencesByNode(layers, connections, renderedIds) {
  return incomingMediaReferencesByNode(layers, connections, renderedIds, 'image')
}

export function incomingVideoReferencesByNode(layers, connections, renderedIds) {
  return incomingMediaReferencesByNode(layers, connections, renderedIds, 'video')
}

export function incomingTextReferencesByNode(layers, connections, renderedIds) {
  return incomingMediaReferencesByNode(layers, connections, renderedIds, 'text')
}

function incomingMediaReferencesByNode(layers, connections, renderedIds, type) {
  const byId = new Map(
    layers
      .filter(layer => type === 'image' ? isConnectionImage(layer, renderedIds) :
        layer.type === type && isRenderedCanvasNode(layer, renderedIds) &&
        (type === 'video' ? layer.url && !String(layer.url).startsWith('blob:') : !layer.generating && String(layer.text || '').trim()))
      .map((layer) => [layer.id, layer]),
  )
  const byNode = new Map(),
    seen = new Map()
  function add(targetId, sourceId) {
    const layer = byId.get(sourceId)
    if (!layer || layer.id === targetId) return
    if (!seen.has(targetId)) {
      seen.set(targetId, new Set())
      byNode.set(targetId, [])
    }
    const key = type === 'text' ? layer.id : layer.url
    if (seen.get(targetId).has(key)) return
    seen.get(targetId).add(key)
    if (type === 'text') {
      byNode.get(targetId).push({ layerId: layer.id, name: layer.name || '画布文本', text: String(layer.text).trim() })
      return
    }
    byNode.get(targetId).push({
      id: `connected-${layer.id}`,
      layerId: layer.id,
      url: layer.url,
      name: layer.name || (type === 'video' ? '画布视频' : '画布图片'),
      ...(type === 'video' ? {
        thumbnailUrl: layer.thumbnailUrl || layer.posterUrl || '',
        duration: Number(layer.duration) || 0,
      } : {}),
    })
  }
  for (const edge of connections) {
    add(edge.toLayerId, edge.fromLayerId)
    if (edge.fromPort === 'left') add(edge.fromLayerId, edge.toLayerId)
  }
  return byNode
}
