import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_DIRECTOR_SKILL_CATEGORY,
  DIRECTOR_SKILL_CATALOG,
  DIRECTOR_SKILL_CATEGORIES,
  DIRECTOR_SKILL_SECTIONS,
  createDirectorSkillMarker,
  createDirectorSkillStructuredPart,
  filterDirectorSkills,
  getDirectorSkillById,
  getDirectorSkillByKey,
  getDirectorSkillSection,
  normalizeDirectorSkillCategory,
  searchDirectorSkills,
  serializeDirectorSkillChip,
} from '../src/features/canvas-v3/config/directorSkillCatalog.js'

const pickerUrl = new URL(
  '../src/features/canvas-v3/components/DirectorSkillPicker.vue',
  import.meta.url,
)
const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)

const skillContract = [
  [
    'pixar-animated-ad-creator-5de625e86d1143e6a4fd948ca25ec34b',
    '皮克斯动画广告',
    '从角色立绘、分镜草图到最终合成带广告歌的完整成片',
    '1.0.1',
  ],
  [
    'viral-video-replicator-3fdf06a4c10a4f96b98f779e197578c8',
    '爆款拉片复刻',
    'AI拆解爆款视频，一键复刻同款',
    '1.0.5',
  ],
  [
    'neo-chinese-aesthetic-tvc-beda8103d1a8414aa15aa0eb1db95a07',
    '新中式美学TVC',
    '新中式美学全案：从妆造、布景到广告成片，一站式惊艳视觉',
    '1.0.12',
  ],
  [
    'hujinquanwuxia-a015ad0682e441c5a70fd7cac0fc563a',
    '古典武侠电影全流程导演',
    '把模糊的武侠主题和灵感转化为视频生产方案',
    '1.0.1',
  ],
  [
    'gameplay-pv-builder-020b92eb952140af9a99e594358a115b',
    '游戏实机PV',
    '自制多类游戏PV，UI 像素锚定不形变，打造3A级游戏效果',
    '1.0.1',
  ],
  [
    'xingrannvpin-0bfcda928d704e8da3d20977029a31b8',
    '精品女频短剧一键成片',
    '告别粗糙流水线成片，纯精品短剧工业化全流程一键出片',
    '1.0.0',
  ],
  [
    'koreeda-film-aesthetic-ad7396f8e0a5497ab352f403f290c82f-e8810017',
    '是枝裕和电影美学',
    '是枝裕和电影美学。用日常写实的生活肌理，包裹克制又轻盈的情感',
    '1.0.11',
  ],
  [
    'wes-anderson-aesthetics-beda8103d1a8414aa15aa0eb1db95a07',
    '韦斯安德森电影美学',
    '深度还原韦氏标志性视听语言，适用15秒-5分钟电影短片或广告',
    '1.0.0',
  ],
  [
    'narrative-tvc-creator-020b92eb952140af9a99e594358a115b',
    '剧情TVC广告片',
    '创作剧情化商品、品牌、服务类 TVC 广告片',
    '1.0.1',
  ],
  [
    'eastwood-western-style-71a5fc5f6ae546d58b0b8d75abc87608',
    '伊斯特伍德西部片',
    '极静对峙瞬间爆发的枪战大片',
    '1.0.0',
  ],
  [
    'high-impact-car-tvc-9d8925c591a643bbad8ca8cfbb87922c',
    '一键爽感轰炸流汽车TVC',
    '上传图片或简单文字叙述即可一键打造超爽感轰炸流TVC广告',
    '1.0.1',
  ],
  [
    'cinematic-travel-vlog-maker-ea101076a01c4630a1e90cb41e56b4d1',
    '旅拍大师',
    '把旅行地点、人物参考和文案，做成电影感旅拍短片',
    '1.0.4',
  ],
  [
    'werewolf-vampire-short-drama-0bfcda928d704e8da3d20977029a31b8',
    '一键海外狼人吸血鬼短剧',
    '漫剧：一键生成海外爆款狼人吸血鬼漫剧，新手友好，风格高度一致',
    '1.0.1',
  ],
  [
    'taiwan-new-wave-aesthetic-ad7396f8e0a5497ab352f403f290c82f-00e974d5',
    '宝岛浪潮电影美学',
    '台湾新浪潮电影美学，细腻呈现其凝视、疏离、写实感的电影表达',
    '1.0.8',
  ],
  [
    'absurdist-comedy-maker-8db3e80ed29a49109eb6c801f13bb76c',
    '无厘头喜剧',
    '将任意主题转成无厘头创意短片，支持剧本改写和照片玩梗。',
    '1.0.3',
  ],
]

