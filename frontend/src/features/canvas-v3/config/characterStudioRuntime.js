import {
  CHARACTER_BODY_CONTROLS,
  CHARACTER_CLOTHES_FIELDS,
  CHARACTER_DECAL_PRESETS,
  CHARACTER_FACE_GROUPS,
  CHARACTER_FEATURE_FIELDS,
  CHARACTER_MAKEUP_GROUPS,
  normalizeCharacterStudioConfig,
} from './characterStudioControls.js'
import {
  characterStudioAssetFormat,
  characterStudioAssetPrompt,
} from './characterStudioAssetFormats.js'

const KINDS = new Set(['create', 'edit', 'assets', 'age'])
const RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3'])
const RESOLUTIONS = new Set(['1K', '2K', '4K'])
const AGE_GROUPS = new Set([
  '婴幼儿',
  '幼儿',
  '儿童',
  '少年',
  '青少年',
  '青年',
  '成年',
  '中年',
  '老年',
])
const text = (value) => (typeof value === 'string' ? value.trim() : '')
const facialControls = CHARACTER_FACE_GROUPS.flatMap((group) => group.controls)

function validatedAssetType(value = 'character-sheet') {
  return characterStudioAssetFormat(value).type
}

function boundedText(value, limit, label) {
  const result = text(value)
  if (result.length > limit) throw new Error(`${label}不能超过 ${limit} 字`)
  if (result.includes('\0')) throw new Error(`${label}包含无效字符`)
  return result
}

function httpImageUrl(value) {
  const result = text(value)
  if (!result || result.length > 4096) return ''
  try {
    const url = new URL(result)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return ''
    return result
  } catch {
    return ''
  }
}

function copyConfig(value) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('模特配置格式无效')
  try {
    const json = JSON.stringify(value)
    if (new TextEncoder().encode(json).length > 65536) throw new Error('模特配置不能超过 64 KiB')
    return JSON.parse(json)
  } catch (error) {
    if (error.message === '模特配置不能超过 64 KiB') throw error
    throw new Error('模特配置必须是有效 JSON')
  }
}

function isOfficial(character) {
  return (
    character?.official === true ||
    character?.isOfficial === true ||
    /^(official|public|builtin)$/i.test(text(character?.source)) ||
    /^(official|public|builtin)$/i.test(text(character?.scope)) ||
    /^(official|builtin)[-_]/i.test(text(character?.id))
  )
}

/** Only editor metadata is saved; task IDs, fees and generation authorization are never copied. */
export function characterStudioPayload(character = {}) {
  const config = copyConfig(character.config)
  if (Array.isArray(config.styleReferenceUrls)) {
    config.styleReferenceUrls = [
      ...new Set(config.styleReferenceUrls.map(httpImageUrl).filter(Boolean)),
    ]
  }
  if (config.clothes && typeof config.clothes === 'object') {
    config.clothes.referenceUrl = httpImageUrl(config.clothes.referenceUrl)
  }
  if (Array.isArray(config.features?.decals)) {
    config.features.decals = config.features.decals.map((decal) => ({
      ...decal,
      url: httpImageUrl(decal?.url),
    }))
  }
  const imageUrl = httpImageUrl(character.imageUrl)
  const id = isOfficial(character) ? '' : boundedText(character.id, 80, '模特标识')
  return {
    ...(id ? { id } : {}),
    name: boundedText(character.name, 80, '模特名称') || '未命名模特',
    description: boundedText(character.description, 4000, '模特描述'),
    gender: boundedText(character.gender, 80, '性别'),
    ageGroup: boundedText(character.ageGroup, 80, '年龄'),
    culture: boundedText(character.culture, 80, '文化背景'),
    imageUrl,
    coverUrl: httpImageUrl(character.coverUrl) || imageUrl,
    config,
  }
}

function ageTarget(config) {
  const value = boundedText(config.ageTarget, 40, '目标年龄')
  if (AGE_GROUPS.has(value)) return value
  const match = value.match(/^(\d{1,3})(?:\s*岁)?$/)
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 120) return `${Number(match[1])}岁`
  throw new Error('请选择明确的目标年龄或年龄段')
}

function isMinor(character, target) {
  const age = `${text(character.ageGroup)} ${target}`
  return /婴|幼|儿童|少年|未成年/.test(age) || /\b([1-9]|1[0-7])\s*岁/.test(age)
}

function requireAgeAppropriate(minor, values) {
  if (
    minor &&
    /裸露|裸体|全裸|赤裸|色情|性化|性感|情趣|内衣|比基尼|透视装|\b(nude|naked|topless|lingerie|sexual)\b/i.test(
      values.join('\n'),
    )
  ) {
    throw new Error('未成年模特仅支持正常着装、符合年龄的造型，请调整描述')
  }
}

