// These are editable generation parameters, not claims that a local face model is running.
const range = (key, label, min = -100, max = 100) => ({ key, label, min, max, step: 1 })
const paired = (key, label) => [
  range(`${key}Left`, `${label}（左）`),
  range(`${key}Right`, `${label}（右）`),
]

export const CHARACTER_EDITOR_TABS = [
  { id: 'face', label: '脸部精修', icon: 'faceViews' },
  { id: 'features', label: '脸部 & 身体特征', icon: 'characterSheet' },
  { id: 'body', label: '身材塑形', icon: 'threeViews' },
  { id: 'clothes', label: '服装造型', icon: 'layers' },
  { id: 'voice', label: '音色音调', icon: 'audio' },
]

export const CHARACTER_FACE_GROUPS = [
  {
    id: 'skin',
    label: '皮肤',
    icon: 'lighting',
    controls: [
      range('skinSmoothing', '质感磨皮', 0),
      range('faceBeauty', 'AI 美颜（脸部）', 0),
      range('skinTexture', '皮肤纹理（脸部）', 0),
      range('skinBrightness', '皮肤透亮', 0),
      range('skinRosiness', '皮肤红润', 0),
      range('skinWhitening', '皮肤美白', 0),
    ],
  },
  {
    id: 'eyes',
    label: '眉眼',
    icon: 'faceViews',
    controls: [
      range('darkCircles', '祛黑眼圈', 0),
      range('eyeBrightnessLeft', '亮眼（左）', 0),
      range('eyeBrightnessRight', '亮眼（右）', 0),
      ...paired('eyeSize', '眼睛大小'),
      ...paired('eyeWidth', '眼宽'),
      ...paired('eyeHeight', '眼高'),
      ...paired('eyeDistance', '眼距'),
      ...paired('eyelid', '眼睑'),
      ...paired('eyeTilt', '眼睛倾斜'),
      ...paired('eyeCorner', '开眼角'),
      ...paired('eyePosition', '眼睛上下'),
      ...paired('eyebrowDistance', '眉毛间距'),
      ...paired('eyebrowPosition', '眉毛上下'),
      ...paired('eyebrowArch', '眉峰'),
      ...paired('eyebrowThickness', '眉毛粗细'),
      ...paired('eyebrowTilt', '眉毛倾斜'),
      range('eyebrowEnhance', '眉毛增强', 0),
    ],
  },
  {
    id: 'nose',
    label: '鼻子',
    icon: 'character',
    controls: [
      range('noseRoot', '山根'),
      range('noseBridge', '鼻梁'),
      range('noseTip', '鼻尖'),
      range('noseLength', '鼻子长短'),
      range('noseSize', '鼻子大小'),
      range('noseWing', '鼻翼'),
    ],
  },
  {
    id: 'lips',
    label: '嘴唇',
    icon: 'smile',
    controls: [
      range('mouthPosition', '嘴巴上下'),
      range('lowerLip', '丰下唇'),
      range('mouthWidth', '嘴巴宽度'),
      range('lipFullness', '丰唇'),
      range('mouthCorner', '嘴角调整'),
      range('mouthTilt', '嘴巴倾斜'),
      range('mouthSize', '嘴巴大小'),
      range('upperLip', '丰上唇'),
      range('lipLines', '祛唇纹', 0),
      range('lipEnhance', '唇妆增强', 0),
    ],
  },
  {
    id: 'face',
    label: '脸部',
    icon: 'characterSheet',
    controls: [
      range('forehead', '额头'),
      range('vFace', 'V 脸'),
      range('faceWidth', '脸部宽度'),
      range('chinHeight', '下巴高度'),
      ...paired('jaw', '下颌'),
      ...paired('cheekbone', '颧骨'),
      ...paired('temple', '太阳穴'),
      range('middleFace', '中庭'),
      range('lowerFace', '下庭'),
      range('philtrum', '人中'),
      range('faceContour', '脸部轮廓流畅', 0),
      range('smallFace', '小脸', 0),
    ],
  },
  { id: 'makeup', label: '妆造', icon: 'elements', controls: [] },
]

export const CHARACTER_EYE_LIGHTS = [
  '无',
  '氧气',
  '清澈',
  '神采',
  '秋水',
  '灵动',
  '水光',
  '聚焦',
  '透亮',
  '星光',
  '通透',
]

