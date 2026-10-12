export function parseTaskResultUrls(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((url) => typeof url === 'string' && url.trim())
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((url) => typeof url === 'string' && url.trim())
      : typeof parsed === 'string' && parsed.trim()
        ? [parsed]
        : []
  } catch {
    return raw.trim() ? [raw.trim()] : []
  }
}

export function normalizeConsoleTaskStats(stats) {
  if (!stats) return stats
  return {
    ...stats,
    tasks: (stats.tasks || []).map((task) => {
      const sourceStatus = String(task.status || '').trim().toLowerCase()
      const failed = ['failed', 'error', 'cancelled', 'canceled'].includes(sourceStatus)
      if (['VIDEO', 'VIDEO_ENHANCE'].includes(task.taskType)) {
        return {
          ...task,
          sourceStatus,
          previewUrls: [],
          videoPreviewUrls: failed ? [] : [...new Set(parseTaskResultUrls(task.videoUrls))],
        }
      }
      const persisted = parseTaskResultUrls(task.resultUrls)
      const original = parseTaskResultUrls(task.imageUrls)
      const previewUrls = [...new Set(persisted.length ? persisted : original)]
      const persistStatus = String(
        task.persistStatus || (persisted.length ? 'DONE' : sourceStatus === 'persisting' ? 'PENDING' : ''),
      ).toUpperCase()
      return {
        ...task,
        sourceStatus,
        status: previewUrls.length > 0 && !failed ? 'completed' : task.status,
        persistStatus,
        previewUrls,
      }
    }),
  }
}

export function consoleTaskStatsUrl(kind, dateFrom, dateTo) {
  if (!['image', 'video', 'enhance'].includes(kind)) throw new Error('Unknown task stats category')
  const params = new URLSearchParams()
  const image = kind === 'image'
  if (!image) params.set('taskType', kind === 'enhance' ? 'VIDEO_ENHANCE' : 'VIDEO')
  if (dateFrom) params.set('dateFrom', dateFrom)
  if (dateTo) params.set('dateTo', dateTo)
  const query = params.toString()
  return `/api/admin/${image ? 'image' : 'video'}-stats${query ? `?${query}` : ''}`
}

function sumFields(rows, fields) {
  return Object.fromEntries(fields.map((field) => [field,
    rows.reduce((sum, row) => sum + (Number(row?.[field]) || 0), 0),
  ]))
}

const dailyFields = ['tasks', 'failedTasks', 'images', 'videos', 'miCost', 'moneyCost']
const modelFields = ['tasks', 'images', 'videos', 'miCost', 'moneyCost']

function mergeRows(rows, key, fields) {
  const groups = new Map()
  for (const row of rows) {
    const id = String(row[key])
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(row)
  }
  return [...groups.values()].map((group) => ({ ...group[0], ...sumFields(group, fields) }))
}

function mergeDaily(rows) {
  return mergeRows(rows, 'day', dailyFields).sort((a, b) => a.day.localeCompare(b.day))
}

function mergeTrends(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = String(row.key)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].map((group) => ({
    key: String(group[0].key),
    label: group[0].label,
    ...sumFields(group, ['totalTasks']),
    daily: mergeDaily(group.flatMap((row) => row.daily || [])),
  })).sort((a, b) => b.totalTasks - a.totalTasks)
}

export function mergeConsoleTaskStats(image, video, enhance) {
  const sources = [image, video, enhance].filter(Boolean)
  const summary = sumFields(sources.map((source) => source.summary), [
    'totalTasks', 'completedTasks', 'failedTasks', 'processingTasks', 'todayTasks',
    'totalImages', 'totalVideos', 'totalMiCost', 'totalMoneyCost',
  ])
  const models = sources.flatMap((source) => source.models || [])
  // Image statistics return only the top models; retain the remainder in the overall chart.
  const listedImages = sumFields(image?.models || [], modelFields)
  const otherImageTasks = (Number(image?.summary?.totalTasks) || 0) - listedImages.tasks
  if (otherImageTasks > 0) {
    models.push({
      model: '\u5176\u4ed6\u56fe\u7247\u6a21\u578b', tasks: otherImageTasks,
      images: Math.max(0, (Number(image.summary.totalImages) || 0) - listedImages.images),
      videos: 0,
      miCost: Math.max(0, (Number(image.summary.totalMiCost) || 0) - listedImages.miCost),
      moneyCost: Math.max(0, (Number(image.summary.totalMoneyCost) || 0) - listedImages.moneyCost),
    })
  }
  const tasks = [
    ...(image?.tasks || []).map((task) => ({ ...task, taskType: 'IMAGE' })),
    ...(video?.tasks || []).map((task) => ({ ...task, taskType: 'VIDEO' })),
    ...(enhance?.tasks || []).map((task) => ({ ...task, taskType: 'VIDEO_ENHANCE' })),
  ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 500)
  const providers = mergeRows(sources.flatMap((source) => source.providers || []), 'provider', [
    'totalTasks', 'successfulTasks', 'failedTasks', 'finishedTasks',
  ]).map((provider) => ({
    ...provider,
    successRate: provider.finishedTasks
      ? provider.successfulTasks * 100 / provider.finishedTasks
      : null,
  })).sort((a, b) => b.totalTasks - a.totalTasks)
  return {
    summary,
    tasks,
    daily: mergeDaily(sources.flatMap((source) => source.daily || [])),
    models: mergeRows(models, 'model', modelFields).sort((a, b) => b.tasks - a.tasks),
    providers,
    modelTrends: mergeTrends(sources.flatMap((source) => source.modelTrends || [])),
    shopTrends: mergeTrends(sources.flatMap((source) => source.shopTrends || [])),
    userTrends: mergeTrends(sources.flatMap((source) => source.userTrends || [])),
  }
}
