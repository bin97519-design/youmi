import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'
import {
  characterAssetUrl,
  characterStudioAssets,
  characterStudioIsOfficial,
} from '../src/features/canvas-v3/config/characterStudioAssets.js'
import {
  CHARACTER_STUDIO_TEMPLATES,
  characterStudioAssetPreview,
} from '../src/features/canvas-v3/config/characterStudioCatalog.js'

const fixture = (overrides = {}) => ({
  id: 'personal-1',
  name: '家居场景角色',
  imageUrl: 'https://assets.example.com/full-body.png',
  config: {},
  ...overrides,
})
const image = (type, name = type) => ({
  type,
  name,
  url: `https://assets.example.com/${type}.png`,
  nodeId: `${type}-node`,
})

test('asset slots preserve real full-body source while using a bundled display-only preview', () => {
  const character = fixture({ official: true })
  const result = characterStudioAssets(character, '/canvas-v3/characters/003.webp')
  assert.deepEqual(
    result.slots.map((slot) => slot.type),
    ['full-body', 'half-body', 'emotion-grid', 'character-sheet'],
  )
  assert.equal(result.slots[0].asset.url, character.imageUrl)
  assert.equal(result.slots[0].asset.previewUrl, '/canvas-v3/characters/003.webp')
  assert.deepEqual(
    result.slots.slice(1).map((slot) => slot.asset),
    [null, null, null],
  )
  assert.deepEqual(result.extras, [])
})

test('typed real assets fill their own slots and legacy combined sheets do not invent separate views', () => {
  const result = characterStudioAssets(
    fixture({
      config: {
        assets: [
          image('half-body'),
          image('emotion-grid'),
          { name: '角色设定图', url: 'https://assets.example.com/legacy-sheet.png' },
        ],
      },
    }),
  )
  assert.equal(result.slots[1].asset.url, image('half-body').url)
  assert.equal(result.slots[2].asset.url, image('emotion-grid').url)
  assert.equal(result.slots[3].asset.url, 'https://assets.example.com/legacy-sheet.png')
  const legacy = characterStudioAssets(
    fixture({
      config: { assets: [{ name: '角色设定图', url: 'https://assets.example.com/sheet.png' }] },
    }),
  )
  assert.equal(legacy.slots[1].asset, null)
  assert.equal(legacy.slots[2].asset, null)
  assert.ok(legacy.slots[3].asset)
})

test('current display names share the format labels while legacy names still classify saved assets', () => {
  const labels = ['全身图', '上身图', '表情九宫格', '角色设定图']
  for (const names of [
    ['半身图', '情绪九宫格', '角色设定图'],
    labels.slice(1),
    ['上身图', '表情九宫格', '全身三视图＋上身六视图'],
    ['上身图', '表情九宫格', '全身三视图+上身六视图'],
  ]) {
    for (const field of ['type', 'name']) {
      const record = fixture({
        config: {
          assets: names.map((name, index) => ({
            [field]: name,
            url: `https://assets.example.com/legacy-${index}.png`,
          })),
        },
      })
      const before = JSON.stringify(record)
      const result = characterStudioAssets(record)
      assert.deepEqual(
        result.slots.map((slot) => slot.label),
        labels,
      )
      assert.deepEqual(
        result.slots.slice(1).map((slot) => slot.asset.type),
        ['half-body', 'emotion-grid', 'character-sheet'],
      )
      assert.deepEqual(result.extras, [])
      assert.equal(JSON.stringify(record), before)
    }
  }
})

