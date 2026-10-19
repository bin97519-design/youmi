import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_DIRECTOR_MODEL_TAB,
  DIRECTOR_MODEL_CATALOG,
  DIRECTOR_MODEL_SECTIONS,
  DIRECTOR_MODEL_TABS,
  createDirectorModelMarker,
  createDirectorModelStructuredPart,
  getDirectorModelByKey,
  getDirectorModelSection,
  normalizeDirectorModelTab,
  serializeDirectorModelChip,
} from '../src/features/canvas-v3/config/directorModelCatalog.js'

const pickerUrl = new URL(
  '../src/features/canvas-v3/components/DirectorModelPicker.vue',
  import.meta.url,
)
const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)

const modelContract = [
  ['lib-image-2.5-s', 'Lib Image 2.5 Pro', '精准生成与编辑，复杂指令稳定还原', 'image', false],
  ['lib-image-2.5-f', 'Lib Image 2.5 Fast', '极速高质量图像生成，兼顾效果与效率', 'image', false],
  ['lib-image-2', 'Lib Image', '最新图片模型、长文本能力突出', 'image', false],
  ['nebula-ultra', 'General image Pro', '最强图片编辑模型，一致性好', 'image', false],
  ['nebula-2-flash', 'General image V2', '支持联网搜索、文字准确、速度更快', 'image', false],
  [
    'doubao-seedream-5-0-pro',
    'Seedream 5.0 Pro',
    '精准交互式编辑，支持原生多语言排版',
    'image',
    false,
  ],
  ['mj-v8.2', 'Style Image V8.2', '电影感全面升级，精准还原光影、人物与真实材质', 'image', false],
  ['mj-v8.1', 'Style Image V8.1', '生图更连贯、细节更丰富、美学水准大幅提升', 'image', false],
  ['mj-v7', 'Style Image V7', '最佳美学，电影质感，创意能力强', 'image', false],
  ['star-video2.5', 'Seedance 2.5', '最强视频模型，全能参考，30s音画同步', 'video', true],
  ['star-video2', 'Seedance 2.0 VIP', '最强视频模型，会员专属通道,15s音画同步', 'video', true],
  ['wanx3.0', 'Wan 3.0', '全模态参考，支持文档与网页输入，超写实高一致性生成', 'video', false],
  ['wanx3.0-prime', 'Wan 3.0 Prime', '超快速生成，全模态参考，超写实高一致性', 'video', false],
  ['MiniMax-Hailuo-H3', 'Minimax H3', '全模态输入，多参数控制，多场景商用级生成', 'video', true],
  [
    'star-video2-fast',
    'Seedance 2.0 Fast VIP',
    '最强视频模型快速版，会员专属通道，15s音画同步',
    'video',
    true,
  ],
  [
    'star-video2-mini',
    'Seedance 2.0 Mini',
    '最强视频模型mini版，高性价比生成，15s音画同步',
    'video',
    true,
  ],
  ['kling-v3-omni', 'Kling O3', '视频编辑模型、参考一致性、音画同出、多镜头', 'video', true],
  ['kling-video-o3', 'Kling 3.0', '视频生成模型，高质感、支持多镜头', 'video', true],
]

