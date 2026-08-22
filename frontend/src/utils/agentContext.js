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

export function resolveAgentReferenceImages({ currentImages, limit = 8 } = {}) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 8))
  const current = normalizeReferenceImages(currentImages, safeLimit)
  return { images: current, inherited: false }
}
