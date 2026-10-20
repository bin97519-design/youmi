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

const source = await readFile(
  new URL('../src/features/canvas-v3/components/PersonalAssetLibrary.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
  id: 'personal-library-panel-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const key = 'canvasV3PersonalAssetLibraryPanelTest'
const registry = `globalThis[Symbol.for('${key}')]`
const moduleSource =
  `import { onBeforeUnmount as testOnBeforeUnmount } from '${import.meta.resolve('vue')}'\n${compiled.content}`
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
      'const apiPath = (value) => value',
    )
    .replace(
      /import \{ uploadFileDirect \} from ['"]\.\.\/\.\.\/\.\.\/utils\/ossUpload['"]/,
      `const uploadFileDirect = (...args) => ${registry}.upload(...args)`,
    )
    .replace(
      /import \{ createPersonalAssetLibraryClient \} from ['"]\.\.\/sync\/personalAssetLibraryClient\.js['"]/,
      `const createPersonalAssetLibraryClient = (options) => ${registry}.client(options.kind)`,
    )
    .replace(
      /from (['"])\.\.\/config\/personalAssetLibrary\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/personalAssetLibrary.js', import.meta.url).href}'`,
    )
    .replace(
      /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
      'const CanvasIcon = { render: () => null }',
    )
    .replace(
      /import PersonalAssetCarousel from ['"]\.\/PersonalAssetCarousel\.vue['"]/,
      `const PersonalAssetCarousel = {
  inheritAttrs: false,
  props: ['items', 'activeId', 'selectedIds', 'multiSelect', 'disabled', 'kind'],
  emits: ['activate', 'select'],
  setup(props, { emit }) {
    const owner = ${registry}
    const snapshot = { props, emit }
    owner.carousel = snapshot
    testOnBeforeUnmount(() => { if (owner.carousel === snapshot) owner.carousel = null })
    return () => null
  },
}`,
    )
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default
const asset = (kind = 'product', extra = {}) => ({
  id: `${kind}-1`,
  name: kind === 'product' ? '绵绵岛床垫' : '暖白卧室',
  description: kind === 'product' ? '浅色面料，商品原图' : '暖光卧室场景',
  imageUrl: `https://assets.example.com/${kind}-original.png`,
  coverUrl: `https://assets.example.com/${kind}-preview.png`,
  config: { libraryKind: kind, merchantNote: 'keep me' },
  ...extra,
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function node(type, text = '') {
  return {
    type,
    tagName: type.toUpperCase(),
    text,
    props: {},
    children: [],
    parent: null,
    hostValue: '',
    get value() {
      return this.type === 'select'
        ? (this.options[this.selectedIndex]?.value ?? '')
        : this.hostValue
    },
    set value(value) {
      this.hostValue = value
      if (this.type === 'select')
        this.selectedIndex = this.options.findIndex((option) => option.value === value)
    },
    clickCalls: 0,
    focusCalls: 0,
    focus() {
      this.focusCalls += 1
    },
    click() {
      this.clickCalls += 1
    },
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return null
    },
    get options() {
      return this.children.filter((child) => child.type === 'option')
    },
  }
}
function detach(target) {
  if (!target.parent) return
  const siblings = target.parent.children
  const index = siblings.indexOf(target)
  if (index >= 0) siblings.splice(index, 1)
  target.parent = null
}
const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => {
    target.text = text
  },
  setElementText: (target, text) => {
    target.text = text
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
  insertStaticContent: (content, parent, anchor) => {
    const target = node('#static', content.replace(/<[^>]*>/g, ''))
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
    return [target, target]
  },
})
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const textContent = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
async function mount(options = {}) {
  const calls = [],
    busyEvents = []
  const state = reactive({ kind: options.kind || 'product' })
  let insertedCount = 0
  const registryValue = {
    user: {
      authHeaders: () => ({}),
      requireLogin: () => {
        calls.push(['login'])
        return options.loggedIn !== false
      },
    },
    graph: {
      nodes: reactive(options.nodes || []),
      addNode: (kind) => {
        calls.push(['addNode', kind])
        return { id: `inserted-${++insertedCount}` }
      },
      updateNodeData: (...args) => calls.push(['updateNodeData', ...args]),
    },
    client: (kind) => ({
      list: async (request) => {
        calls.push(['list', kind, request])
        return options.list ? options.list(kind, request) : [asset(kind)]
      },
      save: async (record, request) => {
        calls.push(['save', kind, record, request])
        return options.save
          ? options.save(record, request)
          : { ...record, id: record.id || `${kind}-saved` }
      },
      remove: async (record, request) => {
        calls.push(['remove', kind, record, request])
        return options.remove ? options.remove(record, request) : { id: record.id }
      },
    }),
    upload: async (file, request) => {
      calls.push(['upload', file, request])
      return options.upload
        ? options.upload(file, request)
        : 'https://assets.example.com/upload.png'
    },
  }
  globalThis[Symbol.for(key)] = registryValue
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () => h(Component, { ...state, onBusyChange: (value) => busyEvents.push(value) }),
  })
  app.mount(root)
  await settle()
  const find = (predicate) => all(root, predicate)
  return {
    state,
    root,
    calls,
    busyEvents,
    find,
    carousel: () => registryValue.carousel,
    button: (label) =>
      find(
        (target) =>
          target.type === 'button' &&
          (target.props['aria-label'] === label || textContent(target).trim() === label),
      )[0],
    form: () => find((target) => target.type === 'form')[0],
    input: (label) =>
      find(
        (target) =>
          ['input', 'textarea'].includes(target.type) && target.props['aria-label'] === label,
      )[0],
    select: (label) =>
      find((target) => target.type === 'select' && target.props['aria-label'] === label)[0],
    checkbox: (label) => {
      const element = find(
        (target) => target.type === 'label' && textContent(target).trim() === label,
      )[0]
      return (
        element &&
        all(element, (target) => target.type === 'input' && target.props.type === 'checkbox')[0]
      )
    },
    async fill(label, value) {
      if (!this.input(label) && label.startsWith('搜索')) await this.click(label)
      assert.ok(this.input(label), `missing input ${label}`)
      this.input(label).props['onUpdate:modelValue'](value)
      await settle()
    },
    async click(label) {
      const button = this.button(label)
      assert.ok(button, `missing button ${label}`)
      const result = button.props.onClick?.({
        target: button,
        preventDefault() {},
        stopPropagation() {},
      })
      await settle()
      return result
    },
    async chooseCategory(label, checked = true) {
      const checkbox = this.checkbox(label)
      assert.ok(checkbox, `missing category checkbox ${label}`)
      if (checkbox.props.onChange) checkbox.props.onChange({ target: { checked } })
      else checkbox.props['onUpdate:modelValue']?.(checked)
      await settle()
    },
    async selectCategory(value) {
      const select = this.select('商品类目')
      assert.ok(select, 'missing product category select')
      if (select.props['onUpdate:modelValue']) select.props['onUpdate:modelValue'](value)
      else select.props.onChange({ target: { value } })
      await settle()
    },
    async submit() {
      const result = this.form().props.onSubmit({ preventDefault() {} })
      await settle()
      return result
    },
    async upload(file) {
      const input = this.input(`${state.kind === 'product' ? '上传商品' : '上传场景'}图片`)
      const target = { files: [file], value: 'selected-file' }
      const result = input.props.onChange({ target })
      await settle()
      return { result, target }
    },
    dispose() {
      app.unmount()
      if (globalThis[Symbol.for(key)] === registryValue) delete globalThis[Symbol.for(key)]
    },
  }
}

test('product and scene panels list only their own typed assets, search metadata and remain free of model controls', async () => {
  for (const kind of ['product', 'scene']) {
    const harness = await mount({
      kind,
      list: async () => [asset('product'), asset('scene'), { ...asset('model'), config: {} }],
    })
    try {
      const singular = kind === 'product' ? '商品' : '场景'
      assert.equal(
        harness.find((entry) => entry.type === 'section')[0].props['aria-label'],
        `我的${singular}库素材`,
      )
      assert.ok(harness.button(`选择${asset(kind).name}`))
      assert.equal(
        harness.button(`选择${asset(kind === 'product' ? 'scene' : 'product').name}`),
        undefined,
      )
      await harness.fill(`搜索${singular}`, '不存在')
      assert.match(textContent(harness.root), /没有找到匹配素材/)
      await harness.click('清空搜索')
      assert.ok(harness.button(`选择${asset(kind).name}`))
      assert.doesNotMatch(textContent(harness.root), /音色|捏脸|模特|角色/)
      assert.deepEqual(harness.busyEvents, [false])
    } finally {
      harness.dispose()
    }
  }
})

test('canvas import excludes unsafe media and saves metadata only after success, with retry preserving the draft', async () => {
  let attempts = 0
  const harness = await mount({
    nodes: [
      {
        id: 'safe',
        data: {
          kind: 'image',
          title: '床垫原图',
          assetUrl: 'https://assets.example.com/original.png',
        },
      },
      { id: 'unsafe', data: { kind: 'image', title: '危险地址', assetUrl: 'javascript:alert(1)' } },
      {
        id: 'credentials',
        data: {
          kind: 'image',
          title: '凭证地址',
          assetUrl: 'https://user:secret@example.com/image.png',
        },
      },
      {
        id: 'video',
        data: { kind: 'video', title: '视频', assetUrl: 'https://assets.example.com/v.mp4' },
      },
    ],
    save: async (record) => {
      attempts += 1
      if (attempts === 1) throw new Error('测试保存失败')
      return { ...record, id: 'new-product' }
    },
  })
  try {
    await harness.click('从当前画布导入')
    assert.ok(harness.button('使用床垫原图'))
    assert.equal(harness.button('使用危险地址'), undefined)
    assert.equal(harness.button('使用凭证地址'), undefined)
    assert.equal(harness.button('使用视频'), undefined)
    await harness.click('使用床垫原图')
    await harness.fill('商品名称', '绵绵岛原品')
    await harness.fill('商品描述', '真实商品外观')
    await harness.submit()
    assert.ok(harness.form())
    assert.match(textContent(harness.root), /测试保存失败/)
    await harness.submit()
    assert.equal(harness.form(), undefined)
    assert.ok(harness.button('选择绵绵岛原品'))
    const saved = harness.calls.filter(([name]) => name === 'save')[0][2]
    assert.equal(saved.imageUrl, 'https://assets.example.com/original.png')
    assert.equal(saved.config.libraryKind, 'product')
    assert.equal(saved.config.sourceNodeId, 'safe')
    assert.equal(
      saved.config.productCategory,
      '',
      'new unclassified imports store an explicit empty category',
    )
    assert.equal(
      harness.calls.some(([name]) => name === 'upload'),
      false,
    )
  } finally {
    harness.dispose()
  }
})

test('editing keeps existing metadata, insertion uses the original image and deletion requires explicit confirmation', async () => {
  const original = asset('product')
  const before = JSON.stringify(original)
  const harness = await mount({ list: async () => [original] })
  try {
    await harness.click('编辑')
    await harness.fill('商品名称', '修改后的床垫')
    await harness.submit()
    const saved = harness.calls.find(([name]) => name === 'save')[2]
    assert.equal(saved.id, original.id)
    assert.equal(saved.config.merchantNote, 'keep me')
    await harness.click('添加到画布')
    assert.deepEqual(
      harness.calls.filter(([name]) => name === 'addNode'),
      [['addNode', 'image']],
    )
    const update = harness.calls.find(([name]) => name === 'updateNodeData')
    assert.deepEqual(update, [
      'updateNodeData',
      'inserted-1',
      {
        title: '修改后的床垫',
        assetUrl: original.imageUrl,
        artifactStatus: 'ready',
        mediaOrigin: 'upload',
        libraryAsset: { kind: 'product', id: original.id, name: '修改后的床垫' },
      },
    ])
    assert.equal('generation' in update[2], false)
    assert.equal('characterStudio' in update[2], false)
    await harness.click('删除')
    assert.equal(
      harness.calls.some(([name]) => name === 'remove'),
      false,
    )
    assert.equal(harness.find((entry) => entry.props.role === 'alertdialog').length, 1)
    await harness.click('确认删除')
    assert.equal(harness.calls.find(([name]) => name === 'remove')[2].config.libraryKind, 'product')
    assert.equal(harness.button('选择修改后的床垫'), undefined)
    assert.match(textContent(harness.root), /画布上的图片不受影响/)
    assert.equal(JSON.stringify(original), before)
  } finally {
    harness.dispose()
  }
})

test('uploads reject SVG and oversized files, require login, report progress and clear the file input', async () => {
  const pending = deferred()
  let uploadOptions
  const harness = await mount({
    upload: (file, options) => {
      uploadOptions = options
      return pending.promise
    },
  })
  try {
    await harness.click('从本地上传')
    for (const file of [
      { name: 'x.svg', type: 'image/svg+xml', size: 100 },
      { name: 'x.jpg', type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 },
    ]) {
      const { target } = await harness.upload(file)
      assert.equal(target.value, '')
      assert.equal(
        harness.calls.some(([name]) => name === 'upload'),
        false,
      )
    }
    const task = harness.upload({ name: '床垫.png', type: 'image/png', size: 100 })
    await settle()
    uploadOptions.onProgress({ percent: 37 })
    await settle()
    assert.match(textContent(harness.root), /上传中 37%/)
    assert.equal(harness.button('保存到我的商品库').props.disabled, true)
    pending.resolve('https://assets.example.com/uploaded.png')
    const { target } = await task
    await settle()
    assert.equal(target.value, '')
    assert.equal(harness.input('商品名称').value, '床垫')
    assert.equal(
      harness.find((entry) => entry.props.alt === '商品原图预览')[0].props.src,
      'https://assets.example.com/uploaded.png',
    )
    assert.deepEqual(harness.busyEvents, [false, true, false])
  } finally {
    harness.dispose()
  }
})

test('unauthenticated mutations do not upload, save or remove private assets', async () => {
  const harness = await mount({ loggedIn: false })
  try {
    await harness.click('编辑')
    await harness.upload({ name: 'x.png', type: 'image/png', size: 100 })
    await harness.submit()
    await harness.click('关闭商品表单')
    await harness.click('删除')
    await harness.click('确认删除')
    assert.equal(
      harness.calls.some(([name]) => ['save', 'upload', 'remove'].includes(name)),
      false,
    )
    assert.equal(harness.calls.filter(([name]) => name === 'login').length, 3)
  } finally {
    harness.dispose()
  }
})

test('cancelled uploads cannot later replace the draft, and Escape closes only the current child layer', async () => {
  const pending = deferred()
  let uploadOptions
  const harness = await mount({
    upload: (file, options) => {
      uploadOptions = options
      return pending.promise
    },
  })
  try {
    await harness.click('编辑')
    const task = harness.upload({ name: 'replacement.png', type: 'image/png', size: 100 })
    await settle()
    const root = harness.find((entry) => entry.props['aria-label'] === '我的商品库素材')[0]
    let stopped = 0
    root.props.onKeydown({
      key: 'Escape',
      stopPropagation: () => {
        stopped += 1
      },
      preventDefault() {},
    })
    assert.ok(harness.form(), 'Escape must not close a busy operation')
    await harness.click('取消上传')
    assert.equal(uploadOptions.signal.aborted, true)
    pending.resolve('https://assets.example.com/stale.png')
    await task
    await settle()
    assert.equal(
      harness.find((entry) => entry.props.alt === '商品原图预览')[0].props.src,
      asset().imageUrl,
    )
    root.props.onKeydown({
      key: 'Escape',
      stopPropagation: () => {
        stopped += 1
      },
      preventDefault() {},
    })
    await settle()
    assert.equal(harness.form(), undefined)
    assert.equal(stopped, 2)
  } finally {
    harness.dispose()
  }
})

test('stale list responses from a different kind are ignored and failed reads can retry', async () => {
  const pending = deferred()
  let productSignal,
    sceneAttempts = 0
  const harness = await mount({
    list: async (kind, options) => {
      if (kind === 'product') {
        productSignal = options.signal
        return pending.promise
      }
      sceneAttempts += 1
      if (sceneAttempts === 1) throw new Error('场景读取失败')
      return [asset('scene')]
    },
  })
  try {
    harness.state.kind = 'scene'
    await settle()
    assert.equal(productSignal.aborted, true)
    assert.match(textContent(harness.root), /场景读取失败/)
    await harness.click('重试')
    assert.ok(harness.button('选择暖白卧室'))
    pending.resolve([asset('product')])
    await settle()
    assert.equal(harness.button('选择绵绵岛床垫'), undefined)
    assert.ok(harness.button('选择暖白卧室'))
  } finally {
    harness.dispose()
  }
})

test('kind changes and unmount abort pending mutations and prevent late saved data crossing libraries', async () => {
  const pending = deferred()
  let saveOptions
  const harness = await mount({
    save: (record, options) => {
      saveOptions = options
      return pending.promise
    },
  })
  try {
    await harness.click('编辑')
    const task = harness.submit()
    await settle()
    harness.state.kind = 'scene'
    await settle()
    assert.equal(saveOptions.signal.aborted, true)
    pending.resolve({ ...asset('product'), name: '迟到保存结果' })
    await task
    await settle()
    assert.ok(harness.button('选择暖白卧室'))
    assert.equal(harness.button('选择迟到保存结果'), undefined)
    assert.equal(harness.form(), undefined)
  } finally {
    harness.dispose()
  }
  assert.equal(harness.busyEvents.at(-1), false)
})

test('legacy empty metadata and cover-only originals remain editable and insertable with API-aligned input limits', async () => {
  const harness = await mount({
    list: async () => [asset('product', { imageUrl: '', description: null })],
  })
  try {
    await harness.click('添加到画布')
    assert.equal(
      harness.calls.find(([name]) => name === 'updateNodeData')[2].assetUrl,
      asset().coverUrl,
    )
    await harness.click('编辑')
    assert.equal(harness.input('商品名称').props.maxlength, '80')
    assert.equal(harness.input('商品描述').props.maxlength, '4000')
    await harness.submit()
    assert.equal(harness.calls.find(([name]) => name === 'save')[2].description, '')
    assert.equal(harness.form(), undefined)
  } finally {
    harness.dispose()
  }
})

test('child dialogs focus their local controls and restore the opener on close', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const opener = {
    isConnected: true,
    calls: 0,
    focus() {
      this.calls += 1
    },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { activeElement: opener },
  })
  const harness = await mount()
  try {
    await harness.click('编辑')
    assert.equal(harness.form().props.role, 'dialog')
    assert.equal(harness.form().props['aria-modal'], 'true')
    assert.equal(harness.input('商品名称').focusCalls, 1)
    assert.equal(
      harness.find((entry) => String(entry.props.class).includes('cv3-character-inner-scrim'))
        .length,
      1,
    )
    await harness.click('关闭商品表单')
    assert.equal(opener.calls, 1)
    await harness.click('删除')
    assert.equal(harness.button('取消').focusCalls, 1)
    await harness.click('取消')
    assert.equal(opener.calls, 2)
  } finally {
    harness.dispose()
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    else delete globalThis.document
  }
})