test('Director model catalogue preserves all 18 captured models, copy, tabs, and section order', () => {
  assert.deepEqual(DIRECTOR_MODEL_TABS, [
    { id: 'image', label: '图片' },
    { id: 'video', label: '视频' },
  ])
  assert.equal(DEFAULT_DIRECTOR_MODEL_TAB, 'image')
  assert.deepEqual(
    DIRECTOR_MODEL_CATALOG.map(({ id, key, label, description, modality, vip = false }) => [
      id,
      label,
      description,
      modality,
      vip,
      key,
    ]),
    modelContract.map(([id, label, description, modality, vip]) => [
      id,
      label,
      description,
      modality,
      vip,
      id,
    ]),
  )
  assert.deepEqual(
    DIRECTOR_MODEL_SECTIONS.image.map((model) => model.id),
    modelContract.filter((model) => model[3] === 'image').map((model) => model[0]),
  )
  assert.deepEqual(
    DIRECTOR_MODEL_SECTIONS.video.map((model) => model.id),
    modelContract.filter((model) => model[3] === 'video').map((model) => model[0]),
  )

  assert.ok(Object.isFrozen(DIRECTOR_MODEL_TABS))
  assert.ok(Object.isFrozen(DIRECTOR_MODEL_CATALOG))
  assert.ok(Object.isFrozen(DIRECTOR_MODEL_SECTIONS))
  assert.ok(Object.isFrozen(DIRECTOR_MODEL_SECTIONS.image))
  assert.ok(Object.isFrozen(DIRECTOR_MODEL_SECTIONS.video))
  assert.equal(new Set(DIRECTOR_MODEL_CATALOG.map((model) => model.id)).size, 18)
  for (const model of DIRECTOR_MODEL_CATALOG) {
    assert.ok(Object.isFrozen(model))
    assert.match(model.logoUrl, /^https:\/\//)
  }
})

test('Director model lookup, tab normalization, markers and structured serialization are stable', () => {
  const first = DIRECTOR_MODEL_CATALOG[0]

  assert.equal(normalizeDirectorModelTab('video'), 'video')
  assert.equal(normalizeDirectorModelTab('unknown'), 'image')
  assert.equal(normalizeDirectorModelTab(null), 'image')
  assert.equal(getDirectorModelSection(), DIRECTOR_MODEL_SECTIONS.image)
  assert.equal(getDirectorModelSection('video'), DIRECTOR_MODEL_SECTIONS.video)
  assert.equal(getDirectorModelSection('missing'), DIRECTOR_MODEL_SECTIONS.image)
  assert.equal(getDirectorModelByKey(first.key), first)
  assert.equal(getDirectorModelByKey({ key: first.key }), first)
  assert.equal(getDirectorModelByKey({ id: first.id }), first)
  assert.equal(getDirectorModelByKey('missing'), null)

  assert.equal(createDirectorModelMarker(first), '{{ model:lib-image-2.5-s }}')
  assert.deepEqual(createDirectorModelStructuredPart(first.key), {
    type: 'model',
    id: 'lib-image-2.5-s',
    name: 'Lib Image 2.5 Pro',
    modality: 'image',
  })
  assert.deepEqual(serializeDirectorModelChip(first.key), {
    marker: '{{ model:lib-image-2.5-s }}',
    structuredPart: {
      type: 'model',
      id: 'lib-image-2.5-s',
      name: 'Lib Image 2.5 Pro',
      modality: 'image',
    },
  })
  for (const unknown of [undefined, null, '', 'missing', {}]) {
    assert.equal(createDirectorModelMarker(unknown), null)
    assert.equal(createDirectorModelStructuredPart(unknown), null)
    assert.equal(serializeDirectorModelChip(unknown), null)
  }
})

test('Director model picker matches the captured cube trigger and 370 by 384 portal dialog', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const cubePath =
    'M7.2.87c.5-.3 1.1-.3 1.6 0l5.11 3.07c.47.28.76.79.76 1.33v5.58c0 .54-.29 1.05-.76 1.33L8.8 15.25l-.1.05c-.47.24-1.04.22-1.5-.05l-5.1-3.07a1.6 1.6 0 0 1-.76-1.33V5.27c0-.51.26-.99.67-1.28l.09-.05zm-4.67 9.98q0 .19.18.3l4.7 2.82v-5.2L2.53 5.95zm6.08-2.1v5.2l4.69-2.8q.16-.11.17-.3v-4.9zM8.18 1.9a.4.4 0 0 0-.36 0L2.96 4.81 8 7.72l5.04-2.9z'

  assert.equal(source.split(cubePath).length - 1, 2)
  assert.match(source, /const MENU_WIDTH = 370/)
  assert.match(source, /const MENU_MAX_HEIGHT = 384/)
  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /id="cv3-director-model-dialog"/)
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="false"/)
  assert.match(source, /aria-label="选择模型"/)
  assert.match(source, /<h2>选择模型<\/h2>/)
  assert.match(source, /max-height:\s*384px/)

  const trigger =
    source.match(/<button[\s\S]*?class="cv3-director-model-trigger"[\s\S]*?<\/button>/)?.[0] || ''
  assert.ok(trigger, 'missing model picker trigger')
  assert.match(trigger, /ref="trigger"/)
  assert.match(trigger, /aria-haspopup="dialog"/)
  assert.match(trigger, /:aria-expanded="open"/)
  assert.match(trigger, /aria-controls="cv3-director-model-dialog"/)
  assert.match(trigger, /:data-selected-count="Math\.max\(0, selectedCount\)"/)
})

