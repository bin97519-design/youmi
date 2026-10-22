import { klingVideoMode } from './klingVideoModes.js'

// These three contracts come from the user-supplied Omni API document. This
// module describes UI settings only; it does not submit requests or pick keys.
export const KLING_OMNI_API_MODELS = Object.freeze({
  视频参考: 'kling-v3-omni-videoref',
  参考生: 'kling-v3-omni-cankao',
  首尾帧: 'kling-v3-omni-shouweizhen',
})

const qualities = [
  { value: 'std', label: '标准' },
  { value: 'pro', label: '高品质' },
]
const ratios = ['16:9', '9:16', '1:1']
const referenceTypes = [
  { value: 'feature', label: '视频参考' },
  { value: 'base', label: '指令变换' },
]
const originalSound = [
  { value: 'yes', label: '保留' },
  { value: 'no', label: '不保留' },
]

function field(key, label, options, required = false) {
  return {
    key,
    label,
    required,
    options: options.map((option) =>
      typeof option === 'string' ? { value: option, label: option } : { ...option },
    ),
  }
}

function durationField(values, required = true) {
  return field(
    'duration',
    '视频时长',
    values.map((value) => ({ value, label: `${value}秒` })),
    required,
  )
}

function scalarParams(params) {
  return params && typeof params === 'object' && !Array.isArray(params) ? params : {}
}

// Defaults below are UI initial choices from the document's request examples,
// not claims about defaults applied by the upstream service.
export function klingOmniControls(mode, params = {}) {
  const label = klingVideoMode(mode).label
  const raw = scalarParams(params)
  const quality = () => field('mode', '生成模式', qualities, true)
  const aspect = () => field('aspect_ratio', '画面比例', ratios)
  const images = (min, max, imageLabel = '参考图片') => ({
    min,
    max,
    required: min > 0,
    label: imageLabel,
  })
  const shared = { apiModel: KLING_OMNI_API_MODELS[label], label }

  if (label === '参考生')
    return {
      ...shared,
      defaults: { mode: 'std', duration: '5', aspect_ratio: '16:9' },
      fields: [quality(), durationField(['5', '10', '15']), aspect()],
      notes: ['支持纯文生视频；参考图片可选，最多7张。'],
      assetLimits: { images: images(0, 7) },
    }

  if (label === '首尾帧')
    return {
      ...shared,
      defaults: { mode: 'std', duration: '5' },
      fields: [quality(), durationField(['5', '10', '15'])],
      notes: [
        '首尾帧图片必传：1张作为首帧，2张依次作为首帧和尾帧。',
        '画面比例跟随首帧图片，无需设置。',
      ],
      assetLimits: { images: images(1, 2, '首尾帧') },
    }

  const editing = raw.refer_type === 'base'
  return {
    ...shared,
    defaults: editing
      ? { refer_type: 'base', mode: 'std' }
      : {
          refer_type: 'feature',
          mode: 'std',
          duration: '5',
          aspect_ratio: '16:9',
          keep_original_sound: 'yes',
        },
    fields: [
      field('refer_type', '参考类型', referenceTypes, true),
      quality(),
      ...(!editing
        ? [
            durationField(['5', '10'], false),
            aspect(),
            field('keep_original_sound', '保留原声', originalSound),
          ]
        : []),
    ],
    notes: [
      '必须提供1个参考视频（3～10秒、mp4/mov、最大100MB、宽度不小于700px）；参考图片可选，最多4张。',
      ...(editing
        ? ['指令变换：输出时长和画面比例跟随输入视频，并始终保留原声。']
        : ['视频参考：参考输入视频的风格和运镜生成新视频。']),
    ],
    assetLimits: {
      images: images(0, 4),
      video: {
        min: 1,
        max: 1,
        required: true,
        formats: ['mp4', 'mov'],
        maxSizeMB: 100,
        minWidth: 700,
        minDuration: 3,
        maxDuration: 10,
      },
    },
  }
}

// Return only active documented scalar fields. Media comes from linked nodes,
// while notify_url belongs at the request top level, never inside params.
// This is a pure read: opening a popup must not migrate a saved draft.
export function klingOmniParams(mode, params = {}) {
  const raw = scalarParams(params)
  const profile = klingOmniControls(mode, raw)
  return Object.fromEntries(
    profile.fields.map((entry) => {
      const rawValue = raw[entry.key]
      const candidate =
        entry.key === 'duration' && typeof rawValue === 'number' ? String(rawValue) : rawValue
      const value = entry.options.some((option) => option.value === candidate)
        ? candidate
        : profile.defaults[entry.key]
      return [entry.key, value]
    }),
  )
}

export function klingOmniSummary(mode, params = {}) {
  const label = klingVideoMode(mode).label
  const value = klingOmniParams(label, params)
  const quality = value.mode === 'pro' ? '高品质' : '标准'
  if (label === '视频参考' && value.refer_type === 'base')
    return `指令变换 · ${quality} · 时长/比例跟随视频 · 保留原声`
  return [
    value.aspect_ratio,
    quality,
    `${value.duration}s`,
    label === '首尾帧' ? '比例跟随首帧' : '',
    label === '视频参考' ? (value.keep_original_sound === 'yes' ? '保留原声' : '不保留原声') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
