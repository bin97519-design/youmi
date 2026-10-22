import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'
import {
  createSelectionSavedAssets,
  selectionAssetSnapshots,
} from '../src/features/canvas-v3/sync/selectionSavedAssets.js'

const documentTypes = ['Document', 'ShadowRoot'].map((name) => [
  name,
  Object.getOwnPropertyDescriptor(globalThis, name),
])
for (const [name] of documentTypes)
  if (typeof globalThis[name] === 'undefined')
    Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
after(() => {
  for (const [name, descriptor] of documentTypes) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
})
const key = Symbol.for('selection-save-dialog-test')
const registry = `globalThis[Symbol.for('selection-save-dialog-test')]`
const source = await readFile(
  new URL('../src/features/canvas-v3/components/SelectionSaveAssetDialog.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(
  source.replace('<Teleport to="body">', '<div>').replace('</Teleport>', '</div>'),
)
const compiled = compileScript(descriptor, {
  id: 'selection-save-dialog-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(
    /import \{ useUserStore \} from ['"]\.\.\/\.\.\/\.\.\/stores\/user['"]/,
    `const useUserStore = () => ${registry}.user`,
  )
  .replace(
    /import \{ useCanvasV3GraphStore \} from ['"]\.\.\/stores\/graph['"]/,
    `const useCanvasV3GraphStore = () => ${registry}.graph`,
  )
  .replace(
    /import \{ apiPath \} from ['"]\.\.\/\.\.\/\.\.\/utils\/apiBase['"]/,
    'const apiPath = value => value',
  )
  .replace(
    /import \{ uploadBase64ImageDirect \} from ['"]\.\.\/\.\.\/\.\.\/utils\/ossUpload['"]/,
    `const uploadBase64ImageDirect = (...args) => ${registry}.upload(...args)`,
  )
  .replace(
    /import \{\s*createSelectionSavedAssets,\s*selectionAssetSnapshots,?\s*\} from ['"]\.\.\/sync\/selectionSavedAssets\.js['"]/,
    `const createSelectionSavedAssets = (...args) => ${registry}.api.createSelectionSavedAssets(...args)
const selectionAssetSnapshots = (...args) => ${registry}.api.selectionAssetSnapshots(...args)`,
  )
  .replace(
    /from (['"])\.\.\/config\/imageAssetCollections\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/imageAssetCollections.js', import.meta.url).href}'`,
  )
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function node(type, text = '') {
  return {
    type,
    tagName: type.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    focusCalls: 0,
    focus() {
      this.focusCalls++
    },
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return null
    },
  }
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
    if (name === 'value') target.value = value
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
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const image = (id = 'image', extra = {}) => ({
  id,
  data: {
    kind: 'image',
    title: `${id}.png`,
    assetUrl: `https://cdn.example.test/${id}.png`,
    ...extra,
  },
})
const video = (id = 'video', extra = {}) => ({
  id,
  data: {
    kind: 'video',
    title: `${id}.mp4`,
    assetUrl: `https://cdn.example.test/${id}.mp4`,
    ...extra,
  },
})
const success = (init, id = 'saved') => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data: { ...JSON.parse(init.body), id } }),
})
async function mount(options = {}) {
  const calls = [],
    events = [],
    writes = [],
    data = new Map()
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => data.get(key),
      setItem: (key, value) => {
        writes.push([key, value])
        data.set(key, value)
      },
    },
  })
  const user = reactive({
    profile: { id: 'alice' },
    authHeaders: () => ({ Authorization: `mock-${user.profile.id}` }),
    requireLogin: () => options.loggedIn !== false,
  })
  const graph = reactive({ projectId: 'project-a' })
  const upload =
    options.upload ||
    (() => {
      throw new Error('Unexpected upload')
    })
  globalThis[key] = {
    user,
    graph,
    upload,
    api: {
      selectionAssetSnapshots,
      createSelectionSavedAssets: (settings) =>
        createSelectionSavedAssets({
          ...settings,
          fetcher: async (url, init) => {
            calls.push([url, init])
            return options.fetcher
              ? options.fetcher(url, init, calls.length)
              : success(init, `saved-${calls.length}`)
          },
        }),
    },
  }
  const state = reactive({ open: true, nodes: [image(), video()], ...options.props })
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        onClose: () => events.push(['close']),
        onSaved: (records) => events.push(['saved', records]),
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
    writes,
    find,
    button,
    input: (label) =>
      find((target) => target.type === 'input' && target.props['aria-label'] === label)[0],
    async fill(label, value) {
      const input = this.input(label)
      assert.ok(input, label)
      input.props['onUpdate:modelValue'](value)
      await settle()
    },
    async click(label) {
      const target = button(label)
      assert.ok(target, label)
      target.props.onClick?.({ preventDefault() {}, stopPropagation() {} })
      await settle()
    },
    async chooseFolder() {
      await this.click('选择保存位置')
      await this.click('选择目录待分类资产')
    },
    async save() {
      find((target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
      await settle()
    },
    async escape() {
      find(
        (target) => target.props['data-selection-context-dialog'] !== undefined,
      )[0].props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
      await settle()
    },
    dispose() {
      app.unmount()
      delete globalThis[key]
      if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage)
      else delete globalThis.localStorage
    },
  }
}

