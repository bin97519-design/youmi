const MAX_DELETED_ASSET_BATCHES = 20

function connectionKey(connection) {
  return `${connection.fromLayerId}|${connection.fromPort}|${connection.toLayerId}|${connection.toPort}`
}

export function archiveCanvasAssetDeletion(payload, ids, options = {}) {
  const layerIds = new Set((payload.layers || []).map((layer) => layer.id))
  const deleteSet = new Set((ids || []).filter((id) => layerIds.has(id)))
  if (!deleteSet.size) return { batchId: '', deletedIds: [] }

  const deletedAt = options.deletedAt ?? Date.now()
  const batchId =
    options.batchId || `deleted-assets-${deletedAt}-${Math.random().toString(36).slice(2, 7)}`
  const entries = (payload.layers || [])
    .map((layer, index) => (deleteSet.has(layer.id) ? { index, layer } : null))
    .filter(Boolean)
  const connections = (payload.connections || []).filter(
    (connection) => deleteSet.has(connection.fromLayerId) || deleteSet.has(connection.toLayerId),
  )
  const detectedElements = Object.fromEntries(
    Object.entries(payload.detectedElements || {}).filter(([layerId]) => deleteSet.has(layerId)),
  )
  const reversePromptReferences = Array.isArray(payload.reversePrompt?.referenceImages)
    ? payload.reversePrompt.referenceImages.filter((reference) => deleteSet.has(reference.layerId))
    : []

  const batches = Array.isArray(payload.deletedAssetBatches) ? payload.deletedAssetBatches : []
  payload.deletedAssetBatches = [
    ...batches,
    {
      id: batchId,
      deletedAt,
      entries,
      connections,
      detectedElements,
      reversePromptReferences,
    },
  ].slice(-MAX_DELETED_ASSET_BATCHES)
  payload.layers = (payload.layers || []).filter((layer) => !deleteSet.has(layer.id))
  payload.connections = (payload.connections || []).filter(
    (connection) => !deleteSet.has(connection.fromLayerId) && !deleteSet.has(connection.toLayerId),
  )
  payload.detectedElements = Object.fromEntries(
    Object.entries(payload.detectedElements || {}).filter(([layerId]) => !deleteSet.has(layerId)),
  )
  if (Array.isArray(payload.reversePrompt?.referenceImages)) {
    payload.reversePrompt.referenceImages = payload.reversePrompt.referenceImages.filter(
      (reference) => !deleteSet.has(reference.layerId),
    )
  }

  return { batchId, deletedIds: entries.map((entry) => entry.layer.id) }
}

export function restoreCanvasAssetDeletion(payload) {
  const batches = Array.isArray(payload.deletedAssetBatches) ? payload.deletedAssetBatches : []
  const batch = batches.at(-1)
  if (!batch) return { batchId: '', restoredIds: [] }

  const existingIds = new Set((payload.layers || []).map((layer) => layer.id))
  const entries = Array.isArray(batch.entries)
    ? batch.entries
    : (batch.layers || []).map((layer, index) => ({ index, layer }))
  const restoredLayers = [...(payload.layers || [])]
  const restoredIds = []
  for (const entry of [...entries].sort((a, b) => (a.index || 0) - (b.index || 0))) {
    if (!entry?.layer?.id || existingIds.has(entry.layer.id)) continue
    restoredLayers.splice(
      Math.min(Math.max(Number(entry.index) || 0, 0), restoredLayers.length),
      0,
      entry.layer,
    )
    existingIds.add(entry.layer.id)
    restoredIds.push(entry.layer.id)
  }

  const connectionKeys = new Set((payload.connections || []).map(connectionKey))
  const restoredConnections = [...(payload.connections || [])]
  for (const connection of batch.connections || []) {
    if (!existingIds.has(connection.fromLayerId) || !existingIds.has(connection.toLayerId)) continue
    const key = connectionKey(connection)
    if (connectionKeys.has(key)) continue
    connectionKeys.add(key)
    restoredConnections.push(connection)
  }

  payload.layers = restoredLayers
  payload.connections = restoredConnections
  payload.detectedElements = {
    ...(payload.detectedElements || {}),
    ...(batch.detectedElements || {}),
  }
  if ((batch.reversePromptReferences || []).length) {
    payload.reversePrompt = payload.reversePrompt || {}
    payload.reversePrompt.referenceImages = Array.isArray(payload.reversePrompt.referenceImages)
      ? payload.reversePrompt.referenceImages
      : []
    const referenceKeys = new Set(
      payload.reversePrompt.referenceImages.map(
        (reference) => `${reference.layerId || ''}|${reference.url || ''}`,
      ),
    )
    for (const reference of batch.reversePromptReferences) {
      const key = `${reference.layerId || ''}|${reference.url || ''}`
      if (!referenceKeys.has(key)) {
        referenceKeys.add(key)
        payload.reversePrompt.referenceImages.push(reference)
      }
    }
  }
  payload.deletedAssetBatches = batches.slice(0, -1)

  return { batchId: batch.id || '', restoredIds }
}
