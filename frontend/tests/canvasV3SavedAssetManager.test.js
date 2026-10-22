import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'

const key = Symbol.for('canvas-saved-asset-manager-test')
const registry = `globalThis[Symbol.for('canvas-saved-asset-manager-test')]`
const source = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasUtilityPanel.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
  id: 'saved-asset-manager-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(
    /import \{ useCanvasV3GraphStore \} from ['"]\.\.\/stores\/graph['"]/,
    `const useCanvasV3GraphStore = () => ${registry}.graph`,
  )
  .replace(
    /import \{ useUserStore \} from ['"]\.\.\/\.\.\/\.\.\/stores\/user['"]/,
    `const useUserStore = () => ${registry}.user`,
  )
  .replace(
    /import \{ apiPath \} from ['"]\.\.\/\.\.\/\.\.\/utils\/apiBase['"]/,
    'const apiPath = value => value',
  )
  .replace(
    /import \{[^}]*createVideoSavedAssetClient,[^}]*\} from ['"]\.\.\/sync\/videoSavedAssetClient\.js['"]/,
    `import { savedAssetMediaKind, videoSavedAssetInfo } from '${new URL('../src/features/canvas-v3/sync/videoSavedAssetClient.js', import.meta.url).href}'
const createVideoSavedAssetClient = () => ${registry}.client`,
  )
  .replace(
    /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
    'const CanvasIcon = { render: () => null }',
  )
  .replace(
    /from (['"])\.\.\/config\/imageAssetCollections\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/imageAssetCollections.js', import.meta.url).href}'`,
  )
  .replace(
    /from (['"])\.\.\/config\/personalAssetLibrary\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/personalAssetLibrary.js', import.meta.url).href}'`,
  )
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default
function node(type, text = '') {
  return { type, text, props: {}, children: [], parent: null, value: '' }
}
function detach(target) {
  if (!target.parent) return
  const index = target.parent.children.indexOf(target)
  if (index >= 0) target.parent.children.splice(index, 1)
  target.parent = null
}
const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
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
  insert: (target, parent, anchor) => {
    detach(target)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
  },
  remove: detach,
})
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const text = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const asset = (id = 'saved', extra = {}) => ({
  id,
  name: '已存参考图',
  imageUrl: `https://assets.example.com/${id}.png`,
  config: {
    libraryKind: 'asset',
    canvasAsset: { folderId: 'folder', folderPath: ['参考', '人物'], tags: ['角色', '写实'] },
  },
  ...extra,
})
const graphNode = (id = 'local', kind = 'image', extra = {}) => ({
  id,
  selected: false,
  data: { kind, title: id, assetUrl: `https://assets.example.com/${id}.png`, ...extra },
})
async function mount(options = {}) {
  const calls = [],
    events = []
  const user = reactive({
    isAuthenticated: options.loggedIn !== false,
    profile: { id: 'alice' },
    authHeaders: () => ({}),
    requireLogin: () => {
      calls.push(['login'])
      return options.loggedIn !== false
    },
  })
  const graph = {
    nodes: reactive(options.nodes || [graphNode()]),
    remember: () => calls.push(['remember']),
    updateNodeData: (...args) => calls.push(['updateNodeData', ...args]),
  }
  globalThis[key] = {
    user,
    graph,
    client: {
      list: async (request) => {
        calls.push(['list', request])
        return options.list ? options.list(request) : [asset()]
      },
    },
  }
  const state = reactive({ panel: options.panel || 'assets', assetRevision: 0 })
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        onClose: () => events.push(['close']),
        onImportSavedAsset: (record) => events.push(['import', record]),
        onPreviewImage: (record) => events.push(['preview', record]),
        onPreviewVideo: (record) => events.push(['preview-video', record]),
        onImportSavedVideo: (record) => events.push(['import-video', record]),
        onImportImages: (files) => events.push(['upload', files]),
        onExport: () => events.push(['export']),
        onDemo: () => events.push(['demo']),
      }),
  })
  app.mount(root)
  await settle()
  const find = (predicate) => all(root, predicate)
  const button = (label) =>
    find(
      (target) =>
        target.type === 'button' &&
        (target.props['aria-label'] === label || text(target).trim() === label),
    )[0]
  return {
    state,
    user,
    graph,
    root,
    calls,
    events,
    find,
    button,
    async click(label) {
      const target = button(label)
      assert.ok(target, label)
      target.props.onClick?.({ preventDefault() {}, stopPropagation() {} })
      await settle()
    },
    dispose() {
      app.unmount()
      delete globalThis[key]
    },
  }
}

