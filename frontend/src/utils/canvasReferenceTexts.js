export function normalizeReferenceTexts(value) {
  const references = new Map()
  for (const reference of Array.isArray(value) ? value : []) {
    const text = String(reference?.text || '').trim()
    if (!text) continue
    const layerId = String(reference.layerId || '')
    const key = layerId || text
    if (!references.has(key))
      references.set(key, {
        layerId,
        text,
        name: String(reference.name || '参考文本'),
      })
  }
  return [...references.values()]
}

export function syncConnectedReferenceTexts(draft, incoming) {
  const connected = normalizeReferenceTexts(incoming)
  const previous = new Set(draft.connectedTextLayerIds || [])
  const byId = new Map(connected.map((reference) => [reference.layerId, reference]))
  const referenceTexts = normalizeReferenceTexts(draft.referenceTexts)
    .map(
      (reference) =>
        byId.get(reference.layerId) || (previous.has(reference.layerId) ? null : reference),
    )
    .filter(Boolean)
  for (const reference of connected) {
    if (
      !referenceTexts.some(
        (item) => item.layerId === reference.layerId && item.text === reference.text,
      )
    )
      referenceTexts.push(reference)
  }
  return {
    referenceTexts,
    connectedTextLayerIds: connected.map((reference) => reference.layerId).filter(Boolean),
  }
}

export function canvasReferenceTextPrompt(prompt, references = [], limit = 10000) {
  const base = String(prompt || '').trim()
  const text = [
    base,
    ...normalizeReferenceTexts(references)
      .filter((reference) => !base.includes(reference.text))
      .map((reference, index) => `参考文本 ${index + 1}（${reference.name}）：\n${reference.text}`),
  ]
    .filter(Boolean)
    .join('\n\n')
  if (text.length > limit)
    throw new Error(`提示词与参考文本合计不能超过 ${limit} 字，请精简文本或移除部分连线`)
  return text
}

export function canvasReferenceTextError(prompt, references, limit) {
  try {
    canvasReferenceTextPrompt(prompt, references, limit)
    return ''
  } catch (error) {
    return error.message
  }
}
