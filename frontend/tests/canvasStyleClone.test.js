import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessCompetitorStyleCloneReadiness,
  buildCompetitorStyleCloneImageUrls,
  buildCompetitorStyleClonePrompt,
  extractCompetitorStylePrompt,
  extractProductIdentityPrompt,
} from '../src/utils/canvasStyleClone.js'

test('sends the current competitor image first and every product image after it', () => {
  assert.deepEqual(
    buildCompetitorStyleCloneImageUrls('competitor-3.png', [
      'product-front.png',
      'product-detail.png',
    ]),
    ['competitor-3.png', 'product-front.png', 'product-detail.png'],
  )
})

const analysis = {
  product_identity: {
    silhouette: '薄款长方形软垫',
    apparent_thickness: '明显薄于普通床垫',
    surface_pattern: '浅蓝波浪绗缝与橙色小印花',
    edge_binding: '窄白色包边',
    fold_structure: '可折叠',
    unknown_facts: '内部层数不可见',
  },
  subject_and_elements: {
    core_subject: '竞品红色床垫',
  },
  content_role: {
    display_task: '暖色卧室中的模特体验场景',
  },
  scene_and_environment: {
    room_type: '奶油色卧室',
    props: '落地窗、纱帘和原木床架',
  },
  people_and_actions: {
    count: '一人',
    pose: '年轻女性盘腿坐在床垫右侧',
  },
  mattress_surface: {
    fabric_type: '红色天鹅绒',
  },
  composition_and_camera: {
    product_angle: '正面四十五度',
    spatial_layout: '主体居中，左上角留白',
  },
  lighting_and_color: {
    lighting_logic: '左侧柔光',
    color_palette: '奶油白与墨绿色',
  },
  visual_style: {
    overall_tone: '法式复古',
  },
  typography_layout: [
    {
      position: '左上角',
      font_style: '高对比衬线体',
      text_content: '竞品买一送一',
    },
  ],
}

test('extracts our visible product identity without inferred internal layers', () => {
  const prompt = extractProductIdentityPrompt(
    { product_identity: analysis.product_identity },
    {
      silhouette: '外轮廓',
      apparent_thickness: '厚度体感',
      surface_pattern: '表面纹理',
      edge_binding: '包边与侧面',
      fold_structure: '折叠结构',
      unknown_facts: '不可见未知事实',
      layer_structure: '分层结构',
    },
  )

  assert.match(prompt, /薄款长方形软垫/)
  assert.match(prompt, /浅蓝波浪绗缝与橙色小印花/)
  assert.match(prompt, /内部层数不可见/)
  assert.doesNotMatch(prompt, /红色天鹅绒/)
})

test('extracts transferable competitor style without product appearance or copy', () => {
  const prompt = extractCompetitorStylePrompt(analysis, {
    product_angle: '产品角度',
    spatial_layout: '空间布局',
    lighting_logic: '光线逻辑',
    color_palette: '色彩组合',
    overall_tone: '整体调性',
    position: '位置',
    font_style: '字体风格',
    text_content: '文字内容',
  })

  assert.match(prompt, /正面四十五度/)
  assert.match(prompt, /奶油白与墨绿色/)
  assert.match(prompt, /高对比衬线体/)
  assert.match(prompt, /年轻女性盘腿坐在床垫右侧/)
  assert.match(prompt, /暖色卧室中的模特体验场景/)
  assert.doesNotMatch(prompt, /竞品红色床垫/)
  assert.doesNotMatch(prompt, /红色天鹅绒/)
  assert.doesNotMatch(prompt, /竞品买一送一/)
})

test('builds a same-category prompt that keeps our product as the only appearance source', () => {
  const stylePrompt = extractCompetitorStylePrompt(analysis)
  const prompt = buildCompetitorStyleClonePrompt({
    mode: 'layout',
    stylePrompt,
    productIdentityPrompt: extractProductIdentityPrompt({
      product_identity: analysis.product_identity,
    }),
    extra: '主标题使用“舒适好眠”',
  })

  assert.match(prompt, /参考图1是本张对应的竞品主图/)
  assert.match(prompt, /参考图2是我方产品白底图或产品参考图/)
  assert.match(prompt, /商品外观的唯一事实来源/)
  assert.match(prompt, /竞品商品外观是明确的负参考/)
  assert.match(prompt, /浅蓝波浪绗缝与橙色小印花/)
  assert.match(prompt, /同类目高保真复刻/)
  assert.match(prompt, /舒适好眠/)
})

test('adds strict cross-category boundaries for style transfer', () => {
  const stylePrompt = extractCompetitorStylePrompt(analysis, {}, 'style')
  const prompt = buildCompetitorStyleClonePrompt({
    mode: 'style',
    stylePrompt,
  })

  assert.match(prompt, /跨类目关系映射/)
  assert.match(prompt, /等价重映射/)
  assert.match(stylePrompt, /版式、构图与镜头/)
  assert.match(stylePrompt, /正面四十五度/)
  assert.match(stylePrompt, /奶油白与墨绿色/)
})

test('uses every product image as a shared source of truth for multi-angle generation', () => {
  const prompt = buildCompetitorStyleClonePrompt({
    mode: 'layout',
    stylePrompt: '版式、构图与镜头：主体居中',
    productCount: 3,
    referenceIndex: 2,
    referenceCount: 18,
    productFacts: '蓝白床垫，波浪绗缝，厚度结构以产品图为准',
    forbiddenContent: '不出现对方品牌和医疗功效',
  })

  assert.match(prompt, /参考图2至参考图4均为同一款我方产品/)
  assert.match(prompt, /第 2\/18 张参考图/)
  assert.match(prompt, /蓝白床垫，波浪绗缝/)
  assert.match(prompt, /不出现对方品牌和医疗功效/)
  assert.match(prompt, /输出前自检/)
})

test('blocks same-category generation until a concrete category is selected', () => {
  const incomplete = assessCompetitorStyleCloneReadiness({
    mode: 'layout',
    productCount: 2,
    referenceCount: 5,
    category: 'general',
  })
  const ready = assessCompetitorStyleCloneReadiness({
    mode: 'layout',
    productCount: 2,
    referenceCount: 5,
    category: 'mattress',
    productFacts: '床垫，蓝白配色',
  })

  assert.equal(incomplete.canRun, false)
  assert.equal(incomplete.checks.find((check) => check.id === 'category')?.blocking, true)
  assert.equal(ready.canRun, true)
})

test('does not require a product category for cross-category style transfer', () => {
  const readiness = assessCompetitorStyleCloneReadiness({
    mode: 'style',
    productCount: 1,
    referenceCount: 1,
    category: '',
  })

  assert.equal(readiness.canRun, true)
  assert.equal(
    readiness.checks.some((check) => check.id === 'category'),
    false,
  )
})
