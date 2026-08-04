const STYLE_FIELDS = [
  ['composition_and_camera', '版式、构图与镜头'],
  ['lighting_and_color', '光线与色彩'],
  ['visual_style', '整体视觉风格'],
  ['typography_layout', '文字版式与字体气质'],
]

const OMITTED_STYLE_KEYS = new Set(['text_content'])

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

export function extractCompetitorStylePrompt(promptJson, fieldLabels = {}) {
  if (!promptJson || typeof promptJson !== 'object' || Array.isArray(promptJson)) return ''

  return STYLE_FIELDS.map(([key, label]) => {
    const value = readableStyleValue(promptJson[key], fieldLabels)
    return value ? `${label}：${value}` : ''
  })
    .filter(Boolean)
    .join('\n')
}

export function buildCompetitorStyleClonePrompt({ mode, stylePrompt, extra = '' }) {
  const cleanStylePrompt = String(stylePrompt || '').trim()
  if (!cleanStylePrompt) throw new Error('竞品图没有解析出可用的视觉风格')

  const modeRule =
    mode === 'style'
      ? '这是跨类目风格迁移：只迁移配色、光线、质感、背景氛围、字体气质与视觉节奏，不得复制竞品的商品结构、用途、配件或类目特征。'
      : '这是同类目版式复刻：迁移版式、构图、镜头、留白、信息层级、光线、配色与视觉节奏，但不得复制竞品商品的具体外观、材质纹理、结构细节、品牌或卖点事实。'

  return [
    '【我方产品约束】',
    '图1是我方产品白底图或产品参考图，也是最终画面中商品外观的唯一来源。',
    '必须准确保持图1产品的形状、结构、比例、材质、颜色、纹理、标识和配件，不得替换、变形、重绘成竞品商品，也不得遗漏产品主体。',
    '图1中已有的白底、边框和无关文案不是必须保留的画面元素，可以按下述竞品视觉方案重新设计场景。',
    '【迁移规则】',
    modeRule,
    '竞品图片只在前置分析阶段使用，本次生图没有竞品原图；以下内容仅是从竞品提取的视觉设计参数：',
    cleanStylePrompt,
    '【输出要求】',
    '根据以上视觉参数，为图1产品制作一张完整电商主图。商品必须清晰、完整、无遮挡，视觉层级明确。',
    '不得照搬竞品原文案、品牌、Logo、价格、销量、认证、功效承诺或水印；需要文字时仅使用补充要求明确提供的简体中文。',
    '最终画幅由接口 size 参数决定，只输出最终图片。',
    String(extra || '').trim() ? `【补充要求】\n${String(extra).trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