test('Director model picker renders both tabbed sections, model rows, plus controls and VIP badges', async () => {
  const source = await readFile(pickerUrl, 'utf8')

  assert.match(source, /DIRECTOR_MODEL_TABS\.filter/)
  assert.match(source, /\['image', 'video'\]\.includes\(tab\.id\)/)
  assert.match(
    source,
    /tabs\.value\.map\(\(tab\) => \(\{[\s\S]*?DIRECTOR_MODEL_SECTIONS\?\.\[tab\.id\]/,
  )
  assert.match(source, /class="cv3-director-model-tabs" role="radiogroup" aria-label="模型类型"/)
  assert.match(source, /v-for="tab in tabs"[\s\S]*?role="radio"/)
  assert.match(source, /:aria-checked="activeTab === tab\.id"/)
  assert.match(source, /@click="scrollToSection\(tab\.id\)"/)
  assert.match(source, /class="cv3-director-model-list"[\s\S]*?role="listbox"/)
  assert.match(source, /v-for="section in sections"[\s\S]*?role="group"/)
  assert.match(source, /v-for="model in section\.models"[\s\S]*?role="option"/)
  assert.match(source, /:data-model-id="model\.id"/)
  assert.match(source, /:aria-label="`添加模型 \$\{model\.label\}`"/)
  assert.match(source, /<i v-if="model\.vip">VIP<\/i>/)
  assert.match(source, /class="cv3-director-model-add" aria-hidden="true">\+<\/span>/)
})

test('tab changes smoothly scroll to their section and honor reduced motion', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const scrollBody = source.match(/function scrollToSection\(tabId\) \{[\s\S]*?\n\}/)?.[0] || ''
  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'))

  assert.match(scrollBody, /activeTab\.value = tabId/)
  assert.match(scrollBody, /matchMedia\?\.\(['"]\(prefers-reduced-motion: reduce\)['"]\)\.matches/)
  assert.match(scrollBody, /list\.scrollTo\(\{/)
  assert.match(scrollBody, /top:\s*Math\.max\(0, section\.offsetTop\)/)
  assert.match(scrollBody, /behavior:\s*reduceMotion \? ['"]auto['"] : ['"]smooth['"]/)
  assert.match(source, /\.cv3-director-model-list\s*\{[\s\S]*?scroll-behavior:\s*smooth/)
  assert.match(reducedMotion, /\.cv3-director-model-list\s*\{[\s\S]*?scroll-behavior:\s*auto/)
  assert.match(reducedMotion, /\.cv3-director-model-popover-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-model-popover-leave-active[\s\S]*?transition:\s*none/)
})

test('model picker delegates duplicate selection and implements complete keyboard and dismissal behavior', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const selectBody = source.match(/function selectModel\(model\) \{[\s\S]*?\n\}/)?.[0] || ''
  const dialogKeys = source.match(/function handleDialogKeydown\(event\) \{[\s\S]*?\n\}/)?.[0] || ''
  const triggerKeys =
    source.match(/function handleTriggerKeydown\(event\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(selectBody, /emit\(['"]select['"], model\)/)
  assert.match(selectBody, /closeMenu\(\{ restoreFocus: false \}\)/)
  assert.doesNotMatch(selectBody, /selectedCount|some\(|includes\(|find\(/)

  for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
    assert.ok(dialogKeys.includes(`'${key}'`), `missing dialog key: ${key}`)
  }
  assert.match(dialogKeys, /rows\[current\]\.click\(\)/)
  assert.match(dialogKeys, /rows\[next\]\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(dialogKeys, /rows\[next\]\?\.scrollIntoView\(\{ block: ['"]nearest['"] \}\)/)
  assert.match(
    triggerKeys,
    /requestOpen\(true, event\.key === ['"]ArrowUp['"] \? ['"]last['"] : ['"]first['"]\)/,
  )
  assert.match(triggerKeys, /closeMenu\(\{ restoreFocus: true \}\)/)

  assert.match(source, /const path = event\.composedPath\?\.\(\) \|\| \[\]/)
  assert.match(source, /\[trigger\.value, dialog\.value\]/)
  assert.match(source, /if \(!inside\) closeMenu\(\{ restoreFocus: false \}\)/)
  assert.match(source, /focusModel\(focusOnOpen\)/)
  assert.match(source, /trigger\.value\?\.focus\(\{ preventScroll: true \}\)/)
})

test('model picker keeps all outside-click and viewport listeners symmetrical', async () => {
  const source = await readFile(pickerUrl, 'utf8')

  const listenerPairs = [
    [
      /document\.addEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
      /document\.removeEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
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
  assert.match(source, /watch\([\s\S]*?\(\) => props\.open/)
  assert.match(source, /if \(open\)[\s\S]*?updatePosition\(\)[\s\S]*?focusModel\(focusOnOpen\)/)
})

test('Director panel appends duplicate model chips and supports focus, drag reorder and deletion', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const insertBody = source.match(/function insertDirectorModel\(model\) \{[\s\S]*?\n\}/)?.[0] || ''
  const removeBody = source.match(/function removeDirectorModel\(index\) \{[\s\S]*?\n\}/)?.[0] || ''
  const dragBody =
    source.match(/function dropModelChip\(event, targetIndex\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(source, /import DirectorModelPicker from ['"]\.\/DirectorModelPicker\.vue['"]/)
  assert.match(source, /const selectedModels = ref\(\[\]\)/)
  assert.match(insertBody, /selectedModels\.value\.push\(\{/)
  assert.match(insertBody, /instanceId:/)
  assert.doesNotMatch(insertBody, /some\(|find\(|includes\(/)
  assert.match(insertBody, /composerInput\.value\?\.focus/)
  assert.match(removeBody, /selectedModels\.value\.splice\(index, 1\)/)
  assert.match(removeBody, /activeModelChipId\.value = ['"]/)
  assert.match(source, /event\.key !== ['"]Backspace['"] && event\.key !== ['"]Delete['"]/)
  assert.match(source, /@keydown\.backspace\.exact="handleComposerBackspace"/)
  assert.match(source, /if \(prompt\.value \|\| !selectedModels\.value\.length\)/)
  assert.match(source, /if \(!prompt\.value && selectedSkills\.value\.length\)/)

  assert.match(
    source,
    /class="cv3-director-model-chips"[\s\S]{0,80}aria-label="已添加模型(?:和 Skill)?"/,
  )
  assert.match(source, /v-for="\(model, index\) in selectedModels"/)
  assert.match(source, /:key="model\.instanceId"/)
  assert.match(source, /draggable="true"/)
  assert.match(source, /@dragstart="beginModelChipDrag\(\$event, index\)"/)
  assert.match(source, /@drop="dropModelChip\(\$event, index\)"/)
  assert.match(source, /@keydown="handleModelChipKeydown\(\$event, index\)"/)
  assert.match(dragBody, /const reordered = \[\.\.\.selectedModels\.value\]/)
  assert.match(dragBody, /reordered\.splice\(sourceIndex, 1\)/)
  assert.match(dragBody, /reordered\.splice\(targetIndex, 0, moved\)/)
  assert.match(dragBody, /selectedModels\.value = reordered/)
})

test('Director panel serializes model markers and structured parts while guarding popups and send state', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const submitBody = source.match(/function submitPrompt\(\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(
    source,
    /import \{ serializeDirectorModelChip \} from ['"]\.\.\/config\/directorModelCatalog\.js['"]/,
  )
  assert.match(source, /const modelMenuOpen = ref\(false\)/)
  assert.match(source, /const hasInlinePopup = computed\([\s\S]*?modelMenuOpen\.value/)
  assert.match(source, /function closeInlinePopups[\s\S]*?modelMenuOpen\.value = false/)
  assert.match(
    source,
    /:data-director-popup-open="hasInlinePopup \|\| scriptSetupOpen \? 'true' : undefined"/,
  )
  assert.match(source, /<DirectorModelPicker[\s\S]*?v-model:open="modelMenuOpen"/)
  assert.match(source, /:selected-count="selectedModels\.length"/)
  assert.match(source, /@select="insertDirectorModel"/)

  assert.match(
    submitBody,
    /if \([\s\S]*?!content[\s\S]*?!selectedModels\.value\.length[\s\S]*?!selectedSkills\.value\.length[\s\S]*?!readyAttachments\.value\.length[\s\S]*?\)/,
  )
  assert.match(
    submitBody,
    /selectedModels\.value\.map\(serializeDirectorModelChip\)\.filter\(Boolean\)/,
  )
  assert.match(
    submitBody,
    /raw:\s*\[[\s\S]*?serializedModels\.map\(\(model\) => model\.marker\)[\s\S]*?serializedSkills\.map\(\(skill\) => skill\.marker\)[\s\S]*?content/,
  )
  assert.match(
    submitBody,
    /parts:\s*\[[\s\S]*?serializedModels\.map\(\(model\) => model\.structuredPart\)[\s\S]*?serializedSkills\.map\(\(skill\) => skill\.structuredPart\)/,
  )
  assert.match(submitBody, /selectedModels\.value = \[\]/)
  assert.match(source, /:disabled="[\s\S]*?attachmentUploadActive \|\|[\s\S]*?\(!prompt\.trim\(\)/)
})
