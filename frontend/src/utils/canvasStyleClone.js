const TRANSFERABLE_STYLE_FIELDS = [
  ['content_role', '本图职责与展示任务'],
  ['composition_and_camera', '版式、构图与镜头'],
  ['scene_and_environment', '场景、道具与空间关系'],
  ['people_and_actions', '人物模特与动作关系'],
  ['lighting_and_color', '光线与色彩'],
  ['visual_style', '整体视觉风格'],
  ['typography_layout', '文字版式与字体气质'],
]

const OMITTED_STYLE_KEYS = new Set([
  'text_content',
  'brand_content',
  'brand_name',
  'logo_text',
  'price_content',
])

const PRODUCT_IDENTITY_FIELDS = [
  ['product_identity', '可见产品身份'],
  ['subject_and_elements', '产品主体'],
  ['mattress_surface', '床垫可见面层'],
  ['mattress_structure', '床垫可见结构'],
  ['curtain_detail', '窗帘可见细节'],
  ['curtain_drape', '窗帘可见形态'],
  ['bed_wood', '实木床可见表面'],
  ['bed_structure', '实木床可见结构'],
]

const OMITTED_PRODUCT_KEYS = new Set([
  ...OMITTED_STYLE_KEYS,
  'auxiliary_props',
  'layer_structure',
  'wood_species',
  'generation_prompt',
  'negative_prompt',
])

function readableStyleValue(value, fieldLabels = {}) {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => readableStyleValue(item, fieldLabels))
      .filter(Boolean)
      .join('；')
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !OMITTED_STYLE_KEYS.has(key))
      .map(([key, childValue]) => {
        const text = readableStyleValue(childValue, fieldLabels)
        return text ? `${fieldLabels[key] || key}：${text}` : ''
      })
      .filter(Boolean)
      .join('，')
  }
  return String(value).trim()
}

function readableProductValue(value, fieldLabels = {}) {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => readableProductValue(item, fieldLabels))
      .filter(Boolean)
      .join('；')
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !OMITTED_PRODUCT_KEYS.has(key))
      .map(([key, childValue]) => {
        const text = readableProductValue(childValue, fieldLabels)
        return text ? `${fieldLabels[key] || key}：${text}` : ''
      })
      .filter(Boolean)
      .join('，')
  }
  return String(value).trim()
}

export function extractCompetitorStylePrompt(promptJson, fieldLabels = {}, mode = 'layout') {
  if (!promptJson || typeof promptJson !== 'object' || Array.isArray(promptJson)) return ''
  void mode

  return TRANSFERABLE_STYLE_FIELDS.map(([key, label]) => {
    const value = readableStyleValue(promptJson[key], fieldLabels)
    return value ? `${label}：${value}` : ''
  })
    .filter(Boolean)
    .join('\n')
}

export function extractProductIdentityPrompt(promptJson, fieldLabels = {}) {
  if (!promptJson || typeof promptJson !== 'object' || Array.isArray(promptJson)) return ''

  return PRODUCT_IDENTITY_FIELDS.map(([key, label]) => {
    const value = readableProductValue(promptJson[key], fieldLabels)
    return value ? `${label}：${value}` : ''
  })
    .filter(Boolean)
    .join('\n')
}

export function buildCompetitorStyleCloneImageUrls(referenceUrl, productUrls = []) {
  const competitorUrl = String(referenceUrl || '').trim()
  const products = (Array.isArray(productUrls) ? productUrls : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean)
  if (!competitorUrl) throw new Error('缺少当前竞品参考图')
  if (!products.length) throw new Error('缺少我方产品图')
  return [competitorUrl, ...products]
}

export function assessCompetitorStyleCloneReadiness({
  mode,
  productCount = 0,
  referenceCount = 0,
  category = '',
  productFacts = '',
}) {
  const checks = [
    {
      id: 'product',
      label: '自家产品素材',
      detail: productCount > 0 ? `已选择 ${productCount} 张产品图` : '至少选择 1 张产品图',
      passed: productCount > 0,
      blocking: true,
    },
    {
      id: 'reference',
      label: '竞品参考素材',
      detail: referenceCount > 0 ? `已选择 ${referenceCount} 张参考图` : '至少选择 1 张参考图',
      passed: referenceCount > 0,
      blocking: true,
    },
  ]

  if (mode === 'layout') {
    const hasSpecificCategory = Boolean(String(category || '').trim()) && category !== 'general'
    checks.push({
      id: 'category',
      label: '同类目确认',
      detail: hasSpecificCategory ? '已选择具体产品类目' : '请选择具体类目，避免错误套用版式',
      passed: hasSpecificCategory,
      blocking: true,
    })
  }

  const hasProductFacts = Boolean(String(productFacts || '').trim())
  checks.push({
    id: 'facts',
    label: '产品事实边界',
    detail: hasProductFacts ? '已填写可确认事实' : '建议填写材质、结构、卖点和禁用声明',
    passed: hasProductFacts,
    blocking: false,
  })

  return {
    checks,
    canRun: checks.every((check) => !check.blocking || check.passed),
  }
}

