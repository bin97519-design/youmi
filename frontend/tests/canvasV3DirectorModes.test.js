import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIRECTOR_ADAPTATION_DIRECTIONS,
  DIRECTOR_ADAPTATION_EPISODES,
  DIRECTOR_AUDIENCES,
  DIRECTOR_CHARACTER_SETTINGS,
  DIRECTOR_ERAS,
  DIRECTOR_GENRES,
  DIRECTOR_HIGHLIGHTS,
  DIRECTOR_HOT_PRESETS,
  DIRECTOR_MODE_MENU,
  DIRECTOR_MODES,
  DIRECTOR_ROLES,
  DIRECTOR_SCRIPT_EPISODES,
  DIRECTOR_SCRIPT_FIELDS,
  DIRECTOR_SCRIPT_STRUCTURES,
  DIRECTOR_VISUAL_STYLES,
  getDirectorMode,
} from '../src/features/canvas-v3/config/directorModes.js'

const labels = (items) => items.map((item) => item.label)

test('Director creation modes preserve the captured order, hierarchy and composer contract', () => {
  assert.deepEqual(
    DIRECTOR_MODE_MENU.map(({ id, type, label, order }) => ({ id, type, label, order })),
    [
      { id: 'omni', type: 'mode', label: '全能创作', order: 0 },
      { id: 'script', type: 'group', label: '剧本创编', order: 1 },
      { id: 'directing', type: 'mode', label: '导演执导', order: 2 },
    ],
  )
  assert.deepEqual(DIRECTOR_MODE_MENU[1].children, ['script_original', 'script_adaptation'])

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(DIRECTOR_MODES).map(([id, mode]) => [
        id,
        {
          label: mode.label,
          triggerLabel: mode.triggerLabel,
          placeholder: mode.placeholder,
          menuLevel: mode.menuLevel,
          menuGroup: mode.menuGroup,
          menuPath: mode.menuPath,
          controls: mode.controls,
          auxiliaryControls: mode.auxiliaryControls,
        },
      ]),
    ),
    {
      omni: {
        label: '全能创作',
        triggerLabel: '全能创作',
        placeholder: '开始你的创作，或者 @ 引用工作流/节点/资源',
        menuLevel: 0,
        menuGroup: null,
        menuPath: ['全能创作'],
        controls: ['attachment', 'mode', 'model', 'skill', 'manual', 'send'],
        auxiliaryControls: [],
      },
      script_original: {
        label: '原创剧本',
        triggerLabel: '剧本创编 · 原创',
        placeholder: '输入你的剧本想法...',
        menuLevel: 1,
        menuGroup: 'script',
        menuPath: ['剧本创编', '原创剧本'],
        controls: ['attachment', 'mode', 'scriptModel', 'manual', 'send'],
        auxiliaryControls: ['scriptPreset'],
      },
      script_adaptation: {
        label: '故事改编',
        triggerLabel: '剧本创编 · 改编',
        placeholder: '输入你的改编想法...',
        menuLevel: 1,
        menuGroup: 'script',
        menuPath: ['剧本创编', '故事改编'],
        controls: ['attachment', 'mode', 'scriptModel', 'manual', 'send'],
        auxiliaryControls: ['scriptUpload', 'adaptationSettings'],
      },
      directing: {
        label: '导演执导',
        triggerLabel: '导演执导',
        placeholder: '选择视频节点或直接输入你的想法...',
        menuLevel: 0,
        menuGroup: null,
        menuPath: ['导演执导'],
        controls: ['attachment', 'mode', 'scriptModel', 'manual', 'send'],
        auxiliaryControls: ['directorRole'],
      },
    },
  )
})

