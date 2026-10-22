import {
  DIRECTOR_ATTACHMENT_LIMIT,
  directorAttachmentMaxBytes,
  normalizeDirectorAsset,
} from './directorAttachments.js'
import { imageAssetSourceUrl } from './imageAssetCollections.js'
import { personalAssetImageUrl } from './personalAssetLibrary.js'

export const DIRECTOR_CANVAS_SELECTION_LIMITS = Object.freeze({ textPerNode: 4000, prompt: 12000 })

function selectionAsset(node, index) {
  const data = node?.data || {}
  const kind = data.kind
  const source =
    kind === 'image' ? imageAssetSourceUrl(data.assetUrl) : personalAssetImageUrl(data.assetUrl)
  if (!source) throw new Error('素材尚未就绪或地址不安全，请先上传图片或视频')
  let size = Number(data.fileSize) || 0
  if (!Number.isFinite(size) || size < 0 || size > directorAttachmentMaxBytes({ kind }))
    throw new Error('素材大小超过当前 Chat 附件限制')
  if (source.startsWith('data:')) {
    const payload = source.slice(source.indexOf(',') + 1)
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
    if (
      payload.length % 4 ||
      (payload.length * 3) / 4 - padding > directorAttachmentMaxBytes({ kind })
    )
      throw new Error('内嵌图片数据无效或超过 20MB')
    size = (payload.length * 3) / 4 - padding
  }
  if (data.mimeType && !String(data.mimeType).toLowerCase().startsWith(`${kind}/`))
    throw new Error('素材类型与节点不一致')
  if (String(data.mimeType || '').toLowerCase() === 'image/svg+xml')
    throw new Error('不支持 SVG 图片，请先转为位图')
  const nodeId = typeof node?.id === 'string' ? node.id : `canvas-selection-${index + 1}`
  const preview = personalAssetImageUrl(data.thumbnail || data.posterUrl) || source
  return normalizeDirectorAsset({
    id: nodeId,
    layerId: nodeId,
    name: typeof data.title === 'string' ? data.title : `${kind === 'image' ? '图片' : '视频'}素材`,
    kind,
    mimeType:
      data.mimeType || (source.startsWith('data:') ? source.slice(5, source.indexOf(';')) : ''),
    size,
    url: source,
    previewUrl: preview,
  })
}

/** Pure append plan. It neither mutates the existing draft nor sends/upload/generates anything. */
export function directorCanvasSelectionIntent(
  nodes,
  {
    existingAttachments = [],
    prompt = '',
    currentScope = {},
    expectedScope = {},
    blockedReason = '',
  } = {},
) {
  const selection = Array.isArray(nodes) ? nodes : []
  const currentPrompt = typeof prompt === 'string' ? prompt : ''
  const stale = ['projectId', 'sessionId', 'conversationId'].some(
    (key) =>
      Object.hasOwn(expectedScope, key) &&
      expectedScope[key] !== undefined &&
      expectedScope[key] !== currentScope[key],
  )
  const assets = []
  const rejections = []
  const existing = Array.isArray(existingAttachments) ? existingAttachments : []
  const identities = new Set(existing.map((asset) => asset.layerId || asset.url || asset.id))
  let nextPrompt = currentPrompt
  let acceptedTextCount = 0
  let duplicateCount = 0
  for (const [index, node] of selection.entries()) {
    const data = node?.data || {}
    const nodeId = typeof node?.id === 'string' ? node.id : `canvas-selection-${index + 1}`
    try {
      if (stale) throw new Error('画布或对话已切换，请重新选择素材')
      if (blockedReason) throw new Error(blockedReason)
      if (['text', 'script', 'reference'].includes(data.kind)) {
        const raw = data.prompt || data.text
        const content = typeof raw === 'string' ? raw.trim() : ''
        if (!content) throw new Error('文本节点内容为空')
        if (content.length > DIRECTOR_CANVAS_SELECTION_LIMITS.textPerNode)
          throw new Error('单个文本节点超过 4000 字，请精简后添加')
        if (nextPrompt.includes(content)) {
          duplicateCount++
          throw new Error('该文本已在当前草稿中')
        }
        const title =
          typeof data.title === 'string' ? [...data.title].slice(0, 100).join('') : '画布文本'
        const addition = `【${title}】\n${content}`
        if (
          nextPrompt.length + addition.length + (nextPrompt ? 2 : 0) >
          DIRECTOR_CANVAS_SELECTION_LIMITS.prompt
        )
          throw new Error('当前草稿最多追加至 12000 字，请精简后添加')
        nextPrompt += `${nextPrompt ? '\n\n' : ''}${addition}`
        acceptedTextCount++
        continue
      }
      if (!['image', 'video'].includes(data.kind))
        throw new Error('此入口仅支持图片、视频和文本节点')
      const asset = selectionAsset(node, index)
      const identity = asset.layerId || asset.url || asset.id
      if (identities.has(identity)) {
        duplicateCount++
        throw new Error('该素材已在当前对话附件中')
      }
      if (existing.length + assets.length >= DIRECTOR_ATTACHMENT_LIMIT)
        throw new Error(`当前对话最多添加 ${DIRECTOR_ATTACHMENT_LIMIT} 个附件`)
      identities.add(identity)
      assets.push(asset)
    } catch (error) {
      rejections.push({ nodeId, reason: error.message || '无法添加选中内容' })
    }
  }
  return {
    assets,
    prompt: nextPrompt,
    acceptedCount: assets.length + acceptedTextCount,
    acceptedMediaCount: assets.length,
    acceptedTextCount,
    rejectedCount: rejections.length,
    duplicateCount,
    rejections,
    stale,
    blocked: Boolean(blockedReason),
  }
}