test('unmount aborts an in-flight upload, clears parent busy state and ignores a late result', async () => {
  const pending = deferred()
  let uploadOptions
  const harness = await mount({
    upload: (file, options) => {
      uploadOptions = options
      return pending.promise
    },
  })
  await harness.click('编辑')
  const task = harness.upload({ name: 'replacement.png', type: 'image/png', size: 100 })
  await settle()
  harness.dispose()
  assert.equal(uploadOptions.signal.aborted, true)
  assert.equal(harness.busyEvents.at(-1), false)
  pending.resolve('https://assets.example.com/late-upload.png')
  const { target } = await task
  await settle()
  assert.equal(target.value, '')
  assert.equal(
    harness.calls.some(([name]) => name === 'save'),
    false,
  )
  assert.equal(
    harness.calls.some(([name]) => name === 'updateNodeData'),
    false,
  )
})

const categorizedAsset = (id, category, name, description = '家居商品') =>
  asset('product', {
    id,
    name,
    description,
    config: {
      libraryKind: 'product',
      merchantNote: 'keep me',
      ...(category ? { productCategory: category } : {}),
    },
  })
const categoryFixtures = () => [
  categorizedAsset('curtain', '窗帘', '遮光窗帘'),
  categorizedAsset('mattress', '床垫', '绵绵岛床垫'),
  categorizedAsset('wood', '实木床', '橡木实木床'),
  categorizedAsset('child', '儿童床', '儿童床'),
  categorizedAsset('bedding', '床品', '纯棉四件套'),
  categorizedAsset('other', '其他', '其他家居商品'),
  categorizedAsset('legacy', '', '床垫与窗帘旧商品', '文字里有实木床，但没有录入类目'),
]