export const CHARACTER_MAKEUP_GROUPS = [
  {
    key: 'eyebrows',
    label: '眉毛',
    choices: [
      '无',
      '自然',
      '直眉',
      '英气',
      '弯月',
      '高挑',
      '浓密',
      '小挑眉',
      '野生',
      '原生',
      '古典',
      '丝雾',
      '棕雾',
      '毛绒',
    ],
  },
  {
    key: 'contacts',
    label: '美瞳',
    choices: [
      '无',
      '琥珀',
      '橄榄绿',
      '混血灰',
      '灰粉',
      '烟花紫',
      '摩卡棕',
      '亚麻灰',
      '金星棕',
      '黑瞳',
      '黑边',
      '红宝石',
      '深棕',
      '金珀',
    ],
  },
  {
    key: 'eyeBags',
    label: '卧蚕',
    choices: ['无', '素颜', '自然', '妈生感', '可爱', '无辜', '月牙', '减龄', '亮片'],
  },
  {
    key: 'eyeshadow',
    label: '眼影',
    choices: [
      '无',
      '裸杏',
      '自然',
      '无辜眼',
      '元气',
      '泪痣',
      '猫眼',
      '闪片',
      '派对',
      '糖果',
      '大地色',
      '消肿',
      '海棠',
    ],
  },
  {
    key: 'eyelashes',
    label: '睫毛',
    choices: [
      '无',
      '自然',
      '纯欲',
      '甜妹',
      '翘睫',
      '仙女',
      '短睫',
      '鱼尾',
      '漫画',
      '下睫',
      '倒置',
      '上睫',
      '浓密',
      '太阳花',
      '卷翘',
    ],
  },
  {
    key: 'contour',
    label: '修容',
    choices: [
      '无',
      '立体',
      '自然',
      'V脸',
      '气质',
      '塑造',
      '欧美',
      '笔挺',
      '古铜',
      '混血',
      '盒鼻',
      '短鼻',
    ],
  },
  {
    key: 'blush',
    label: '腮红',
    choices: [
      '无',
      '元气',
      '眼下',
      '法式',
      '氛围',
      '高原',
      '面颊',
      '微醺',
      '冻伤',
      '晒伤',
      '红润',
      '桃粉',
      '减龄',
    ],
  },
  {
    key: 'lipstick',
    label: '唇彩',
    choices: [
      '无',
      '珊瑚粉',
      '裸粉',
      '蜜桃',
      '樱桃',
      '南瓜',
      '亮橘',
      '正红',
      '西柚',
      '浆果',
      '豆沙粉',
      '玫瑰',
      '火龙果',
      '果冻',
      '裸棕',
      '砖红',
      '车厘子',
      '玫红',
    ],
  },
  {
    key: 'decoration',
    label: '妆饰',
    choices: ['无', '眼下钻石', '雀斑', '度假雀斑', '慵懒雀斑', '野生雀斑', '美式雀斑'],
  },
  {
    key: 'eyeliner',
    label: '眼线',
    choices: [
      '无',
      '自然系',
      '深邃',
      '甜酷',
      '韩系',
      '狗狗眼',
      '古典',
      '全包',
      '开口下至',
      '淡颜',
      '上扬',
      '刀锋',
    ],
  },
  {
    key: 'highlight',
    label: '高光',
    choices: ['无', '眼下提亮', '丰润', '平整', '盈润', '丰盈', '笔挺', '透亮', '水光', '小灯泡'],
  },
]

export const CHARACTER_DECAL_PRESETS = [
  { id: 'mole', label: '痣' },
  { id: 'scar-dark', label: '疤痕_深' },
  { id: 'scar-light', label: '疤痕_浅' },
  { id: 'freckles-full', label: '全脸雀斑' },
  { id: 'freckles-cheeks', label: '脸颊雀斑' },
  { id: 'custom', label: '自定义' },
]

export const CHARACTER_FEATURE_FIELDS = [
  {
    key: 'faceShape',
    label: '脸型',
    choices: ['保持原样', '鹅蛋脸', '圆脸', '方脸', '瓜子脸', '长脸'],
  },
  {
    key: 'hairStyle',
    label: '发型',
    choices: ['保持原样', '短发', '长发', '卷发', '直发', '马尾', '盘发'],
  },
  { key: 'hairColor', label: '发色', choices: ['保持原样', '黑色', '棕色', '金色', '灰白色'] },
  { key: 'eyeColor', label: '瞳色', choices: ['保持原样', '黑色', '棕色', '蓝色', '绿色', '灰色'] },
  {
    key: 'skinTone',
    label: '肤色',
    choices: ['保持原样', '自然肤色', '偏白', '小麦色', '古铜色', '深肤色'],
  },
  {
    key: 'distinguishingFeatures',
    label: '其他特征',
    multiline: true,
    placeholder: '例如：酒窝、雀斑、眼镜等，希望保留或调整的模特特征',
  },
]

