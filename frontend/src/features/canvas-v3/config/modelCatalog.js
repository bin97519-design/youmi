import { isTtImage25Model } from './imageModelVersions.js'
import { imageModelControls } from './imageModelParameters.js'
import { isKlingOmniApiModel } from './klingOmniIdentity.js'
import { isWanxiangModel } from './wanxiangParameters.js'
import {
  isMinimaxH3Model,
  isSeedance20AnciModel,
  isSeedance25Model,
  MINIMAX_H3_MODEL,
  SEEDANCE20_ANCI_MODEL,
  SEEDANCE25_MODEL,
} from './videoModelParameters.js'

// Labels, descriptions and estimates observed in the LibTV reference menu.
// These are reference UI options, not aliases for our configured generation APIs.
export const IMAGE_MODEL_CATALOG = [
  ['Lib Image 2.5 Pro', 'modelLib', '30s', '精准生成与编辑，复杂指令稳定还原'],
  ['Lib Image 2.5 Fast', 'modelLib', '20s', '极速高质量图像生成，兼顾效果与效率'],
  ['Lib Image', 'modelLib', '60s', '最新图片模型、长文本能力突出'],
  ['General image Pro', 'modelGeneral', '50s', '最强图片编辑模型，一致性好'],
  ['General image V2.1', 'modelGeneralV21', '25s', '多图参考更一致，文字排版更精准'],
  ['General image V2', 'modelGeneral', '25s', '支持联网搜索、文字准确、速度更快'],
  ['Seedream 5.0 Pro', 'modelSeedream', '20s', '精准交互式编辑，支持原生多语言排版'],
  ['Genesis F.3', 'image', '30s', '角色稳定一致，支持局部与图内文字编辑'],
  ['Qwen image 3.0', 'image', '60s', '擅长复杂版面与精准文字的高质量生图模型'],
  ['Style Image V8.2', 'image', '50s', '电影感全面升级，精准还原光影、人物与真实材质'],
  ['Style Image V8.1', 'image', '50s', '生图更连贯、细节更丰富、美学水准大幅提升'],
  ['Style Image V7', 'image', '50s', '最佳美学，电影质感，创意能力强'],
  ['Style Image Niji 7', 'image', '50s', '动漫高审美模型，风格多样'],
  ['Seedream 4.6', 'modelSeedream', '20s', '提升人像一致性、平面设计效果'],
  ['Seedream 5.0 Lite', 'modelSeedream', '20s', '支持联网搜索，擅长中式风格、审美提升'],
  ['Seedream 4.5', 'modelSeedream', '15s', '多角色一致性、擅长中式风格'],
  ['Z-image Turbo', 'image', '10s', '极速生成，适合真实感图片'],
  ['Qwen Image', 'image', '60s', 'Qwen 生图模型，文字排版能力强'],
  ['Qwen Edit', 'image', '60s', 'Qwen系编辑模型，精细可控'],
  ['Seedream 4.0', 'modelSeedream', '', ''],
].map(([label, icon, latency, description]) => ({
  value: label,
  label,
  icon,
  latency,
  description,
}))

// Video menu presentation only; these entries do not alias or configure an API.
export const VIDEO_MODEL_CATALOG = [
  {
    value: SEEDANCE20_ANCI_MODEL,
    label: 'Seedance 2.0 按次',
    icon: 'modelSeedanceMini',
    description: '按次计费 · 快速 / 标准 · 4～15秒 · 720P · 0～9张参考图',
  },
  {
    value: SEEDANCE25_MODEL,
    label: 'Seedance 2.5 全能',
    icon: 'modelSeedanceMini',
    description: 'SD 2.5 满血版按秒 · 4～30秒 · 最高1080P',
  },
  {
    value: MINIMAX_H3_MODEL,
    label: 'MiniMax H3',
    icon: 'modelMinimax',
    description: '4～15秒 · 首尾帧 / 参考生 · 有声视频',
  },
  {
    value: 'seedance-2.0-mini',
    label: '即梦 Seedance 2.0 mini',
    icon: 'modelSeedanceMini',
    description: '极致性价比，相近的体验，比Fast更快的推理速度',
    uiOnly: true,
  },
  {
    value: 'HappyHorse 1.0',
    label: 'HappyHorse 1.0',
    icon: 'modelHappyHorse',
  },
  {
    value: 'Kling 3.0',
    label: '可灵-Omni',
    icon: 'modelKling',
  },
  {
    value: '万相 3.0',
    label: '万相 3.0 全能',
    icon: 'modelWanxiang',
    description: '多模态参考 · 标准 / 高速 · 2～30秒 / 智能时长 · 最高1080P',
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    icon: 'modelMinimax',
    description: '视频生成模型，待配置生成服务',
    uiOnly: true,
  },
]