function visualInstructions(config, minor) {
  const result = []
  for (const [controls, values] of [
    [facialControls, config.facial],
    [CHARACTER_BODY_CONTROLS, config.body],
  ]) {
    for (const control of controls) {
      if (minor && ['bust', 'hips'].includes(control.key)) continue
      const value = values[control.key]
      if (value !== 0) result.push(`${control.label}：${value > 0 ? '+' : ''}${value}。`)
    }
  }
  if (config.facial.removeBlemishes) result.push('自然去除斑点与痘痘，保留真实皮肤纹理。')
  if (config.facial.eyeLight !== '无') result.push(`眼神光：${config.facial.eyeLight}。`)
  for (const group of CHARACTER_MAKEUP_GROUPS) {
    if (config.makeup[group.key] !== '无')
      result.push(`${group.label}：${config.makeup[group.key]}。`)
  }
  for (const [fields, values] of [
    [CHARACTER_FEATURE_FIELDS, config.features],
    [CHARACTER_CLOTHES_FIELDS, config.clothes],
  ]) {
    for (const field of fields) {
      if (values[field.key] && values[field.key] !== '保持原样')
        result.push(`${field.label}：${values[field.key]}。`)
    }
  }
  for (const decal of config.features.decals) {
    const label =
      CHARACTER_DECAL_PRESETS.find((preset) => preset.id === decal.kind)?.label || '特征'
    result.push(
      `特征贴图 ${label}：横向 ${Math.round(decal.x)}%、纵向 ${Math.round(decal.y)}%，旋转 ${decal.rotation}°，相对大小 ${decal.scale}。` +
        (decal.kind === 'custom' && httpImageUrl(decal.url)
          ? '使用本次所附自定义贴图参考，保持人物其余特征不变。'
          : '保持人物其余特征不变。'),
    )
  }
  const clothes = config.clothes
  if (clothes.hairStyle) result.push(`造型发型：${clothes.hairCategory} / ${clothes.hairStyle}。`)
  if (clothes.hairColor) result.push(`造型发色：${clothes.hairColor}。`)
  if (clothes.makeupStyle)
    result.push(`整体妆容：${clothes.makeupCategory} / ${clothes.makeupStyle}。`)
  if (clothes.lipColor) result.push(`口红颜色：${clothes.lipColor}。`)
  if (clothes.clothingStyle)
    result.push(`服装造型：${clothes.clothingCategory} / ${clothes.clothingStyle}。`)
  if (httpImageUrl(clothes.referenceUrl)) result.push('服装造型参考所附用户选择的服装图片。')
  return result
}

function modelSheetAppearance(character, config, description, minor) {
  const filled = (value) => {
    const result = text(value)
    return result && result !== '保持原样' ? result : ''
  }
  const age = filled(character.ageGroup)
  const model = [
    age && `年龄段：${age}`,
    description && `角色描述：${description}`,
    filled(config.features.faceShape) && `脸型：${config.features.faceShape}`,
    filled(config.features.skinTone) && `肤色：${config.features.skinTone}`,
    '身材比例按参考图保持，不推断身高、体重或围度',
  ].filter(Boolean)
  const hair = [
    filled(config.clothes.hairColor || config.features.hairColor) &&
      `发色：${config.clothes.hairColor || config.features.hairColor}`,
    filled(config.clothes.hairStyle || config.features.hairStyle) &&
      `发型：${config.clothes.hairStyle || config.features.hairStyle}`,
    '未填写的长度、卷直、刘海与扎发方式按参考图保持',
  ].filter(Boolean)
  const clothing = [
    ...[
      ['上衣', config.clothes.upper],
      ['裤子/下装', config.clothes.lower],
      ['鞋子', config.clothes.shoes],
      ['配饰', config.clothes.accessories],
      ['服装风格', config.clothes.style],
      ['服装造型', config.clothes.clothingStyle],
      ['造型描述', config.clothes.description],
    ]
      .filter(([, value]) => filled(value))
      .map(([label, value]) => `${label}：${filled(value)}`),
    '其余服装、鞋子、配饰与妆容按参考图保持',
  ]
  const gender = text(character.gender)
  const subject = /^(女|女性)$/.test(gender)
    ? minor
      ? '女孩模特'
      : '女性模特'
    : /^(男|男性)$/.test(gender)
      ? minor
        ? '男孩模特'
        : '男性模特'
      : '模特'
  return { subject, model: model.join('；'), hair: hair.join('；'), clothing: clothing.join('；') }
}

