import { createImageSavedAssetClient } from './imageSavedAssetClient.js'
import { createVideoSavedAssetClient, videoAssetSourceUrl } from './videoSavedAssetClient.js'
import { imageAssetName, imageAssetSourceUrl } from '../config/imageAssetCollections.js'

export const SELECTION_ASSET_LIMIT = 50
const RETRYABLE = new Set(['pending', 'failed'])

function abortError() {
  return new DOMException('已停止保存', 'AbortError')
}

function capturedHeaders(headers) {
  const value = typeof headers === 'function' ? headers() : headers
  return value instanceof Headers ? Object.fromEntries(value.entries()) : { ...value }
}

/** An opening-time whitelist, never a live node/task/provider object. */
export function selectionAssetSnapshots(nodes = []) {
  const snapshots = []
  const ids = new Set()
  const objects = new WeakSet()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue
    const data = node.data || {}
    if (!['image', 'video'].includes(data.kind)) continue
    const sourceNodeId = typeof node.id === 'string' ? node.id : String(node.id ?? '')
    if (sourceNodeId) {
      if (ids.has(sourceNodeId)) continue
      ids.add(sourceNodeId)
    } else {
      if (objects.has(node)) continue
      objects.add(node)
    }
    const kind = data.kind
    const fileName = String(
      data.title || data.fileName || (kind === 'video' ? '未命名视频' : '未命名图片'),
    )
    const name = imageAssetName(
      fileName.replace(/\.(?:png|jpe?g|webp|gif|avif|bmp|mp4|mov|webm|m4v|avi|mkv|ogg)$/i, ''),
    )
    const sourceUrl =
      kind === 'image'
        ? imageAssetSourceUrl(data.assetUrl || data.imageUrl || '')
        : videoAssetSourceUrl(data.assetUrl || data.videoUrl || '')
    snapshots.push(
      Object.freeze({
        key: sourceNodeId ? `${kind}:${sourceNodeId}` : `${kind}:selection-${snapshots.length}`,
        kind,
        sourceNodeId,
        name,
        fileName,
        sourceUrl,
        posterUrl:
          kind === 'video' ? videoAssetSourceUrl(data.posterUrl || data.thumbnail || '') : '',
        width: data.mediaWidth || data.width,
        height: data.mediaHeight || data.height,
        duration:
          kind === 'video'
            ? data.mediaDuration || data.durationSeconds || data.duration
            : undefined,
      }),
    )
    if (snapshots.length > SELECTION_ASSET_LIMIT)
      throw new Error(`每次最多保存 ${SELECTION_ASSET_LIMIT} 项资产，请减少选择后重试`)
  }
  return Object.freeze(snapshots)
}

function current(request) {
  if (request.signal?.aborted) return false
  try {
    return request.isCurrent ? request.isCurrent() === true : true
  } catch {
    return false
  }
}

function message(error) {
  return typeof error?.message === 'string' && error.message
    ? error.message.replaceAll('模特', '资产').replaceAll('角色库', '资产库')
    : '保存失败，请稍后重试'
}

function isDefiniteRejection(error) {
  return (
    (Number.isFinite(error?.status) && error.status >= 400 && error.status < 500) ||
    (error?.code != null && error.code !== 0)
  )
}

/**
 * Sequential independent cloud saves, not an atomic transaction. Construction,
 * snapshots and state reads never upload, fetch or persist anything.
 */
