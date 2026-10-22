import { KLING_OMNI_API_MODELS } from './klingOmniParameters.js'

function identity(value) {
  const name =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? value.model || value.value
        : ''
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

// API identity only. Editable labels and the historical Kling 3.0 UI token are
// never proof of a billable provider route or of a particular Omni capability.
export function klingOmniModeForModel(value) {
  const name = identity(value)
  return Object.entries(KLING_OMNI_API_MODELS).find(([, model]) => model === name)?.[0] || ''
}

export function isKlingOmniApiModel(value) {
  return Boolean(klingOmniModeForModel(value))
}

export function klingOmniApiModelForMode(mode) {
  return Object.hasOwn(KLING_OMNI_API_MODELS, mode) ? KLING_OMNI_API_MODELS[mode] : ''
}
