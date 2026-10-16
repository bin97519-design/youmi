const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)))

const COMMON_SKILL_RECORDS = [
  {
    skillKey: 'pixar-animated-ad-creator-5de625e86d1143e6a4fd948ca25ec34b',
    shortSlug: 'pixar-animated-ad-creator',
    name: '皮克斯动画广告',
    description: '从角色立绘、分镜草图到最终合成带广告歌的完整成片',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/5de625e86d1143e6a4fd948ca25ec34b/16c4f89b3083f4fff4bfb4e35dae218df05a4077.png',
  },
  {
    skillKey: 'viral-video-replicator-3fdf06a4c10a4f96b98f779e197578c8',
    shortSlug: 'viral-video-replicator',
    name: '爆款拉片复刻',
    description: 'AI拆解爆款视频，一键复刻同款',
    version: '1.0.5',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/3fdf06a4c10a4f96b98f779e197578c8/c832de3388169b8b9c9244843657b13048d219ce.png',
  },
  {
    skillKey: 'neo-chinese-aesthetic-tvc-beda8103d1a8414aa15aa0eb1db95a07',
    shortSlug: 'neo-chinese-aesthetic-tvc',
    name: '新中式美学TVC',
    description: '新中式美学全案：从妆造、布景到广告成片，一站式惊艳视觉',
    version: '1.0.12',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/beda8103d1a8414aa15aa0eb1db95a07/fc88a7500af42ee82e678b94aaa1a7e69fc34d26.png',
  },
  {
    skillKey: 'hujinquanwuxia-a015ad0682e441c5a70fd7cac0fc563a',
    shortSlug: 'hujinquanwuxia',
    name: '古典武侠电影全流程导演',
    description: '把模糊的武侠主题和灵感转化为视频生产方案',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/ae93620a110f4bebbf8932e6a045ec4d/81a243fb88967177b7c19481864541cad99380cb.png',
  },
  {
    skillKey: 'gameplay-pv-builder-020b92eb952140af9a99e594358a115b',
    shortSlug: 'gameplay-pv-builder',
    name: '游戏实机PV',
    description: '自制多类游戏PV，UI 像素锚定不形变，打造3A级游戏效果',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/020b92eb952140af9a99e594358a115b/397f6891109295ce11c7f17037b241640e5c7812.png',
  },
  {
    skillKey: 'xingrannvpin-0bfcda928d704e8da3d20977029a31b8',
    shortSlug: 'xingrannvpin',
    name: '精品女频短剧一键成片',
    description: '告别粗糙流水线成片，纯精品短剧工业化全流程一键出片',
    version: '1.0.0',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/ae93620a110f4bebbf8932e6a045ec4d/7cca96293060254350807d0a1b4692045976e5f9.png',
  },
  {
    skillKey: 'koreeda-film-aesthetic-ad7396f8e0a5497ab352f403f290c82f-e8810017',
    shortSlug: 'koreeda-film-aesthetic',
    name: '是枝裕和电影美学',
    description: '是枝裕和电影美学。用日常写实的生活肌理，包裹克制又轻盈的情感',
    version: '1.0.11',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/ad7396f8e0a5497ab352f403f290c82f/5c4ecdf1f0bddfb9c61e6ffde78677dc8149aeab.png',
  },
  {
    skillKey: 'wes-anderson-aesthetics-beda8103d1a8414aa15aa0eb1db95a07',
    shortSlug: 'wes-anderson-aesthetics',
    name: '韦斯安德森电影美学',
    description: '深度还原韦氏标志性视听语言，适用15秒-5分钟电影短片或广告',
    version: '1.0.0',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/beda8103d1a8414aa15aa0eb1db95a07/3ad499bfc70aa8b09ab6ea865e2a22dac192a8f5.png',
  },
  {
    skillKey: 'narrative-tvc-creator-020b92eb952140af9a99e594358a115b',
    shortSlug: 'narrative-tvc-creator',
    name: '剧情TVC广告片',
    description: '创作剧情化商品、品牌、服务类 TVC 广告片',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/020b92eb952140af9a99e594358a115b/1c3366d3dd68725b8d56fc36de281a60bdfb54d7.PNG',
  },
  {
    skillKey: 'eastwood-western-style-71a5fc5f6ae546d58b0b8d75abc87608',
    shortSlug: 'eastwood-western-style',
    name: '伊斯特伍德西部片',
    description: '极静对峙瞬间爆发的枪战大片',
    version: '1.0.0',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/71a5fc5f6ae546d58b0b8d75abc87608/327035f8cfd86f99a15d86a45891cfd577f30353.png',
  },
  {
    skillKey: 'high-impact-car-tvc-9d8925c591a643bbad8ca8cfbb87922c',
    shortSlug: 'high-impact-car-tvc',
    name: '一键爽感轰炸流汽车TVC',
    description: '上传图片或简单文字叙述即可一键打造超爽感轰炸流TVC广告',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/9d8925c591a643bbad8ca8cfbb87922c/a8a7a2ac1cd102eba02d05e328888e053d147c5d.png',
  },
  {
    skillKey: 'cinematic-travel-vlog-maker-ea101076a01c4630a1e90cb41e56b4d1',
    shortSlug: 'cinematic-travel-vlog-maker',
    name: '旅拍大师',
    description: '把旅行地点、人物参考和文案，做成电影感旅拍短片',
    version: '1.0.4',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/ea101076a01c4630a1e90cb41e56b4d1/600ccba6229e3819ef3d1e1ee636477844c0672a.jpg',
  },
  {
    skillKey: 'werewolf-vampire-short-drama-0bfcda928d704e8da3d20977029a31b8',
    shortSlug: 'werewolf-vampire-short-drama',
    name: '一键海外狼人吸血鬼短剧',
    description: '漫剧：一键生成海外爆款狼人吸血鬼漫剧，新手友好，风格高度一致',
    version: '1.0.1',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/0bfcda928d704e8da3d20977029a31b8/ff31db5b3d4e1755d2647eceaf4952d4db5fe371.png',
  },
  {
    skillKey: 'taiwan-new-wave-aesthetic-ad7396f8e0a5497ab352f403f290c82f-00e974d5',
    shortSlug: 'taiwan-new-wave-aesthetic',
    name: '宝岛浪潮电影美学',
    description: '台湾新浪潮电影美学，细腻呈现其凝视、疏离、写实感的电影表达',
    version: '1.0.8',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/ad7396f8e0a5497ab352f403f290c82f/c5dc3ba9a53fc83efa3db5f491292d3ed28b381a.jpg',
  },
  {
    skillKey: 'absurdist-comedy-maker-8db3e80ed29a49109eb6c801f13bb76c',
    shortSlug: 'absurdist-comedy-maker',
    name: '无厘头喜剧',
    description: '将任意主题转成无厘头创意短片，支持剧本改写和照片玩梗。',
    version: '1.0.3',
    coverUrl:
      'https://libtv-res.liblib.art/upload-images/8db3e80ed29a49109eb6c801f13bb76c/0ffd9c0a06affd66611ceee1f377bec094a82c77.png',
  },
]

