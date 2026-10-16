const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)))

const LIB_LOGO_URL =
  'https://liblibai-online.liblib.cloud/img/26867b52384f44d6ad5f717dbd710ff7/44e937c59a92e1316948f60d25f5b3ef3c2ea3f6ead2178ef7b85f4cd6b055aa.png'
const GENERAL_IMAGE_LOGO_URL =
  'https://liblibai-online.liblib.cloud/img/26867b52384f44d6ad5f717dbd710ff7/a648ead572dfc3292bf97afa915056222848383e345a342d6aa06ae0adf96899.png'
const SEED_LOGO_URL =
  'https://libtv-res.liblib.art/upload-images/70a305c50c704a778db114468830617b/43df57d720f983795db62c96952a44a86d1bc27a.png'
const STYLE_IMAGE_LOGO_URL =
  'https://libtv-res.liblib.art/upload-images/70a305c50c704a778db114468830617b/538045210cdc7b90d61704f96d1be52bc3830c13.png'
const WAN_LOGO_URL =
  'https://libtv-res.liblib.art/upload-images/70a305c50c704a778db114468830617b/d031349093e34e87240f833e6299223cbac7fc06.png'
const MINIMAX_LOGO_URL =
  'https://libtv-res.liblib.art/upload-images/70a305c50c704a778db114468830617b/7f62d6d3837bdc432b69a56cd81157a93e055d2e.png'
const KLING_LOGO_URL =
  'https://libtv-res.liblib.art/upload-images/70a305c50c704a778db114468830617b/2db40556bb3eecf270635541d94cf247ce59965e.png'

export const DIRECTOR_MODEL_TABS = freezeList([
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
])

export const DEFAULT_DIRECTOR_MODEL_TAB = 'image'

export const DIRECTOR_MODEL_CATALOG = freezeList([
  {
    id: 'lib-image-2.5-s',
    key: 'lib-image-2.5-s',
    label: 'Lib Image 2.5 Pro',
    description: '精准生成与编辑，复杂指令稳定还原',
    modality: 'image',
    logoUrl: LIB_LOGO_URL,
  },
  {
    id: 'lib-image-2.5-f',
    key: 'lib-image-2.5-f',
    label: 'Lib Image 2.5 Fast',
    description: '极速高质量图像生成，兼顾效果与效率',
    modality: 'image',
    logoUrl: LIB_LOGO_URL,
  },
  {
    id: 'lib-image-2',
    key: 'lib-image-2',
    label: 'Lib Image',
    description: '最新图片模型、长文本能力突出',
    modality: 'image',
    logoUrl: LIB_LOGO_URL,
  },
  {
    id: 'nebula-ultra',
    key: 'nebula-ultra',
    label: 'General image Pro',
    description: '最强图片编辑模型，一致性好',
    modality: 'image',
    logoUrl: GENERAL_IMAGE_LOGO_URL,
  },
  {
    id: 'nebula-2-flash',
    key: 'nebula-2-flash',
    label: 'General image V2',
    description: '支持联网搜索、文字准确、速度更快',
    modality: 'image',
    logoUrl: GENERAL_IMAGE_LOGO_URL,
  },
  {
    id: 'doubao-seedream-5-0-pro',
    key: 'doubao-seedream-5-0-pro',
    label: 'Seedream 5.0 Pro',
    description: '精准交互式编辑，支持原生多语言排版',
    modality: 'image',
    logoUrl: SEED_LOGO_URL,
  },
  {
    id: 'mj-v8.2',
    key: 'mj-v8.2',
    label: 'Style Image V8.2',
    description: '电影感全面升级，精准还原光影、人物与真实材质',
    modality: 'image',
    logoUrl: STYLE_IMAGE_LOGO_URL,
  },
  {
    id: 'mj-v8.1',
    key: 'mj-v8.1',
    label: 'Style Image V8.1',
    description: '生图更连贯、细节更丰富、美学水准大幅提升',
    modality: 'image',
    logoUrl: STYLE_IMAGE_LOGO_URL,
  },
  {
    id: 'mj-v7',
    key: 'mj-v7',
    label: 'Style Image V7',
    description: '最佳美学，电影质感，创意能力强',
    modality: 'image',
    logoUrl: STYLE_IMAGE_LOGO_URL,
  },
  {
    id: 'star-video2.5',
    key: 'star-video2.5',
    label: 'Seedance 2.5',
    description: '最强视频模型，全能参考，30s音画同步',
    modality: 'video',
    logoUrl: SEED_LOGO_URL,
    vip: true,
  },
  {
    id: 'star-video2',
    key: 'star-video2',
    label: 'Seedance 2.0 VIP',
    description: '最强视频模型，会员专属通道,15s音画同步',
    modality: 'video',
    logoUrl: SEED_LOGO_URL,
    vip: true,
  },
  {
    id: 'wanx3.0',
    key: 'wanx3.0',
    label: 'Wan 3.0',
    description: '全模态参考，支持文档与网页输入，超写实高一致性生成',
    modality: 'video',
    logoUrl: WAN_LOGO_URL,
  },
  {
    id: 'wanx3.0-prime',
    key: 'wanx3.0-prime',
    label: 'Wan 3.0 Prime',
    description: '超快速生成，全模态参考，超写实高一致性',
    modality: 'video',
    logoUrl: WAN_LOGO_URL,
  },
  {
    id: 'MiniMax-Hailuo-H3',
    key: 'MiniMax-Hailuo-H3',
    label: 'Minimax H3',
    description: '全模态输入，多参数控制，多场景商用级生成',
    modality: 'video',
    logoUrl: MINIMAX_LOGO_URL,
    vip: true,
  },
  {
    id: 'star-video2-fast',
    key: 'star-video2-fast',
    label: 'Seedance 2.0 Fast VIP',
    description: '最强视频模型快速版，会员专属通道，15s音画同步',
    modality: 'video',
    logoUrl: SEED_LOGO_URL,
    vip: true,
  },
  {
    id: 'star-video2-mini',
    key: 'star-video2-mini',
    label: 'Seedance 2.0 Mini',
    description: '最强视频模型mini版，高性价比生成，15s音画同步',
    modality: 'video',
    logoUrl: SEED_LOGO_URL,
    vip: true,
  },
  {
    id: 'kling-v3-omni',
    key: 'kling-v3-omni',
    label: 'Kling O3',
    description: '视频编辑模型、参考一致性、音画同出、多镜头',
    modality: 'video',
    logoUrl: KLING_LOGO_URL,
    vip: true,
  },
  {
    id: 'kling-video-o3',
    key: 'kling-video-o3',
    label: 'Kling 3.0',
    description: '视频生成模型，高质感、支持多镜头',
    modality: 'video',
    logoUrl: KLING_LOGO_URL,
    vip: true,
  },
])

