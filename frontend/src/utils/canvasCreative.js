const PRODUCT_GUARD = [
  '图1是唯一的产品外观来源。',
  '必须保持图1产品的形状、结构、材质、颜色、纹理、比例与标识准确，不得替换、变形或混入其他商品特征。',
  '必须先识别并提取图1中的完整产品主体或产品组合，再把它清晰放入最终画面；不得遗漏产品，不得只保留图1的文字、背景或装饰。',
  '图1中原有的营销文案、价格条、边框和背景都不是产品的一部分，除非补充要求明确指定，否则不要复制。',
  '不得添加未经提供的品牌、价格、销量、证书、型号、功效承诺或水印。',
  '所有可见文字使用简体中文短句；无法稳定呈现时减少文字，不得生成错字、乱码或伪文字。',
].join('\n')

const MAIN_PRESETS = {
  layout: [
    '共有两张参考图：图1是需要展示的产品图，图2是版式与构图参考图。',
    '借鉴图2的信息结构、主体位置、留白、背景关系、光影组织和视觉节奏，为图1产品重新制作一张电商主图。',
    '必须用图1产品替换图2中的原商品或视觉主体。图1产品应占据画面核心区域约45%至70%，完整、清晰、无遮挡，不得只生成图2场景。',
    PRODUCT_GUARD,
    '图2只作为版式与视觉结构参考，不得复制其中的品牌、商品名称、价格、销量、促销、证书、型号、专属卖点或水印。',
    '输出一张干净、真实、层次明确、可直接用于电商展示的图片，画幅比例与图2一致，只输出最终图片。',
  ].join('\n'),
  style: [
    '共有两张参考图：图1是需要保持真实外观的产品图，图2是视觉风格参考图。',
    '保持图1产品不变，将整张图重构为图2的视觉风格。',
    '图1产品必须完整、清晰地出现在画面核心区域，占画面约45%至70%；不得只生成图2的场景、色彩或原商品。',
    PRODUCT_GUARD,
    '只迁移图2的配色与色温、光线方向与软硬、背景场景、构图节奏、信息层级、字体气质、质感和整体氛围。',
    '图2不得向结果带入品牌、商品名称、价格、销量、促销、证书、型号、专属卖点或水印。',
    '输出一张完成度高、可直接用于电商展示的图片，画幅比例与图2一致，只输出最终图片。',
  ].join('\n'),
}