test('product category filter presents native checkbox choices in canonical order and combines OR categories with AND search', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    assert.ok(harness.button('类目筛选'))
    const toolbar = harness.find((entry) =>
      String(entry.props.class).split(' ').includes('cv3-personal-toolbar'),
    )[0]
    const toolbarElements = all(toolbar, () => true)
    const categoryIndex = toolbarElements.findIndex((entry) =>
      String(entry.props.class).includes('cv3-personal-category-filter'),
    )
    const searchIndex = toolbarElements.findIndex(
      (entry) => entry.type === 'button' && entry.props['aria-label'] === '搜索商品',
    )
    assert.ok(
      categoryIndex >= 0 && categoryIndex < searchIndex,
      'category filter belongs to the left of the search field',
    )
    await harness.click('类目筛选')
    const group = harness.find(
      (entry) => entry.props.role === 'group' && entry.props['aria-label'] === '类目选项',
    )[0]
    assert.ok(group)
    assert.deepEqual(
      all(group, (entry) => entry.type === 'label').map((entry) => textContent(entry).trim()),
      ['窗帘', '床垫', '实木床', '儿童床', '床品', '其他', '未分类'],
    )
    assert.equal(
      all(group, (entry) => entry.type === 'input' && entry.props.type === 'checkbox').length,
      7,
    )
    await harness.chooseCategory('实木床')
    await harness.chooseCategory('床垫')
    assert.equal(harness.checkbox('实木床').props.checked, true)
    assert.equal(harness.checkbox('床垫').props.checked, true)
    assert.ok(harness.button('类目筛选，已选：床垫、实木床'))
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.ok(harness.button('选择橡木实木床'))
    assert.equal(harness.button('选择遮光窗帘'), undefined)
    assert.equal(harness.button('选择床垫与窗帘旧商品'), undefined)
    await harness.fill('搜索商品', '绵绵岛')
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.equal(harness.button('选择橡木实木床'), undefined)
    await harness.click('清除类目筛选')
    assert.ok(harness.button('类目筛选'))
    assert.equal(harness.input('搜索商品').value, '绵绵岛')
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.equal(harness.button('选择遮光窗帘'), undefined)
  } finally {
    harness.dispose()
  }
})