export const DIRECTOR_SKILL_CATEGORIES = freezeList([{ id: 'common', label: '通用' }])

export const DEFAULT_DIRECTOR_SKILL_CATEGORY = 'common'

export const DIRECTOR_SKILL_CATALOG = freezeList(
  COMMON_SKILL_RECORDS.map((skill, index) => ({
    ...skill,
    order: index + 1,
    id: `libtv-user-generated/${skill.skillKey}`,
    label: skill.name,
    category: DEFAULT_DIRECTOR_SKILL_CATEGORY,
    categoryLabel: '通用',
    resultType: 3,
    modality: 'video',
  })),
)

export const DIRECTOR_SKILL_SECTIONS = Object.freeze({
  common: DIRECTOR_SKILL_CATALOG,
})

const DIRECTOR_SKILL_BY_ID = Object.freeze(
  Object.fromEntries(DIRECTOR_SKILL_CATALOG.map((skill) => [skill.id, skill])),
)

const DIRECTOR_SKILL_BY_KEY = Object.freeze(
  Object.fromEntries(DIRECTOR_SKILL_CATALOG.map((skill) => [skill.skillKey, skill])),
)

const DIRECTOR_SKILL_BY_SHORT_SLUG = Object.freeze(
  Object.fromEntries(DIRECTOR_SKILL_CATALOG.map((skill) => [skill.shortSlug, skill])),
)