const DEMAND_SEEDS = [
  {
    dimension: '人群',
    title: '核心人群直达',
    audience: '最匹配该产品的核心购买人群',
    scene: '目标人群最常见的真实使用环境',
    need: '让用户快速确认这就是为自己准备的产品',
    sellingPoint: '产品信息中与核心人群直接相关的卖点',
    visualDirection: '人物与产品关系自然，产品始终是视觉主体，避免夸张效果演示',
  },
  {
    dimension: '场景',
    title: '高频场景代入',
    audience: '正处在典型使用场景中的潜在用户',
    scene: '产品最有价值的高频使用场景',
    need: '把抽象卖点转化为一眼可懂的使用体验',
    sellingPoint: '产品在该场景下能够被事实支持的价值',
    visualDirection: '真实生活方式构图，自然光，场景完整但不抢产品主体',
  },
  {
    dimension: '需求',
    title: '核心问题解决',
    audience: '正在比较同类商品的决策用户',
    scene: '购买前最关心的问题出现时',
    need: '用一个明确理由降低理解和决策成本',
    sellingPoint: '产品信息中最强且可验证的核心卖点',
    visualDirection: '一个核心卖点配一个证据画面，信息层级清晰，留白充足',
  },
  {
    dimension: '人群',
    title: '细分人群专属',
    audience: '有明确偏好或限制条件的细分人群',
    scene: '细分人群的日常使用空间',
    need: '强化产品与细分人群之间的适配感',
    sellingPoint: '材质、规格、功能或体验中的适配优势',
    visualDirection: '克制的专属感表达，人物作为尺度和情境参照，不虚构身份标签',
  },
  {
    dimension: '场景',
    title: '使用前后变化',
    audience: '需要直观看到使用价值的用户',
    scene: '使用前问题与使用后体验的同场对照',
    need: '帮助用户迅速理解产品带来的变化',
    sellingPoint: '能够被产品信息支持的使用改善',
    visualDirection: '左右或上下对照构图，保持真实，不做无法验证的效果承诺',
  },
  {
    dimension: '需求',
    title: '品质细节证明',
    audience: '关注材质、结构和做工的理性用户',
    scene: '购买前放大查看细节和比较品质时',
    need: '用真实细节建立信任',
    sellingPoint: '产品已提供的材质、结构、纹理或工艺信息',
    visualDirection: '产品特写结合简短标注，光线克制，细节清晰，不伪造检测与资质',
  },
  {
    dimension: '人群',
    title: '送礼与分享',
    audience: '有赠送、分享或共同使用需求的人群',
    scene: '真实的赠送、分享或共同使用场景',
    need: '传达体面、好理解和容易使用',
    sellingPoint: '外观、包装或使用体验中已确认的优势',
    visualDirection: '有人情味但不过度煽情，产品完整清晰，避免虚构礼盒或配件',
  },
  {
    dimension: '场景',
    title: '空间搭配展示',
    audience: '关注产品与环境协调性的用户',
    scene: '产品最常出现的空间与搭配关系',
    need: '让用户判断尺寸感、风格和摆放效果',
    sellingPoint: '产品外观、颜色、尺寸或形态带来的搭配价值',
    visualDirection: '环境整洁、尺度可信、色彩协调，产品轮廓与关键结构不被遮挡',
  },
  {
    dimension: '需求',
    title: '规格选择指引',
    audience: '在不同款式或规格间犹豫的用户',
    scene: '下单前核对适配条件和规格时',
    need: '减少选错与退换顾虑',
    sellingPoint: '产品信息中已经提供的规格与适配信息',
    visualDirection: '参数卡与产品展示并置，只展示已确认参数，不补写未知尺寸',
  },
  {
    dimension: '人群',
    title: '轻松上手体验',
    audience: '重视操作门槛和使用便利的用户',
    scene: '首次使用或日常快速使用时',
    need: '降低学习成本和使用顾虑',
    sellingPoint: '已确认的操作方式、结构或便利设计',
    visualDirection: '三步以内的动作表达，画面顺序明确，不虚构未提供功能',
  },
  {
    dimension: '场景',
    title: '长期使用价值',
    audience: '重视耐用、维护和长期体验的用户',
    scene: '清洁、收纳、维护或长期使用环境',
    need: '回应购买后的持续使用顾虑',
    sellingPoint: '已提供的清洁、收纳、维护或耐用信息',
    visualDirection: '细节图与真实动作组合，表达克制，避免无依据的寿命数字',
  },
  {
    dimension: '需求',
    title: '一图决策总结',
    audience: '需要快速完成购买判断的用户',
    scene: '浏览多款商品后的最后比较阶段',
    need: '把关键价值压缩成一张易读的决策图',
    sellingPoint: '产品信息中最重要的三项以内事实',
    visualDirection: '产品英雄图加三项以内短信息，层级清楚，不堆促销元素',
  },
]

const DETAIL_SEEDS = [
  ['首屏主视觉', '用一句核心利益点建立第一印象', '产品主视觉与核心利益点', '大标题、产品主体、一个核心卖点，留白充足', '产品真实外观与核心价值'],
  ['痛点共鸣', '让用户快速识别自己的问题', '从用户日常问题切入，引出产品价值', '真实场景与痛点信息分区，产品自然进入画面', '用户问题与使用前状态'],
  ['核心卖点', '集中解释最重要的购买理由', '一个核心卖点配一条简洁说明', '产品主体居中，卖点标签不遮挡产品', '产品信息中可确认的核心卖点'],
  ['细节证明', '用材质、结构或工艺建立可信度', '放大一个能够支撑卖点的真实细节', '局部特写、标注线和简短说明，画面干净', '材质、结构、工艺或使用细节'],
  ['场景体验', '帮助用户想象真实使用体验', '产品进入具体人群与使用场景', '自然光生活场景，产品始终是视觉主体', '适用人群、使用空间与体验变化'],
  ['优势说明', '把产品价值讲得更清楚', '用同维度信息解释产品优势', '左右或上下对照结构，不出现贬低性竞品表达', '已提供且可验证的产品差异'],
  ['使用方法', '降低理解和使用门槛', '用简洁步骤说明如何使用或搭配', '三步以内的流程卡片，阅读顺序明确', '真实使用方式和注意点'],
  ['规格选择', '帮助用户完成购买决策', '整理已提供的尺寸、款式或适配信息', '清晰参数卡与产品展示并置，不填未知参数', '产品信息中已有的规格与适配范围'],
  ['品质感知', '强化整体质感与品牌印象', '通过光影、材质和细节呈现产品品质', '克制高级的棚拍或生活方式构图，文字极少', '外观、触感、材质与做工'],
  ['人群适配', '说明产品适合哪些明确人群', '用不同使用者的真实需要组织信息', '人物与产品关系自然，避免夸张效果演示', '产品信息中明确的适用人群'],
  ['维护与耐用', '回应长期使用顾虑', '说明清洁、收纳、保养或耐用价值', '细节图与简短说明卡组合，信息清晰', '已提供的维护方式和长期价值'],
  ['收尾转化', '总结价值并给出自然的行动引导', '回扣核心卖点和使用体验', '产品英雄图、价值总结和克制的行动文案', '整套详情页已经确认的产品价值'],
]