test('opening uses an immutable asset snapshot and cancels without uploads or writes', async () => {
  let uploads = 0
  const harness = await mount({
    upload: () => {
      uploads++
    },
    props: { nodes: [image('local', { assetUrl: 'data:image/png;base64,AAAA' }), video()] },
  })
  try {
    assert.equal(harness.calls.length, 0)
    assert.equal(uploads, 0)
    assert.equal(harness.writes.length, 0)
    assert.equal(harness.button('保存').props.disabled, true)
    assert.match(text(harness.root), /已选择 2 项素材/)
    assert.equal(harness.input('资产名称1').value, 'local')
    assert.equal(
      harness.find((target) => target.type === 'video').length,
      0,
      'Opening must not start video loads',
    )
    harness.state.nodes[0].data.title = 'changed.png'
    harness.state.nodes.push(image('new'))
    await settle()
    assert.equal(harness.input('资产名称1').value, 'local')
    assert.equal(harness.input('资产名称3'), undefined)
    await harness.click('取消')
    assert.deepEqual(harness.events, [['close']])
    assert.equal(uploads, 0)
    assert.equal(harness.calls.length, 0)
  } finally {
    harness.dispose()
  }
})

test('Save sends edited names and common folder/tags through the real clients, emitting confirmed assets once', async () => {
  const harness = await mount()
  try {
    await harness.chooseFolder()
    await harness.fill('资产名称1', '图片自定义')
    await harness.fill('资产名称2', '视频自定义')
    await harness.click('设置标签')
    await harness.click('标签角色')
    await harness.click('标签场景')
    assert.equal(harness.writes.length, 0)
    await harness.save()
    assert.equal(harness.calls.length, 2)
    const bodies = harness.calls.map(([url, init]) => {
      assert.equal(url, '/api/canvas/characters')
      return JSON.parse(init.body)
    })
    assert.deepEqual(
      bodies.map((record) => record.name),
      ['图片自定义', '视频自定义'],
    )
    for (const record of bodies) {
      assert.deepEqual(record.config.canvasAsset.folderPath, ['待分类资产'])
      assert.deepEqual(record.config.canvasAsset.tags, ['角色', '场景'])
    }
    assert.equal(harness.events.length, 1)
    assert.equal(harness.events[0][0], 'saved')
    assert.equal(harness.events[0][1].length, 2)
    assert.equal(harness.button('继续保存').props.disabled, true)
    assert.match(text(harness.root), /全部资产已保存到云端/)
    await harness.save()
    await harness.click('完成')
    assert.equal(harness.calls.length, 2)
    assert.deepEqual(
      harness.events.map(([name]) => name),
      ['saved', 'close'],
    )
  } finally {
    harness.dispose()
  }
})

test('partial failure is visible; retry skips successes and emits only new confirmations', async () => {
  let fail = true
  const harness = await mount({
    fetcher: async (_url, init) => {
      if (fail && JSON.parse(init.body).name === 'video')
        return { ok: false, status: 400, json: async () => ({ code: 1, message: '视频保存失败' }) }
      return success(init, JSON.parse(init.body).name)
    },
  })
  try {
    await harness.chooseFolder()
    await harness.save()
    assert.match(text(harness.root), /已保存 1\/2.*失败 1/)
    assert.match(text(harness.root), /视频保存失败/)
    assert.equal(harness.events[0][1].length, 1)
    assert.equal(harness.input('资产名称1').props.disabled, true)
    fail = false
    await harness.save()
    assert.deepEqual(
      harness.calls.map(([, init]) => JSON.parse(init.body).name),
      ['image', 'video', 'video'],
    )
    assert.equal(harness.events.length, 2)
    assert.equal(harness.events[1][1][0].name, 'video')
    assert.match(text(harness.root), /全部资产已保存到云端/)
  } finally {
    harness.dispose()
  }
})

test('stop aborts in-flight work and preserves confirmed rows without unsafe retry of uncertain writes', async () => {
  const harness = await mount({
    props: { nodes: [image('a'), video('b'), image('c')] },
    fetcher: async (_url, init, count) => {
      if (count === 1) return success(init, 'a')
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      )
    },
  })
  try {
    await harness.chooseFolder()
    await harness.save()
    assert.equal(harness.calls.length, 2)
    await harness.save()
    assert.equal(harness.calls.length, 2)
    await harness.click('停止保存')
    assert.equal(harness.calls[1][1].signal.aborted, true)
    assert.match(text(harness.root), /已保存 1\/3.*待核对 1/)
    assert.match(text(harness.root), /不会自动重试/)
    assert.equal(harness.events[0][1].length, 1)
    await harness.save()
    assert.deepEqual(
      harness.calls.map(([, init]) => JSON.parse(init.body).name),
      ['a', 'b', 'c'],
    )
    await harness.click('关闭保存资产')
    assert.equal(harness.calls[2][1].signal.aborted, true)
    assert.deepEqual(
      harness.events.map(([name]) => name),
      ['saved', 'close'],
    )
  } finally {
    harness.dispose()
  }
})