test('unclassified means missing explicit category, never a category guessed from name or description', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('类目筛选')
    await harness.chooseCategory('未分类')
    assert.ok(harness.button('选择床垫与窗帘旧商品'))
    assert.equal(harness.button('选择绵绵岛床垫'), undefined)
    assert.equal(harness.button('选择橡木实木床'), undefined)
    assert.equal(harness.button('选择其他家居商品'), undefined)
    await harness.click('清除类目筛选')
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.equal(harness.button('选择床垫与窗帘旧商品'), undefined)
  } finally {
    harness.dispose()
  }
})

test('filtering a selected product out prevents hidden insert, edit and delete actions', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('选择遮光窗帘')
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.equal(harness.button('选择遮光窗帘'), undefined)
    for (const label of ['添加到画布', '编辑', '删除'])
      assert.equal(harness.button(label).props.disabled, true, label)
    await harness.click('添加到画布')
    await harness.click('编辑')
    await harness.click('删除')
    assert.equal(
      harness.calls.some(([name]) => ['addNode', 'updateNodeData', 'remove'].includes(name)),
      false,
    )
    assert.equal(harness.form(), undefined)
    assert.equal(harness.find((entry) => entry.props.role === 'alertdialog').length, 0)
    await harness.click('选择绵绵岛床垫')
    assert.equal(harness.button('添加到画布').props.disabled, false)
    await harness.click('添加到画布')
    assert.equal(
      harness.calls.find(([name]) => name === 'updateNodeData')[2].libraryAsset.id,
      'mattress',
    )
  } finally {
    harness.dispose()
  }
})