export function createSelectionSavedAssets(options = {}) {
  return Object.freeze({
    createBatch(items) {
      if (!Array.isArray(items) || items.length > SELECTION_ASSET_LIMIT)
        throw new Error(`每次最多保存 ${SELECTION_ASSET_LIMIT} 项资产`)
      const seen = new Set()
      const rows = items.map((item) => {
        if (!item?.key || !['image', 'video'].includes(item.kind) || seen.has(item.key))
          throw new Error('待保存资产快照无效，请重新打开保存窗口')
        seen.add(item.key)
        const source = { ...item }
        return {
          ...source,
          status: source.sourceUrl ? 'pending' : 'invalid',
          error: source.sourceUrl
            ? ''
            : `${source.kind === 'video' ? '视频' : '图片'}尚无可保存产物或地址无效`,
          saved: null,
        }
      })
      let running = false
      let activeController = null
      const state = () => rows.map((row) => ({ ...row }))
      function summary(newlySaved = [], cancelled = false) {
        return {
          rows: state(),
          newlySaved: [...newlySaved],
          cancelled,
          saved: rows.filter((row) => row.status === 'saved').map((row) => row.saved),
          failed: rows
            .filter((row) => row.status === 'failed' || row.status === 'invalid')
            .map((row) => ({ ...row })),
          uncertain: rows.filter((row) => row.status === 'uncertain').map((row) => ({ ...row })),
          pending: rows.filter((row) => row.status === 'pending').map((row) => ({ ...row })),
        }
      }
      return Object.freeze({
        state,
        cancel() {
          activeController?.abort()
        },
        async run(details = {}, request = {}) {
          if (running) throw new Error('正在保存，请勿重复提交')
          if (!current(request)) throw abortError()
          const folderId = typeof details.folderId === 'string' ? details.folderId.trim() : ''
          const folderPath = Array.isArray(details.folderPath) ? [...details.folderPath] : []
          if (!folderId || !folderPath.length) throw new Error('请选择保存位置')
          const tags = Array.isArray(details.tags) ? [...details.tags] : []
          const names = { ...details.names }
          const targets = rows.filter((row) => RETRYABLE.has(row.status))
          if (!targets.length) return summary()
          running = true
          const controller = new AbortController()
          activeController = controller
          const stop = () => controller.abort()
          request.signal?.addEventListener('abort', stop, { once: true })
          const isCurrent = () => !controller.signal.aborted && current(request)
          const update = () => {
            if (current(request)) {
              // A UI observer must not turn a confirmed save into a failed item.
              try {
                request.onProgress?.(state())
              } catch {
                /* Observer owns its UI errors. */
              }
            }
          }
          let postStarted = false
          const fetcher = options.fetcher || globalThis.fetch
          const trackedFetcher = async (url, init) => {
            if (!isCurrent()) throw abortError()
            if (String(init?.method || 'GET').toUpperCase() === 'POST') postStarted = true
            return fetcher(url, init)
          }
          // All requests in this explicit run use the same opening account's
          // headers; a later account switch cannot redirect a queued item.
          const newlySaved = []
          try {
            const fixedOptions = {
              ...options,
              headers: capturedHeaders(options.headers),
              fetcher: trackedFetcher,
            }
            const imageClient = createImageSavedAssetClient(fixedOptions)
            const videoClient = createVideoSavedAssetClient(fixedOptions)
            for (const row of targets) {
              if (!isCurrent()) break
              postStarted = false
              row.status = 'saving'
              row.error = ''
              const name = Object.hasOwn(names, row.key) ? names[row.key] : row.name
              row.name = typeof name === 'string' ? name : ''
              update()
              const record = {
                name: row.name,
                folderId,
                folderPath,
                tags,
                sourceNodeId: row.sourceNodeId,
                width: row.width,
                height: row.height,
                ...(row.kind === 'image'
                  ? { imageUrl: row.sourceUrl }
                  : { videoUrl: row.sourceUrl, posterUrl: row.posterUrl, duration: row.duration }),
              }
              try {
                const saved = await (row.kind === 'image' ? imageClient : videoClient).save(
                  record,
                  { signal: controller.signal },
                )
                if (!isCurrent()) throw abortError()
                row.saved = saved
                row.status = 'saved'
                newlySaved.push(saved)
                update()
              } catch (error) {
                const stopped = !isCurrent() || error?.name === 'AbortError'
                if (postStarted && (stopped || !isDefiniteRejection(error))) {
                  row.status = 'uncertain'
                  row.error = '保存结果未确认，请先到资产库核对；此项不会自动重试，以免重复保存'
                } else if (stopped) {
                  row.status = 'pending'
                  row.error = ''
                } else {
                  row.status = 'failed'
                  row.error = message(error)
                }
                update()
                if (stopped) break
              }
            }
            return summary(newlySaved, !isCurrent())
          } finally {
            request.signal?.removeEventListener('abort', stop)
            if (activeController === controller) activeController = null
            running = false
          }
        },
      })
    },
  })
}