export const CHARACTER_BODY_CONTROLS = [
  range('bust', '丰胸'),
  range('slim', '瘦身'),
  range('arms', '瘦手臂'),
  range('hips', '美臀'),
  range('shoulderWidth', '肩膀宽度'),
  range('height', 'AI 增高', 0),
  range('posture', '驼背', 0),
  range('legLength', '长腿', 0),
  range('squareShoulder', '直角肩', 0),
  range('smallHead', '小头', 0),
  range('slimBelly', '瘦肚子', 0),
  range('slimLegs', '瘦腿', 0),
  range('slimNeckLeft', '瘦脖子-左', 0),
  range('slimNeckRight', '瘦脖子-右', 0),
  range('waist', '美腰', 0),
  range('swanNeckLeft', '天鹅颈-左', 0),
  range('swanNeckRight', '天鹅颈-右', 0),
  range('wholeBody', '全身美型', 0),
]

export const CHARACTER_STYLING_CATEGORIES = ['现代', '古风', '民国', '仙侠', '科幻', '民族', '儿童']
export const CHARACTER_MAKEUP_CATEGORIES = [
  '现代',
  '古代',
  '民国',
  '欧美时尚',
  '国潮',
  '特效',
  '儿童',
]
export const CHARACTER_CLOTHING_CATEGORIES = [
  '现代',
  '古风',
  '仙侠',
  '民国',
  '科幻',
  '礼服',
  '民族',
]
export const CHARACTER_HAIR_STYLES = [
  '长直发',
  '大波浪',
  '波波头',
  '齐肩中短发',
  '高马尾',
  '低马尾',
  '双马尾',
  '丸子头',
  '半扎发',
  '编发',
  '空气刘海',
  '齐刘海',
]
export const CHARACTER_MAKEUP_STYLES = [
  '素颜',
  '裸妆',
  '桃花氛围妆',
  '日常淡妆',
  '冷艳妆',
  '甜美妆',
  '韩系妆',
]
export const CHARACTER_HAIR_COLORS = [
  '#171412',
  '#4d3528',
  '#754831',
  '#a07146',
  '#b29c79',
  '#d1b983',
  '#bdb8ae',
  '#d6c3bd',
  '#8d5c63',
  '#675c7c',
]
export const CHARACTER_LIP_COLORS = [
  '#b1575d',
  '#b02b3a',
  '#c46d73',
  '#b65134',
  '#bf725d',
  '#9e344b',
  '#ae3e55',
  '#c07c73',
  '#7b2732',
  '#8d5150',
]
export const CHARACTER_CLOTHING_STYLES = [
  ['便装', 3],
  ['连衣裙', 4],
  ['职业西装', 2],
  ['通勤', 1],
  ['运动', 4],
  ['JK制服', 2],
  ['校服', 3],
  ['街头', 2],
  ['家居', 3],
].flatMap(([label, count]) => Array.from({ length: count }, (_, i) => `${label} ${i + 1}`))

export const CHARACTER_VOICE_LIBRARY = [
  ...['青涩青年音色', '精英青年音色', '霸道青年音色', '青年大学生音色'].map((name, index) => ({
    id: `male-${index}`,
    name,
    gender: '男',
    tone: '青年',
  })),
  ...['少女音色', '御姐音色', '成熟女性音色', '甜美女性音色'].map((name, index) => ({
    id: `female-${index}`,
    name,
    gender: '女',
    tone: index === 2 ? '成熟' : '青年',
  })),
  ...[
    '青涩青年音色',
    '精英青年音色',
    '霸道青年音色',
    '青年大学生音色',
    '少女音色',
    '御姐音色',
    '成熟女性音色',
    '甜美女性音色',
  ].map((name, index) => ({
    id: `beta-${index}`,
    name: `${name} - beta`,
    gender: index < 4 ? '男' : '女',
    tone: '青年',
  })),
  { id: 'boy-smart', name: '聪明男童', gender: '男', tone: '儿童' },
  { id: 'boy-cute', name: '可爱男童', gender: '男', tone: '儿童' },
  { id: 'girl-cute', name: '萌萌女童', gender: '女', tone: '儿童' },
  { id: 'pig-character', name: '卡通猪小琪', gender: '卡通', tone: '卡通' },
]