function videoDisplayLabel(model) {
  if (isWanxiangModel(model)) return '万相 3.0 全能'
  if (isKlingOmniApiModel(model)) return '可灵-Omni'
  if ((model.model || model.value) === 'Kling 3.0' && model.label === 'Kling 3.0')
    return '可灵-Omni'
  if (isSeedance20AnciModel(model) && model.label === 'SD 2.0 按次') return 'Seedance 2.0 按次'
  if (isSeedance25Model(model) && ['seedance-2.5', 'Seedance 2.5'].includes(model.label))
    return 'Seedance 2.5 全能'
  return model.label
}

export function videoModelOptions(values = [], configured = [], selected = '') {
  // Keep a saved legacy MiniMax placeholder visible without upgrading its route.
  const visibleValues =
    selected === 'minimax' && !values.includes(selected) ? [...values, selected] : values
  const options = visibleValues.flatMap((value) => {
    const family = isSeedance20AnciModel(value)
      ? isSeedance20AnciModel
      : isSeedance25Model(value)
        ? isSeedance25Model
        : isMinimaxH3Model(value)
          ? isMinimaxH3Model
          : isWanxiangModel(value)
            ? isWanxiangModel
            : null
    const routes = family ? configured.filter((option) => option?.value && family(option)) : []
    if (routes.length)
      return routes.map((option) => ({
        ...VIDEO_MODEL_CATALOG.find((entry) => entry.value === value),
        ...option,
        value: option.value,
        label:
          videoDisplayLabel(option) ||
          VIDEO_MODEL_CATALOG.find((entry) => entry.value === value)?.label ||
          value,
      }))
    return [
      {
        ...(VIDEO_MODEL_CATALOG.find((entry) => entry.value === value) || {}),
        value,
        label: VIDEO_MODEL_CATALOG.find((entry) => entry.value === value)?.label || value,
      },
    ]
  })
  return [...new Map(options.map((option) => [option.value, option])).values()]
}

export function modelPresentation(model, kind = 'image') {
  const isSeedance20Anci = kind === 'video' && isSeedance20AnciModel(model)
  const isSeedance25 = kind === 'video' && isSeedance25Model(model)
  const isMinimaxH3 = kind === 'video' && isMinimaxH3Model(model)
  const isKlingOmni = kind === 'video' && isKlingOmniApiModel(model)
  const isWanxiang = kind === 'video' && isWanxiangModel(model)
  const observed =
    kind === 'video'
      ? VIDEO_MODEL_CATALOG.find((entry) =>
          isSeedance20Anci
            ? isSeedance20AnciModel(entry)
            : isSeedance25
              ? isSeedance25Model(entry)
              : isMinimaxH3
                ? isMinimaxH3Model(entry)
                : isWanxiang
                  ? isWanxiangModel(entry)
                  : !isSeedance20AnciModel(entry) &&
                    (entry.value === (model.model || model.value) ||
                      (entry.value !== 'Kling 3.0' && entry.label === model.label)),
        )
      : IMAGE_MODEL_CATALOG.find((entry) => entry.label === model.label)
  const name = `${model.value} ${model.label}`.toLowerCase()
  const isImage25 = kind === 'image' && isTtImage25Model(model)
  const isBanana =
    kind === 'image' && ['banana-2.1', 'banana-pro'].includes(imageModelControls(model).id)
  return {
    icon: observed?.icon || (/seedream/.test(name) ? 'modelSeedream' : kind),
    // Do not invent a latency estimate for models configured in our own backend.
    latency: observed?.latency || '',
    description: observed?.description || model.description || '使用项目已配置的生成服务',
    ...model,
    ...(kind === 'video' && model.label ? { label: videoDisplayLabel(model) } : {}),
    // Family branding follows the configured model identity, not its editable label.
    ...(isImage25 ? { icon: 'modelImage25' } : {}),
    ...(isBanana ? { icon: 'modelBanana' } : {}),
    ...(isSeedance20Anci || isSeedance25 ? { icon: 'modelSeedanceMini' } : {}),
    ...(isMinimaxH3 ? { icon: 'modelMinimax' } : {}),
    ...(isKlingOmni ? { icon: 'modelKling' } : {}),
    ...(isWanxiang ? { icon: 'modelWanxiang', uiOnly: false } : {}),
    ...(kind === 'video' && observed?.uiOnly ? { uiOnly: true } : {}),
  }
}