test('verified official 003 assets preserve the four exact sources and bundled unmodified previews', async () => {
  const character = CHARACTER_STUDIO_TEMPLATES.find((entry) => entry.id === 'official-003')
  const before = JSON.stringify(character)
  const sources = ['full_body', 'face_closeup', 'expression_grid', 'character_sheet'].map(
    (name) =>
      `https://libtv-res.liblib.art/tool/character/003_${name}_1.png?x-oss-process=image/resize,h_440,m_lfit/format,webp/ignore-error,1`,
  )
  const previews = ['full-body', 'face-closeup', 'expression-grid', 'character-sheet'].map(
    (name) => `/canvas-v3/characters/assets/003-${name}.webp`,
  )
  assert.equal(character.name, '甜妹/清新少女')
  assert.equal(character.imageUrl, sources[0])
  assert.equal(character.previewUrl, '/canvas-v3/characters/003.webp')
  assert.equal(character.assetPreviewUrl, previews[0])
  assert.equal(character.source, 'public-reference')
  assert.equal(character.promptSource, 'not-retrieved')
  assert.equal(character.sourceUrl, sources[0])
  const result = characterStudioAssets(character, characterStudioAssetPreview(character))
  assert.deepEqual(
    result.slots.map((slot) => slot.asset.url),
    sources,
  )
  assert.deepEqual(
    result.slots.map((slot) => slot.asset.previewUrl),
    previews,
  )
  assert.equal(new Set(result.slots.map((slot) => slot.asset.url)).size, 4)
  assert.deepEqual(result.extras, [])
  for (const [index, asset] of character.config.assets.entries()) {
    assert.equal(asset.source, 'public-reference')
    assert.equal(asset.promptSource, 'not-retrieved')
    assert.equal(asset.sourceUrl, sources[index + 1])
    assert.equal(asset.prompt, undefined)
  }
  for (const preview of previews) {
    const bundled = await readFile(new URL(`../public${preview}`, import.meta.url))
    assert.equal(bundled.toString('ascii', 0, 4), 'RIFF')
    assert.equal(bundled.toString('ascii', 8, 12), 'WEBP')
  }
  result.slots[1].asset.name = 'edited returned asset'
  assert.equal(JSON.stringify(character), before)
})

test('unverified official templates never infer additional image assets from 003 sources', () => {
  for (const character of CHARACTER_STUDIO_TEMPLATES.filter(
    (entry) => entry.id !== 'official-003',
  )) {
    const result = characterStudioAssets(character, character.previewUrl)
    assert.equal(result.slots[0].asset.url, character.imageUrl)
    assert.deepEqual(
      result.slots.slice(1).map((slot) => slot.asset),
      [null, null, null],
    )
    assert.equal(character.config.assets, undefined)
    assert.deepEqual(result.extras, [])
  }
})

test('typed asset previews allow safe display sources without replacing personal originals', () => {
  for (const previewUrl of [
    'javascript:alert(1)',
    'data:image/png;base64,a',
    'blob:https://assets.example.com/image',
    '//unsafe.example.com/preview.png',
    '/\\unsafe.example.com/preview.png',
    'https://user:password@assets.example.com/preview.png',
  ]) {
    const original = image('half-body')
    const record = fixture({ config: { assets: [{ ...original, previewUrl }] } })
    const before = JSON.stringify(record)
    const result = characterStudioAssets(record)
    assert.equal(result.slots[0].asset.url, record.imageUrl)
    assert.equal(result.slots[1].asset.url, original.url)
    assert.equal(result.slots[1].asset.previewUrl, original.url)
    assert.equal(JSON.stringify(record), before)
  }
  const original = image('half-body')
  for (const previewUrl of [
    '/canvas-v3/custom-preview.webp',
    'https://assets.example.com/view.webp',
  ]) {
    const result = characterStudioAssets(
      fixture({ config: { assets: [{ ...original, previewUrl }] } }),
    )
    assert.equal(result.slots[1].asset.url, original.url)
    assert.equal(result.slots[1].asset.previewUrl, previewUrl)
  }
})

test('unknown and older real assets stay visible without mutating input records', () => {
  const record = fixture({
    config: {
      assets: [
        image('character-sheet'),
        { name: '角色设定图', url: 'https://assets.example.com/older-sheet.png' },
        { name: '服装参考', url: 'https://assets.example.com/clothes.png' },
      ],
    },
  })
  const before = JSON.stringify(record)
  const result = characterStudioAssets(record)
  assert.deepEqual(
    result.extras.map((asset) => asset.name),
    ['角色设定图', '服装参考'],
  )
  result.extras[0].name = 'changed returned value'
  assert.equal(JSON.stringify(record), before)
})

test('invalid assets and unsafe URLs cannot become displayed or inserted media', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    '/local.png',
    '//example.com/a.png',
    'https://a:b@example.com/a.png',
  ]) {
    assert.equal(characterAssetUrl(url), '')
  }
  assert.equal(
    characterAssetUrl('http://127.0.0.1:8083/test.png'),
    'http://127.0.0.1:8083/test.png',
  )
  const result = characterStudioAssets(
    fixture({
      imageUrl: 'javascript:alert(1)',
      coverUrl: 'https://assets.example.com/cover.png',
      config: {
        assets: [null, 'not-an-asset', { url: 'data:image/png;base64,a' }, image('half_body')],
      },
    }),
    '//unsafe.example.com/preview.png',
  )
  assert.equal(result.slots[0].asset.previewUrl, 'https://assets.example.com/cover.png')
  assert.equal(result.slots[1].asset.url, image('half_body').url)
  assert.deepEqual(characterStudioAssets(fixture({ config: { assets: {} } })).extras, [])
})

