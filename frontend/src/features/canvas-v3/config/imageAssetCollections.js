import { personalAssetImageUrl } from './personalAssetLibrary.js'

export const IMAGE_ASSET_DEFAULT_FOLDER = 'uncategorized'
export const IMAGE_ASSET_DEFAULT_TAGS = Object.freeze(['角色', '场景', '物品', '风格', '音效'])
const safeText = (value, max = 50) =>
  typeof value === 'string' &&
  ![...value].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)
    ? value.trim().slice(0, max)
    : ''
const safeId = (value) => safeText(String(value ?? ''), 100)

/** Raster-only inline images may be uploaded on Save; active SVG / temporary blob URLs may not. */
export function imageAssetSourceUrl(value) {
  const remote = personalAssetImageUrl(value)
  if (remote) return remote
  if (typeof value !== 'string' || value.length > 28 * 1024 * 1024) return ''
  return /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-zA-Z0-9+/]+={0,2}$/i.test(value)
    ? value
    : ''
}

export function imageAssetName(value) {
  return safeText(value, 50) || '未命名图片'
}

export function imageAssetCollectionKey(userId) {
  const id = safeId(userId)
  return id ? `youmi:canvas-v3:image-asset-collections:${encodeURIComponent(id)}` : ''
}

/** Defensive parsing also prevents broken/cyclic folder trees from trapping the dropdown. */
export function normalizeImageAssetCollections(value) {
  const folders = [{ id: IMAGE_ASSET_DEFAULT_FOLDER, name: '待分类资产', parentId: '' }]
  const seen = new Set([IMAGE_ASSET_DEFAULT_FOLDER])
  const pending = Array.isArray(value?.folders) ? value.folders.slice(0, 200) : []
  for (let pass = 0; pass < pending.length + 1; pass += 1) {
    let changed = false
    for (const folder of pending) {
      const id = safeId(folder?.id)
      const parentId = safeId(folder?.parentId)
      const name = safeText(folder?.name, 40)
      if (!id || !name || seen.has(id) || (parentId && !seen.has(parentId))) continue
      folders.push({ id, name, parentId })
      seen.add(id)
      changed = true
    }
    if (!changed) break
  }
  const tags = [...IMAGE_ASSET_DEFAULT_TAGS]
  for (const valueTag of Array.isArray(value?.tags) ? value.tags.slice(0, 100) : []) {
    const name = safeText(valueTag, 30)
    if (name && !tags.includes(name)) tags.push(name)
  }
  return { folders, tags }
}

export function loadImageAssetCollections(storage, userId) {
  const key = imageAssetCollectionKey(userId)
  if (!key) return normalizeImageAssetCollections()
  try {
    return normalizeImageAssetCollections(JSON.parse(storage?.getItem(key) || 'null'))
  } catch {
    return normalizeImageAssetCollections()
  }
}

/** Explicit folder/tag edits only. An unauthenticated shared browser never gets a shared store. */
export function saveImageAssetCollections(storage, userId, value) {
  const key = imageAssetCollectionKey(userId)
  if (!key || !storage?.setItem) throw new Error('请先登录后再管理资产目录')
  const normalized = normalizeImageAssetCollections(value)
  try {
    storage.setItem(key, JSON.stringify(normalized))
  } catch {
    throw new Error('无法保存本机资产目录，请检查浏览器存储权限')
  }
  return normalized
}

export function imageAssetFolderPath(folders, folderId) {
  const path = []
  const seen = new Set()
  let folder = folders?.find((item) => item.id === folderId)
  while (folder && !seen.has(folder.id)) {
    path.unshift(folder.name)
    seen.add(folder.id)
    folder = folders.find((item) => item.id === folder.parentId)
  }
  return path
}