test('closing during a request aborts it and suppresses late saves and progress', async () => {
  let resolve
  const harness = await mount({
    fetcher: async (_url, init) =>
      new Promise((done) => {
        resolve = () => done(success(init, 'late'))
      }),
  })
  try {
    await harness.chooseFolder()
    await harness.save()
    await harness.click('关闭保存资产')
    assert.equal(harness.calls[0][1].signal.aborted, true)
    resolve()
    await settle()
    assert.deepEqual(harness.events, [['close']])
    assert.equal(harness.calls.length, 1)
  } finally {
    harness.dispose()
  }
})

test('account and project switches abort old requests and never emit stale assets into the new context', async () => {
  for (const change of [
    (harness) => {
      harness.user.profile = { id: 'bob' }
    },
    (harness) => {
      harness.graph.projectId = 'project-b'
    },
  ]) {
    let resolve
    const harness = await mount({
      fetcher: async (_url, init) =>
        new Promise((done) => {
          resolve = () => done(success(init, 'old'))
        }),
    })
    try {
      await harness.chooseFolder()
      await harness.save()
      assert.equal(harness.calls.length, 1)
      change(harness)
      await settle()
      assert.equal(harness.calls[0][1].signal.aborted, true)
      resolve()
      await settle()
      assert.deepEqual(harness.events, [['close']])
      assert.equal(harness.input('资产名称1'), undefined)
      assert.equal(harness.calls.length, 1)
      assert.equal(harness.calls[0][1].headers.Authorization, 'mock-alice')
    } finally {
      harness.dispose()
    }
  }
})

test('explicit local folder/tag creation is account-scoped and Escape dismisses nested menus first', async () => {
  const harness = await mount()
  try {
    await harness.click('选择保存位置')
    assert.match(text(harness.root), /个人资产库/)
    await harness.click('新建根目录')
    await harness.fill('新目录名称', '商品素材')
    assert.equal(harness.writes.length, 0)
    await harness.click('确定')
    assert.equal(harness.writes.length, 1)
    assert.match(harness.writes[0][0], /alice$/)
    await harness.click('设置标签')
    await harness.click('新建标签')
    await harness.fill('新标签名称', '原始素材')
    await harness.click('确定')
    assert.equal(harness.writes.length, 2)
    await harness.escape()
    assert.equal(harness.events.length, 0)
    await harness.save()
    const record = JSON.parse(harness.calls[0][1].body)
    assert.deepEqual(record.config.canvasAsset.folderPath, ['商品素材'])
    assert.deepEqual(record.config.canvasAsset.tags, ['原始素材'])
  } finally {
    harness.dispose()
  }
})

test('oversized selection, invalid media and anonymous users cannot cause writes', async () => {
  for (const options of [
    {
      props: { nodes: Array.from({ length: 51 }, (_, index) => image(String(index))) },
      expected: /最多保存 50/,
    },
    {
      props: {
        nodes: [
          image('bad', { assetUrl: 'javascript:alert(1)' }),
          video('bad-video', { assetUrl: 'blob:temporary' }),
        ],
      },
      expected: /无可保存产物/,
    },
    { loggedIn: false },
  ]) {
    const harness = await mount(options)
    try {
      if (options.expected) assert.match(text(harness.root), options.expected)
      await harness.chooseFolder()
      await harness.save()
      assert.equal(harness.calls.length, 0)
      assert.equal(harness.writes.length, 0)
    } finally {
      harness.dispose()
    }
  }
})

test('batch modal uses only scoped 720×520 two-column styles, isolated from canvas/global typography', () => {
  assert.ok(source.includes('<style scoped>'))
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /data-canvas-shortcuts-ignore/)
  const css = descriptor.styles[0].content
  assert.match(css, /\.cv3-selection-save-dialog\s*\{[^}]*width:\s*720px;[^}]*height:\s*520px/s)
  assert.match(css, /\.cv3-selection-save-fields\s*\{[^}]*width:\s*236px/s)
  assert.match(css, /grid-template-columns:\s*repeat\(3,/)
  assert.match(css, /max-width:\s*116px/)
  assert.match(css, /backdrop-filter:\s*blur\(/)
  assert.doesNotMatch(css, /(?:^|\n)(?:html|body|:root|\.cv3-root)\s*[,{]/)
})
