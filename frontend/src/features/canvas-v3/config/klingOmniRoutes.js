import { KLING_OMNI_API_MODELS } from './klingOmniParameters.js'
import { klingVideoMode } from './klingVideoModes.js'
import { klingOmniModeForModel } from './klingOmniIdentity.js'

// The aggregate composer choice is not a credential. Resolve the active intent
// against its exact managed API identity; never borrow another mode's key.
export function resolveKlingOmniRoute(selection, mode, configured = []) {
  const label = klingVideoMode(mode).label
  const identity = KLING_OMNI_API_MODELS[label]
  const selected = typeof selection === 'object' ? selection?.value : selection
  const choices = configured.filter(
    (option) => option?.value && klingOmniModeForModel(option) === label,
  )
  const explicit = choices.find((option) => option.value === selected)
  if (explicit) return explicit
  if (!choices.length)
    throw new Error(
      `可灵-Omni「${label}」尚未配置对应接口 ${identity}，请在模型管理中配置并绑定画布视频功能`,
    )
  if (choices.length > 1)
    throw new Error(`可灵-Omni「${label}」配置了多条线路，请明确选择线路或保留唯一有效配置`)
  return choices[0]
}