export function buildCompetitorStyleClonePrompt({
  mode,
  stylePrompt,
  extra = '',
  productCount = 1,
  referenceIndex = 1,
  referenceCount = 1,
  productFacts = '',
  productIdentityPrompt = '',
  forbiddenContent = '',
}) {
  const cleanStylePrompt = String(stylePrompt || '').trim()
  if (!cleanStylePrompt) throw new Error('竞品图没有解析出可用的视觉风格')

  const normalizedProductCount = Math.max(1, Number(productCount) || 1)
  const normalizedReferenceCount = Math.max(1, Number(referenceCount) || 1)
  const normalizedReferenceIndex = Math.min(
    normalizedReferenceCount,
    Math.max(1, Number(referenceIndex) || 1),
  )
  const firstProductReference = 2
  const lastProductReference = normalizedProductCount + 1
  const productSourceLabel =
    normalizedProductCount === 1
      ? '参考图2是我方产品白底图或产品参考图，也是最终画面中商品外观的唯一事实来源。'
      : `参考图${firstProductReference}至参考图${lastProductReference}均为同一款我方产品的不同角度或细节参考；参考图2为主视觉基准，全部产品图共同构成最终商品外观的唯一事实来源。`

  const modeRule =
    mode === 'style'
      ? '这是跨类目关系映射：保留参考图1的配色、色温、光线、质感、镜头语言、人物气质、场景节奏、文字层级和空间关系；对与原类目绑定的产品姿态、使用动作、尺度关系、功能部件及专属场景做等价重映射，使其适合我方产品，禁止生硬照搬不合理的使用方式。'
      : '这是同类目高保真复刻：以参考图1为主要视觉依据，优先迁移版式骨架、构图机位、裁切与占比、产品展示状态、人物类型与位置、模特姿态动作、场景道具、前中后景、留白、信息模块、光线方向、色温、配色和视觉节奏；不得复制竞品商品的具体外观、材质纹理、结构细节、品牌或卖点事实。'

  return [
    '【标准化复刻任务】',
    `当前为第 ${normalizedReferenceIndex}/${normalizedReferenceCount} 张参考图对应的独立成图；本张只完成一个清晰的视觉职责，不与其他成图重复堆叠信息。`,
    '【参考图角色】',
    '参考图1是本张对应的竞品主图，只负责视觉呈现方式。必须直接观察并高保真迁移其构图、镜头、色调、色温、光线、人物、动作、场景、道具、产品展示状态和排版骨架；下方视觉指纹只用于强化识别，不得代替或覆盖参考图1。',
    '【我方产品约束】',
    productSourceLabel,
    '最终商品必须替换为我方产品。必须逐像素级优先保持产品图中可见的轮廓、长宽比例、厚薄体感、折叠状态、绗缝/纹理、包边、侧面、色块、印花标记、数量和配件；不得替换、增厚、变薄、变形、混合不同产品、重绘成竞品商品，也不得遗漏产品主体。',
    '参考图1中的竞品商品外观是明确的负参考：禁止继承其轮廓、厚度、绗缝、包边、侧墙、颜色、图案、标记、层数、截面和配件。若竞品构图与我方产品真实形态冲突，允许微调产品摆放与人物接触关系，产品身份永远优先。',
    '产品图中已有的白底、边框和无关文案不是必须保留的画面元素，可以按照本次迁移范围重新设计场景。',
    String(productIdentityPrompt || '').trim()
      ? `以下是从全部我方产品图自动提取的可见身份指纹，属于不可覆盖的硬约束：\n${String(productIdentityPrompt).trim()}`
      : '未提取到产品身份指纹：必须直接逐图观察参考图2及之后的我方产品图，并以其可见外观为硬约束。',
    String(productFacts || '').trim()
      ? `已确认产品事实：${String(productFacts).trim()}`
      : '未提供额外产品事实：只允许使用产品图中可直接观察到的外观事实，不得推断材质、参数、功效、认证或适用人群。',
    '【迁移规则】',
    modeRule,
    '人物规则：不得复刻具体人物身份或独特面容；可以使用非特定新模特，并保持参考图中的人数、年龄感、性别表达、穿搭气质、画面位置、姿态、动作方向、视线和人物与产品的空间关系。参考图无人时不得擅自添加人物。',
    '排版规则：保留参考图的信息模块数量、相对位置、尺寸比例、对齐、层级和字体气质；删除竞品原文、品牌、Logo、价格、认证及水印。只有补充要求明确提供文字时才写入文字，否则对应区域留白或使用无文字视觉模块，严禁自造品牌名和乱码。',
    '结构展示规则：只有我方产品图直接展示或已确认产品事实明确说明时，才允许生成爆炸图、分层图、截面图、参数图和功效图；否则必须保留参考图的信息布局但改成我方产品可见的整体、局部、折叠或表面细节，绝不继承竞品内部结构。',
    '以下为从参考图1提取的逐图视觉指纹，必须与参考图1共同使用：',
    cleanStylePrompt,
    '【输出要求】',
    '根据参考图1及以上视觉指纹，为我方产品制作一张完整电商主图。视觉相似的优先级依次为：构图与展示状态、人物与动作、场景与道具、色调色温与光线、排版骨架、细节质感。商品识别始终以我方产品图为最高优先级。',
    '不得照搬竞品原文案、品牌、Logo、价格、销量、认证、功效承诺或水印；需要文字时仅使用补充要求明确提供的简体中文。',
    String(forbiddenContent || '').trim()
      ? `项目禁用内容：${String(forbiddenContent).trim()}`
      : '项目禁用内容：竞品品牌与文案、虚假参数、虚假认证、无依据功效、乱码文字、多余产品和错误配件。',
    '输出前自检：先做产品身份硬检查，与全部我方产品图逐项核对轮廓、长宽比、厚度、折叠方式、绗缝/纹理、包边、侧面、色块、印花标记、数量和配件；任一项不一致必须先修正，不能用“视觉效果”作为改变产品的理由。再对照参考图1检查构图、机位、主体占比、人物动作、场景、色温、光线和排版骨架；同时确认无竞品品牌资产、无自造文字、无虚构事实、无畸形遮挡和多余产品。',
    '最终画幅由接口 size 参数决定，只输出最终图片。',
    String(extra || '').trim() ? `【补充要求】\n${String(extra).trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