/** Build a real image instruction from a whitelist of visual controls, never arbitrary config keys. */
export function characterStudioPrompt(
  character = {},
  kind = 'edit',
  customInstruction = '',
  assetType,
  ratio,
) {
  if (!KINDS.has(kind)) throw new Error('未知的模特生成操作')
  const selectedAssetType = kind === 'assets' ? validatedAssetType(assetType) : undefined
  const identitySheet = selectedAssetType === 'character-sheet'
  const additional = boundedText(customInstruction, 4000, '补充要求')
  const description = boundedText(character.description, 4000, '模特描述')
  const config = normalizeCharacterStudioConfig(character.config)
  const target = kind === 'age' ? ageTarget(config) : ''
  const minor = isMinor(character, target)
  requireAgeAppropriate(minor, [
    description,
    additional,
    config.features.distinguishingFeatures,
    ...CHARACTER_CLOTHES_FIELDS.map((field) => config.clothes[field.key]),
    config.clothes.clothingStyle,
  ])
  const lines = identitySheet
    ? []
    : [
        kind === 'create'
          ? '创建一位用于故事或家居电商场景的角色，单人、自然站姿、正常着装，画面清晰。'
          : '以所附角色原图为唯一人物身份参考，保持同一人物的身份辨识度、未明确调整的五官特征与整体画风。',
        '只执行用户明确选择的视觉调整；数值为相对调整强度，正负值表示调整方向，0 表示保持原样，不代表实际尺寸。',
      ]
  const facts = [
    ['角色名称', text(character.name)],
    ['性别', text(character.gender)],
    ['年龄段', text(character.ageGroup)],
    ['文化区域', text(character.culture)],
    ['角色描述', description],
  ]
  for (const [label, value] of facts) if (value) lines.push(`${label}：${value}。`)
  if (!identitySheet) lines.push(...visualInstructions(config, minor))
  if (kind === 'assets') {
    lines.push(
      characterStudioAssetPrompt(
        selectedAssetType,
        ratio,
        identitySheet ? modelSheetAppearance(character, config, description, minor) : undefined,
      ),
    )
  } else if (kind === 'age') {
    lines.push(`将角色自然调整至 ${target}，保留可辨识的同一人特征，年龄变化符合自然生理规律。`)
  } else if (kind === 'edit') {
    lines.push('仅调整以上明确配置的项目，未提及的服装、背景和构图保持原样。')
  }
  if (additional) lines.push(`用户补充的画面要求：${additional}`)
  lines.push(
    '人物必须完整正常着装，姿态自然，不描绘裸露或性化内容。未成年人采用符合年龄的日常穿着、体态与表情，不做成人化或性化塑形。',
    '只输出一张最终图片，不添加水印、说明文字、无关人物或多余肢体。',
  )
  const prompt = lines.join('\n')
  if (prompt.length > 12000) throw new Error('模特提示词合计不能超过 12000 字，请精简描述与调整项')
  return prompt
}

/** Generation settings only come from the configured model selector, never from character metadata. */
export function characterStudioGenerationSpec({
  character = {},
  kind = 'edit',
  assetType,
  instruction = '',
  model,
  ratio,
  resolution,
  models = [],
} = {}) {
  const chosenModel = text(model)
  const option = (Array.isArray(models) ? models : []).find(
    (item) => text(item?.value || item?.id) === chosenModel,
  )
  if (
    !chosenModel ||
    !option ||
    option.disabled === true ||
    option.enabled === false ||
    /^(disabled|inactive)$/i.test(text(option.status))
  ) {
    throw new Error('请选择当前已配置且可用的图片模型')
  }
  if (!RATIOS.has(ratio)) throw new Error('请选择支持的图片比例')
  if (!RESOLUTIONS.has(resolution)) throw new Error('请选择 1K、2K 或 4K 分辨率')
  if (!KINDS.has(kind)) throw new Error('未知的模特生成操作')
  const selectedAssetType = kind === 'assets' ? validatedAssetType(assetType) : undefined
  const format = kind === 'assets' ? characterStudioAssetFormat(selectedAssetType) : null
  const primary = httpImageUrl(character.imageUrl)
  if (kind !== 'create' && !primary) throw new Error('请先上传或选择有效的模特原图')
  const config = character.config || {}
  const styleUrls = Array.isArray(config.styleReferenceUrls) ? config.styleReferenceUrls : []
  const decals = Array.isArray(config.features?.decals)
    ? config.features.decals.filter((decal) => decal?.kind === 'custom').map((decal) => decal.url)
    : []
  const referenceUrls = [
    ...new Set(
      [primary, ...styleUrls, config.clothes?.referenceUrl, ...decals]
        .map(httpImageUrl)
        .filter(Boolean),
    ),
  ]
  if (referenceUrls.length > 8) throw new Error('模特原图与风格参考图合计不能超过 8 张')
  return Object.freeze({
    model: chosenModel,
    ratio,
    resolution,
    count: 1,
    ...(format
      ? {
          assetType: selectedAssetType,
          formatVersion: format.formatVersion,
          promptSource: format.promptSource,
        }
      : {}),
    prompt: characterStudioPrompt(character, kind, instruction, selectedAssetType, ratio),
    referenceUrls: Object.freeze(referenceUrls),
  })
}
