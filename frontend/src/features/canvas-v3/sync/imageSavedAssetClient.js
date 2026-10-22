import { createCharacterAssetClient } from './characterAssetClient.js'
import { personalAssetImageUrl, personalAssetKind } from '../config/personalAssetLibrary.js'
import { imageAssetSourceUrl } from '../config/imageAssetCollections.js'

const bounded = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '')

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('已取消', 'AbortError')
}

export function imageSavedAssetPayload(record, imageUrl = record?.imageUrl) {
  const name = bounded(record?.name, 50)
  if (
    !name ||
    [...name].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)
  )
    throw new Error('请填写有效的资产名称')
  if (String(record.name).trim().length > 50) throw new Error('资产名称不能超过 50 字')
  const url = personalAssetImageUrl(imageUrl)
  if (!url) throw new Error('图片尚未上传或地址无效，请重新选择图片')
  const folderId = bounded(record?.folderId, 100)
  const folderPath = Array.isArray(record?.folderPath)
    ? record.folderPath
        .slice(0, 200)
        .map((name) => bounded(name, 40))
        .filter(Boolean)
    : []
  if (!folderId || !folderPath.length) throw new Error('请选择保存位置')
  const tags = [
    ...new Set(
      (Array.isArray(record?.tags) ? record.tags : [])
        .map((tag) => bounded(tag, 30))
        .filter(Boolean),
    ),
  ].slice(0, 100)
  const canvasAsset = {
    folderId,
    folderPath,
    tags,
    sourceNodeId: bounded(record?.sourceNodeId, 100),
  }
  for (const dimension of ['width', 'height']) {
    const value = Number(record?.[dimension])
    if (Number.isFinite(value) && value > 0 && value <= 65536)
      canvasAsset[dimension] = Math.round(value)
  }
  // Whitelist descriptive fields: never persist the node's task, provider, billing or credentials.
  return {
    name,
    imageUrl: url,
    coverUrl: url,
    description: '',
    config: { libraryKind: 'asset', canvasAsset },
  }
}

/** Reuses the account-owned backend personal material API, not generation or a local fake list. */
export function createImageSavedAssetClient({ uploadImage, ...options } = {}) {
  const client = createCharacterAssetClient(options)
  return {
    async list(request = {}) {
      const records = await client.list(request)
      return records.filter(
        (record) => personalAssetKind(record) === 'asset' && personalAssetImageUrl(record.imageUrl),
      )
    },
    async save(record, request = {}) {
      let source = imageAssetSourceUrl(record?.imageUrl)
      if (!source) throw new Error('图片地址无效，无法保存资产')
      // Validate all form metadata before an upload can cause any external write.
      imageSavedAssetPayload(
        record,
        personalAssetImageUrl(source) || 'https://validation.invalid/image.png',
      )
      abortIfNeeded(request.signal)
      if (source.startsWith('data:')) {
        if (typeof uploadImage !== 'function') throw new Error('请先上传图片后重试')
        source = await uploadImage(source, {
          signal: request.signal,
          dir: 'youmi/assets',
          fileName: bounded(record.name, 50),
        })
        abortIfNeeded(request.signal)
      }
      const payload = imageSavedAssetPayload(record, source)
      const result = await client.save(payload, request)
      abortIfNeeded(request.signal)
      if (personalAssetKind(result) !== 'asset' || !personalAssetImageUrl(result.imageUrl))
        throw new Error('服务未确认资产保存成功，请刷新资产库确认后重试')
      return result
    },
  }
}