test('Director Skill catalogue preserves all 15 captured common Skills and metadata', () => {
  assert.equal(DEFAULT_DIRECTOR_SKILL_CATEGORY, 'common')
  assert.deepEqual(DIRECTOR_SKILL_CATEGORIES, [
    { id: 'home-commerce', label: '家居电商' },
    { id: 'common', label: '通用' },
  ])
  const commonSkills = getDirectorSkillSection('common')
  const homeSkills = getDirectorSkillSection('home-commerce')
  assert.deepEqual(
    commonSkills.map(
      ({ skillKey, name, description, version, resultType, modality, id, order }) => [
        skillKey,
        name,
        description,
        version,
        resultType,
        modality,
        id,
        order,
      ],
    ),
    skillContract.map(([skillKey, name, description, version], index) => [
      skillKey,
      name,
      description,
      version,
      3,
      'video',
      `libtv-user-generated/${skillKey}`,
      index + 1,
    ]),
  )
  assert.equal(DIRECTOR_SKILL_SECTIONS.common, commonSkills)
  assert.equal(DIRECTOR_SKILL_SECTIONS['home-commerce'], homeSkills)
  assert.equal(commonSkills.length, 15)
  assert.equal(homeSkills.length, 10)
  assert.equal(new Set(DIRECTOR_SKILL_CATALOG.map((skill) => skill.id)).size, 25)
  assert.ok(Object.isFrozen(DIRECTOR_SKILL_CATALOG))
  assert.ok(Object.isFrozen(DIRECTOR_SKILL_CATEGORIES))
  assert.ok(Object.isFrozen(DIRECTOR_SKILL_SECTIONS))
  for (const skill of commonSkills) {
    assert.ok(Object.isFrozen(skill))
    assert.match(skill.coverUrl, /^https:\/\//)
    assert.equal(skill.category, 'common')
    assert.equal(skill.categoryLabel, '通用')
  }
  for (const skill of homeSkills) {
    assert.ok(Object.isFrozen(skill))
    assert.equal(skill.category, 'home-commerce')
    assert.equal(skill.categoryLabel, '家居电商')
    assert.match(skill.prompt, /家居|淘系/)
    assert.match(skill.sourceUrl, /^https:\/\/github\.com\//)
  }
})

test('Director Skill lookup, search, marker and structured serialization helpers are stable', () => {
  const first = getDirectorSkillSection('common')[0]
  const commonSkills = getDirectorSkillSection('common')

  assert.equal(normalizeDirectorSkillCategory('common'), 'common')
  assert.equal(normalizeDirectorSkillCategory('missing'), 'common')
  assert.equal(getDirectorSkillSection(), commonSkills)
  assert.equal(getDirectorSkillSection('missing'), commonSkills)
  assert.equal(getDirectorSkillById(first.id), first)
  assert.equal(getDirectorSkillById({ id: first.id }), first)
  assert.equal(getDirectorSkillByKey(first.skillKey), first)
  assert.equal(getDirectorSkillByKey(first.shortSlug), first)
  assert.equal(getDirectorSkillByKey({ skillKey: first.skillKey }), first)
  assert.equal(getDirectorSkillByKey('missing'), null)
  assert.deepEqual(
    filterDirectorSkills({ modality: 'video', resultType: 3 }),
    DIRECTOR_SKILL_CATALOG.filter((skill) => skill.modality === 'video' && skill.resultType === 3),
  )
  assert.deepEqual(
    searchDirectorSkills('武侠').map((skill) => skill.name),
    ['古典武侠电影全流程导演'],
  )
  assert.deepEqual(
    searchDirectorSkills('viral-video-replicator').map((skill) => skill.name),
    ['爆款拉片复刻'],
  )

  assert.equal(
    createDirectorSkillMarker(first),
    `{{ skill:libtv-user-generated/${first.skillKey} }}`,
  )
  assert.deepEqual(createDirectorSkillStructuredPart(first), {
    type: 'skill',
    id: first.id,
    name: '皮克斯动画广告',
    modality: 'video',
    category: 'common',
  })
  assert.deepEqual(createDirectorSkillStructuredPart(first, { prompt: '电影广告', draft: true }), {
    type: 'skill',
    id: first.id,
    name: '皮克斯动画广告',
    prompt: '电影广告',
    draft: true,
    modality: 'video',
    category: 'common',
  })
  assert.deepEqual(serializeDirectorSkillChip(first.skillKey, { prompt: '电影广告' }), {
    marker: `{{ skill:libtv-user-generated/${first.skillKey} }}`,
    structuredPart: {
      type: 'skill',
      id: first.id,
      name: '皮克斯动画广告',
      prompt: '电影广告',
      modality: 'video',
      category: 'common',
    },
  })
  for (const unknown of [undefined, null, '', 'missing', {}]) {
    assert.equal(createDirectorSkillMarker(unknown), null)
    assert.equal(createDirectorSkillStructuredPart(unknown), null)
    assert.equal(serializeDirectorSkillChip(unknown), null)
  }
})

test('Skill trigger preserves the captured icon and opens the 450 by 400 portal dialog', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const triggerPath =
    'M8.4 1.33c.15 0 .27.12.27.27v.67c0 .14-.12.26-.27.26H3.55c-.2 0-.35.16-.35.36v7.4q.51-.29 1.13-.3h8.47V7.6c0-.15.12-.27.27-.27h.66c.15 0 .27.12.27.27V14c0 .34-.26.63-.6.66H4.21a2.3 2.3 0 0 1-2.19-2H2V2.9c0-.8.61-1.47 1.4-1.55h5M4.33 11.2a1.13 1.13 0 0 0 0 2.27h8.47V11.2zm7.4-9.91a.3.3 0 0 1 .54 0 4.7 4.7 0 0 0 2.44 2.44.3.3 0 0 1 0 .54 4.7 4.7 0 0 0-2.44 2.44.3.3 0 0 1-.54 0 4.7 4.7 0 0 0-2.44-2.44.3.3 0 0 1 0-.54 4.7 4.7 0 0 0 2.44-2.44'
  const rowPath =
    'M13.4 5.69q0-.25-.04-.49l-1.12 1.12-.33.32q-.15.14-.41.24-.37.12-.74 0-.26-.1-.42-.24l-.33-.32-.46-.47q-.19-.17-.32-.33-.16-.15-.24-.41a1.2 1.2 0 0 1 0-.74l.04-.12q.1-.17.2-.3l.32-.33 1.11-1.12-.48-.03a3.22 3.22 0 0 0-3.13 3.98l.1.38q.03.15.02.35a1 1 0 0 1-.13.47c-.1.19-.26.35-.4.49l-3.95 3.94a.77.77 0 1 0 1.1 1.1l3.94-3.95c.14-.14.3-.31.48-.4l.12-.06q.16-.07.35-.08.2 0 .35.03l.38.1a3.23 3.23 0 0 0 3.99-3.13m1.13 0a4.35 4.35 0 0 1-5.72 4.15l-.06-.01-.04.02-.18.18-3.94 3.94a1.9 1.9 0 0 1-2.7-2.7l3.94-3.93.2-.22v-.06l-.08-.34a4.36 4.36 0 0 1 6.02-5 .57.57 0 0 1 .17.92l-1.8 1.79-.28.32.03.04.26.26.46.47.27.25.04.03h.02l.03-.03.27-.25 1.79-1.8.05-.04a.57.57 0 0 1 .87.21q.38.83.38 1.8'

  assert.ok(source.includes(triggerPath))
  assert.ok(source.includes(rowPath))
  assert.match(source, /const MENU_WIDTH = 450/)
  assert.match(source, /const MENU_HEIGHT = 400/)
  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /id="cv3-director-skill-dialog"/)
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="false"/)
  assert.match(source, /aria-label="Skill"/)

  const trigger =
    source.match(/<button[\s\S]*?class="cv3-director-skill-trigger"[\s\S]*?<\/button>/)?.[0] || ''
  assert.ok(trigger, 'missing Skill trigger')
  assert.match(trigger, /ref="trigger"/)
  assert.match(trigger, /aria-haspopup="dialog"/)
  assert.match(trigger, /:aria-expanded="open"/)
  assert.match(trigger, /aria-controls="cv3-director-skill-dialog"/)

  const dialogRule = source.match(/\.cv3-director-skill-dialog\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(dialogRule, /position:\s*fixed/)
  assert.match(dialogRule, /z-index:\s*1100/)
  assert.match(dialogRule, /border-radius:\s*12px/)
})