test('editing saves one product category while preserving metadata and resetting filters so the saved item remains visible', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    await harness.fill('搜索商品', '绵绵岛')
    await harness.click('选择绵绵岛床垫')
    await harness.click('编辑')
    const select = harness.select('商品类目')
    assert.ok(select)
    assert.equal(select.value, '床垫')
    assert.deepEqual(
      select.options.map((option) => [option.props.value ?? '', textContent(option).trim()]),
      [
        ['', '未分类'],
        ['窗帘', '窗帘'],
        ['床垫', '床垫'],
        ['实木床', '实木床'],
        ['儿童床', '儿童床'],
        ['床品', '床品'],
        ['其他', '其他'],
      ],
    )
    await harness.selectCategory('儿童床')
    await harness.fill('商品名称', '儿童床新名称')
    await harness.submit()
    const saved = harness.calls.find(([name]) => name === 'save')[2]
    assert.equal(saved.config.productCategory, '儿童床')
    assert.equal(saved.config.merchantNote, 'keep me')
    assert.equal(saved.config.libraryKind, 'product')
    assert.equal(saved.id, 'mattress')
    assert.equal(harness.form(), undefined)
    assert.ok(harness.button('类目筛选'))
    assert.equal(harness.input('搜索商品')?.value || '', '')
    assert.ok(harness.button('选择儿童床新名称'))
    assert.equal(harness.button('添加到画布').props.disabled, false)
  } finally {
    harness.dispose()
  }
})

test('category menu Escape takes priority, restores trigger focus and outside pointers dismiss only the menu', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    const trigger = harness.button('类目筛选')
    const panel = harness.find((entry) => entry.props['aria-label'] === '我的商品库素材')[0]
    await harness.click('类目筛选')
    let stopped = 0,
      prevented = 0
    panel.props.onKeydown({
      key: 'Escape',
      stopPropagation: () => {
        stopped += 1
      },
      preventDefault: () => {
        prevented += 1
      },
    })
    await settle()
    assert.equal(harness.checkbox('床垫'), undefined)
    assert.equal(stopped, 1)
    assert.equal(prevented, 1)
    assert.equal(trigger.focusCalls, 1)
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    panel.props.onPointerdown({ target: { closest: () => ({}) } })
    await settle()
    assert.ok(
      harness.checkbox('床垫'),
      'pointer activity within the category controls keeps the menu open',
    )
    panel.props.onPointerdown({ target: { closest: () => null } })
    await settle()
    assert.equal(harness.checkbox('床垫'), undefined)
    assert.ok(harness.button('类目筛选，已选：床垫'))
    assert.ok(harness.button('选择绵绵岛床垫'))
  } finally {
    harness.dispose()
  }
})

test('scene panels never expose product categories and changing kind clears category selection and menus', async () => {
  const harness = await mount({
    list: async (kind) => (kind === 'product' ? categoryFixtures() : [asset('scene')]),
  })
  try {
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    harness.state.kind = 'scene'
    await settle()
    assert.equal(harness.button('类目筛选'), undefined)
    assert.equal(harness.button('类目筛选，已选：床垫'), undefined)
    assert.equal(harness.find((entry) => entry.props['aria-label'] === '类目选项').length, 0)
    await harness.click('编辑')
    assert.equal(harness.select('商品类目'), undefined)
    await harness.click('关闭场景表单')
    harness.state.kind = 'product'
    await settle()
    assert.ok(harness.button('类目筛选'))
    assert.ok(harness.button('选择遮光窗帘'))
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.equal(harness.checkbox('床垫'), undefined)
  } finally {
    harness.dispose()
  }
})

