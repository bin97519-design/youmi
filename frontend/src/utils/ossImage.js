const OSS_IMAGE_HOST = 'huami-canvas.oss-cn-shanghai.aliyuncs.com'

export function buildOssThumbnailUrl(url, options = {}) {
  const sourceUrl = String(url || '').trim()
  if (!sourceUrl || sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:')) return sourceUrl
  if (/[?&]x-oss-process=/i.test(sourceUrl)) return sourceUrl

  try {
    const parsed = new URL(sourceUrl)
    if (parsed.hostname.toLowerCase() !== OSS_IMAGE_HOST) return sourceUrl
    if (/[?&](expires|ossaccesskeyid|signature)=/i.test(sourceUrl)) return sourceUrl

    const width = Math.max(64, Math.min(1600, Math.round(Number(options.width) || 800)))
    const height = Math.max(64, Math.min(1600, Math.round(Number(options.height) || width)))
    const quality = Math.max(40, Math.min(95, Math.round(Number(options.quality) || 80)))
    const process = `image/resize,m_lfit,w_${width},h_${height}/quality,q_${quality}/format,webp`
    return `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}x-oss-process=${process}`
  } catch {
    return sourceUrl
  }
}