test('Director mode identifiers and menu leaves are unique and internally consistent', () => {
  const modes = Object.values(DIRECTOR_MODES)
  const modeIds = modes.map((mode) => mode.id)
  const menuLeafIds = DIRECTOR_MODE_MENU.flatMap((item) =>
    item.type === 'group' ? item.children : [item.modeId],
  )

  assert.equal(new Set(modeIds).size, modeIds.length)
  assert.equal(new Set(menuLeafIds).size, menuLeafIds.length)
  assert.deepEqual([...menuLeafIds].sort(), [...modeIds].sort())

  for (const [key, mode] of Object.entries(DIRECTOR_MODES)) {
    assert.equal(mode.id, key)
    assert.equal(mode.menuPath.at(-1), mode.label)
    assert.equal(mode.menuPath.length, mode.menuLevel + 1)
    assert.equal(new Set(mode.controls).size, mode.controls.length)
    assert.equal(new Set(mode.auxiliaryControls).size, mode.auxiliaryControls.length)
    assert.equal(mode.menuLevel === 1, Boolean(mode.menuGroup))
    assert.ok(Object.isFrozen(mode))
    assert.ok(Object.isFrozen(mode.menuPath))
    assert.ok(Object.isFrozen(mode.controls))
    assert.ok(Object.isFrozen(mode.auxiliaryControls))
  }
})

test('getDirectorMode returns known modes and safely falls back to omni creation', () => {
  for (const [id, mode] of Object.entries(DIRECTOR_MODES)) {
    assert.equal(getDirectorMode(id), mode)
  }
  for (const id of [undefined, null, '', 'script', 'unknown', 0, {}]) {
    assert.equal(getDirectorMode(id), DIRECTOR_MODES.omni)
  }
})

