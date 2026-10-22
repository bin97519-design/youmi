// User-defined composer choices only. Selecting a mode records UI intent; it
// does not declare provider capabilities or change the model's API contract.

export const KLING_VIDEO_MODES = Object.freeze(
  [
    { label: '视频参考', icon: 'klingModeVideoReference', disabled: false, reason: '' },
    { label: '参考生', icon: 'klingModeReference', disabled: false, reason: '' },
    { label: '首尾帧', icon: 'klingModeFrames', disabled: false, reason: '' },
  ].map((mode) => Object.freeze(mode)),
)

export function isKling30Model(value) {
  const identity =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? value.model || value.value
        : ''
  return typeof identity === 'string' && identity.trim().toLowerCase() === 'kling 3.0'
}

// Display a safe fallback without migrating or writing to a saved node draft.
export function klingVideoMode(value) {
  return KLING_VIDEO_MODES.find((mode) => mode.label === value) || KLING_VIDEO_MODES[0]
}
