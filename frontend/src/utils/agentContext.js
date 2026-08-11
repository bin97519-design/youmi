function normalizeReferenceImages(images, limit) {
  const result = []
  const seenUrls = new Set()

  for (const image of Array.isArray(images) ? images : []) {
    if (!image || image.uploading || image.error) continue
    const url = String(typeof image === 'string' ? image : image.url || '').trim()
    if (!url || url.startsWith('blob:') || seenUrls.has(url)) continue
    seenUrls.add(url)
    result.push({
      id: typeof image === 'string' ? '' : String(image.id || ''),
      layerId: typeof image === 'string' ? '' : String(image.layerId || ''),
      name: typeof image === 'string' ? '' : String(image.name || ''),
      url,
    })
    if (result.length >= limit) break
  }

  return result
}

export function resolveAgentReferenceImages({ currentImages, messages, limit = 8 } = {}) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 8))
  const current = normalizeReferenceImages(currentImages, safeLimit)
  if (current.length) return { images: current, inherited: false }

  const history = Array.isArray(messages) ? messages : []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (!message?.agent || message.role !== 'user') continue
    const inherited = normalizeReferenceImages(message.referenceImages, safeLimit)
    if (inherited.length) return { images: inherited, inherited: true }
  }

  return { images: [], inherited: false }
}