test('asset manager merges durable saved assets with current graph media, preserving metadata and existing selection', async () => {
  const local = graphNode('local')
  const harness = await mount({
    nodes: [local, graphNode('video', 'video')],
    list: async () => [
      asset('cloud'),
      asset('same', { name: '当前素材资产', imageUrl: local.data.assetUrl }),
    ],
  })
  try {
    assert.equal(harness.calls.filter(([name]) => name === 'list').length, 1)
    assert.equal(harness.find((target) => target.type === 'article').length, 3)
    assert.match(text(harness.root), /参考 \/ 人物/)
    assert.match(text(harness.root), /角色 · 写实/)
    assert.ok(harness.button('预览资产local'))
    assert.ok(harness.button('预览资产已存参考图'))
    await harness.click('预览资产已存参考图')
    assert.equal(harness.events[0][0], 'preview')
    assert.equal(harness.events[0][1].id, 'cloud')
    await harness.click('添加资产已存参考图到画布')
    assert.equal(harness.events[1][0], 'import')
    assert.equal(harness.events[1][1].imageUrl, asset('cloud').imageUrl)
    assert.equal(
      harness.graph.nodes.length,
      2,
      'panel delegates insertion, not arbitrary graph mutations',
    )
    await harness.click('定位素材local')
    assert.equal(local.selected, true)
    assert.deepEqual(harness.events.at(-1), ['close'])
    await harness.click('视频')
    assert.equal(harness.find((target) => target.type === 'article').length, 1)
    assert.ok(harness.button('定位素材video'))
  } finally {
    harness.dispose()
  }
})

test('saved records cannot pull legacy, unknown, product or unsafe assets into the generic manager', async () => {
  const harness = await mount({
    nodes: [],
    list: async () => [
      asset('valid'),
      asset('duplicate', { imageUrl: asset('valid').imageUrl }),
      asset('model', { name: '旧模特', config: {} }),
      asset('unknown', { name: '未知素材', config: { libraryKind: 'unknown' } }),
      asset('product', { name: '商品素材', config: { libraryKind: 'product' } }),
      asset('bad', { name: '恶意图片', imageUrl: 'javascript:alert(1)' }),
    ],
  })
  try {
    assert.equal(harness.find((target) => target.type === 'article').length, 1)
    assert.doesNotMatch(text(harness.root), /旧模特|未知素材|商品素材|恶意图片/)
    assert.ok(harness.button('添加资产已存参考图到画布'))
    assert.equal(harness.button('删除'), undefined)
  } finally {
    harness.dispose()
  }
})

test('panel opening and asset revision cause fresh reads while unrelated tabs never fetch', async () => {
  const harness = await mount({ panel: 'history', nodes: [] })
  try {
    assert.equal(harness.calls.length, 0)
    assert.match(text(harness.root), /暂无生成记录/)
    harness.state.panel = 'assets'
    await settle()
    assert.equal(harness.calls.length, 1)
    harness.state.assetRevision++
    await settle()
    assert.equal(harness.calls.length, 2)
    harness.state.panel = 'help'
    await settle()
    assert.match(text(harness.root), /从一个节点开始/)
    harness.state.assetRevision++
    await settle()
    assert.equal(harness.calls.length, 2)
    harness.state.panel = 'assets'
    await settle()
    assert.equal(harness.calls.length, 3)
  } finally {
    harness.dispose()
  }
})

test('loading and errors remain honest, local media survives, and retry can confirm an empty cloud library', async () => {
  let reject
  let attempts = 0
  const pending = new Promise((_resolve, fail) => {
    reject = fail
  })
  const harness = await mount({ list: () => (++attempts === 1 ? pending : []) })
  try {
    assert.match(text(harness.root), /正在加载个人资产/)
    assert.ok(harness.button('定位素材local'))
    reject(new Error('服务离线'))
    await settle()
    assert.match(text(harness.root), /服务离线/)
    assert.ok(harness.button('定位素材local'))
    await harness.click('重试')
    assert.doesNotMatch(text(harness.root), /服务离线|正在加载个人资产/)
    assert.ok(harness.button('刷新个人资产'))
  } finally {
    harness.dispose()
  }
})

test('anonymous views do not request private assets and only explicit login opens authentication', async () => {
  const harness = await mount({ loggedIn: false, nodes: [] })
  try {
    assert.equal(harness.calls.length, 0)
    assert.match(text(harness.root), /登录后可查看/)
    await harness.click('登录')
    assert.deepEqual(harness.calls, [['login']])
  } finally {
    harness.dispose()
  }
})