export const CHARACTER_CLOTHES_FIELDS = [
  {
    key: 'style',
    label: '服装风格',
    choices: ['保持原样', '休闲', '商务', '运动', '古风', '时尚', '居家'],
  },
  { key: 'upper', label: '上装', placeholder: '描述上装款式、颜色、材质' },
  { key: 'lower', label: '下装', placeholder: '描述裤装、裙装等' },
  { key: 'shoes', label: '鞋子', placeholder: '描述鞋子款式与颜色' },
  { key: 'accessories', label: '配饰', placeholder: '描述眼镜、帽子、首饰等配饰' },
  {
    key: 'description',
    label: '造型描述',
    multiline: true,
    placeholder: '补充你希望的整体穿搭、配色和细节',
  },
]

export const CHARACTER_VOICE_FIELDS = [
  {
    key: 'timbre',
    label: '音色',
    choices: ['自然', '清亮', '温柔', '醇厚', '磁性', '沙哑', '活泼'],
  },
  { key: 'language', label: '语言', choices: ['普通话', '英语', '粤语', '日语', '韩语'] },
  {
    key: 'description',
    label: '声音描述',
    multiline: true,
    placeholder: '描述模特的声线、说话习惯与语气',
  },
]
export const CHARACTER_VOICE_CONTROLS = [
  range('pitch', '音调'),
  range('speed', '语速'),
  range('emotion', '情绪强度', 0),
]

const facialControls = CHARACTER_FACE_GROUPS.flatMap((group) => group.controls)
const copy = (value) => JSON.parse(JSON.stringify(value || {}))
const text = (value, limit = 1200) => String(value || '').slice(0, limit)

function numericValues(controls, source) {
  return Object.fromEntries(
    controls.map((control) => {
      const number = Number(source?.[control.key])
      return [
        control.key,
        Number.isFinite(number)
          ? Math.round(Math.max(control.min, Math.min(control.max, number)))
          : 0,
      ]
    }),
  )
}

function fieldValues(fields, source) {
  return Object.fromEntries(
    fields.map((field) => [field.key, text(source?.[field.key] || field.choices?.[0] || '')]),
  )
}

/** Complete, inert config. Unknown surrounding metadata is retained for backwards compatibility. */
export function normalizeCharacterStudioConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}
  return {
    ...copy(value),
    styleReferenceUrls: Array.isArray(value.styleReferenceUrls)
      ? value.styleReferenceUrls
          .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))
          .slice(0, 8)
      : [],
    facial: {
      ...numericValues(facialControls, value.facial),
      removeBlemishes: Boolean(value.facial?.removeBlemishes),
      eyeLight: CHARACTER_EYE_LIGHTS.includes(value.facial?.eyeLight)
        ? value.facial.eyeLight
        : '无',
    },
    makeup: Object.fromEntries(
      CHARACTER_MAKEUP_GROUPS.map((group) => [
        group.key,
        group.choices.includes(value.makeup?.[group.key]) ? value.makeup[group.key] : '无',
      ]),
    ),
    features: {
      ...fieldValues(CHARACTER_FEATURE_FIELDS, value.features),
      decals: Array.isArray(value.features?.decals)
        ? value.features.decals.slice(0, 20).map((decal, index) => ({
            id: text(decal.id || `decal-${index}`, 100),
            kind: CHARACTER_DECAL_PRESETS.some((preset) => preset.id === decal.kind)
              ? decal.kind
              : 'mole',
            url: text(decal.url, 20000),
            x: Number.isFinite(Number(decal.x)) ? Math.max(0, Math.min(100, Number(decal.x))) : 50,
            y: Number.isFinite(Number(decal.y)) ? Math.max(0, Math.min(100, Number(decal.y))) : 40,
            rotation: Number.isFinite(Number(decal.rotation))
              ? Math.max(-180, Math.min(180, Number(decal.rotation)))
              : 0,
            scale: Number.isFinite(Number(decal.scale))
              ? Math.max(0.2, Math.min(3, Number(decal.scale)))
              : 1,
          }))
        : [],
    },
    body: numericValues(CHARACTER_BODY_CONTROLS, value.body),
    clothes: {
      ...fieldValues(CHARACTER_CLOTHES_FIELDS, value.clothes),
      hairCategory: text(value.clothes?.hairCategory || '现代', 60),
      hairStyle: text(value.clothes?.hairStyle, 120),
      hairColor: text(value.clothes?.hairColor, 30),
      makeupCategory: text(value.clothes?.makeupCategory || '现代', 60),
      makeupStyle: text(value.clothes?.makeupStyle, 120),
      lipColor: text(value.clothes?.lipColor, 30),
      clothingCategory: text(value.clothes?.clothingCategory || '现代', 60),
      clothingStyle: text(value.clothes?.clothingStyle, 120),
      referenceUrl: text(value.clothes?.referenceUrl, 20000),
    },
    voice: {
      ...fieldValues(CHARACTER_VOICE_FIELDS, value.voice),
      ...numericValues(CHARACTER_VOICE_CONTROLS, value.voice),
      selectedVoice: text(value.voice?.selectedVoice, 120),
      designDescription: text(value.voice?.designDescription),
    },
  }
}

