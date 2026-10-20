import { characterStudioAssetFormat } from './characterStudioAssetFormats.js'

export const CHARACTER_ASSET_SLOTS = Object.freeze(
  ['full-body', 'half-body', 'emotion-grid', 'character-sheet'].map((type) =>
    Object.freeze({ type, label: characterStudioAssetFormat(type).label }),
  ),
)

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const aliases = new Map([
  ['full-body', 'full-body'],
  ['fullbody', 'full-body'],
  ['full_body', 'full-body'],
  ['全身图', 'full-body'],
  ['半身图', 'half-body'],
  ['上身图', 'half-body'],
  ['half-body', 'half-body'],
  ['halfbody', 'half-body'],
  ['half_body', 'half-body'],
  ['emotion-grid', 'emotion-grid'],
  ['emotion_grid', 'emotion-grid'],
  ['expression-grid', 'emotion-grid'],
  ['情绪九宫格', 'emotion-grid'],
  ['表情九宫格', 'emotion-grid'],
  ['character-sheet', 'character-sheet'],
  ['character_sheet', 'character-sheet'],
  ['sheet', 'character-sheet'],
  ['角色设定图', 'character-sheet'],
  ['全身三视图＋上身六视图', 'character-sheet'],
  ['全身三视图+上身六视图', 'character-sheet'],
])

/** Only actual remote image assets may be inserted into the graph. */
export function characterAssetUrl(value) {
  const candidate = text(value)
  if (!candidate || candidate.length > 4096) return ''
  try {
    const url = new URL(candidate)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? candidate
      : ''
  } catch {
    return ''
  }
}

function previewSource(value, fallback) {
  const candidate = text(value)
  // Bundled official previews are display-only; never replace the real asset URL.
  return characterAssetUrl(candidate) || (/^\/(?![\\/])/.test(candidate) ? candidate : fallback)
}

export function characterStudioIsOfficial(character = {}) {
  return (
    character.official === true ||
    character.isOfficial === true ||
    /^(official|public|builtin)$/i.test(text(character.source)) ||
    /^(official|public|builtin)$/i.test(text(character.scope)) ||
    /^(official|builtin)[-_]/i.test(text(character.id))
  )
}

/** Classify real saved images without synthesizing missing views from the full-body image. */
export function characterStudioAssets(character = {}, previewUrl = '') {
  const slots = CHARACTER_ASSET_SLOTS.map((slot) => ({ ...slot, asset: null }))
  const extras = []
  const seen = new Set()
  const original = characterAssetUrl(character.imageUrl) || characterAssetUrl(character.coverUrl)
  if (original) {
    slots[0].asset = {
      type: 'full-body',
      name: '全身图',
      url: original,
      previewUrl: previewSource(previewUrl, original),
      nodeId: '',
    }
    seen.add(original)
  }
  const assets = Array.isArray(character.config?.assets) ? character.config.assets : []
  for (const item of assets) {
    if (!item || typeof item !== 'object') continue
    const url = characterAssetUrl(item.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const type =
      aliases.get(text(item.type || item.assetType || item.kind).toLowerCase()) ||
      aliases.get(text(item.name).toLowerCase()) ||
      ''
    const slot = slots.find((entry) => entry.type === type)
    const asset = {
      type,
      name: text(item.name) || slot?.label || '其他角色资产',
      url,
      previewUrl: previewSource(item.previewUrl, url),
      nodeId: text(item.nodeId),
    }
    if (slot && !slot.asset) slot.asset = asset
    else extras.push(asset)
  }
  return { slots, extras }
}