test('official variants cannot expose personal-delete affordances', () => {
  for (const metadata of [
    { official: true },
    { isOfficial: true },
    { id: 'official-003' },
    { source: 'public' },
    { scope: 'builtin' },
  ]) {
    assert.equal(characterStudioIsOfficial(metadata), true)
  }
  assert.equal(characterStudioIsOfficial(fixture()), false)
})

const source = await readFile(
  new URL('../src/features/canvas-v3/components/CharacterStudioAssetViewer.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
  id: 'character-asset-viewer-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(
    /from (["'])\.\.\/config\/characterStudioAssets\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/characterStudioAssets.js', import.meta.url).href}'`,
  )
  .replace(
    /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
    'const CanvasIcon = { render: () => null }',
  )
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function node(type, text = '') {
  return {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options)
    },
    getAttribute(name) {
      return this.props[name]
    },
  }
}
function detach(child) {
  if (!child.parent) return
  const siblings = child.parent.children
  const index = siblings.indexOf(child)
  if (index >= 0) siblings.splice(index, 1)
  child.parent = null
}
const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (value) => node('#text', value),
  createComment: (value) => node('#comment', value),
  setText: (target, value) => {
    target.text = value
  },
  setElementText: (target, value) => {
    target.text = value
    target.children = []
  },
  patchProp: (target, name, _old, value) => {
    target.props[name] = value
  },
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (child, parent, anchor) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach,
  insertStaticContent: (content, parent, anchor) => {
    const child = node('#static', content.replace(/<[^>]*>/g, ''))
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
    return [child, child]
  },
})
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const textContent = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
async function mount(initial = {}) {
  const state = reactive({ character: fixture(), ...initial })
  const root = node('root')
  const events = []
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        ...Object.fromEntries(
          ['close', 'insert', 'edit', 'create', 'remove', 'generate', 'voice'].map((event) => [
            `on${event[0].toUpperCase()}${event.slice(1)}`,
            (value) => events.push([event, value]),
          ]),
        ),
      }),
  })
  app.mount(root)
  await nextTick()
  await nextTick()
  return {
    state,
    root,
    events,
    find: (predicate) => all(root, predicate),
    button: (label) =>
      all(
        root,
        (target) =>
          target.type === 'button' &&
          (target.props['aria-label'] === label || textContent(target).trim() === label),
      )[0],
    dispose: () => app.unmount(),
  }
}

test('official full-body preview renders only a real image and three missing-view generation controls', async () => {
  const h = await mount({
    character: fixture({ official: true }),
    previewUrl: '/canvas-v3/characters/003.webp',
  })
  assert.equal(h.find((item) => item.type === 'img').length, 1)
  assert.equal(h.find((item) => item.type === 'img')[0].props.src, '/canvas-v3/characters/003.webp')
  for (const label of ['生成上身图', '生成表情九宫格', '生成模特设定图']) assert.ok(h.button(label))
  assert.equal(h.button('生成全身图'), undefined)
  assert.equal(h.button('删除模特'), undefined)
  assert.doesNotMatch(textContent(h.root), /15|14|米值/)
  h.dispose()
})

test('verified official 003 renders four real reference previews without missing-view generation', async () => {
  const character = CHARACTER_STUDIO_TEMPLATES.find((entry) => entry.id === 'official-003')
  const h = await mount({ character, previewUrl: characterStudioAssetPreview(character) })
  assert.deepEqual(
    h.find((item) => item.type === 'img').map((item) => item.props.src),
    [character.assetPreviewUrl, ...character.config.assets.map((asset) => asset.previewUrl)],
  )
  assert.deepEqual(
    h
      .find((entry) => entry.props['data-asset-type'])
      .map((entry) => entry.props['data-asset-type']),
    ['full-body', 'half-body', 'emotion-grid', 'character-sheet'],
  )
  for (const label of ['生成全身图', '生成上身图', '生成表情九宫格', '生成模特设定图'])
    assert.equal(h.button(label), undefined)
  assert.equal(h.button('删除模特'), undefined)
  assert.deepEqual(h.events, [])
  h.dispose()
})

test('the asset viewer presents model terminology without renaming saved asset types or user names', async () => {
  const record = fixture({
    name: '用户原名：角色甲',
    config: {
      assets: [image('half-body'), image('emotion-grid'), image('character-sheet', '角色设定图')],
    },
  })
  const before = JSON.stringify(record)
  const h = await mount({ character: record })
  assert.equal(h.find((item) => item.props.role === 'dialog')[0].props['aria-label'], '模特资产')
  assert.deepEqual(
    h.find((item) => item.type === 'img').map((item) => item.props.alt),
    ['全身图', '上身图', '表情九宫格', '模特设定图'],
  )
  for (const label of ['关闭模特资产', '选择模特音色 ›', '编辑模特', '创建新模特', '删除模特'])
    assert.ok(h.button(label), label)
  assert.match(textContent(h.root), /用户原名：角色甲/)
  assert.equal(JSON.stringify(record), before)
  assert.deepEqual(h.events, [])
  h.dispose()
})

