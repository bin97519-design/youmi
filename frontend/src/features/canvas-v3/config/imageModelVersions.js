export const IMAGE_MODEL_VERSIONS = [
  { value: 'flare', label: '标准版' },
  { value: 'sunburst', label: '增强版' },
]

export const IMAGE_MODEL_QUALITIES = [
  { value: 'low', label: '低画质' },
  { value: 'medium', label: '标准画质' },
  { value: 'high', label: '高画质' },
  { value: 'xhigh', label: '超高画质' },
  { value: 'max', label: '极致画质' },
]

const TT_MODELS = new Set([
  'tt-image-2.5',
  'tt-image-2.5-flare',
  'tt-image-2.5-sunburst',
  'gpt-image2.5',
  'gpt-image-2.5',
  'gpt-image2.5-sunburst-api',
])
const BANANA_PRO_MODELS = new Set([
  'banana-pro',
  'banana-pro-api',
  'bananapro',
  'gemini-3-pro-image-preview',
])

function modelIdentity(model) {
  // A configured route ID and its editable display label are not model identities.
  return String(typeof model === 'object' ? model?.model || model?.value || '' : model || '')
    .trim()
    .toLowerCase()
}

export function isTtImage25Model(model) {
  return TT_MODELS.has(modelIdentity(model))
}

export function imageModelVersion(model, explicitVersion) {
  if (!isTtImage25Model(model)) return undefined
  const supported = (value) => IMAGE_MODEL_VERSIONS.some((option) => option.value === value)
  if (supported(explicitVersion)) return explicitVersion
  if (supported(model?.defaultVersion)) return model.defaultVersion
  return modelIdentity(model).includes('sunburst') ? 'sunburst' : 'flare'
}

export function imageModelLabel(model, fallback = '') {
  if (isTtImage25Model(model)) return 'image-2.5'
  if (BANANA_PRO_MODELS.has(modelIdentity(model))) return 'banana-pro'
  return typeof model === 'object' ? model?.label || model?.value || fallback : model || fallback
}

// Collapse model-family presentation only. Every returned value remains a real
// configured route, and an existing node keeps its exact selected route.
export function imageModelMenuOptions(options = [], selectedValue = '') {
  const configured = Array.isArray(options) ? options : []
  const representative =
    configured.find((option) => option?.value === selectedValue && isTtImage25Model(option)) ||
    configured.find((option) => isTtImage25Model(option))
  let included = false
  return configured.flatMap((option) => {
    if (!isTtImage25Model(option)) {
      if (BANANA_PRO_MODELS.has(modelIdentity(option)) && option.label !== 'banana-pro') {
        return [{ ...option, label: 'banana-pro' }]
      }
      return [option]
    }
    if (included) return []
    included = true
    return [{ ...representative, label: imageModelLabel(representative) }]
  })
}
