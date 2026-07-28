export const IMAGE_MI_PRICES = Object.freeze({
  banana2: Object.freeze({ '1K': 8, '2K': 9, '4K': 12 }),
  'banana-pro': Object.freeze({ '1K': 13, '2K': 15, '4K': 21 }),
  'gpt-image-2': Object.freeze({ '1K': 6, '2K': 10, '4K': 15 }),
})

export function normalizeImageModel(model) {
  const value = String(model || '').trim().toLowerCase()
  const compact = value.replace(/[\s_-]+/g, '')
  if (compact === 'banana2' || value.startsWith('gemini-3.1-flash')) return 'banana2'
  if (compact === 'bananapro' || value.startsWith('gemini-3-pro')) return 'banana-pro'
  if (['gptimage2', 'gptimag2'].includes(compact) || value.startsWith('gpt-image-2')) {
    return 'gpt-image-2'
  }
  return value
}

export function imageMiUnitPrice(model, resolution) {
  const prices = IMAGE_MI_PRICES[normalizeImageModel(model)]
  return prices?.[String(resolution || '').trim().toUpperCase()] ?? 0
}

export function imageMiCost(model, resolution, count = 1) {
  const safeCount = Math.max(1, Math.min(4, Number.parseInt(count, 10) || 1))
  return imageMiUnitPrice(model, resolution) * safeCount
}
