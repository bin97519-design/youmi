import { IMAGE_MODEL_QUALITIES, imageModelVersion, isTtImage25Model } from './imageModelVersions.js'

// Vendor media-protocol enums, verified against the model-specific API docs.
const BANANA_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const TT_RATIOS = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
]

export function imageModelControls(model) {
  const identity = String(
    typeof model === 'object' ? model?.model || model?.value || '' : model || '',
  )
    .trim()
    .toLowerCase()
  const tt = isTtImage25Model(model)
  const banana21 = ['banana-2.1', 'banana21', 'banana_2.1'].includes(identity)
  const pro = ['banana-pro', 'banana-pro-api', 'bananapro', 'gemini-3-pro-image-preview'].includes(
    identity,
  )
  const defaults = { resolution: '2K', ratio: '16:9', count: '1张' }
  const fields = {}
  if (tt) {
    defaults.version = imageModelVersion(model)
    defaults.quality = '标准画质'
    defaults.background = '自动'
    fields.quality = ['画质', IMAGE_MODEL_QUALITIES.map((option) => option.label)]
  }
  fields.resolution = ['清晰度', ['1K', '2K', '4K']]
  if (tt) fields.background = ['背景', ['自动', '保留背景', '透明背景']]
  if (banana21) {
    defaults.thinkingLevel = '快速'
    fields.thinkingLevel = ['思考等级', ['快速', '深度']]
  }
  fields.ratio = [
    '比例',
    tt ? TT_RATIOS : banana21 ? [...BANANA_RATIOS, '1:4', '4:1', '1:8', '8:1'] : BANANA_RATIOS,
  ]
  // The application owns one provider task per idempotency key, regardless of model.
  fields.count = ['生成数量', ['1张']]
  return {
    id: tt ? 'tt-image-2.5' : banana21 ? 'banana-2.1' : pro ? 'banana-pro' : 'generic',
    defaults,
    fields,
    webSearch: banana21,
    customSize: tt,
  }
}

export function imageModelParams(model, params = {}) {
  const profile = imageModelControls(model)
  const result = { ...profile.defaults }
  const aliases = {
    quality: Object.fromEntries(
      IMAGE_MODEL_QUALITIES.map((option) => [option.value, option.label]),
    ),
    background: { auto: '自动', opaque: '保留背景', transparent: '透明背景' },
    thinkingLevel: { minimal: '快速', high: '深度' },
  }
  for (const [key, field] of Object.entries(profile.fields)) {
    const value = aliases[key]?.[params[key]] || params[key]
    if (field[1].includes(value)) result[key] = value
  }
  if (profile.id === 'tt-image-2.5') result.version = imageModelVersion(model, params.version)
  if (profile.customSize && params.customSize != null) result.customSize = params.customSize
  return result
}

export function imageCustomSize(value) {
  if (typeof value !== 'string') throw new Error('请填写自定义尺寸，例如 1536x864 或 auto')
  const size = value.trim().toLowerCase()
  if (size === 'auto') return 'auto'
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) throw new Error('尺寸格式应为像素宽x高，例如 1536x864，或 auto')
  const width = Number(match[1])
  const height = Number(match[2])
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width % 16 ||
    height % 16
  )
    throw new Error('自定义尺寸的宽高必须是 16 的正整数倍')
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels < 655360 || pixels > 8294400)
    throw new Error('自定义尺寸总像素须在 655360～8294400 之间')
  if (width > height * 3 || height > width * 3) throw new Error('自定义尺寸比例须在 1:3～3:1 之间')
  return `${width}x${height}`
}
