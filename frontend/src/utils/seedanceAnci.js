export const SEEDANCE_ANCI_MODEL = 'seedance-2.0-anci'
export const SEEDANCE_ANCI_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
export const SEEDANCE_ANCI_VERSIONS = [
  { value: '快速', label: '快速版' },
  { value: '标准', label: '标准版' },
]
export const isSeedanceAnciModel = (model) => model === SEEDANCE_ANCI_MODEL
export const seedanceAnciVersion = (version) => version === '标准' ? '标准' : '快速'
export const videoVersionPayload = (model, version) =>
  isSeedanceAnciModel(model) ? { version: seedanceAnciVersion(version) } : {}
export function seedanceAnciNotice(model, version, duration) {
  if (!isSeedanceAnciModel(model)) return ''
  return '按条计费，时长不影响单价；快速版与标准版单价不同。' +
    (version === '标准' && Number(duration) === 15 ? '标准版选择15秒时，上游实际成片约10秒，仍按一条计费。' : '')
}