test('script creation keeps the captured preset catalogue and option lists', () => {
  assert.deepEqual(labels(DIRECTOR_HOT_PRESETS), [
    '玄幻修仙逆袭',
    '现实职场成长',
    '末世生存基建',
    '非遗国潮视觉',
    '古代女频甜宠',
    '规则怪谈悬疑',
    '重生复仇爽剧',
    '仙门团宠日常',
  ])
  assert.deepEqual(
    DIRECTOR_HOT_PRESETS.map((preset) => preset.rank),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.deepEqual(labels(DIRECTOR_GENRES), [
    '玄幻修仙',
    '都市现实',
    '古装言情',
    '悬疑推理',
    '惊悚怪谈',
    '犯罪谍战',
    '家庭伦理',
    '末世科幻',
    '历史传奇',
    '喜剧',
    '主旋律',
    '体育竞技',
    '职场行业',
    '文旅非遗',
    '其他',
  ])
  assert.deepEqual(labels(DIRECTOR_AUDIENCES), ['男频', '女频', '泛人群', '出海', '银发', '其他'])
  assert.deepEqual(labels(DIRECTOR_CHARACTER_SETTINGS), [
    '小人物',
    '打工人',
    '女强',
    '不完美成长型',
    '专业型',
    '天才',
    '双强',
    '腹黑',
    '黑莲花',
    '忠犬',
    '病娇',
    '福宝',
    '大小姐',
    '少爷',
    '王爷',
    '王妃',
    '皇帝',
    '将军',
    '修士',
    '龙王',
    '医者',
    '律师',
    '警探',
    '教师',
    '模特',
    '其他',
  ])
  assert.deepEqual(labels(DIRECTOR_ERAS), [
    '古代',
    '现代',
    '架空',
    '末世',
    '民国',
    '年代（80–90s）',
    '近未来',
    '平行世界',
    '多时空穿越',
    '其他',
  ])
  assert.deepEqual(labels(DIRECTOR_HIGHLIGHTS), [
    '器物金手指',
    '收集升级',
    '基建生存',
    '专业碾压',
    '马甲大佬',
    '先婚后爱',
    '重生复仇',
    '团宠被爱',
    'IP二创',
    '双向救赎',
    '穿越异世',
    '扮猪吃虎',
    '亲历行业细节',
    '真实成长',
    '规则禁忌',
    '单元解谜',
    '文化元素新用',
    '风格混搭',
    '视觉奇观',
    '隐藏身份',
    '真假千金',
    '契约婚姻',
    '萌宝助攻',
    '赘婿逆袭',
    '系统傍身',
    '欢喜冤家',
    '普通人的处境',
    '群像时代切片',
    '姐弟恋',
    '穿书',
    '时间循环',
  ])
  assert.deepEqual(labels(DIRECTOR_VISUAL_STYLES), [
    '自定义',
    '冷峻宫廷权谋',
    '国产冷调悬疑',
    '都市写实',
    '柔光古装言情',
    '日系青春胶片',
    '写实江湖武侠',
    '高调棚拍广告',
    '经典好莱坞',
    '赛博科幻',
    '冷感文艺',
    '暗黑恐怖',
    '3D 奇幻动画',
    '工业质感',
    '怀旧港片',
    '唯美国风 3D',
    '三渲二动漫',
    '超写实 3D',
    '暗调奇幻 CG',
    '东方玄幻 3D',
    '经典国产美术',
    '国风壁画',
  ])
  assert.deepEqual(labels(DIRECTOR_SCRIPT_STRUCTURES), [
    '三幕式',
    '五幕式',
    '英雄旅程',
    '平行结构',
    '交叉结构',
    '非线性结构',
    '环形结构',
    '单元结构',
  ])
})

test('script fields, adaptation settings and director roles expose complete static controls', () => {
  assert.deepEqual(
    DIRECTOR_SCRIPT_FIELDS.map(({ id, label, maxSelect, options }) => ({
      id,
      label,
      maxSelect,
      optionIds: options.map((option) => option.id),
    })),
    [
      {
        id: 'audience',
        label: '目标受众',
        maxSelect: 2,
        optionIds: DIRECTOR_AUDIENCES.map((item) => item.id),
      },
      {
        id: 'characters',
        label: '角色设定',
        maxSelect: 5,
        optionIds: DIRECTOR_CHARACTER_SETTINGS.map((item) => item.id),
      },
      {
        id: 'era',
        label: '时代背景',
        maxSelect: 2,
        optionIds: DIRECTOR_ERAS.map((item) => item.id),
      },
      {
        id: 'highlights',
        label: '核心看点',
        maxSelect: 3,
        optionIds: DIRECTOR_HIGHLIGHTS.map((item) => item.id),
      },
      {
        id: 'visualStyle',
        label: '画风',
        maxSelect: 1,
        optionIds: DIRECTOR_VISUAL_STYLES.map((item) => item.id),
      },
      {
        id: 'structure',
        label: '剧本结构',
        maxSelect: 1,
        optionIds: DIRECTOR_SCRIPT_STRUCTURES.map((item) => item.id),
      },
    ],
  )
  assert.deepEqual(DIRECTOR_SCRIPT_EPISODES, {
    min: 1,
    max: 100,
    step: 1,
    default: 20,
  })
  assert.deepEqual(labels(DIRECTOR_ADAPTATION_DIRECTIONS), [
    '剧本浓缩',
    '故事扩写',
    '强化冲突',
    '强化钩子',
  ])
  assert.deepEqual(DIRECTOR_ADAPTATION_EPISODES, {
    min: 2,
    max: 100,
    step: 1,
    default: 100,
  })
  assert.deepEqual(labels(DIRECTOR_ROLES), [
    '自动',
    'TVC广告',
    '悬疑短剧',
    '口播带货',
    '动画剧情',
    '纪录片',
    '卡点MV',
  ])
  assert.deepEqual(
    DIRECTOR_ROLES.filter((role) => role.isDefault).map((role) => role.id),
    ['auto'],
  )
})

test('all Director static option collections keep unique stable identifiers', () => {
  const lists = [
    DIRECTOR_HOT_PRESETS,
    DIRECTOR_GENRES,
    DIRECTOR_AUDIENCES,
    DIRECTOR_CHARACTER_SETTINGS,
    DIRECTOR_ERAS,
    DIRECTOR_HIGHLIGHTS,
    DIRECTOR_VISUAL_STYLES,
    DIRECTOR_SCRIPT_STRUCTURES,
    DIRECTOR_SCRIPT_FIELDS,
    DIRECTOR_ADAPTATION_DIRECTIONS,
    DIRECTOR_ROLES,
  ]

  for (const items of lists) {
    assert.equal(new Set(items.map((item) => item.id)).size, items.length)
    assert.ok(Object.isFrozen(items))
    for (const item of items) assert.ok(Object.isFrozen(item))
  }
})