test('recorded incomplete and completed asset views preserve their observed card order', async () => {
  const partial = await mount({ character: fixture() })
  assert.deepEqual(
    partial
      .find((entry) => entry.props['data-asset-type'])
      .map((entry) => entry.props['data-asset-type']),
    ['half-body', 'full-body', 'emotion-grid', 'character-sheet'],
  )
  partial.dispose()
  const complete = await mount({
    character: fixture({
      config: { assets: [{ type: 'half-body', url: 'https://assets.example.com/half.png' }] },
    }),
  })
  assert.deepEqual(
    complete
      .find((entry) => entry.props['data-asset-type'])
      .map((entry) => entry.props['data-asset-type']),
    ['full-body', 'half-body', 'emotion-grid', 'character-sheet'],
  )
  complete.dispose()
})

test('real saved assets render exactly four slots and voice without an additional asset list', async () => {
  const record = fixture({
    config: {
      assets: [
        image('half-body'),
        image('emotion-grid'),
        image('character-sheet'),
        image('costume', '服装素材'),
      ],
    },
  })
  const before = JSON.stringify(record)
  const h = await mount({
    character: record,
  })
  const sources = h.find((item) => item.type === 'img').map((item) => item.props.src)
  assert.deepEqual(sources, [
    fixture().imageUrl,
    image('half-body').url,
    image('emotion-grid').url,
    image('character-sheet').url,
  ])
  assert.deepEqual(
    h.find((item) => item.props['data-asset-type']).map((item) => item.props['data-asset-type']),
    ['full-body', 'half-body', 'emotion-grid', 'character-sheet'],
  )
  assert.equal(
    h.find((item) => item.type === 'button' && String(item.props['aria-label']).startsWith('生成'))
      .length,
    0,
  )
  assert.doesNotMatch(textContent(h.root), /服装素材|其他角色资产/)
  assert.equal(
    h.find((item) => /cv3-character-assets-extras|has-extras/.test(String(item.props.class)))
      .length,
    0,
  )
  assert.equal(
    h.find((item) => String(item.props.class).includes('cv3-character-assets-voice')).length,
    1,
  )
  assert.equal(h.button('选择模特音色 ›').props.disabled, false)
  h.button('选择模特音色 ›').props.onClick()
  assert.deepEqual(h.events, [['voice', undefined]])
  assert.equal(JSON.stringify(record), before)
  h.dispose()
})

test('duplicate older sheets and unknown attachments remain stored but never add viewer DOM', async () => {
  const record = fixture({
    config: {
      assets: [
        image('half-body'),
        image('emotion-grid'),
        image('character-sheet'),
        {
          name: '旧角色设定图',
          type: 'character-sheet',
          url: 'https://assets.example.com/older-sheet.png',
        },
        { name: '未分类附件', type: 'unknown', url: 'https://assets.example.com/unknown.png' },
      ],
    },
  })
  const before = JSON.stringify(record)
  const h = await mount({ character: record })
  const sources = h.find((item) => item.type === 'img').map((item) => item.props.src)
  assert.deepEqual(sources, [
    fixture().imageUrl,
    image('half-body').url,
    image('emotion-grid').url,
    image('character-sheet').url,
  ])
  assert.equal(h.find((item) => item.props['data-asset-type']).length, 4)
  assert.equal(h.find((item) => item.type === 'figure' || item.type === 'figcaption').length, 0)
  assert.equal(h.find((item) => item.props['aria-label'] === '其他角色资产').length, 0)
  assert.equal(
    h.find((item) => /cv3-character-assets-extras|has-extras/.test(String(item.props.class)))
      .length,
    0,
  )
  assert.doesNotMatch(textContent(h.root), /旧角色设定图|未分类附件/)
  assert.ok(h.button('选择模特音色 ›'))
  assert.equal(JSON.stringify(record), before)
  assert.equal(record.config.assets.length, 5)
  assert.deepEqual(
    characterStudioAssets(record).extras.map((asset) => asset.url),
    ['https://assets.example.com/older-sheet.png', 'https://assets.example.com/unknown.png'],
  )
  assert.deepEqual(h.events, [])
  h.dispose()
})