test('refresh uses current category metadata rather than retaining an obsolete filtered match', async () => {
  let rows = [categorizedAsset('moving', '床垫', '待更新商品')]
  const harness = await mount({ list: async () => rows })
  try {
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.ok(harness.button('选择待更新商品'))
    rows = [categorizedAsset('moving', '窗帘', '待更新商品')]
    await harness.click('刷新商品库')
    assert.equal(harness.button('选择待更新商品'), undefined)
    assert.equal(harness.button('添加到画布').props.disabled, true)
    await harness.click('清除类目筛选')
    assert.ok(harness.button('选择待更新商品'))
  } finally {
    harness.dispose()
  }
})

test('editing an untouched legacy category preserves it, while explicit unclassification clears only that metadata field', async () => {
  const original = categorizedAsset('legacy-custom', '原有自定义分类', '旧商品')
  const harness = await mount({ list: async () => [original] })
  try {
    await harness.click('编辑')
    assert.equal(harness.select('商品类目').value, '')
    await harness.fill('商品名称', '只改名字')
    await harness.submit()
    assert.equal(
      harness.calls.filter(([name]) => name === 'save')[0][2].config.productCategory,
      '原有自定义分类',
    )
    await harness.click('编辑')
    await harness.selectCategory('')
    await harness.submit()
    const explicitSave = harness.calls.filter(([name]) => name === 'save')[1][2]
    assert.equal(explicitSave.config.productCategory, '')
    assert.equal(explicitSave.config.libraryKind, 'product')
    assert.equal(explicitSave.config.merchantNote, 'keep me')
    assert.equal(original.config.productCategory, '原有自定义分类')
  } finally {
    harness.dispose()
  }
})

test('the compact toolbar exposes accessible controls without count or refresh and expands search on demand', async () => {
  for (const kind of ['product', 'scene']) {
    const singular = kind === 'product' ? '商品' : '场景'
    const harness = await mount({ kind })
    try {
      const toolbar = harness.find((entry) => entry.props.role === 'toolbar')[0]
      assert.ok(toolbar)
      assert.equal(toolbar.props['aria-label'], `${singular}素材工具栏`)
      assert.deepEqual(
        toolbar.children.filter((entry) => entry.type === 'div').map((entry) => entry.props.class),
        ['cv3-personal-toolbar-filters', 'cv3-personal-toolbar-views'],
      )
      assert.doesNotMatch(textContent(toolbar), /项素材|刷新/)
      assert.equal(
        all(toolbar, (entry) => String(entry.props['aria-label']).startsWith('刷新')).length,
        0,
      )
      assert.ok(harness.button(`刷新${singular}库`))
      assert.equal(harness.input(`搜索${singular}`), undefined)
      assert.ok(harness.button(`搜索${singular}`))
      assert.equal(harness.button('多选').props['aria-pressed'], false)
      assert.equal(harness.button('宫格模式').props['aria-pressed'], true)
      assert.equal(harness.button('列表模式').props['aria-pressed'], false)
      await harness.click(`搜索${singular}`)
      const input = harness.input(`搜索${singular}`)
      assert.ok(input)
      assert.equal(input.focusCalls, 1)
      assert.equal(harness.button(`搜索${singular}`), undefined)
      input.props.onBlur({ target: input })
      await settle()
      assert.equal(harness.input(`搜索${singular}`), undefined)
      assert.ok(harness.button(`搜索${singular}`))
    } finally {
      harness.dispose()
    }
  }
})

test('expanded search retains nonempty queries on blur, clears locally and consumes Escape without closing the library', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.fill('搜索商品', '绵绵岛')
    let input = harness.input('搜索商品')
    input.props.onBlur({ target: input })
    await settle()
    assert.equal(harness.input('搜索商品').value, '绵绵岛')
    assert.ok(harness.button('清除商品搜索'))
    const escape = async () => {
      let stopped = 0,
        prevented = 0
      input = harness.input('搜索商品')
      const handler =
        input.props.onKeydown ||
        harness.find((entry) => entry.props['aria-label'] === '我的商品库素材')[0].props.onKeydown
      handler({
        key: 'Escape',
        target: input,
        stopPropagation: () => {
          stopped += 1
        },
        preventDefault: () => {
          prevented += 1
        },
      })
      await settle()
      assert.equal(stopped, 1)
      assert.equal(prevented, 1)
    }
    await escape()
    assert.equal(harness.input('搜索商品').value, '')
    assert.equal(harness.button('清除商品搜索'), undefined)
    assert.ok(harness.button('选择遮光窗帘'))
    await escape()
    assert.equal(harness.input('搜索商品'), undefined)
    assert.ok(harness.button('搜索商品'))
    assert.equal(harness.button('搜索商品').focusCalls, 1)
    await harness.fill('搜索商品', '床垫')
    await harness.click('清除商品搜索')
    assert.equal(harness.input('搜索商品').value, '')
    assert.ok(harness.button('选择遮光窗帘'))
  } finally {
    harness.dispose()
  }
})