function getSkillIdentity(skillOrIdentity) {
  if (typeof skillOrIdentity === 'string') return skillOrIdentity.trim()
  if (!skillOrIdentity || typeof skillOrIdentity !== 'object') return ''
  return skillOrIdentity.id || skillOrIdentity.skillKey || skillOrIdentity.shortSlug || ''
}

function getSkillSerializationOptions(skillOrIdentity, options) {
  const source = skillOrIdentity && typeof skillOrIdentity === 'object' ? skillOrIdentity : {}
  return options && typeof options === 'object' ? { ...source, ...options } : source
}

function copyOptionalField(target, source, field) {
  if (!Object.hasOwn(source, field) || source[field] == null || source[field] === '') return
  target[field] = source[field]
}

export function normalizeDirectorSkillCategory(category) {
  return Object.hasOwn(DIRECTOR_SKILL_SECTIONS, category)
    ? category
    : DEFAULT_DIRECTOR_SKILL_CATEGORY
}

export function getDirectorSkillSection(category = DEFAULT_DIRECTOR_SKILL_CATEGORY) {
  return DIRECTOR_SKILL_SECTIONS[normalizeDirectorSkillCategory(category)]
}

export function getDirectorSkillById(skillOrId) {
  const identity = getSkillIdentity(skillOrId)
  return DIRECTOR_SKILL_BY_ID[identity] || null
}

export function getDirectorSkillByKey(skillOrKey) {
  const identity = getSkillIdentity(skillOrKey)
  return (
    DIRECTOR_SKILL_BY_KEY[identity] ||
    DIRECTOR_SKILL_BY_ID[identity] ||
    DIRECTOR_SKILL_BY_SHORT_SLUG[identity] ||
    null
  )
}

export function filterDirectorSkills({ category, modality, resultType, predicate } = {}) {
  return Object.freeze(
    DIRECTOR_SKILL_CATALOG.filter((skill, index) => {
      if (category && skill.category !== category) return false
      if (modality && skill.modality !== modality) return false
      if (resultType != null && skill.resultType !== resultType) return false
      return typeof predicate !== 'function' || predicate(skill, index)
    }),
  )
}

export function searchDirectorSkills(query, filters = {}) {
  const normalizedQuery = String(query ?? '')
    .trim()
    .toLocaleLowerCase()
  const candidates = filterDirectorSkills(filters)
  if (!normalizedQuery) return candidates

  return Object.freeze(
    candidates.filter((skill) =>
      [
        skill.name,
        skill.description,
        skill.version,
        skill.skillKey,
        skill.shortSlug,
        skill.categoryLabel,
      ].some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery)),
    ),
  )
}

export function createDirectorSkillMarker(skillOrIdentity) {
  const skill = getDirectorSkillByKey(skillOrIdentity)
  return skill ? `{{ skill:${skill.id} }}` : null
}

export function createDirectorSkillStructuredPart(skillOrIdentity, options) {
  const skill = getDirectorSkillByKey(skillOrIdentity)
  if (!skill) return null

  const structuredPart = {
    type: 'skill',
    id: skill.id,
    name: skill.name,
  }
  const serializationOptions = getSkillSerializationOptions(skillOrIdentity, options)
  copyOptionalField(structuredPart, serializationOptions, 'prompt')
  copyOptionalField(structuredPart, serializationOptions, 'draft')
  return structuredPart
}

export function serializeDirectorSkillChip(skillOrIdentity, options) {
  const marker = createDirectorSkillMarker(skillOrIdentity)
  const structuredPart = createDirectorSkillStructuredPart(skillOrIdentity, options)
  return marker && structuredPart ? { marker, structuredPart } : null
}
