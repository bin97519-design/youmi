import { createCharacterAssetClient } from './characterAssetClient.js'
import { personalAssetImageUrl, personalAssetKind } from '../config/personalAssetLibrary.js'

const bounded = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
export const videoAssetSourceUrl = (value) => personalAssetImageUrl(value)

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('已取消', 'AbortError')
}

/** Explicit media metadata, not file extensions or a possibly edited display name. */
export function videoSavedAssetInfo(record) {
  if (personalAssetKind(record) !== 'asset' || record?.config?.mediaKind !== 'video') return null
  const url = videoAssetSourceUrl(record.config.videoUrl)
  if (!url) return null
  const meta = record.config.canvasAsset || {}
  const info = {
    url,
    posterUrl: personalAssetImageUrl(record.config.posterUrl || record.coverUrl) || '',
  }
  for (const dimension of ['width', 'height']) {
    const value = Number(meta[dimension])
    if (Number.isFinite(value) && value > 0 && value <= 65536) info[dimension] = Math.round(value)
  }
  const duration = Number(meta.duration)
  if (Number.isFinite(duration) && duration > 0 && duration <= 86400) info.duration = duration
  return info
}

export function savedAssetMediaKind(record) {
  if (videoSavedAssetInfo(record)) return 'video'
  if (
    personalAssetKind(record) === 'asset' &&
    (!record.config.mediaKind || record.config.mediaKind === 'image') &&
    personalAssetImageUrl(record.imageUrl)
  )
    return 'image'
  return ''
}

export function videoSavedAssetPayload(record = {}) {
  const name = bounded(record.name, 50)
  if (
    !name ||
    [...name].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)
  )
    throw new Error('请填写有效的资产名称')
  if (String(record.name).trim().length > 50) throw new Error('资产名称不能超过 50 字')
  const videoUrl = videoAssetSourceUrl(record.videoUrl)
  if (!videoUrl) throw new Error('视频尚未上传或地址无效，请重新选择视频')
  const folderId = bounded(record.folderId, 100)
  const folderPath = Array.isArray(record.folderPath)
    ? record.folderPath
        .slice(0, 200)
        .map((name) => bounded(name, 40))
        .filter(Boolean)
    : []
  if (!folderId || !folderPath.length) throw new Error('请选择保存位置')
  const posterUrl = personalAssetImageUrl(record.posterUrl) || ''
  const canvasAsset = {
    folderId,
    folderPath,
    tags: [
      ...new Set(
        (Array.isArray(record.tags) ? record.tags : [])
          .map((tag) => bounded(tag, 30))
          .filter(Boolean),
      ),
    ].slice(0, 100),
    sourceNodeId: bounded(record.sourceNodeId, 100),
  }
  for (const dimension of ['width', 'height']) {
    const value = Number(record[dimension])
    if (Number.isFinite(value) && value > 0 && value <= 65536)
      canvasAsset[dimension] = Math.round(value)
  }
  const duration = Number(record.duration)
  if (Number.isFinite(duration) && duration > 0 && duration <= 86400)
    canvasAsset.duration = duration
  // Leave imageUrl empty so legacy image-only clients never mistake this video
  // (or its poster) for a saved image. No task, credential or billing data is copied.
  return {
    name,
    imageUrl: '',
    coverUrl: posterUrl,
    description: '',
    config: { libraryKind: 'asset', mediaKind: 'video', videoUrl, posterUrl, canvasAsset },
  }
}

/** Uses the existing account-owned cloud material API; never submits generation. */
export function createVideoSavedAssetClient(options = {}) {
  const client = createCharacterAssetClient(options)
  return {
    async list({ includeImages = false, ...request } = {}) {
      const records = await client.list(request)
      abortIfNeeded(request.signal)
      return records.filter((record) => {
        const kind = savedAssetMediaKind(record)
        return kind === 'video' || (includeImages && kind === 'image')
      })
    },
    async save(record, request = {}) {
      const payload = videoSavedAssetPayload(record)
      abortIfNeeded(request.signal)
      const saved = await client.save(payload, request)
      abortIfNeeded(request.signal)
      if (videoSavedAssetInfo(saved)?.url !== payload.config.videoUrl)
        throw new Error('服务未确认视频资产保存成功，请刷新资产库确认后重试')
      return saved
    },
  }
}
