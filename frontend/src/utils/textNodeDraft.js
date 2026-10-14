export const TEXT_NODE_INSTRUCTION_LIMIT = 4000
export const TEXT_NODE_CONTENT_LIMIT = 20000
export const TEXT_NODE_CONTEXT_LIMIT = 24000

function normalizeReferences(value) {
  const references = new Map()
  for (const item of Array.isArray(value) ? value : []) {
    const kind = item?.kind === 'text' ? 'text' : 'image'
    const layerId = String(item?.layerId || '')
    const content = String(kind === 'text' ? item?.text || '' : item?.url || '').trim()
    if (!content || (kind === 'image' && !/^https?:\/\//i.test(content))) continue
    const key = `${kind}:${layerId || content}`
    if (references.has(key)) continue
    references.set(key, {
      kind,
      layerId,
      name: String(item.name || (kind === 'text' ? '参考文本' : '参考图片')),
      ...(kind === 'text'
        ? { text: content }
        : { url: content, thumbnailUrl: String(item.thumbnailUrl || '') }),
    })
  }
  return [...references.values()]
}

export function normalizeTextNodeDraft(value = {}, defaultModel = '') {
  value ||= {}
  return {
    prompt: String(value.prompt || ''),
    model: String(value.model || defaultModel),
    references: normalizeReferences(value.references),
    connectedLayerIds: [
      ...new Set(
        (Array.isArray(value.connectedLayerIds) ? value.connectedLayerIds : [])
          .map(String)
          .filter(Boolean),
      ),
    ],
    pendingResult: String(value.pendingResult || ''),
  }
}

export function syncTextNodeReferences(draft, images = [], texts = [], layers = []) {
  const current = normalizeTextNodeDraft(draft)
  const incoming = normalizeReferences([
    ...images.map((item) => ({ ...item, kind: 'image' })),
    ...texts.map((item) => ({ ...item, kind: 'text' })),
  ])
  const byId = new Map(incoming.map((item) => [item.layerId, item]))
  const byLayer = new Map(layers.map((layer) => [layer.id, layer]))
  const previous = new Set(current.connectedLayerIds)
  const references = current.references
    .map((item) => {
      if (byId.has(item.layerId)) return byId.get(item.layerId)
      if (previous.has(item.layerId)) return null
      const layer = byLayer.get(item.layerId)
      if (!layer) return item
      return item.kind === 'text'
        ? { ...item, text: layer.text || '' }
        : { ...item, url: layer.url || '', thumbnailUrl: layer.thumbnailUrl || '' }
    })
    .filter(Boolean)
  return normalizeTextNodeDraft({
    ...current,
    references: [...references, ...incoming],
    connectedLayerIds: incoming.map((item) => item.layerId),
  })
}

export function textNodeRequestError(draft, text = '') {
  if (!draft.prompt.trim()) return '请输入文本生成或修改要求'
  if (draft.prompt.length > TEXT_NODE_INSTRUCTION_LIMIT) return '文本要求不能超过4000字'
  if (String(text).length > TEXT_NODE_CONTENT_LIMIT) return '当前文本不能超过20000字'
  const images = draft.references.filter((item) => item.kind === 'image')
  const texts = draft.references.filter((item) => item.kind === 'text')
  if (images.length > 8) return '最多支持8张参考图片'
  if (texts.length > 6) return '最多支持6个参考文本'
  if (texts.some((item) => item.text.length > 12000)) return '单个参考文本不能超过12000字'
  if (
    String(text).length + texts.reduce((sum, item) => sum + item.text.length, 0) >
    TEXT_NODE_CONTEXT_LIMIT
  )
    return '当前文本与参考文本合计不能超过24000字'
  return ''
}

export function textNodeRequest(canvasId, layer, draft) {
  const error = textNodeRequestError(draft, layer.text || '')
  if (error) throw new Error(error)
  return {
    canvasId,
    layerId: layer.id,
    instruction: draft.prompt.trim(),
    text: String(layer.text || ''),
    agentModel: draft.model,
    imageUrls: [
      ...new Set(draft.references.filter((item) => item.kind === 'image').map((item) => item.url)),
    ],
    referenceTexts: draft.references
      .filter((item) => item.kind === 'text')
      .map((item) => ({ name: item.name, text: item.text })),
  }
}

export function textNodeResultPatch(layer, submitted, response, editing = false) {
  const text = String(response?.text || '').trim()
  if (!text || text.length > TEXT_NODE_CONTENT_LIMIT)
    throw new Error(text ? '返回文本超过20000字，原文已保留' : '没有返回文本，原文已保留')
  const current = normalizeTextNodeDraft(layer.textNodeDraft, submitted.model)
  const canApply = !editing && !layer.locked && String(layer.text || '') === submitted.text
  return {
    ...(canApply ? { text } : {}),
    textNodeDraft: {
      ...current,
      prompt: canApply && current.prompt.trim() === submitted.instruction ? '' : current.prompt,
      pendingResult: canApply ? '' : text,
    },
    textNodeLastResult: {
      model: response.model || submitted.model,
      provider: response.provider || '',
      updatedAt: Date.now(),
    },
  }
}