test('view switching wires only filtered assets and current selection into the dedicated carousel', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    assert.equal(harness.carousel(), undefined)
    await harness.click('列表模式')
    assert.equal(harness.button('列表模式').props['aria-pressed'], true)
    assert.equal(harness.button('宫格模式').props['aria-pressed'], false)
    let carousel = harness.carousel()
    assert.ok(carousel)
    assert.deepEqual(
      carousel.props.items.map((item) => item.id),
      categoryFixtures().map((item) => item.id),
    )
    assert.equal(carousel.props.activeId, 'curtain')
    assert.equal(carousel.props.multiSelect, false)
    assert.equal(carousel.props.disabled, false)
    assert.equal(carousel.props.kind, 'product')
    carousel.emit('activate', 'mattress')
    await settle()
    assert.equal(carousel.props.activeId, 'mattress')
    await harness.click('多选')
    assert.equal(harness.carousel(), null)
    assert.equal(harness.button('宫格模式').props['aria-pressed'], true)
    assert.equal(harness.button('退出多选').props['aria-pressed'], true)
    assert.equal(harness.button('选择绵绵岛床垫').props['aria-pressed'], true)
    await harness.click('列表模式')
    carousel = harness.carousel()
    assert.equal(carousel.props.multiSelect, true)
    assert.deepEqual(carousel.props.selectedIds, ['mattress'])
    carousel.emit('activate', 'wood')
    await settle()
    assert.equal(carousel.props.activeId, 'wood')
    assert.deepEqual(
      carousel.props.selectedIds,
      ['mattress'],
      'navigation must not change multi-selection',
    )
    carousel.emit('select', 'wood')
    await settle()
    assert.deepEqual(carousel.props.selectedIds, ['mattress', 'wood'])
    await harness.fill('搜索商品', '绵绵岛')
    carousel = harness.carousel()
    assert.deepEqual(
      carousel.props.items.map((item) => item.id),
      ['mattress'],
    )
    assert.deepEqual(carousel.props.selectedIds, ['mattress'])
    carousel.emit('activate', 'mattress')
    await settle()
    carousel.emit('activate', 'curtain')
    carousel.emit('select', 'curtain')
    carousel.emit('select', 'not-a-visible-id')
    await settle()
    assert.equal(carousel.props.activeId, 'mattress')
    assert.deepEqual(
      carousel.props.selectedIds,
      ['mattress'],
      'hidden or stale carousel events cannot select filtered-out assets',
    )
    await harness.click('退出多选')
    assert.equal(
      harness.button('列表模式').props['aria-pressed'],
      true,
      'exit restores the mode used before multi-selection',
    )
    carousel = harness.carousel()
    assert.equal(carousel.props.multiSelect, false)
    assert.deepEqual(carousel.props.selectedIds, [])
    await harness.click('宫格模式')
    assert.equal(harness.carousel(), null)
    assert.ok(harness.button('选择绵绵岛床垫'))
    assert.equal(harness.button('选择绵绵岛床垫').props['aria-pressed'], true)
  } finally {
    harness.dispose()
  }
})

test('multi-select inserts real original images in one explicit bulk action and never enables metadata mutation', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    assert.doesNotMatch(textContent(harness.root), /已选\s*\d+\s*项/)
    await harness.click('多选')
    assert.equal(harness.button('退出多选').props['aria-pressed'], true)
    assert.match(textContent(harness.root), /已选\s*1\s*项/)
    assert.equal(harness.button('选择遮光窗帘').props['aria-pressed'], true)
    await harness.click('选择遮光窗帘')
    assert.equal(harness.button('添加到画布').props.disabled, true)
    await harness.click('选择绵绵岛床垫')
    await harness.click('选择橡木实木床')
    assert.match(textContent(harness.root), /已选\s*2\s*项/)
    assert.equal(harness.button('选择绵绵岛床垫').props['aria-pressed'], true)
    assert.equal(harness.button('选择橡木实木床').props['aria-pressed'], true)
    assert.equal(harness.button('编辑').props.disabled, true)
    assert.equal(harness.button('删除').props.disabled, true)
    await harness.click('编辑')
    await harness.click('删除')
    assert.equal(harness.form(), undefined)
    assert.equal(harness.find((entry) => entry.props.role === 'alertdialog').length, 0)
    await harness.click('添加到画布')
    const insertions = harness.calls.filter(([name]) => name === 'updateNodeData')
    assert.deepEqual(
      insertions.map((entry) => entry[2].libraryAsset.id),
      ['mattress', 'wood'],
    )
    assert.equal(new Set(insertions.map((entry) => entry[1])).size, 2)
    for (const [, , data] of insertions) {
      assert.equal(data.assetUrl, asset().imageUrl)
      assert.equal(data.mediaOrigin, 'upload')
      assert.equal(data.libraryAsset.kind, 'product')
      assert.equal('generation' in data, false)
      assert.equal('characterStudio' in data, false)
    }
    assert.equal(
      harness.calls.some(([name]) => ['save', 'remove', 'upload'].includes(name)),
      false,
    )
    await harness.click('退出多选')
    assert.equal(harness.button('多选').props['aria-pressed'], false)
    assert.doesNotMatch(textContent(harness.root), /已选\s*\d+\s*项/)
    await harness.click('多选')
    assert.match(textContent(harness.root), /已选\s*1\s*项/)
    assert.equal(harness.button('选择橡木实木床').props['aria-pressed'], true)
    assert.equal(harness.button('选择绵绵岛床垫').props['aria-pressed'], false)
  } finally {
    harness.dispose()
  }
})

test('multi-selections are pruned by filters and cannot reappear as hidden bulk insert targets', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('多选')
    await harness.click('选择绵绵岛床垫')
    assert.match(textContent(harness.root), /已选\s*2\s*项/)
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.match(textContent(harness.root), /已选\s*1\s*项/)
    await harness.click('添加到画布')
    assert.deepEqual(
      harness.calls
        .filter(([name]) => name === 'updateNodeData')
        .map((entry) => entry[2].libraryAsset.id),
      ['mattress'],
    )
    await harness.click('清除类目筛选')
    assert.equal(harness.button('选择遮光窗帘').props['aria-pressed'], false)
    await harness.fill('搜索商品', '没有这个商品')
    assert.match(textContent(harness.root), /已选\s*0\s*项/)
    assert.equal(harness.button('添加到画布').props.disabled, true)
    await harness.click('清空搜索')
    assert.equal(harness.button('选择绵绵岛床垫').props['aria-pressed'], false)
  } finally {
    harness.dispose()
  }
})