test('account changes, tab changes and unmount abort stale reads and never show another account assets', async () => {
  const pending = []
  const harness = await mount({
    nodes: [],
    list: () => new Promise((resolve) => pending.push(resolve)),
  })
  try {
    harness.user.profile = { id: 'bob' }
    await settle()
    assert.equal(harness.calls[0][1].signal.aborted, true)
    pending[0]([asset('alice-private', { name: '爱丽丝私有图片' })])
    pending[1]([asset('bob', { name: '鲍勃图片' })])
    await settle()
    assert.doesNotMatch(text(harness.root), /爱丽丝私有图片/)
    assert.match(text(harness.root), /鲍勃图片/)
    harness.state.assetRevision++
    await settle()
    harness.state.panel = 'shortcuts'
    await settle()
    assert.equal(harness.calls.at(-1)[1].signal.aborted, true)
    pending[2]([asset('late')])
    await settle()
    assert.match(text(harness.root), /添加节点/)
    harness.state.panel = 'assets'
    await settle()
    harness.dispose()
    assert.equal(harness.calls.at(-1)[1].signal.aborted, true)
    pending[3]([asset('unmounted')])
    await settle()
  } finally {
    if (globalThis[key]) harness.dispose()
  }
})

test('existing import file and generation history actions remain functional', async () => {
  const harness = await mount({
    panel: 'history',
    nodes: [
      graphNode('local', 'image', {
        candidates: [{ url: 'https://assets.example.com/v2.png', createdAt: 1 }],
      }),
    ],
  })
  try {
    await harness.click('local')
    assert.deepEqual(harness.calls[0], ['remember'])
    assert.deepEqual(harness.calls[1], [
      'updateNodeData',
      'local',
      { assetUrl: 'https://assets.example.com/v2.png', artifactStatus: 'ready' },
    ])
    harness.state.panel = 'assets'
    await settle()
    const target = { files: [{ name: 'image.png' }], value: 'image.png' }
    harness
      .find((target) => target.type === 'input' && target.props.type === 'file')[0]
      .props.onChange({ target })
    assert.equal(target.value, '')
    assert.deepEqual(harness.events.at(-1), ['upload', [{ name: 'image.png' }]])
  } finally {
    harness.dispose()
  }
})

test('explicit saved videos use their own filter, poster, preview and insertion events without image masquerading', async () => {
  const videoUrl = 'https://assets.example.com/clip.mp4'
  const posterUrl = 'https://assets.example.com/cover.png'
  const video = asset('video-cloud', {
    name: '我的视频',
    imageUrl: '',
    coverUrl: posterUrl,
    config: {
      libraryKind: 'asset',
      mediaKind: 'video',
      videoUrl,
      posterUrl,
      canvasAsset: { folderPath: ['视频素材'], tags: ['片段'], duration: 12 },
    },
  })
  const local = graphNode('clip-node', 'video', { assetUrl: videoUrl })
  const harness = await mount({ nodes: [local], list: async () => [asset('image'), video] })
  try {
    assert.equal(harness.calls.filter(([name]) => name === 'list').length, 1)
    assert.equal(harness.find((target) => target.type === 'article').length, 2)
    const cover = harness.find((target) => target.type === 'img' && target.props.src === posterUrl)
    assert.equal(cover.length, 1)
    assert.equal(
      harness.find((target) => target.type === 'img' && target.props.src === videoUrl).length,
      0,
    )
    await harness.click('视频')
    assert.equal(harness.find((target) => target.type === 'article').length, 1)
    await harness.click('预览资产clip-node')
    assert.deepEqual(harness.events.at(-1), ['preview-video', video])
    await harness.click('添加资产我的视频到画布')
    assert.deepEqual(harness.events.at(-1), ['import-video', video])
    assert.equal(harness.graph.nodes.length, 1, 'the shell owns insertion into the actual graph')
    await harness.click('图片')
    assert.equal(harness.find((target) => target.type === 'article').length, 1)
    assert.ok(harness.button('预览资产已存参考图'))
    assert.equal(harness.button('预览资产clip-node'), undefined)
  } finally {
    harness.dispose()
  }
})

test('invalid video metadata cannot silently become an image asset through its poster or stale imageUrl', async () => {
  const harness = await mount({
    nodes: [],
    list: async () => [
      asset('image'),
      asset('invalid-video', {
        name: '无效视频',
        config: { libraryKind: 'asset', mediaKind: 'video', videoUrl: 'javascript:alert(1)' },
      }),
      asset('unknown', {
        name: '未知类型',
        config: { libraryKind: 'asset', mediaKind: 'unknown' },
      }),
      asset('video', {
        name: '无封面视频',
        imageUrl: '',
        config: {
          libraryKind: 'asset',
          mediaKind: 'video',
          videoUrl: 'https://assets.example.com/no-poster.mp4',
        },
      }),
    ],
  })
  try {
    assert.equal(harness.find((target) => target.type === 'article').length, 2)
    assert.doesNotMatch(text(harness.root), /无效视频|未知类型/)
    await harness.click('视频')
    assert.equal(harness.find((target) => target.type === 'article').length, 1)
    assert.equal(harness.find((target) => target.type === 'img').length, 0)
    assert.ok(harness.button('预览资产无封面视频'))
  } finally {
    harness.dispose()
  }
})