test('footer, missing-view generation and voice actions only emit their declared intents', async () => {
  const record = fixture()
  const h = await mount({ character: record, generationCost: 9 })
  h.button('生成上身图').props.onClick()
  h.button('生成表情九宫格').props.onClick()
  h.button('生成模特设定图').props.onClick()
  h.button('选择模特音色 ›').props.onClick()
  h.button('添加到画布').props.onClick()
  h.button('编辑模特').props.onClick()
  h.button('创建新模特').props.onClick()
  h.button('删除模特').props.onClick()
  assert.deepEqual(h.events.slice(0, 4), [
    ['generate', 'half-body'],
    ['generate', 'emotion-grid'],
    ['generate', 'character-sheet'],
    ['voice', undefined],
  ])
  assert.deepEqual(
    h.events.slice(4).map(([name]) => name),
    ['insert', 'edit', 'create', 'remove'],
  )
  for (const [, value] of h.events.slice(4).filter(([name]) => name !== 'create'))
    assert.equal(value.id, record.id)
  assert.match(textContent(h.root), /9 米值/)
  assert.equal(record.config.assets, undefined)
  h.dispose()
})

test('busy state prevents all mutation intents while close remains accessible', async () => {
  const h = await mount({ busy: true })
  for (const label of [
    '生成上身图',
    '选择模特音色 ›',
    '添加到画布',
    '编辑模特',
    '创建新模特',
    '删除模特',
  ]) {
    assert.equal(h.button(label).props.disabled, true)
    h.button(label).props.onClick()
  }
  assert.deepEqual(h.events, [])
  h.button('关闭模特资产').props.onClick()
  assert.deepEqual(h.events, [['close', undefined]])
  h.dispose()
})

test('status and error feedback remain visible within the asset overlay', async () => {
  const h = await mount({ status: '原任务待查询，不会重复提交', error: '请先选择可用模型' })
  assert.ok(
    h
      .find((item) => item.props.role === 'status')
      .some((item) => textContent(item).includes('原任务待查询')),
  )
  assert.ok(
    h
      .find((item) => item.props.role === 'alert')
      .some((item) => textContent(item).includes('可用模型')),
  )
  assert.deepEqual(h.events, [])
  h.dispose()
})

test('Escape closes only this layer and focus returns to its opener on unmount', async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let restored = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      activeElement: {
        focus() {
          restored += 1
        },
      },
    },
  })
  const h = await mount()
  try {
    assert.equal(h.button('关闭模特资产').focusCalls.length, 1)
    const layer = h.find((item) => item.props.role === 'dialog')[0]
    let prevented = false,
      stopped = false
    layer.props.onKeydown({
      key: 'Escape',
      preventDefault() {
        prevented = true
      },
      stopPropagation() {
        stopped = true
      },
    })
    assert.equal(prevented, true)
    assert.equal(stopped, true)
    assert.deepEqual(h.events, [['close', undefined]])
    layer.props.onKeydown({ key: 'Enter' })
    assert.equal(h.events.length, 1)
  } finally {
    h.dispose()
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor)
    else delete globalThis.document
  }
  assert.equal(restored, 1)
})

test('a failed local preview falls back to its real URL, then reports failure without paid regeneration', async () => {
  const h = await mount({ previewUrl: '/canvas-v3/characters/003.webp' })
  let img = h.find((item) => item.type === 'img')[0]
  img.props.onError({ target: img })
  await nextTick()
  img = h.find((item) => item.type === 'img')[0]
  assert.equal(img.props.src, fixture().imageUrl)
  img.props.onError({ target: img })
  await nextTick()
  assert.equal(h.find((item) => item.type === 'img').length, 0)
  assert.match(textContent(h.root), /全身图图片加载失败/)
  assert.equal(h.button('生成全身图'), undefined)
  assert.equal(h.button('添加到画布').props.disabled, true)
  h.button('添加到画布').props.onClick()
  assert.deepEqual(h.events, [])
  h.dispose()
})

test('viewer is render-only, uncropped sheets and scoped overlay are part of the component contract', () => {
  assert.doesNotMatch(
    source,
    /fetch\(|axios|runImage\(|uploadFileDirect|createCharacterAssetClient|useCanvasV3TaskStore/,
  )
  assert.match(source, /\.cv3-character-inner-scrim\.cv3-character-asset-viewer/)
  assert.match(source, /object-fit: contain/)
  assert.match(source, /\.is-half-body > img\s*\{\s*object-fit: cover/)
  assert.doesNotMatch(source, /assets\.extras|cv3-character-assets-extras|has-extras|其他角色资产/)
})
