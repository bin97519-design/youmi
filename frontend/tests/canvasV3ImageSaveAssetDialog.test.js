import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'

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

const key = Symbol.for('image-save-dialog-test')
const registry = `globalThis[Symbol.for('image-save-dialog-test')]`
const source = await readFile(
  new URL('../src/features/canvas-v3/components/ImageSaveAssetDialog.vue', import.meta.url),
  'utf8',
)
// Teleport's contents use the exact production template; custom renderer has no browser body.
const { descriptor } = parse(
  source.replace('<Teleport to="body">', '<div>').replace('</Teleport>', '</div>'),
)
const compiled = compileScript(descriptor, {
  id: 'image-save-dialog-test',
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
    /import \{ apiPath \} from ['"]\.\.\/\.\.\/\.\.\/utils\/apiBase['"]/,
    'const apiPath = value => value',
  )
  .replace(
    /import \{ uploadBase64ImageDirect \} from ['"]\.\.\/\.\.\/\.\.\/utils\/ossUpload['"]/,
    'const uploadBase64ImageDirect = () => { throw new Error("unexpected upload") }',
  )
  .replace(
    /import \{ createImageSavedAssetClient \} from ['"]\.\.\/sync\/imageSavedAssetClient\.js['"]/,
    `const createImageSavedAssetClient = () => ${registry}.client`,
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
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
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
    authHeaders: () => ({}),
    requireLogin: () => options.loggedIn !== false,
  })
  globalThis[key] = {
    user,
    client: {
      save: async (record, request) => {
        calls.push([record, request])
        return options.save ? options.save(record, request) : { ...record, id: 'saved-1' }
      },
    },
  }
  const state = reactive({
    open: true,
    node: {
      id: 'node-1',
      data: { title: '原始图.png', assetUrl: 'https://assets.example.com/image.png' },
    },
    ...options.props,
  })
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        onClose: () => events.push(['close']),
        onSaved: (record) => events.push(['saved', record]),
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
    async save() {
      find((target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
      await settle()
    },
    async escape() {
      const backdrop = find((target) => target.props['data-image-context-dialog'] !== undefined)[0]
      assert.ok(backdrop)
      backdrop.props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
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

test('opening and canceling the dialog are read-only; valid explicit save emits backend-confirmed record', async () => {
  const harness = await mount()
  try {
    assert.equal(harness.input('资产名称').value, '原始图')
    assert.match(text(harness.root), /原始图\.png/)
    assert.equal(harness.button('保存').props.disabled, true)
    assert.equal(harness.calls.length, 0)
    assert.equal(harness.writes.length, 0)
    await harness.click('选择保存位置')
    await harness.click('选择目录待分类资产')
    assert.equal(harness.button('保存').props.disabled, false)
    await harness.click('设置标签')
    await harness.click('标签角色')
    await harness.click('标签场景')
    await harness.save()
    assert.equal(harness.calls.length, 1)
    assert.deepEqual(harness.calls[0][0].tags, ['角色', '场景'])
    assert.deepEqual(harness.calls[0][0].folderPath, ['待分类资产'])
    assert.deepEqual(
      harness.events.map(([event]) => event),
      ['saved', 'close'],
    )
    assert.equal(harness.writes.length, 0)
  } finally {
    harness.dispose()
  }
  const canceled = await mount()
  try {
    await canceled.click('取消')
    assert.deepEqual(canceled.events, [['close']])
    assert.equal(canceled.calls.length, 0)
    assert.equal(canceled.writes.length, 0)
  } finally {
    canceled.dispose()
  }
})

test('new folders and labels persist only on explicit confirmation and are user-isolated', async () => {
  const harness = await mount()
  try {
    await harness.click('选择保存位置')
    await harness.click('新建根目录')
    await harness.fill('新目录名称', '商品参考')
    assert.equal(harness.writes.length, 0)
    await harness.click('确定')
    assert.equal(harness.writes.length, 1)
    assert.match(harness.writes[0][0], /alice$/)
    await harness.click('设置标签')
    await harness.click('新建标签')
    await harness.fill('新标签名称', '原始素材')
    await harness.click('确定')
    assert.equal(harness.writes.length, 2)
    assert.equal(harness.calls.length, 0)
    await harness.save()
    assert.deepEqual(harness.calls[0][0].folderPath, ['商品参考'])
    assert.deepEqual(harness.calls[0][0].tags, ['原始素材'])
    harness.user.profile = { id: 'bob' }
    await settle()
    assert.equal(harness.button('保存').props.disabled, true)
    await harness.click('设置标签')
    assert.equal(harness.button('标签原始素材'), undefined)
  } finally {
    harness.dispose()
  }
})

test('a failed save keeps its draft and allows retry without a false success', async () => {
  let attempts = 0
  const harness = await mount({
    save: async (record) => {
      if (++attempts === 1) throw new Error('网络错误')
      return { ...record, id: 'confirmed' }
    },
  })
  try {
    await harness.click('选择保存位置')
    await harness.click('选择目录待分类资产')
    await harness.fill('资产名称', '我的作品')
    await harness.save()
    assert.match(text(harness.root), /网络错误/)
    assert.equal(harness.events.length, 0)
    assert.equal(harness.input('资产名称').value, '我的作品')
    await harness.save()
    assert.equal(harness.events[0][1].id, 'confirmed')
  } finally {
    harness.dispose()
  }
})

test('pending saves disable duplicate submission and closing; account changes abort stale completion', async () => {
  let resolve
  const pending = new Promise((done) => {
    resolve = done
  })
  const harness = await mount({ save: () => pending })
  try {
    await harness.click('选择保存位置')
    await harness.click('选择目录待分类资产')
    await harness.save()
    await harness.save()
    await harness.click('取消')
    assert.equal(harness.calls.length, 1)
    assert.equal(harness.events.length, 0)
    assert.equal(harness.button('保存中…').props.disabled, true)
    harness.user.profile = { id: 'bob' }
    await settle()
    assert.equal(harness.calls[0][1].signal.aborted, true)
    resolve({ id: 'late' })
    await settle()
    assert.equal(harness.events.length, 0)
  } finally {
    resolve({ id: 'late' })
    harness.dispose()
  }
})

test('Escape dismisses nested controls before modal; invalid images and anonymous writes stay disabled', async () => {
  const harness = await mount()
  try {
    await harness.click('设置标签')
    await harness.escape()
    assert.equal(harness.events.length, 0)
    await harness.escape()
    assert.deepEqual(harness.events, [['close']])
  } finally {
    harness.dispose()
  }
  const invalid = await mount({ props: { image: 'javascript:alert(1)' } })
  try {
    assert.equal(invalid.button('保存').props.disabled, true)
    assert.match(text(invalid.root), /图片地址无效/)
  } finally {
    invalid.dispose()
  }
  const anonymous = await mount({ loggedIn: false })
  try {
    await anonymous.click('选择保存位置')
    await anonymous.click('选择目录待分类资产')
    await anonymous.save()
    assert.equal(anonymous.calls.length, 0)
  } finally {
    anonymous.dispose()
  }
})

test('dialog typography is scoped and measured without root or global font rules', () => {
  assert.ok(source.includes('<style scoped>'))
  assert.match(source, /width:\s*720px/)
  assert.match(source, /height:\s*200px/)
  assert.match(source, /font-size:\s*14px/)
  assert.doesNotMatch(source, /(?:^|\n)(?:html|body|:root|\.cv3-root)\s*[,{]/)
  assert.match(source, /data-image-context-dialog/)
  assert.match(source, /aria-modal="true"/)
  const css = descriptor.styles[0].content
  assert.match(css, /\.cv3-save-asset-name-wrap\s*\{[^}]*margin:\s*0 0 10px/s)
  assert.match(css, /\.cv3-save-asset-select-wrap\s*\{[^}]*margin-bottom:\s*10px/s)
  assert.match(css, /\.cv3-save-asset-name-wrap:focus-within\s*\{[^}]*border-color:\s*#888/s)
  assert.match(css, /\.cv3-save-asset-name-wrap input:focus-visible\s*\{[^}]*outline:\s*none/s)
  assert.match(
    css,
    /\.cv3-save-asset-dropdown\s*\{[^}]*border-radius:\s*12px;[^}]*background:\s*#1f1f1f/s,
  )
})

test('explicit user-supplied names keep raster suffixes while default filenames lose only raster extensions', async () => {
  const explicit = await mount({ props: { name: '用户指定.PNG' } })
  try {
    assert.equal(explicit.input('资产名称').value, '用户指定.PNG')
  } finally {
    explicit.dispose()
  }
  for (const filename of [
    '参考.JPEG',
    '参考.webp',
    '参考.gif',
    '参考.avif',
    '参考.bmp',
    '版本.json',
  ]) {
    const harness = await mount({
      props: {
        node: {
          id: 'image',
          data: { title: filename, assetUrl: 'https://assets.example.com/image.png' },
        },
      },
    })
    try {
      assert.equal(harness.input('资产名称').value, filename.endsWith('.json') ? filename : '参考')
      assert.match(text(harness.root), new RegExp(filename.replace('.', '\\.')))
    } finally {
      harness.dispose()
    }
  }
})