export function expandMainImagePrompt(mode, extra = '') {
  const preset = MAIN_PRESETS[mode] || MAIN_PRESETS.layout
  const cleanExtra = extra.trim()
  const noText = /不要(?:任何)?文字|不需要文案|无文字|纯图|no[\s-]?text/i.test(cleanExtra)
  const hardConstraint = noText
    ? '最高优先级硬约束：最终画面不得出现任何文字、字符、数字、符号、标签、价格条或营销边框；必须移除两张源图中的全部现成文案。'
    : ''
  return [hardConstraint, preset, cleanExtra ? `补充要求：${cleanExtra}` : '']
    .filter(Boolean)
    .join('\n')
}

export function createDemandFallback({ productInfo, count, style }) {
  const total = Math.max(3, Math.min(12, Number(count) || 6))
  return DEMAND_SEEDS.slice(0, total).map((seed, index) => {
    const copy = seed.sellingPoint
    const imagePrompt = [
      PRODUCT_GUARD,
      `产品信息：${productInfo}`,
      `整体风格：${style || '真实、清晰、有品质感'}`,
      `创意方向：${seed.title}`,
      `目标人群：${seed.audience}`,
      `使用场景：${seed.scene}`,
      `用户需求：${seed.need}`,
      `核心卖点：${seed.sellingPoint}`,
      `画面文案：${copy}`,
      `视觉方向：${seed.visualDirection}`,
      '生成一张主体明确、构图有层次、适合淘宝/天猫展示的电商创意图，只输出最终图片。',
    ].join('\n')
    return {
      id: `fallback-demand-${index + 1}`,
      index: index + 1,
      ...seed,
      copy,
      imagePrompt,
      selected: true,
    }
  })
}

export function createDetailFallback({
  productInfo,
  count,
  style,
  strength,
  referenceCount,
  ratio,
}) {
  const total = Math.max(3, Math.min(12, Number(count) || 6))
  return DETAIL_SEEDS.slice(0, total).map((seed, index) => {
    const [title, goal, copy, visual, proof] = seed
    const referenceIndex = referenceCount ? index % referenceCount : null
    const referenceRule = referenceIndex == null
      ? '图1是产品图，也是本屏商品外观的唯一来源。'
      : `图1是产品图，图2是本屏参考图。参考强度为${strength || 'balanced'}；最终画幅比例与图2一致，图2同时提供布局、构图、色彩、光影和信息节奏，不得复制其商品、品牌、文字、价格、销量、证书或水印。`
    const imagePrompt = [
      referenceRule,
      PRODUCT_GUARD,
      `产品信息：${productInfo}`,
      `详情页第${index + 1}屏：${title}`,
      `页面目标：${goal}`,
      `画面文案：${copy}`,
      `视觉方向：${visual}`,
      `证明重点：${proof}`,
      `生成完整的${ratio || '产品图原始比例'}画幅电商详情页单屏，整体风格为${style || '真实、清晰、有品质感'}。移动端阅读顺畅，只输出最终图片。`,
    ].join('\n')
    return {
      id: `fallback-detail-${index + 1}`,
      index: index + 1,
      title,
      goal,
      copy,
      visual,
      proof,
      referenceIndex,
      imagePrompt,
      selected: true,
    }
  })
}