export function characterStudioRecord(character = {}) {
  if (!character || typeof character !== 'object' || Array.isArray(character)) character = {}
  return {
    ...copy(character),
    name: text(character.name || '未命名模特', 80),
    config: normalizeCharacterStudioConfig(character.config),
  }
}

export function characterStudioImage(character = {}) {
  return text(
    character.imageUrl || character.url || character.assetUrl || character.coverUrl,
    20000,
  )
}

/** Stable fingerprint of visual settings only; voice, identity and paid settings are excluded. */
export function characterStudioVisualConfig(character = {}) {
  const config = normalizeCharacterStudioConfig(character?.config)
  return JSON.stringify({
    facial: config.facial,
    makeup: config.makeup,
    features: config.features,
    body: config.body,
    clothes: config.clothes,
    styleReferenceUrls: config.styleReferenceUrls,
  })
}

/** Translate controls into model instructions; no local pixel transformation is implied. */
export function characterStudioInstruction(character = {}, customInstruction = '') {
  const config = normalizeCharacterStudioConfig(character.config)
  const instructions = [
    '以所提供的角色图片为唯一身份参考，保留人物身份、未明确调整的五官特征、服装、背景、画风和构图。仅进行以下用户明确配置的调整；数值为相对调整强度，不是实际尺寸，0 表示保持原样。',
  ]
  for (const control of [...facialControls, ...CHARACTER_BODY_CONTROLS]) {
    const value = (facialControls.includes(control) ? config.facial : config.body)[control.key]
    if (value !== 0) instructions.push(`${control.label}：${value > 0 ? '+' : ''}${value}。`)
  }
  if (config.facial.removeBlemishes) instructions.push('自然去除斑点与痘痘，保留真实皮肤细节。')
  if (config.facial.eyeLight !== '无') instructions.push(`眼神光：${config.facial.eyeLight}。`)
  for (const group of CHARACTER_MAKEUP_GROUPS)
    if (config.makeup[group.key] !== '无')
      instructions.push(`${group.label}：${config.makeup[group.key]}。`)
  for (const [fields, values] of [
    [CHARACTER_FEATURE_FIELDS, config.features],
    [CHARACTER_CLOTHES_FIELDS, config.clothes],
  ])
    for (const field of fields)
      if (values[field.key] && values[field.key] !== '保持原样')
        instructions.push(`${field.label}：${values[field.key]}。`)
  for (const decal of config.features.decals)
    instructions.push(
      `特征贴图 ${CHARACTER_DECAL_PRESETS.find((preset) => preset.id === decal.kind)?.label}：位置横向 ${Math.round(decal.x)}%、纵向 ${Math.round(decal.y)}%，旋转 ${decal.rotation}°，相对大小 ${decal.scale}。保持其他特征不变。`,
    )
  if (config.clothes.hairStyle)
    instructions.push(`发型：${config.clothes.hairCategory} / ${config.clothes.hairStyle}。`)
  if (config.clothes.hairColor) instructions.push(`发色：${config.clothes.hairColor}。`)
  if (config.clothes.makeupStyle)
    instructions.push(
      `整体妆容：${config.clothes.makeupCategory} / ${config.clothes.makeupStyle}。`,
    )
  if (config.clothes.lipColor) instructions.push(`口红颜色：${config.clothes.lipColor}。`)
  if (config.clothes.clothingStyle)
    instructions.push(
      `服装造型：${config.clothes.clothingCategory} / ${config.clothes.clothingStyle}。`,
    )
  if (text(customInstruction).trim())
    instructions.push(`补充调整：${text(customInstruction).trim()}`)
  instructions.push(
    '只输出一张调整后的角色图片，不添加文字、水印、额外人物或多余肢体。音色音调是角色档案信息，不应改变本次图片。',
  )
  return instructions.join('\n')
}
