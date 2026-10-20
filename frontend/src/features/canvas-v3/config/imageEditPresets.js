import { imageGridTemplate, imageGridHint } from './imageGridTemplates.js'
import { emotionRoleInstructions } from './portraitEmotion.js'
import { MULTI_ANGLE_TEMPLATE, angleInstructions } from './multiAngle.js'

// UI labels and middle defaults verified in the live reference. Prompts are ours.
export const PORTRAIT_FIELDS = [
  { key: 'scene', label: '人景融合', options: ['轻度对齐', '自然融合', '深度融合'] },
  { key: 'light', label: '光影融合', options: ['柔和补光', '自然匹配', '氛围强化'] },
  { key: 'skin', label: '皮肤', options: ['清透修饰', '自然肤质', '真实肌理'] },
  { key: 'texture', label: '纹理', options: ['柔和纹理', '自然纹理', '颗粒质感'] },
  { key: 'sharpness', label: '锐度', options: ['柔焦', '标准清晰', '高清锐化'] },
]

export const PORTRAIT_MENU = [
  { id: 'portrait-texture', label: '人像调节', icon: 'character' },
  { id: 'portrait-emotion', label: '情绪调节', icon: 'smile' },
]

const templates = [
  {
    id: 'staging-storyboard',
    label: '调度故事板',
    icon: 'storyboard',
    hint: '点击生成，基于当前图像规划人物走位、镜头机位与连续镜头；支持文生/参考图生成。',
    prompt:
      '以引用图或补充描述为视觉参考，生成一张电影场面调度故事板。按阅读顺序展示环境建立、人物进入、人物走位与互动、机位切换、关键动作及场面收束。保持人物身份、服装、场景空间、视线方向、动作轴线和光线连续，明确前中后景关系与镜头景别变化。使用简洁的调度草图、走位路径与运动方向箭头表现人物和镜头的调度轨迹，分镜排版整齐并呈现同一段连续事件。不要无关画面，不要文字、数字或水印；输出一张完整故事板图片。',
  },
  {
    id: 'storyboard',
    label: '故事板',
    icon: 'storyboard',
    hint: '点击生成，基于当前图像或描述生成连续故事板；支持文生/参考图生成。',
    prompt:
      '以引用图或补充描述为故事与视觉参考，生成一张完整的连续故事板。按从左到右、从上到下的阅读顺序，展示故事的开端、发展、关键转折与结尾；通过全景、中景、近景与特写变化推动叙事。保持人物身份、服装、场景布局、画面风格和光线一致，确保前后镜头事件衔接自然。分镜排列整齐，避免重复镜头，不要文字、数字、对白气泡或水印；仅输出一张完整故事板图片。',
  },
  {
    id: 'portrait-texture',
    label: '人像质感调节',
    icon: 'character',
    hint: '上传图片或输入描述，选择质感强度，让人物更自然、更真实',
    prompt:
      '以引用图为人物身份、服装、姿态和构图参考，降低 AI 感并优化人像真实质感。保持五官、年龄、体型和场景内容一致，不更换人物，不添加文字或水印。',
  },
  {
    id: 'portrait-emotion',
    label: '情绪调节',
    icon: 'smile',
    hint: '选择角色并拖动情绪定位，调整表情；保持人物身份与画面内容一致。',
    prompt:
      '以引用图为准，只调整选中角色的情绪与面部表情。严格保持同一人物的身份、五官比例、年龄、发型、服装、身体姿态、背景、光线与构图；保留未选角色，不添加文字或水印。',
  },
  {
    id: 'panorama-720',
    label: '720全景',
    icon: 'panorama',
    hint: '点击生成，直接将场景图像转为720全景图；支持文生/参考图生成。',
    prompt:
      '根据引用图或补充描述生成一张完整的 720° 球形全景环境图。使用宽高比 2:1 的等距柱状投影（equirectangular），横向覆盖 360°、纵向覆盖 180°，包含天顶与地面，左右边缘无缝衔接。保持参考场景的风格、主体、空间结构、材质、光线和配色，合理补全视野外环境，确保水平线与空间透视连续。输出单张平铺全景图，不要多联画、边框、文字、水印或内嵌的球形预览。',
  },
]

export function imageEditTemplate(id) {
  if (id === 'multi-angle') return MULTI_ANGLE_TEMPLATE
  return templates.find((template) => template.id === id) || imageGridTemplate(id)
}

export function imageEditHint(id) {
  if (id === 'multi-angle') return MULTI_ANGLE_TEMPLATE.hint
  return templates.find((template) => template.id === id)?.hint || imageGridHint(id)
}

export function portraitSettings(settings = {}) {
  return Object.fromEntries(
    PORTRAIT_FIELDS.map((field) => [
      field.key,
      field.options.includes(settings[field.key]) ? settings[field.key] : field.options[1],
    ]),
  )
}

export function imageEditPreset(id) {
  const template = templates.find((item) => item.id === id)
  if (!template) return null
  return {
    title: id === 'panorama-720' ? '720°全景图' : template.label,
    prompt: '',
    params: {
      count: '1张',
      ...(id === 'panorama-720' ? { ratio: '2:1', quality: '标准画质', resolution: '2K' } : {}),
    },
    editTemplate: {
      id,
      version: 1,
      ...(id === 'portrait-texture' ? { settings: portraitSettings() } : {}),
    },
  }
}

// Before the nine-view layout was introduced, "restore default" persisted this
// built-in text as though it were a user edit. Only this exact historical default
// follows the current template; any user-authored changes remain authoritative.
const LEGACY_CHARACTER_SHEET_PROMPT =
  '以引用图中的角色为准，生成一张专业角色设定图。包含角色正面、侧面、背面的全身造型，以及脸部与服装配饰细节。严格统一人物身份、身材比例、发型、服装、材质和配色，使用干净背景与整洁的设定稿排版。不要引入其他角色，不要文字、标注或水印；仅输出一张完整设定图。'

export function imageEditTemplatePrompt(data) {
  const preset = data?.editTemplate
  const template = imageEditTemplate(preset?.id)
  if (!template) return ''
  const instructions = preset.instructions?.trim()
  if (preset.id === 'character-sheet' && instructions === LEGACY_CHARACTER_SHEET_PROMPT)
    return template.prompt
  return instructions || template.prompt
}

export function imageEditInstructions(data) {
  const preset = data.editTemplate
  if (preset?.id === 'multi-angle') return angleInstructions(preset.camera)
  const template = imageEditTemplate(preset?.id)
  if (!template) return ''
  const prompt = imageEditTemplatePrompt(data)
  if (preset.id === 'portrait-texture') {
    const settings = portraitSettings(preset.settings)
    return [
      prompt,
      ...PORTRAIT_FIELDS.map((field) => `${field.label}：${settings[field.key]}`),
    ].join('\n')
  }
  if (preset.id === 'portrait-emotion') return prompt + '\n' + emotionRoleInstructions(preset.roles)
  return prompt
}