export const DIRECTOR_MODEL_SECTIONS = Object.freeze({
  image: Object.freeze(DIRECTOR_MODEL_CATALOG.filter((model) => model.modality === 'image')),
  video: Object.freeze(DIRECTOR_MODEL_CATALOG.filter((model) => model.modality === 'video')),
})

const DIRECTOR_MODEL_BY_KEY = Object.freeze(
  Object.fromEntries(DIRECTOR_MODEL_CATALOG.map((model) => [model.key, model])),
)

function getModelKey(modelOrKey) {
  if (typeof modelOrKey === 'string') return modelOrKey
  if (!modelOrKey || typeof modelOrKey !== 'object') return ''
  return modelOrKey.key || modelOrKey.id || ''
}

export function normalizeDirectorModelTab(tab) {
  return Object.hasOwn(DIRECTOR_MODEL_SECTIONS, tab) ? tab : DEFAULT_DIRECTOR_MODEL_TAB
}

export function getDirectorModelSection(tab = DEFAULT_DIRECTOR_MODEL_TAB) {
  return DIRECTOR_MODEL_SECTIONS[normalizeDirectorModelTab(tab)]
}

export function getDirectorModelByKey(modelOrKey) {
  return DIRECTOR_MODEL_BY_KEY[getModelKey(modelOrKey)] || null
}

export function createDirectorModelMarker(modelOrKey) {
  const model = getDirectorModelByKey(modelOrKey)
  return model ? `{{ model:${model.key} }}` : null
}

export function createDirectorModelStructuredPart(modelOrKey) {
  const model = getDirectorModelByKey(modelOrKey)
  if (!model) return null

  return {
    type: 'model',
    id: model.key,
    name: model.label,
    modality: model.modality,
  }
}

export function serializeDirectorModelChip(modelOrKey) {
  const marker = createDirectorModelMarker(modelOrKey)
  const structuredPart = createDirectorModelStructuredPart(modelOrKey)
  return marker && structuredPart ? { marker, structuredPart } : null
}
