export function canonicalModelApiProvider(provider) {
  const value = String(provider || '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (
    value.startsWith('lk888') ||
    value.startsWith('youmi888') ||
    value.startsWith('model-api')
  ) {
    return 'lingke'
  }
  if (value.startsWith('apimart')) return 'apimart'
  if (value.startsWith('gettoken')) return 'gettoken'
  if (value.startsWith('proxy')) return 'proxy'
  if (value.startsWith('agnes')) return 'agnes'
  return value
}

export function canonicalModelApiType(modelType) {
  const value = String(modelType || '').trim().toLowerCase()
  if (value === 'video_generation' || value === 'vision_reasoning') return value
  return 'image_generation'
}

export function summarizeModelApiKeys(rows = []) {
  const enabled = rows.filter((row) => row.enabled).length
  return {
    total: rows.length,
    enabled,
    disabled: rows.length - enabled,
    models: new Set(
      rows.map((row) => String(row.model || '').trim().toLowerCase()).filter(Boolean),
    ).size,
    providers: new Set(rows.map((row) => canonicalModelApiProvider(row.provider))).size,
    imageGeneration: rows.filter(
      (row) => canonicalModelApiType(row.modelType) === 'image_generation',
    ).length,
    videoGeneration: rows.filter(
      (row) => canonicalModelApiType(row.modelType) === 'video_generation',
    ).length,
    visionReasoning: rows.filter(
      (row) => canonicalModelApiType(row.modelType) === 'vision_reasoning',
    ).length,
  }
}

export function modelApiProviderOptions(rows = []) {
  return [...new Set(rows.map((row) => canonicalModelApiProvider(row.provider)))].sort()
}

export function filterModelApiKeys(
  rows = [],
  { search = '', status = 'all', provider = 'all', modelType = 'all' } = {},
) {
  const query = String(search || '').trim().toLowerCase()
  return rows.filter((row) => {
    if (status === 'enabled' && !row.enabled) return false
    if (status === 'disabled' && row.enabled) return false
    if (provider !== 'all' && canonicalModelApiProvider(row.provider) !== provider) return false
    if (modelType !== 'all' && canonicalModelApiType(row.modelType) !== modelType) return false
    if (!query) return true
    return [
      row.name,
      row.model,
      row.provider,
      row.baseUrl,
      row.generationPath,
      row.taskPath,
      row.apiKeyMasked,
    ].some((value) => String(value || '').toLowerCase().includes(query))
  })
}

export function modelApiRouteLabel(row, rows = []) {
  if (!row?.enabled) return '未参与路由'
  const peers = rows
    .filter(
      (item) =>
        item.enabled &&
        canonicalModelApiType(item.modelType) === canonicalModelApiType(row.modelType) &&
        String(item.model || '').trim().toLowerCase() ===
          String(row.model || '').trim().toLowerCase(),
    )
    .sort((left, right) => {
      const priority = Number(right.priority || 0) - Number(left.priority || 0)
      return priority || Number(left.id || 0) - Number(right.id || 0)
    })
  const index = peers.findIndex((item) => String(item.id) === String(row.id))
  if (index <= 0) return '主线路'
  return `备用 ${index}`
}

export function joinModelApiEndpoint(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const suffix = String(path || '').trim()
  if (!suffix) return base
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}
