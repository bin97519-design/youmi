import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCompetitorStyleClonePrompt,
  extractCompetitorStylePrompt,
} from '../src/utils/canvasStyleClone.js'

const analysis = {
  subject_and_elements: {
    core_subject: '竞品红色床垫',
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
  assert.doesNotMatch(prompt, /竞品红色床垫/)
  assert.doesNotMatch(prompt, /红色天鹅绒/)
  assert.doesNotMatch(prompt, /竞品买一送一/)
})

test('builds a same-category prompt that keeps our product as the only appearance source', () => {
  const stylePrompt = extractCompetitorStylePrompt(analysis)
  const prompt = buildCompetitorStyleClonePrompt({
    mode: 'layout',
    stylePrompt,
    extra: '主标题使用“舒适好眠”',
  })

  assert.match(prompt, /图1是我方产品白底图或产品参考图/)
  assert.match(prompt, /商品外观的唯一来源/)
  assert.match(prompt, /同类目版式复刻/)
  assert.match(prompt, /舒适好眠/)
})

test('adds strict cross-category boundaries for style transfer', () => {
  const prompt = buildCompetitorStyleClonePrompt({
    mode: 'style',
    stylePrompt: '整体视觉风格：极简科技感',
  })

  assert.match(prompt, /跨类目风格迁移/)
  assert.match(prompt, /不得复制竞品的商品结构、用途、配件或类目特征/)
})