test('Skill popup implements tabs, search, creation/import, hover details and duplicate selection', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const selectBody = source.match(/function selectSkill\(skill\) \{[\s\S]*?\n\}/)?.[0] || ''
  const createBody = source.match(/function requestCreate\(\) \{[\s\S]*?\n\}/)?.[0] || ''
  const importBody = source.match(/function requestImport\(\) \{[\s\S]*?\n\}/)?.[0] || ''

  for (const [id, label] of [
    ['general', '通用'],
    ['favorite', '收藏'],
    ['mine', '我的'],
  ]) {
    assert.match(source, new RegExp(`id: ['"]${id}['"], label: ['"]${label}['"]`))
  }
  assert.match(source, /v-model="searchQuery"[\s\S]{0,80}placeholder="搜索 Skill"/)
  assert.match(source, /activeTab\.value === ['"]favorite['"]/)
  assert.match(source, /activeTab\.value === ['"]mine['"]/)
  assert.match(source, /skillSearchText\(skill\)\.includes\(normalizedSearch\.value\)/)

  assert.ok(source.includes('创建新的Skill'))
  assert.ok(source.includes('通过与Agent对话创建'))
  assert.ok(source.includes('导入已有Skill'))
  assert.ok(source.includes('上传 .md 文件或文件夹'))
  assert.match(source, /class="cv3-director-skill-create-menu"[\s\S]{0,100}role="menu"/)
  assert.match(createBody, /emit\(['"]create-request['"]\)/)
  assert.match(importBody, /emit\(['"]import-request['"]\)/)
  assert.match(createBody, /closeAll\(\{ restoreFocus: false \}\)/)
  assert.match(importBody, /closeAll\(\{ restoreFocus: false \}\)/)

  assert.match(source, /v-for="skill in visibleSkills"[\s\S]{0,180}role="option"/)
  assert.match(source, /@keydown\.enter\.prevent="selectSkill\(skill\)"/)
  assert.match(source, /@keydown\.space\.prevent="selectSkill\(skill\)"/)
  assert.match(source, /class="cv3-director-skill-details"/)
  assert.match(source, /@click\.stop="openDetail\(skill\)"/)
  assert.match(source, /event\?\.type === ['"]focus['"] \? 0 : 120/)
  assert.match(source, /previewCloseTimer = window\.setTimeout\([\s\S]*?80\)/)
  assert.match(selectBody, /emit\(['"]select['"], skill\)/)
  assert.doesNotMatch(selectBody, /some\(|find\(|includes\(/)
})

test('Skill directory and detail surfaces preserve the captured modal hierarchy and actions', async () => {
  const source = await readFile(pickerUrl, 'utf8')

  assert.ok(source.includes('没找到合适的？'))
  assert.ok(source.includes('查看全部 Skill'))
  assert.match(source, /function openDirectory\(\)[\s\S]*?directoryOpen\.value = true/)
  assert.match(source, /v-if="open && directoryOpen"/)
  assert.match(source, /class="cv3-director-skill-directory"[\s\S]{0,120}role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /aria-labelledby="cv3-director-skill-directory-title"/)
  assert.match(source, /placeholder="搜索 Skill"[\s\S]{0,80}aria-label="搜索全部 Skill"/)
  assert.match(source, /v-for="category in categoryOptions"/)
  assert.match(source, /v-for="skill in directorySkills"/)
  assert.match(source, /@click="openDetail\(skill\)"/)
  assert.match(source, /@click="selectSkill\(skill\)"/)
  assert.match(source, /@click="toggleFavorite\(skill\)"/)

  const directoryRule = source.match(/\.cv3-director-skill-directory\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(directoryRule, /width:\s*min\(1120px, 92vw\)/)
  assert.match(directoryRule, /height:\s*min\(700px, 88vh\)/)
  const gridRule = source.match(/\.cv3-director-skill-grid\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(gridRule, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  const coverRule = source.match(/\.cv3-director-skill-card-cover\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(coverRule, /width:\s*185px/)
  assert.match(coverRule, /height:\s*104px/)

  assert.match(source, /v-if="open && detailSkill"/)
  assert.match(source, /class="cv3-director-skill-detail"[\s\S]{0,120}role="dialog"/)
  assert.match(source, /:aria-label="`\$\{skillName\(detailSkill\)\} 详情`"/)
  assert.ok(source.includes('介绍'))
  assert.ok(source.includes('＋ 添加 Skill'))
  assert.match(source, /@click="shareSkill\(detailSkill\)"/)
  assert.match(source, /@click="toggleFavorite\(detailSkill\)"/)
  assert.match(source, /@click="selectSkill\(detailSkill\)"/)
  const detailRule = source.match(/\.cv3-director-skill-detail\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(detailRule, /width:\s*min\(900px, calc\(100vw - 40px\)\)/)
  assert.match(detailRule, /max-height:\s*calc\(100vh - 120px\)/)
  assert.match(detailRule, /border-radius:\s*16px/)
})

test('Skill picker supports keyboard navigation, layered Escape dismissal and focus containment', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const moveBody = source.match(/function moveListFocus\(event\) \{[\s\S]*?\n\}/)?.[0] || ''
  const triggerKeys =
    source.match(/function handleTriggerKeydown\(event\) \{[\s\S]*?\n\}/)?.[0] || ''
  const escapeBody =
    source.match(/function handleDocumentKeydown\(event\) \{[\s\S]*?\n\}/)?.[0] || ''
  const trapBody = source.match(/function trapFocus\(event, container\) \{[\s\S]*?\n\}/)?.[0] || ''

  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.ok(moveBody.includes(`'${key}'`), `missing list navigation key: ${key}`)
  }
  assert.match(moveBody, /rows\[next\]\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(moveBody, /rows\[next\]\?\.scrollIntoView\(\{ block: ['"]nearest['"] \}\)/)
  assert.match(triggerKeys, /event\.key === ['"]ArrowDown['"] \|\| event\.key === ['"]ArrowUp['"]/)
  assert.match(
    triggerKeys,
    /requestOpen\(true, event\.key === ['"]ArrowUp['"] \? ['"]last['"] : ['"]search['"]\)/,
  )

  assert.match(escapeBody, /event\.key !== ['"]Escape['"] \|\| !props\.open/)
  assert.match(escapeBody, /if \(detailSkill\.value\) closeDetail\(\)/)
  assert.match(escapeBody, /else if \(directoryOpen\.value\) closeDirectory\(\)/)
  assert.match(escapeBody, /else if \(createMenuOpen\.value\)/)
  assert.match(escapeBody, /else closeMenu\(\{ restoreFocus: true \}\)/)
  assert.match(trapBody, /event\.key !== ['"]Tab['"]/)
  assert.match(trapBody, /event\.shiftKey && document\.activeElement === first/)
  assert.match(trapBody, /document\.activeElement === last/)
  assert.match(source, /@keydown="trapFocus\(\$event, directoryDialog\)"/)
  assert.match(source, /@keydown="trapFocus\(\$event, detailDialog\)"/)
})

test('Skill picker keeps outside-click, viewport and modal side effects symmetrical', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const listenerPairs = [
    [
      /document\.addEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
      /document\.removeEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
    ],
    [
      /document\.addEventListener\(['"]keydown['"], handleDocumentKeydown, true\)/,
      /document\.removeEventListener\(['"]keydown['"], handleDocumentKeydown, true\)/,
    ],
    [
      /window\.addEventListener\(['"]resize['"], updatePosition\)/,
      /window\.removeEventListener\(['"]resize['"], updatePosition\)/,
    ],
    [
      /window\.addEventListener\(['"]scroll['"], updatePosition, true\)/,
      /window\.removeEventListener\(['"]scroll['"], updatePosition, true\)/,
    ],
    [
      /window\.visualViewport\?\.addEventListener\(['"]resize['"], updatePosition\)/,
      /window\.visualViewport\?\.removeEventListener\(['"]resize['"], updatePosition\)/,
    ],
    [
      /window\.visualViewport\?\.addEventListener\(['"]scroll['"], updatePosition\)/,
      /window\.visualViewport\?\.removeEventListener\(['"]scroll['"], updatePosition\)/,
    ],
  ]
  for (const [add, remove] of listenerPairs) {
    assert.match(source, add)
    assert.match(source, remove)
  }
  assert.match(source, /const path = event\.composedPath\?\.\(\) \|\| \[\]/)
  assert.match(source, /\[trigger\.value, dialog\.value, createMenu\.value\]/)
  assert.match(source, /if \(!inside\) closeMenu\(\{ restoreFocus: false \}\)/)
  assert.match(source, /document\.body\.style\.overflow = ['"]hidden['"]/)
  assert.match(source, /document\.body\.style\.overflow = bodyOverflowBeforeModal/)
  assert.match(source, /trigger\.value\?\.focus\(\{ preventScroll: true \}\)/)
})

test('Skill popup and nested surfaces use anchored transitions with reduced-motion fallbacks', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'))

  assert.match(source, /\.cv3-director-skill-dialog\s*\{[\s\S]*?transform-origin:/)
  assert.match(
    source,
    /\.cv3-director-skill-popover-enter-from,[\s\S]*?opacity:\s*0[\s\S]*?translateY\(5px\) scale\(0\.98\)/,
  )
  assert.match(source, /\.cv3-director-skill-preview-enter-from,[\s\S]*?translateX\(6px\)/)
  assert.match(source, /\.cv3-director-skill-modal-enter-from[\s\S]*?opacity:\s*0/)
  assert.match(
    source,
    /\.cv3-director-skill-modal-enter-from \.cv3-director-skill-directory,[\s\S]*?translateY\(8px\) scale\(0\.95\)/,
  )
  assert.match(reducedMotion, /\.cv3-director-skill-trigger/)
  assert.match(reducedMotion, /\.cv3-director-skill-popover-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-skill-submenu-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-skill-preview-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-skill-modal-enter-active[\s\S]*?transition:\s*none/)
})

test('Director panel integrates Skill selection, local creation/import and removable Skill chips', async () => {
  const source = await readFile(panelUrl, 'utf8')

  assert.match(source, /import DirectorSkillPicker from ['"]\.\/DirectorSkillPicker\.vue['"]/)
  assert.match(
    source,
    /import \{ serializeDirectorSkillChip \} from ['"]\.\.\/config\/directorSkillCatalog\.js['"]/,
  )
  assert.match(source, /const skillMenuOpen = ref\(false\)/)
  assert.match(source, /const selectedSkills = ref\(\[\]\)/)
  assert.match(source, /const skillFileInput = ref\(null\)/)
  assert.match(source, /const hasInlinePopup = computed\([\s\S]*?skillMenuOpen\.value/)
  assert.match(source, /function closeInlinePopups[\s\S]*?skillMenuOpen\.value = false/)

  const pickerTag = source.match(/<DirectorSkillPicker\b[\s\S]*?\/>/)?.[0] || ''
  assert.ok(pickerTag, 'missing Director Skill picker integration')
  assert.match(pickerTag, /v-model:open="skillMenuOpen"/)
  assert.match(pickerTag, /@select="insertDirectorSkill"/)
  assert.match(pickerTag, /@create-request="startSkillCreation"/)
  assert.match(pickerTag, /@import-request="requestSkillImport"/)

  const insertBody = source.match(/function insertDirectorSkill\(skill[\s\S]*?\n\}/)?.[0] || ''
  assert.match(insertBody, /selectedSkills\.value\.push\(\{/)
  assert.match(insertBody, /instanceId:/)
  assert.match(insertBody, /composerInput\.value\?\.focus/)
  assert.doesNotMatch(insertBody, /some\(|find\(|includes\(/)
  assert.match(source, /function removeDirectorSkill\(/)
  assert.match(source, /event\.key !== ['"]Backspace['"] && event\.key !== ['"]Delete['"]/)
  assert.match(source, /aria-label="已添加 Skill"|aria-label="已添加模型和 Skill"/)
  assert.match(source, /v-for="\(skill, index\) in selectedSkills"/)
  assert.match(source, /@keydown="handleSkillChipKeydown\(\$event, index\)"/)

  assert.match(source, /accept="\.md,text\/markdown"/)
  assert.match(source, /@change="onSkillFileChange"/)
  assert.match(source, /你想做什么？/)
  assert.match(source, /从零聊出一个 Skill/)
  assert.match(source, /基于当前画布创建 Skill/)
  assert.match(source, /忽略/)
  assert.match(source, /提交/)
})

test('Director panel serializes Skill markers and structured parts in send state', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const submitBody = source.match(/function submitPrompt\(\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(submitBody, /const serializedSkills = selectedSkills\.value/)
  assert.match(submitBody, /\.map\(\(skill\) => \{[\s\S]*?serializeDirectorSkillChip\(skill\)/)
  assert.match(submitBody, /return \{ marker: `\{\{ skill:\$\{skill\.id\} \}\}`, structuredPart \}/)
  assert.match(submitBody, /\)\s*\.filter\(Boolean\)/)
  assert.match(submitBody, /serializedSkills\.map\(\(skill\) => skill\.marker\)/)
  assert.match(submitBody, /serializedSkills\.map\(\(skill\) => skill\.structuredPart\)/)
  assert.match(submitBody, /selectedSkills\.value = \[\]/)
  assert.match(submitBody, /selectedSkills\.value\.length/)
  assert.match(source, /:disabled="[\s\S]*?attachmentUploadActive \|\|[\s\S]*?\(!prompt\.trim\(\)/)
})