test('switching kind resets toolbar state and busy mutations reject direct toolbar actions', async () => {
  const pending = deferred()
  const harness = await mount({
    list: async (kind) => (kind === 'product' ? categoryFixtures() : [asset('scene')]),
    upload: () => pending.promise,
  })
  try {
    await harness.click('多选')
    await harness.click('选择绵绵岛床垫')
    await harness.click('列表模式')
    await harness.fill('搜索商品', '绵绵岛')
    harness.state.kind = 'scene'
    await settle()
    assert.equal(harness.button('多选').props['aria-pressed'], false)
    assert.equal(harness.button('宫格模式').props['aria-pressed'], true)
    assert.equal(harness.input('搜索场景'), undefined)
    assert.ok(harness.button('搜索场景'))
    assert.equal(harness.carousel(), null)
    await harness.click('编辑')
    const task = harness.upload({ name: 'scene.png', type: 'image/png', size: 100 })
    await settle()
    for (const label of ['多选', '列表模式', '宫格模式', '搜索场景', '刷新场景库'])
      assert.equal(harness.button(label).props.disabled, true, label)
    await harness.click('多选')
    await harness.click('列表模式')
    await harness.click('搜索场景')
    await harness.click('刷新场景库')
    assert.equal(harness.button('多选').props['aria-pressed'], false)
    assert.equal(harness.button('宫格模式').props['aria-pressed'], true)
    assert.equal(harness.input('搜索场景'), undefined)
    assert.equal(harness.carousel(), null)
    assert.equal(
      harness.calls.filter(([name, kind]) => name === 'list' && kind === 'scene').length,
      1,
    )
    await harness.click('取消上传')
    pending.resolve('https://assets.example.com/scene-upload.png')
    await task
  } finally {
    pending.resolve('https://assets.example.com/late.png')
    harness.dispose()
  }
})

test('carousel filtering keeps its visible fallback and single-item actions synchronized', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('选择遮光窗帘')
    await harness.click('列表模式')
    assert.equal(harness.carousel().props.activeId, 'curtain')
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.deepEqual(
      harness.carousel().props.items.map((item) => item.id),
      ['mattress'],
    )
    assert.equal(harness.carousel().props.activeId, 'mattress')
    assert.equal(harness.button('编辑').props.disabled, false)
    assert.equal(harness.button('添加到画布').props.disabled, false)
    await harness.click('添加到画布')
    assert.equal(
      harness.calls.find(([name]) => name === 'updateNodeData')[2].libraryAsset.id,
      'mattress',
    )
  } finally {
    harness.dispose()
  }
})

test('carousel fallback does not implicitly select the replacement item in multi-select mode', async () => {
  const harness = await mount({ list: async () => categoryFixtures() })
  try {
    await harness.click('多选')
    await harness.click('列表模式')
    assert.deepEqual(harness.carousel().props.selectedIds, ['curtain'])
    await harness.click('类目筛选')
    await harness.chooseCategory('床垫')
    assert.equal(harness.carousel().props.activeId, 'mattress')
    assert.deepEqual(harness.carousel().props.selectedIds, [])
    assert.match(textContent(harness.root), /已选\s*0\s*项/)
    for (const label of ['编辑', '删除', '添加到画布'])
      assert.equal(harness.button(label).props.disabled, true, label)
    await harness.click('添加到画布')
    assert.equal(
      harness.calls.some(([name]) => name === 'addNode'),
      false,
    )
    harness.carousel().emit('select', 'mattress')
    await settle()
    assert.deepEqual(harness.carousel().props.selectedIds, ['mattress'])
    assert.equal(harness.button('添加到画布').props.disabled, false)
  } finally {
    harness.dispose()
  }
})

test('compact toolbar keeps the measured row, group gaps, circular search and segmented view dimensions', () => {
  const styles = descriptor.styles.map((style) => style.content).join('\n')
  const cssRule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rule = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1]
    assert.ok(rule, `missing CSS rule ${selector}`)
    return rule
  }
  const toolbar = cssRule('.cv3-personal-toolbar')
  assert.match(toolbar, /height:\s*32px\s*;/)
  assert.match(toolbar, /margin:\s*16px 0 17px\s*;/)
  assert.match(toolbar, /padding:\s*0 20px\s*;/)
  assert.match(cssRule('.cv3-personal-toolbar-filters'), /gap:\s*6px\s*;/)
  assert.match(cssRule('.cv3-personal-toolbar-views'), /gap:\s*4px\s*;/)
  const roundIcon = cssRule('.cv3-personal-library .cv3-personal-toolbar-icon')
  assert.match(roundIcon, /width:\s*32px\s*;/)
  assert.match(roundIcon, /height:\s*32px\s*;/)
  assert.match(roundIcon, /border-radius:\s*9999px\s*;/)
  assert.match(cssRule('.cv3-personal-view-segment'), /height:\s*32px\s*;/)
  const segmentButton = cssRule('.cv3-personal-library .cv3-personal-view-segment > button')
  assert.match(segmentButton, /width:\s*26px\s*;/)
  assert.match(segmentButton, /height:\s*26px\s*;/)
  const expandedSearch = cssRule('.cv3-personal-search')
  assert.match(expandedSearch, /height:\s*32px\s*;/)
  assert.match(expandedSearch, /border-radius:\s*9999px\s*;/)
})
