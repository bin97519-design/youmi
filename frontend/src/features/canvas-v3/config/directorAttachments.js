export const DIRECTOR_ATTACHMENT_LIMIT = 10

export const DIRECTOR_ATTACHMENT_ACCEPT = [
  'image/*',
  'video/*',
  'audio/*',
  '.pdf',
  '.txt',
  '.md',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
].join(',')

export const DIRECTOR_ATTACHMENT_LIMITS = Object.freeze({
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  file: 20 * 1024 * 1024,
})

export function directorAttachmentKind(value) {
  const type = String(value?.type || value?.mimeType || '').toLowerCase()
  const declared = String(value?.kind || '').toLowerCase()
  if (['image', 'video', 'audio'].includes(declared)) return declared
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function directorAttachmentMaxBytes(value) {
  return (
    DIRECTOR_ATTACHMENT_LIMITS[directorAttachmentKind(value)] || DIRECTOR_ATTACHMENT_LIMITS.file
  )
}

export function directorAttachmentSizeLabel(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function normalizeDirectorAsset(asset) {
  if (!asset) return null
  const url = String(asset.url || asset.assetUrl || '').trim()
  if (!url) return null
  const layerId = String(asset.layerId || asset.nodeId || asset.id || '').trim()
  return {
    id: String(asset.id || layerId || url),
    layerId,
    name: String(asset.name || asset.title || '未命名素材'),
    kind: directorAttachmentKind(asset),
    mimeType: String(asset.mimeType || ''),
    size: Math.max(0, Number(asset.size) || 0),
    url,
    previewUrl: String(asset.previewUrl || asset.thumbnail || url),
    source: 'library',
    status: 'ready',
    progress: 100,
  }
}

export function serializeDirectorAttachment(attachment) {
  if (!attachment?.url || attachment.status !== 'ready') return null
  return {
    type: 'attachment',
    id: String(attachment.id || ''),
    layerId: String(attachment.layerId || ''),
    name: String(attachment.name || '未命名素材'),
    kind: directorAttachmentKind(attachment),
    mimeType: String(attachment.mimeType || ''),
    size: Math.max(0, Number(attachment.size) || 0),
    url: String(attachment.url),
    source: attachment.source === 'library' ? 'library' : 'upload',
    ...(['product', 'style', 'other'].includes(attachment.referenceRole)
      ? { referenceRole: attachment.referenceRole }
      : {}),
  }
}
