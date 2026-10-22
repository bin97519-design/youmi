export const SEEDANCE25_MODEL = 'doubao-seedance-2-5-260628'
export const SEEDANCE20_ANCI_MODEL = 'seedance-2.0-anci'
export const MINIMAX_H3_MODEL = 'minimax-h3'

const SEEDANCE25_IDENTITIES = new Set([SEEDANCE25_MODEL, 'seedance-2.5-guanfang-anmiao'])
const RATIOS = ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
const RESOLUTIONS = ['480P', '720P', '1080P']
const H3_RESOLUTIONS = ['768P', '1080P', '2K', '4K']

function modelIdentity(model) {
  return String(typeof model === 'object' ? model?.model || model?.value || '' : model || '')
    .trim()
    .toLowerCase()
}

export function isSeedance25Model(model) {
  return SEEDANCE25_IDENTITIES.has(modelIdentity(model))
}

export function isMinimaxH3Model(model) {
  return modelIdentity(model) === MINIMAX_H3_MODEL
}

export function isSeedance20AnciModel(model) {
  return modelIdentity(model) === SEEDANCE20_ANCI_MODEL
}

// Model profiles are protocol-specific; the per-call branch is not an alias
// for the native per-second Seedance endpoint or its first/last-frame modes.
export function videoModelControls(model, mode = '') {
  if (isSeedance20AnciModel(model))
    return {
      id: SEEDANCE20_ANCI_MODEL,
      defaults: { ratio: '16:9', resolution: '720P', duration: 5, version: '快速' },
      fields: {
        ratio: ['比例', ['16:9', '9:16', '1:1', '4:3', '3:4']],
        resolution: ['清晰度', ['720P']],
        duration: ['视频时长', Array.from({ length: 12 }, (_, index) => index + 4)],
        version: ['速度版本', ['快速', '标准']],
      },
      modes: ['文生视频', '图片参考'],
      switches: [],
      durationMin: 4,
      durationMax: 15,
    }
  const seedance25 = isSeedance25Model(model)
  const minimaxH3 = isMinimaxH3Model(model)
  if (!seedance25 && !minimaxH3) return { id: 'generic' }
  const seedanceFirstFrame = seedance25 && mode === '图生视频'
  return {
    id: minimaxH3 ? MINIMAX_H3_MODEL : 'seedance-2.5',
    defaults: {
      ratio: 'Auto',
      resolution: minimaxH3 ? '768P' : '720P',
      duration: 5,
    },
    fields: {
      ratio: ['比例', seedanceFirstFrame ? ['Auto'] : [...RATIOS]],
      resolution: ['清晰度', [...(minimaxH3 ? H3_RESOLUTIONS : RESOLUTIONS)]],
      duration: ['视频时长', 'number'],
    },
    modes: minimaxH3
      ? ['首尾帧', '参考生']
      : ['文生视频', '全能参考', '图生视频', '首尾帧', '图片参考'],
    switches: seedance25 ? ['联网搜索'] : [],
    durationMin: 4,
    durationMax: minimaxH3 ? 15 : 30,
  }
}

// Used for UI defaults/model switches. Submission independently validates input.
export function videoModelParams(model, params = {}, mode = '') {
  const profile = videoModelControls(model, mode)
  if (profile.id === 'generic') return { ...params }
  const result = { ...profile.defaults }
  const ratio = params.ratio === 'adaptive' ? 'Auto' : params.ratio
  const resolution = String(params.resolution || '').toUpperCase()
  if (profile.fields.ratio[1].includes(ratio)) result.ratio = ratio
  if (profile.fields.resolution[1].includes(resolution)) result.resolution = resolution
  if (
    Number.isInteger(params.duration) &&
    params.duration >= profile.durationMin &&
    params.duration <= profile.durationMax
  )
    result.duration = params.duration
  if (profile.fields.version?.[1].includes(params.version)) result.version = params.version
  return result
}
