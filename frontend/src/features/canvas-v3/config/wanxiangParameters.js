// Contract supplied by the user for the Lingke media API, not DashScope's API.
export const WANXIANG_MODEL = 'wan3.0-video-quannengcankao'
const LEGACY_MENU_VALUE = '万相 3.0'

export function isWanxiangModel(model) {
  const identity = typeof model === 'object' ? model?.model || model?.value : model
  return [WANXIANG_MODEL, LEGACY_MENU_VALUE].includes(String(identity || '').trim())
}

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

// UI initial choices use the request example. prompt_extend starts disabled so
// simply choosing this model does not opt a user into rewriting their prompt.
export function wanxiangControls() {
  return {
    id: 'wanxiang30',
    apiModel: WANXIANG_MODEL,
    label: '万相 3.0 全能',
    defaults: {
      version: 'standard',
      resolution: '720P',
      duration: '5',
      ratio: 'adaptive',
      audio: true,
      prompt_extend: false,
    },
    fields: [
      field(
        'version',
        '版本',
        [
          { value: 'standard', label: '标准版' },
          { value: 'prime', label: '高速版' },
        ],
        true,
      ),
      field('resolution', '分辨率', ['480P', '720P', '1080P'], true),
      field(
        'duration',
        '视频时长',
        [
          { value: 'auto', label: '智能时长' },
          ...Array.from({ length: 29 }, (_, index) => ({
            value: String(index + 2),
            label: `${index + 2}秒`,
          })),
        ],
        true,
      ),
      field('ratio', '宽高比', [
        { value: 'adaptive', label: '自适应' },
        '16:9',
        '9:16',
        '1:1',
        '4:3',
        '3:4',
      ]),
      field('audio', '视频声音', [
        { value: true, label: '开启' },
        { value: false, label: '关闭' },
      ]),
      field('prompt_extend', '提示词优化', [
        { value: true, label: '开启' },
        { value: false, label: '关闭' },
      ]),
    ],
    assetLimits: {
      images: { min: 0, max: 10, label: '参考图片' },
      video: { min: 0, max: 5, maxDuration: 15, label: '参考视频' },
      audio: { min: 0, max: 5, maxDuration: 15, label: '参考音频' },
    },
    notes: [
      '图片、视频、音频可任意组合，也支持纯文字生成；图片始终作为参考图，不自动设为首尾帧。',
      '最多10张参考图片、5段参考视频和5段参考音频；参考视频和参考音频各自总时长不超过15秒。',
      '成片时长与参考视频总时长合计不超过30秒。',
      '智能时长先按30秒预扣，生成后按实际时长多退少补。',
      '高速版单价约为标准版的2.1倍；720P、1080P单价分别为480P的2倍、4倍。',
    ],
  }
}

// Pure presentation normalization. Submission must validate explicit raw input
// before using these defaults; unrelated model parameters are never forwarded.
export function wanxiangParams(params = {}) {
  const raw = params && typeof params === 'object' && !Array.isArray(params) ? params : {}
  const profile = wanxiangControls()
  return Object.fromEntries(
    profile.fields.map((entry) => {
      let candidate = raw[entry.key]
      if (entry.key === 'duration' && typeof candidate === 'number') candidate = String(candidate)
      if (['audio', 'prompt_extend'].includes(entry.key) && ['true', 'false'].includes(candidate))
        candidate = candidate === 'true'
      const value = entry.options.some((option) => option.value === candidate)
        ? candidate
        : profile.defaults[entry.key]
      return [entry.key, value]
    }),
  )
}

export function wanxiangSummary(params = {}) {
  const value = wanxiangParams(params)
  return [
    value.ratio === 'adaptive' ? '自适应' : value.ratio,
    value.version === 'prime' ? '高速版' : '标准版',
    value.resolution,
    value.duration === 'auto' ? '智能时长' : `${value.duration}s`,
    value.audio ? '有声' : '无声',
  ].join(' · ')
}
