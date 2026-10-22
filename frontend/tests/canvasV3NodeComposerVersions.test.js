import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { wanxiangParams } from '../src/features/canvas-v3/config/wanxiangParameters.js'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/NodeComposer.vue',
  import.meta.url,
)
const componentPromise = (async () => {
  // Vite resolves extensionless imports in this existing config module. Preserve
  // the real config while giving Node's ESM loader the equivalent explicit URLs.
  const controlsUrl = new URL('../config/nodeControls.js', componentUrl)
  const controlsSource = (await readFile(controlsUrl, 'utf8')).replace(
    /from (["'])(\.[^"']+)\1/g,
    (_match, _quote, path) =>
      `from '${new URL(path.endsWith('.js') ? path : `${path}.js`, controlsUrl).href}'`,
  )
  const controlsModule = `data:text/javascript;base64,${Buffer.from(controlsSource).toString('base64')}`
  const { descriptor } = parse(await readFile(componentUrl, 'utf8'))
  const compiled = compileScript(descriptor, {
    id: 'node-composer-versions',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } },
  })
  const source = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(/from ['"]\.\.\/config\/nodeControls['"]/g, `from '${controlsModule}'`)
    .replace(
      /import \{ useCanvasV3GraphStore \} from ['"][^'"]*\/stores\/graph['"]/,
      'const useCanvasV3GraphStore = () => globalThis.__cv3ComposerVersionHarness.graph',
    )
    .replace(
      /import \{ useCanvasV3TaskStore \} from ['"][^'"]*\/stores\/tasks['"]/,
      'const useCanvasV3TaskStore = () => globalThis.__cv3ComposerVersionHarness.tasks',
    )
    .replace(
      /import \{ useUserStore \} from ['"][^'"]*\/stores\/user['"]/,
      'const useUserStore = () => globalThis.__cv3ComposerVersionHarness.user',
    )
    .replace(
      /import \{ apiPath \} from ['"][^'"]*\/utils\/apiBase['"]/,
      'const apiPath = (path) => path',
    )
    .replace(/import (\w+) from ['"]\.\/[^'"]+\.vue['"]/g, (_match, name) => {
      if (name === 'CanvasIcon')
        return `const CanvasIcon = { name: 'CanvasIconTestStub', props: ['name', 'size'], setup: (props) => () => globalThis.__cv3ComposerVersionHarness.renderIcon(props) }`
      return `const ${name} = { name: '${name}TestStub', setup: () => () => null }`
    })
    .replace(/from (["'])(\.\.[^"']+)\1/g, (_match, _quote, path) => {
      return `from '${new URL(path.endsWith('.js') ? path : `${path}.js`, componentUrl).href}'`
    })
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .default
})()

let teleportRoot

function node(type, text = '') {
  return markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    style: {},
    scrollHeight: 500,
    focus() {
      globalThis.document.activeElement = this
    },
    getAttribute(name) {
      return this.props[name] == null ? null : String(this.props[name])
    },
    contains(target) {
      return findAll(this, (candidate) => candidate === target).length > 0
    },
    querySelectorAll(selector) {
      if (selector === '[role="menuitemradio"]:not(:disabled)')
        return findAll(
          this,
          (candidate) => candidate.props.role === 'menuitemradio' && !candidate.props.disabled,
        )
      return []
    },
    getBoundingClientRect() {
      return { left: 320, right: 660, top: 560, bottom: 592, width: 340, height: 32 }
    },
  })
}

function detach(child) {
  if (!child.parent) return
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
}

const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => (target.text = text),
  setElementText: (target, text) => {
    target.text = text
    target.children = []
  },
  patchProp: (target, key, _previous, value) => (target.props[key] = value),
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (child, parent, anchor = null) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach,
  querySelector: () => teleportRoot,
})

function findAll(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => findAll(child, predicate)),
  ]
}

function textContent(target) {
  return `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
}

function hasClass(target, className) {
  return String(target.props.class || '')
    .split(/\s+/)
    .includes(className)
}

async function flush() {
  await nextTick()
  await nextTick()
}

async function mountComposer(
  t,
  {
    kind = 'image',
    model = 'tt-image-2.5',
    params = {},
    mode = '',
    models = [],
    videoModels = [],
    observeComposer = false,
    pricingUser = {},
    pricingFetch,
  } = {},
) {
  const original = new Map()
  const windowListeners = new Map()
  const documentListeners = new Map()
  const observers = []
  for (const [key, value] of Object.entries({
    window: {
      innerWidth: 1228,
      innerHeight: 892,
      addEventListener(name, listener) {
        windowListeners.set(name, listener)
      },
      removeEventListener(name, listener) {
        if (windowListeners.get(name) === listener) windowListeners.delete(name)
      },
    },
    document: {
      activeElement: null,
      addEventListener(name, listener) {
        documentListeners.set(name, listener)
      },
      removeEventListener(name, listener) {
        if (documentListeners.get(name) === listener) documentListeners.delete(name)
      },
    },
    ...(observeComposer
      ? {
          ResizeObserver: class {
            constructor(callback) {
              this.callback = callback
              observers.push(this)
            }
            observe(target) {
              this.target = target
            }
            disconnect() {
              this.disconnected = true
            }
          },
        }
      : {}),
    ...(pricingFetch ? { fetch: pricingFetch } : {}),
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  }
  const currentNode = reactive({
    id: 'image-1',
    data: { kind, model, params, prompt: '', ...(mode ? { mode } : {}) },
  })
  const graph = reactive({
    nodes: [currentNode],
    edges: [],
    historyCalls: 0,
    remember() {
      this.historyCalls++
    },
    updateNodeData(id, data) {
      assert.equal(id, currentNode.id)
      currentNode.data = { ...currentNode.data, ...data }
    },
  })
  const tasks = reactive({
    imageModels: models,
    videoModels,
    runImageCalls: [],
    runImage(id) {
      this.runImageCalls.push(id)
    },
    runVideoCalls: [],
    runVideo(id) {
      this.runVideoCalls.push(id)
    },
  })
  globalThis.__cv3ComposerVersionHarness = {
    graph,
    tasks,
    user: reactive({
      isAuthenticated: false,
      token: '',
      profile: null,
      authHeaders: () => ({}),
      ...pricingUser,
    }),
    renderIcon: (props) => h('svg', { 'data-icon': props.name, width: props.size }),
  }
  teleportRoot = node('teleport-root')
  const root = node('root')
  const resources = { app: null }
  t.after(() => {
    resources.app?.unmount()
    delete globalThis.__cv3ComposerVersionHarness
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const Component = await componentPromise
  resources.app = renderer.createApp({
    setup: () => () => h(Component, { node: currentNode, position: { x: 320, y: 400 } }),
  })
  resources.app.mount(root)
  await flush()
  return {
    root,
    popupRoot: teleportRoot,
    currentNode,
    graph,
    tasks,
    user: globalThis.__cv3ComposerVersionHarness.user,
    observers,
    pointerDown(target) {
      documentListeners.get('pointerdown')?.({ target, composedPath: () => [target] })
    },
    resizeComposer(height) {
      const observer = observers[0]
      assert.ok(observer?.target)
      const bounds = observer.target.getBoundingClientRect()
      observer.target.getBoundingClientRect = () => ({ ...bounds, height })
      observer.callback()
    },
    resizeViewport(height) {
      globalThis.window.innerHeight = height
      windowListeners.get('resize')?.()
    },
  }
}

function button(harness, label) {
  return findAll(
    harness.root,
    (target) => target.type === 'button' && target.props['aria-label'] === label,
  )[0]
}

async function openParams(harness) {
  const trigger = button(harness, '输出参数')
  assert.ok(trigger)
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  return findAll(
    harness.popupRoot,
    (target) => target.type === 'section' && hasClass(target, 'cv3-param-field'),
  )
}

function rowLabel(row) {
  return textContent(findAll(row, (target) => target.type === 'label')[0])
}

function versionButtons(row) {
  return findAll(row, (target) => target.type === 'button')
}

function parameterRow(rows, label) {
  const row = rows.find((target) => rowLabel(target) === label)
  assert.ok(row, `Expected a ${label} parameter row`)
  return row
}

function parameterChoices(rows, label) {
  return versionButtons(parameterRow(rows, label)).map(textContent)
}

async function chooseModel(harness, label) {
  const trigger = button(harness, '选择模型')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const option = findAll(
    harness.popupRoot,
    (target) =>
      target.props.role === 'option' &&
      findAll(target, (child) => child.type === 'strong').some(
        (child) => textContent(child) === label,
      ),
  )[0]
  assert.ok(option, `Expected model option ${label}`)
  option.props.onClick()
  await flush()
}

async function chooseMode(harness, label) {
  const trigger = button(harness, '生成模式')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const option = findAll(
    harness.popupRoot,
    (target) => target.type === 'button' && textContent(target).trim() === label,
  )[0]
  assert.ok(option, `Expected mode ${label}`)
  option.props.onClick()
  await flush()
}

async function connectReferences(harness, values) {
  const references = values.map((value, index) => ({
    id: `reference-${index}`,
    data: {
      kind: 'image',
      title: `素材 ${index + 1}`,
      assetUrl: `https://cdn.example.com/reference-${index}.png`,
      ...value,
    },
  }))
  harness.graph.nodes = [harness.currentNode, ...references]
  harness.graph.edges = references.map((reference, index) => ({
    id: `edge-${index}`,
    source: reference.id,
    target: harness.currentNode.id,
  }))
  await flush()
  return references
}

function advancedRegion(harness) {
  return findAll(
    harness.root,
    (target) => target.props.role === 'region' && target.props['aria-label'] === '高级设置',
  )[0]
}

async function toggleAdvanced(harness) {
  const trigger = button(harness, '高级设置')
  assert.ok(trigger)
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  return trigger
}

async function escapeComposer(harness) {
  const composer = findAll(harness.root, (target) => hasClass(target, 'cv3-composer'))[0]
  composer.props.onKeydown({ key: 'Escape', stopPropagation() {}, preventDefault() {} })
  await flush()
}

test('TT output parameters add only a version row first and persist a real version click', async (t) => {
  const harness = await mountComposer(t)
  let rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['版本', '画质', '清晰度', '背景', '比例', '生成数量'])
  assert.deepEqual(parameterChoices(rows, '生成数量'), ['1张'])
  const [standard, enhanced] = versionButtons(rows[0])
  assert.deepEqual([textContent(standard), textContent(enhanced)], ['标准版', '增强版'])
  assert.equal(standard.props['aria-pressed'], true)
  assert.equal(enhanced.props['aria-pressed'], false)
  enhanced.props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.params.version, 'sunburst')
  assert.equal(harness.graph.historyCalls, 1)
  rows = findAll(
    harness.popupRoot,
    (target) => target.type === 'section' && hasClass(target, 'cv3-param-field'),
  )
  assert.equal(versionButtons(rows[0])[1].props['aria-pressed'], true)
  assert.equal(harness.currentNode.data.params.resolution, '2K')
})

test('old enhanced-alias nodes show their actual enhanced default without mutating saved params', async (t) => {
  const harness = await mountComposer(t, { model: 'gpt-image2.5-sunburst-api' })
  const rows = await openParams(harness)
  assert.equal(rowLabel(rows[0]), '版本')
  assert.equal(versionButtons(rows[0])[1].props['aria-pressed'], true)
  assert.equal(Object.hasOwn(harness.currentNode.data.params, 'version'), false)
  assert.equal(harness.graph.historyCalls, 0)
})

test('configured opaque TT routes honor the configured default instead of an arbitrary display label', async (t) => {
  const harness = await mountComposer(t, {
    model: 'model-api-key:44',
    models: [
      {
        value: 'model-api-key:44',
        label: '我的图片模型',
        model: 'tt-image-2.5',
        defaultVersion: 'sunburst',
      },
    ],
  })
  const rows = await openParams(harness)
  assert.equal(rowLabel(rows[0]), '版本')
  assert.equal(versionButtons(rows[0])[1].props['aria-pressed'], true)
})

test('switching from TT to Banana Pro removes TT-only fields and retains supported resolution', async (t) => {
  const harness = await mountComposer(t, {
    params: { version: 'sunburst', resolution: '4K' },
    models: [
      { value: 'tt-image-2.5', label: 'TT Image 2.5' },
      { value: 'model-api-key:45', label: 'TT Image 2.5 仿名', model: 'banana-pro' },
    ],
  })
  const trigger = button(harness, '选择模型')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const otherModel = findAll(harness.popupRoot, (target) => target.props.role === 'option')[1]
  assert.ok(otherModel)
  otherModel.props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.model, 'model-api-key:45')
  assert.equal(Object.hasOwn(harness.currentNode.data.params, 'version'), false)
  assert.equal(harness.currentNode.data.params.resolution, '4K')
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['清晰度', '比例', '生成数量'])
})

test('Banana Pro shows only its documented resolution, ratio, and single-image controls', async (t) => {
  const harness = await mountComposer(t, {
    model: 'model-api-key:45',
    params: {
      version: 'sunburst',
      quality: '极致画质',
      background: '透明背景',
      ratio: '3:4',
      resolution: '4K',
      count: '4张',
    },
    models: [{ value: 'model-api-key:45', label: '香蕉pro', model: 'banana-pro' }],
  })
  assert.equal(textContent(button(harness, '选择模型')), 'banana-pro')
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['清晰度', '比例', '生成数量'])
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['1K', '2K', '4K'])
  assert.deepEqual(parameterChoices(rows, '比例'), [
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '4:5',
    '5:4',
    '9:16',
    '16:9',
    '21:9',
  ])
  assert.deepEqual(parameterChoices(rows, '生成数量'), ['1张'])
  assert.equal(textContent(button(harness, '输出参数')).trim(), '3:4 · 4K · 1张')
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /画质|背景|版/)
  assert.equal(harness.graph.historyCalls, 0, 'Reading an old node must not silently rewrite it')
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('Banana 2.1 exposes thinking levels and its additional portrait and landscape ratios', async (t) => {
  const harness = await mountComposer(t, {
    model: 'model-api-key:46',
    models: [{ value: 'model-api-key:46', label: 'image-2.5 同名配置', model: 'banana-2.1' }],
  })
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['清晰度', '思考等级', '比例', '生成数量'])
  assert.deepEqual(parameterChoices(rows, '思考等级'), ['快速', '深度'])
  assert.deepEqual(parameterChoices(rows, '比例'), [
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '4:5',
    '5:4',
    '9:16',
    '16:9',
    '21:9',
    '1:4',
    '4:1',
    '1:8',
    '8:1',
  ])
  const [quick, deep] = versionButtons(parameterRow(rows, '思考等级'))
  assert.equal(quick.props['aria-pressed'], true)
  assert.equal(deep.props['aria-pressed'], false)
  deep.props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.params.thinkingLevel, '深度')
  assert.match(textContent(button(harness, '输出参数')), /深度/)
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /画质|背景|版/)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('changing model resets unsupported values once, keeps compatible values, and never submits a task', async (t) => {
  const harness = await mountComposer(t, {
    params: {
      version: 'sunburst',
      quality: '极致画质',
      background: '透明背景',
      ratio: '9:21',
      resolution: '4K',
      count: '4张',
    },
    models: [
      { value: 'tt-image-2.5', label: 'image-2.5', model: 'tt-image-2.5' },
      { value: 'model-api-key:45', label: 'Banana Pro', model: 'banana-pro' },
      { value: 'model-api-key:46', label: 'Banana 2.1', model: 'banana-2.1' },
    ],
  })
  await chooseModel(harness, 'banana-pro')
  assert.equal(harness.currentNode.data.model, 'model-api-key:45')
  assert.deepEqual(harness.currentNode.data.params, {
    resolution: '4K',
    ratio: '16:9',
    count: '1张',
  })
  assert.equal(harness.graph.historyCalls, 1)
  await flush()
  assert.equal(harness.graph.historyCalls, 1, 'Normalization must not create watcher undo entries')
  assert.equal(textContent(button(harness, '输出参数')).trim(), '16:9 · 4K · 1张')

  await chooseModel(harness, 'Banana 2.1')
  assert.equal(harness.currentNode.data.model, 'model-api-key:46')
  let rows = await openParams(harness)
  versionButtons(parameterRow(rows, '比例'))
    .find((target) => textContent(target) === '3:4')
    .props.onClick()
  versionButtons(parameterRow(rows, '思考等级'))[1].props.onClick()
  await flush()
  const historyBeforeSwitch = harness.graph.historyCalls
  await chooseModel(harness, 'banana-pro')
  assert.deepEqual(harness.currentNode.data.params, {
    resolution: '4K',
    ratio: '3:4',
    count: '1张',
  })
  assert.equal(harness.graph.historyCalls, historyBeforeSwitch + 1)
  rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['清晰度', '比例', '生成数量'])
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('switching to a configured TT route uses its own default version and does not inherit Banana controls', async (t) => {
  const harness = await mountComposer(t, {
    model: 'model-api-key:46',
    params: { resolution: '4K', ratio: '8:1', count: '1张', thinkingLevel: '深度' },
    models: [
      { value: 'model-api-key:46', label: 'Banana 2.1', model: 'banana-2.1' },
      {
        value: 'model-api-key:47',
        label: '自定义高级路由',
        model: 'tt-image-2.5',
        defaultVersion: 'sunburst',
      },
    ],
  })
  await chooseModel(harness, 'image-2.5')
  assert.equal(harness.currentNode.data.model, 'model-api-key:47')
  assert.equal(harness.currentNode.data.params.version, 'sunburst')
  assert.equal(harness.currentNode.data.params.ratio, '16:9')
  assert.equal(harness.currentNode.data.params.resolution, '4K')
  assert.equal(Object.hasOwn(harness.currentNode.data.params, 'thinkingLevel'), false)
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['版本', '画质', '清晰度', '背景', '比例', '生成数量'])
  assert.equal(versionButtons(rows[0])[1].props['aria-pressed'], true)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('only Banana 2.1 advanced settings expose a persistent real web-search switch', async (t) => {
  const harness = await mountComposer(t, {
    model: 'banana-2.1',
    models: [
      { value: 'banana-2.1', label: 'Banana 2.1' },
      { value: 'banana-pro-api', label: 'Banana Pro' },
      { value: 'tt-image-2.5', label: 'image-2.5' },
    ],
  })
  await toggleAdvanced(harness)
  const switchFor = (label) =>
    findAll(
      advancedRegion(harness),
      (target) => target.props.role === 'switch' && target.props['aria-label'] === label,
    )[0]
  assert.equal(switchFor('智能引用 AutoLink'), undefined)
  const webSearch = switchFor('联网搜索')
  assert.ok(webSearch)
  assert.equal(webSearch.props.checked, true)
  webSearch.props.onChange({ target: { checked: false } })
  await flush()
  assert.equal(harness.currentNode.data.switches['联网搜索'], false)
  assert.equal(switchFor('联网搜索').props.checked, false)

  await chooseModel(harness, 'banana-pro')
  assert.equal(switchFor('联网搜索'), undefined)
  assert.equal(switchFor('智能引用 AutoLink'), undefined)
  assert.match(textContent(advancedRegion(harness)), /当前模型没有额外设置/)
  await chooseModel(harness, 'image-2.5')
  assert.equal(switchFor('联网搜索'), undefined)
  await chooseModel(harness, 'Banana 2.1')
  assert.equal(switchFor('联网搜索').props.checked, false)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('video output fields remain unchanged even if stale TT model/version data is present', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', params: { version: 'sunburst' } })
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['比例', '清晰度', '视频时长'])
  assert.equal(
    findAll(
      harness.popupRoot,
      (target) => target.type === 'button' && ['标准版', '增强版'].includes(textContent(target)),
    ).length,
    0,
  )
})

test('video model menu removes the old 2.0 option without rewriting an existing node', async (t) => {
  const params = { ratio: '3:4', resolution: '1080P', duration: 8, count: '1个' }
  const harness = await mountComposer(t, { kind: 'video', model: '2.0', params })
  const trigger = button(harness, '选择模型')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const labels = findAll(harness.popupRoot, (target) => target.props.role === 'option').map(
    (option) => textContent(findAll(option, (target) => target.type === 'strong')[0]),
  )
  assert.deepEqual(labels, [
    'Seedance 2.0 按次',
    'Seedance 2.5 全能',
    '可灵-Omni',
    'MiniMax H3',
    '万相 3.0 全能',
  ])
  assert.equal(harness.currentNode.data.model, '2.0')
  assert.deepEqual(harness.currentNode.data.params, params)
  assert.equal(harness.graph.historyCalls, 0)
  assert.deepEqual(harness.tasks.runImageCalls, [])
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

for (const model of ['seedance-2.0-mini', 'Seedance 1.5 Pro', 'HappyHorse 1.0']) {
  test(`the removed ${model} choice stays absent for a historical selected node without changing or submitting it`, async (t) => {
    const params = { ratio: '3:4', resolution: '1080P', duration: 8, count: '1个', audio: false }
    const originalFetch = globalThis.fetch
    const fetchCalls = []
    globalThis.fetch = (...args) => {
      fetchCalls.push(args)
      throw new Error('Opening the model menu must not create a network request')
    }
    t.after(() => {
      globalThis.fetch = originalFetch
    })
    const harness = await mountComposer(t, {
      kind: 'video',
      model,
      params,
      videoModels: [{ value: model, model, label: model }],
    })
    assert.equal(harness.currentNode.data.model, model)
    assert.deepEqual(harness.currentNode.data.params, params)
    assert.equal(harness.graph.historyCalls, 0)
    const trigger = button(harness, '选择模型')
    trigger.props.onClick({ currentTarget: trigger })
    await flush()
    const options = findAll(harness.popupRoot, (target) => target.props.role === 'option')
    const labels = options.map((option) =>
      textContent(findAll(option, (target) => target.type === 'strong')[0]),
    )
    assert.deepEqual(labels, [
      'Seedance 2.0 按次',
      'Seedance 2.5 全能',
      '可灵-Omni',
      'MiniMax H3',
      '万相 3.0 全能',
    ])
    assert.ok(options.every((option) => option.props['aria-selected'] === false))
    assert.equal(harness.currentNode.data.model, model)
    assert.deepEqual(harness.currentNode.data.params, params)
    assert.equal(harness.graph.historyCalls, 0)
    assert.deepEqual(harness.tasks.runImageCalls, [])
    assert.deepEqual(harness.tasks.runVideoCalls, [])
    assert.deepEqual(fetchCalls, [])
    await escapeComposer(harness)
    assert.equal(harness.currentNode.data.model, model)
    assert.deepEqual(harness.currentNode.data.params, params)
  })
}

test('MiniMax video selection uses its waveform icon and remains a non-billable UI-only option', async (t) => {
  const params = { ratio: '9:16', resolution: '1080P', duration: 10, count: '1个', audio: false }
  const harness = await mountComposer(t, { kind: 'video', model: 'minimax', params })
  assert.equal(harness.currentNode.data.model, 'minimax')
  assert.deepEqual(harness.currentNode.data.params, params)
  assert.equal(harness.graph.historyCalls, 0)
  const trigger = button(harness, '选择模型')
  assert.equal(textContent(trigger), 'MiniMax')
  assert.equal(findAll(trigger, (target) => target.props['data-icon'] === 'modelMinimax').length, 1)
  assert.equal(
    textContent(findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]).trim(),
    '预计 — 米值',
  )

  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const options = findAll(harness.popupRoot, (target) => target.props.role === 'option')
  const miniMaxOptions = options.filter((target) =>
    findAll(target, (child) => child.type === 'strong').some(
      (child) => textContent(child) === 'MiniMax',
    ),
  )
  assert.equal(miniMaxOptions.length, 1)
  assert.equal(miniMaxOptions[0].props['aria-selected'], true)
  assert.equal(
    findAll(miniMaxOptions[0], (target) => target.props['data-icon'] === 'modelMinimax').length,
    1,
  )
  assert.match(textContent(miniMaxOptions[0]), /待配置生成服务/)
  trigger.props.onClick({ currentTarget: trigger })
  const originalFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = (...args) => {
    fetchCalls.push(args)
    throw new Error('A UI-only MiniMax option must not create a network request')
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  harness.currentNode.data.prompt = '简洁的商品展示视频，镜头缓慢推进'
  await flush()
  const generate = button(harness, '生成')
  assert.equal(Boolean(generate.props.disabled), false)
  generate.props.onClick()
  await flush()
  assert.match(
    textContent(harness.root),
    /当前为交互演示，尚未接入该模型的生成服务，未提交任务或扣费/,
  )
  assert.deepEqual(fetchCalls, [])
  assert.deepEqual(harness.tasks.runImageCalls, [])
  assert.deepEqual(harness.currentNode.data.params, params)
})

test('Wanxiang video menu and selected trigger share their icon while selection stays non-billable', async (t) => {
  const params = { ratio: '9:16', resolution: '1080P', duration: 10, audio: false }
  const harness = await mountComposer(t, { kind: 'video', model: 'minimax', params })
  const originalFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = (...args) => {
    fetchCalls.push(args)
    throw new Error('Selecting Wanxiang must not create a network request')
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const modelTrigger = button(harness, '选择模型')
  modelTrigger.props.onClick({ currentTarget: modelTrigger })
  await flush()
  const options = findAll(harness.popupRoot, (target) => target.props.role === 'option')
  const wanxiang = options.filter((target) =>
    findAll(target, (child) => child.type === 'strong').some(
      (child) => textContent(child) === '万相 3.0 全能',
    ),
  )
  assert.equal(wanxiang.length, 1)
  assert.equal(
    findAll(wanxiang[0], (target) => target.props['data-icon'] === 'modelWanxiang').length,
    1,
  )
  wanxiang[0].props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.model, '万相 3.0')
  assert.deepEqual(harness.currentNode.data.params, wanxiangParams(params))
  const selected = button(harness, '选择模型')
  assert.equal(textContent(selected), '万相 3.0 全能')
  assert.equal(
    findAll(selected, (target) => target.props['data-icon'] === 'modelWanxiang').length,
    1,
  )
  assert.equal(
    textContent(findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]).trim(),
    '预计 — 米值',
  )
  harness.currentNode.data.prompt = '镜头缓慢推进'
  await flush()
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runImageCalls, [])
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
  assert.deepEqual(fetchCalls, [])
})

test('Wanxiang popup exposes only documented fields, preserves saved draft on open and supports auto duration', async (t) => {
  const saved = { ratio: 'adaptive', duration: '5', count: '4个', seed: 9 }
  const harness = await mountComposer(t, { kind: 'video', model: '万相 3.0', params: saved })
  const trigger = button(harness, '输出参数')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const fields = findAll(harness.popupRoot, (target) => target.props['data-param'])
  assert.deepEqual(
    fields.map((field) => field.props['data-param']),
    ['version', 'resolution', 'duration', 'ratio', 'audio', 'prompt_extend'],
  )
  assert.deepEqual(harness.currentNode.data.params, saved)
  assert.equal(harness.graph.historyCalls, 0)
  assert.equal(
    findAll(harness.root, (target) => target.props['aria-label'] === '生成模式').length,
    0,
  )
  assert.equal(
    findAll(harness.root, (target) => target.props['aria-label'] === '高级设置').length,
    0,
  )
  const options = (key) =>
    findAll(
      fields.find((field) => field.props['data-param'] === key),
      (target) => target.type === 'button',
    )
  assert.deepEqual(options('version').map(textContent), ['标准版', '高速版'])
  assert.deepEqual(options('resolution').map(textContent), ['480P', '720P', '1080P'])
  assert.deepEqual(
    options('duration').map((target) => target.props['data-value']),
    ['auto', ...Array.from({ length: 29 }, (_, index) => String(index + 2))],
  )
  assert.deepEqual(options('ratio').map(textContent), [
    '自适应',
    '16:9',
    '9:16',
    '1:1',
    '4:3',
    '3:4',
  ])
  options('version')[1].props.onClick()
  options('duration')[0].props.onClick()
  options('audio')[1].props.onClick()
  options('prompt_extend')[0].props.onClick()
  await flush()
  assert.deepEqual(harness.currentNode.data.params, {
    version: 'prime',
    resolution: '720P',
    duration: 'auto',
    ratio: 'adaptive',
    audio: false,
    prompt_extend: true,
  })
  assert.match(textContent(harness.root), /高速版.*720P.*智能时长.*无声/)
  assert.match(textContent(harness.popupRoot), /30秒预扣/)
  assert.doesNotMatch(textContent(harness.popupRoot), /生成数量|联网搜索|首尾帧必传/)
})

test('Wanxiang reference chips use per-type numbering and enforce actual media duration limits', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: '万相 3.0',
    params: { duration: '25' },
  })
  harness.currentNode.data.prompt = '图1与图2中的人物，参考视频1的动作，使用音频1的声音'
  const assets = [
    ['v1', 'video', 7.5],
    ['i1', 'image'],
    ['i2', 'image'],
    ['a1', 'audio', 3],
    ['v2', 'video', 2.5],
  ]
  for (const [id, kind, mediaDuration] of assets) {
    harness.graph.nodes.push({
      id,
      data: {
        kind,
        title: id,
        assetUrl: `https://cdn.example.com/${id}`,
        ...(mediaDuration != null ? { mediaDuration } : {}),
      },
    })
    harness.graph.edges.push({ id: `edge-${id}`, source: id, target: harness.currentNode.id })
  }
  await flush()
  assert.deepEqual(
    findAll(harness.root, (target) => hasClass(target, 'cv3-reference-index')).map(textContent),
    ['视频1', '图1', '图2', '音频1', '视频2'],
  )
  assert.equal(Boolean(button(harness, '生成').props.disabled), true)
  assert.match(textContent(harness.root), /合计不能超过30秒/)
  harness.currentNode.data.params = { duration: 'auto' }
  await flush()
  assert.equal(Boolean(button(harness, '生成').props.disabled), false)
  harness.graph.nodes.find((target) => target.id === 'a1').data.mediaDuration = undefined
  await flush()
  assert.equal(Boolean(button(harness, '生成').props.disabled), true)
  assert.match(textContent(harness.root), /尚未读取参考音频的实际时长/)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  const source = harness.graph.nodes.find((target) => target.id === 'a1')
  harness.graph.updateNodeData = (id, patch) => {
    assert.equal(id, source.id)
    Object.assign(source.data, patch)
  }
  const preview = findAll(
    harness.root,
    (target) => target.props['aria-label'] === '预览引用：a1',
  )[0]
  preview.props.onClick({ currentTarget: preview })
  await flush()
  const audio = findAll(harness.root, (target) => target.type === 'audio')[0]
  audio.props.onLoadedmetadata({
    target: { currentSrc: 'https://cdn.example.com/stale-audio', duration: 4 },
  })
  assert.equal(source.data.mediaDuration, undefined)
  audio.props.onLoadedmetadata({ target: { currentSrc: source.data.assetUrl, duration: 4 } })
  await flush()
  assert.equal(source.data.mediaDuration, 4)
  assert.equal(Boolean(button(harness, '生成').props.disabled), false)
  harness.graph.edges = harness.graph.edges.filter((edge) => edge.source !== 'a1')
  await flush()
  audio.props.onLoadedmetadata({ target: { currentSrc: source.data.assetUrl, duration: 6 } })
  assert.equal(source.data.mediaDuration, 4)
  assert.equal(harness.graph.historyCalls, 0)
})

test('Seedance 2.5 selection exposes its documented controls and dispatches only the video task store', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: '2.0',
    params: { ratio: '3:4', resolution: '4K', duration: 30, count: '4个', audio: false },
  })
  await chooseModel(harness, 'Seedance 2.5 全能')
  assert.equal(harness.currentNode.data.model, 'doubao-seedance-2-5-260628')
  assert.equal(
    harness.currentNode.data.mode,
    undefined,
    'Choosing a model must not persist a guessed mode',
  )
  assert.deepEqual(harness.currentNode.data.params, {
    ratio: '3:4',
    resolution: '720P',
    duration: 30,
  })
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['比例', '清晰度', '视频时长'])
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['480P', '720P', '1080P'])
  assert.equal(
    rows.some((row) => rowLabel(row) === '生成数量'),
    false,
  )
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /[1-9]\d*个|生成数量/)
  const duration = findAll(parameterRow(rows, '视频时长'), (target) => target.type === 'input')[0]
  assert.deepEqual([duration.props.min, duration.props.max, duration.props.step], [4, 30, 1])
  duration.props.onChange({ target: { value: '31' } })
  await flush()
  assert.equal(harness.currentNode.data.params.duration, 30)
  assert.match(textContent(harness.root), /4～30 的整数秒/)
  await escapeComposer(harness)
  await toggleAdvanced(harness)
  const toggles = findAll(harness.popupRoot, (target) => hasClass(target, 'cv3-switch-row'))
  assert.equal(toggles.length, 1)
  assert.equal(textContent(toggles[0]), '联网搜索')
  assert.equal(findAll(toggles[0], (target) => target.type === 'input')[0].props.checked, false)
  await escapeComposer(harness)
  harness.currentNode.data.prompt = '一只金毛犬在海边奔跑'
  await flush()
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
  assert.deepEqual(harness.tasks.runImageCalls, [])
  assert.equal(
    textContent(findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]).trim(),
    '预计 — 米值',
  )
})

test('Seedance 2.0 per-call selection renders only documented enum fields and does not inherit H3 controls', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'minimax-h3',
    mode: '首尾帧',
    params: {
      ratio: 'Auto',
      resolution: '4K',
      duration: 30,
      version: 'sunburst',
      count: '4个',
      audio: false,
    },
  })
  await chooseModel(harness, 'Seedance 2.0 按次')
  assert.equal(harness.currentNode.data.model, 'seedance-2.0-anci')
  assert.equal(harness.currentNode.data.mode, '首尾帧', 'An old UI mode is ignored, not rewritten')
  assert.deepEqual(harness.currentNode.data.params, {
    ratio: '16:9',
    resolution: '720P',
    duration: 5,
    version: '快速',
  })
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['比例', '清晰度', '视频时长', '速度版本'])
  assert.deepEqual(parameterChoices(rows, '比例'), ['16:9', '9:16', '1:1', '4:3', '3:4'])
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['720P'])
  assert.deepEqual(
    parameterChoices(rows, '视频时长'),
    Array.from({ length: 12 }, (_, i) => String(i + 4)),
  )
  assert.deepEqual(parameterChoices(rows, '速度版本'), ['快速', '标准'])
  assert.equal(findAll(harness.popupRoot, (target) => target.type === 'input').length, 0)
  assert.equal(button(harness, '生成模式'), undefined)
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /[1-9]\d*个|生成数量|4K|Auto/)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  await escapeComposer(harness)
  await toggleAdvanced(harness)
  assert.match(textContent(harness.popupRoot), /当前模型没有额外设置/)
  assert.equal(findAll(harness.popupRoot, (target) => target.type === 'input').length, 0)
  await escapeComposer(harness)
  harness.currentNode.data.prompt = '角色在海边漫步，镜头跟随'
  await flush()
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('per-call standard 15-second warning follows real enum clicks and disappears for other choices', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: 'seedance-2.0-anci' })
  const rows = await openParams(harness)
  const warning = () =>
    findAll(harness.popupRoot, (target) => target.props.role === 'note')
      .map(textContent)
      .join('')
  assert.equal(warning(), '')
  versionButtons(parameterRow(rows, '速度版本'))[1].props.onClick()
  versionButtons(parameterRow(rows, '视频时长'))
    .find((target) => textContent(target) === '15')
    .props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.params.version, '标准')
  assert.equal(harness.currentNode.data.params.duration, 15)
  assert.match(warning(), /标准版选择15秒时，上游实际成片约10秒，仍按次计费/)
  assert.equal(harness.graph.historyCalls, 2)
  versionButtons(parameterRow(rows, '速度版本'))[0].props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.params.version, '快速')
  assert.equal(warning(), '')
  versionButtons(parameterRow(rows, '速度版本'))[1].props.onClick()
  versionButtons(parameterRow(rows, '视频时长'))
    .find((target) => textContent(target) === '14')
    .props.onClick()
  await flush()
  assert.equal(warning(), '')
  assert.equal(harness.currentNode.data.params.duration, 14)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('per-call one and two reference images retain all five ratios without positional frames and require prompt text', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'seedance-2.0-anci',
    mode: '首尾帧',
    params: { ratio: '9:16', resolution: '720P', duration: 8, version: '快速' },
  })
  for (const count of [1, 2]) {
    await connectReferences(
      harness,
      Array.from({ length: count }, () => ({})),
    )
    const rows = await openParams(harness)
    assert.deepEqual(parameterChoices(rows, '比例'), ['16:9', '9:16', '1:1', '4:3', '3:4'])
    assert.equal(findAll(harness.root, (target) => hasClass(target, 'cv3-frame-slots')).length, 0)
    assert.equal(button(harness, '生成模式'), undefined)
    assert.doesNotMatch(textContent(harness.popupRoot), /单张图片的首帧任务仅支持/)
    assert.equal(button(harness, '生成').props.disabled, true)
    assert.match(button(harness, '生成').props.title, /必须提供提示词/)
    await escapeComposer(harness)
  }
  assert.equal(harness.graph.historyCalls, 0)
  await connectReferences(harness, [{}, { kind: 'text', prompt: '角色沿着海边漫步' }])
  assert.equal(button(harness, '生成').props.disabled, false)
  harness.currentNode.data.runState = 'paused'
  await connectReferences(harness, [{}])
  assert.equal(button(harness, '生成').props.disabled, false, 'Original tasks remain resumable')
  assert.equal(harness.currentNode.data.mode, '首尾帧')
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('configured opaque per-call routes use their exact identity and clean speed-version params on model switches', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'minimax-h3',
    params: { ratio: '3:4', resolution: '4K', duration: 8 },
    videoModels: [
      { value: 'feature-route:61', model: 'seedance-2.0-anci', label: '我的按次通道' },
      { value: 'feature-route:62', model: 'doubao-seedance-2-5-260628', label: '我的按秒通道' },
    ],
  })
  await chooseModel(harness, '我的按次通道')
  assert.equal(harness.currentNode.data.model, 'feature-route:61')
  assert.equal(textContent(button(harness, '选择模型')), '我的按次通道')
  assert.equal(
    findAll(
      button(harness, '选择模型'),
      (target) => target.props['data-icon'] === 'modelSeedanceMini',
    ).length,
    1,
  )
  assert.deepEqual(harness.currentNode.data.params, {
    ratio: '3:4',
    resolution: '720P',
    duration: 8,
    version: '快速',
  })
  let rows = await openParams(harness)
  versionButtons(parameterRow(rows, '速度版本'))[1].props.onClick()
  await flush()
  await escapeComposer(harness)
  await chooseModel(harness, '我的按秒通道')
  assert.equal(harness.currentNode.data.model, 'feature-route:62')
  assert.equal(Object.hasOwn(harness.currentNode.data.params, 'version'), false)
  rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['比例', '清晰度', '视频时长'])
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['480P', '720P', '1080P'])
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('connected Seedance image count derives actual ratios without a mode button, frame row or saved-mode mutation', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'doubao-seedance-2-5-260628',
    mode: '文生视频',
    params: { ratio: '16:9', resolution: '1080P', duration: 8, count: '1个' },
  })
  assert.equal(button(harness, '生成模式'), undefined)
  for (const count of [1, 2]) {
    await connectReferences(
      harness,
      Array.from({ length: count }, () => ({})),
    )
    assert.equal(harness.currentNode.data.mode, '文生视频')
    assert.equal(
      harness.currentNode.data.params.ratio,
      '16:9',
      'Reading derived controls must not rewrite the draft',
    )
    const rows = await openParams(harness)
    if (count === 1) {
      assert.deepEqual(parameterChoices(rows, '比例'), ['Auto'])
      assert.match(
        textContent(parameterRow(rows, '比例')),
        /Seedance 2\.5 单张图片的首帧任务仅支持自适应比例/,
      )
      assert.match(textContent(button(harness, '输出参数')).trim(), /^Auto/)
    } else {
      assert.deepEqual(parameterChoices(rows, '比例'), [
        'Auto',
        '16:9',
        '4:3',
        '1:1',
        '3:4',
        '9:16',
        '21:9',
      ])
      assert.doesNotMatch(textContent(parameterRow(rows, '比例')), /任务仅支持自适应比例/)
      assert.match(textContent(button(harness, '输出参数')).trim(), /^16:9/)
    }
    assert.equal(
      rows.some((row) => rowLabel(row) === '生成数量'),
      false,
    )
    assert.doesNotMatch(textContent(button(harness, '输出参数')), /[1-9]\d*个|生成数量/)
    assert.equal(findAll(harness.root, (target) => hasClass(target, 'cv3-frame-slots')).length, 0)
    assert.equal(
      findAll(harness.root, (target) => hasClass(target, 'cv3-reference-card')).length,
      count,
    )
    await escapeComposer(harness)
  }
  await connectReferences(harness, [{}, {}, {}])
  const rows = await openParams(harness)
  assert.equal(parameterChoices(rows, '比例').length, 7)
  assert.doesNotMatch(textContent(parameterRow(rows, '比例')), /任务仅支持自适应比例/)
  assert.match(textContent(button(harness, '输出参数')).trim(), /^16:9/)
  assert.equal(
    rows.some((row) => rowLabel(row) === '生成数量'),
    false,
  )
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /[1-9]\d*个|生成数量/)
  assert.equal(harness.currentNode.data.mode, '文生视频')
  assert.equal(harness.graph.historyCalls, 0)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('MiniMax H3 has its own resolutions, duration, modes and no ignored advanced switches', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'doubao-seedance-2-5-260628',
    mode: '全能参考',
    params: { ratio: '9:16', resolution: '720P', duration: 30, count: '1个' },
  })
  await chooseModel(harness, 'MiniMax H3')
  assert.equal(harness.currentNode.data.model, 'minimax-h3')
  assert.equal(
    harness.currentNode.data.mode,
    '全能参考',
    'A stale saved mode is ignored, never rewritten by the model menu',
  )
  assert.deepEqual(harness.currentNode.data.params, {
    ratio: '9:16',
    resolution: '768P',
    duration: 5,
  })
  const rows = await openParams(harness)
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['768P', '1080P', '2K', '4K'])
  assert.equal(
    rows.some((row) => rowLabel(row) === '生成数量'),
    false,
  )
  const duration = findAll(parameterRow(rows, '视频时长'), (target) => target.type === 'input')[0]
  assert.deepEqual([duration.props.min, duration.props.max, duration.props.step], [4, 15, 1])
  duration.props.onChange({ target: { value: '15' } })
  await flush()
  assert.equal(harness.currentNode.data.params.duration, 15)
  await escapeComposer(harness)
  await connectReferences(harness, [{}, {}, {}])
  assert.equal(button(harness, '生成模式'), undefined)
  assert.equal(harness.currentNode.data.mode, '全能参考')
  await toggleAdvanced(harness)
  assert.match(textContent(harness.popupRoot), /当前模型没有额外设置/)
  assert.equal(findAll(harness.popupRoot, (target) => target.type === 'input').length, 0)
  await escapeComposer(harness)
  harness.currentNode.data.prompt = '一只白鹭掠过湖面'
  await flush()
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('video and audio references retain their real media previews instead of broken image URLs', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'doubao-seedance-2-5-260628',
    mode: '首尾帧',
    params: { ratio: '9:16', resolution: '720P', duration: 8, count: '1个' },
  })
  await connectReferences(harness, [
    {},
    { kind: 'video', title: '视频参考', assetUrl: 'https://cdn.example.com/video.mp4' },
    { kind: 'audio', title: '音频参考', assetUrl: 'https://cdn.example.com/audio.mp3' },
  ])
  assert.equal(findAll(harness.root, (target) => hasClass(target, 'cv3-reference-card')).length, 3)
  assert.equal(
    findAll(
      harness.root,
      (target) => target.type === 'img' && /\.(mp4|mp3)$/.test(target.props.src || ''),
    ).length,
    0,
  )
  for (const kind of ['video', 'audio']) {
    const media = findAll(harness.root, (target) => target.type === kind)[0]
    assert.ok(media, `${kind} uses its native player`)
    assert.ok(Object.hasOwn(media.props, 'controls'))
    assert.notEqual(media.props.controls, false)
    assert.equal(media.props.preload, 'metadata')
    assert.equal(typeof media.props.onClick, 'function')
    assert.equal(typeof media.props.onKeydown, 'function')
  }
  const rows = await openParams(harness)
  assert.equal(
    parameterChoices(rows, '比例').length,
    7,
    'Audio/video force all-reference rather than first-frame restrictions',
  )
  assert.match(textContent(button(harness, '输出参数')).trim(), /^9:16/)
  assert.equal(harness.currentNode.data.mode, '首尾帧')
  assert.equal(harness.graph.historyCalls, 0)
})

test('not-ready linked video inputs show the real validation error and prevent a new paid submission', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: 'minimax-h3' })
  harness.currentNode.data.prompt = '保持商品外观，镜头缓慢推进'
  await connectReferences(harness, [{ assetUrl: '' }])
  const generate = button(harness, '生成')
  assert.equal(generate.props.disabled, true)
  assert.match(textContent(harness.root), /尚未|未就绪|未准备/)
  assert.match(generate.props.title, /尚未|未就绪|未准备/)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  harness.currentNode.data.runState = 'paused'
  await flush()
  assert.equal(
    button(harness, '生成').props.disabled,
    false,
    'Original tasks must remain resumable even when current inputs changed',
  )
  button(harness, '生成').props.onClick()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
})

test('H3 text, one-frame, two-frame and reference inputs expose all seven supplied ratios', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'minimax-h3',
    mode: '首尾帧',
    params: { ratio: 'Auto', resolution: '768P', duration: 5, count: '1个' },
  })
  for (const count of [0, 1, 2, 3]) {
    await connectReferences(
      harness,
      Array.from({ length: count }, () => ({})),
    )
    const rows = await openParams(harness)
    assert.deepEqual(parameterChoices(rows, '比例'), [
      'Auto',
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
      '21:9',
    ])
    assert.doesNotMatch(textContent(parameterRow(rows, '比例')), /任务仅支持自适应比例/)
    if (count === 2) {
      versionButtons(parameterRow(rows, '比例'))
        .find((target) => textContent(target) === '9:16')
        .props.onClick()
      await flush()
      assert.equal(harness.currentNode.data.params.ratio, '9:16')
      assert.match(textContent(button(harness, '输出参数')).trim(), /^9:16/)
    }
    await escapeComposer(harness)
  }
  assert.equal(harness.currentNode.data.mode, '首尾帧')
  assert.equal(harness.graph.historyCalls, 1, 'Only the user ratio click creates history')
})

test('non-video modes still open and persist their explicit choice', async (t) => {
  const harness = await mountComposer(t, { kind: 'smartEdit', model: '', mode: '默认模式' })
  assert.ok(button(harness, '生成模式'))
  await chooseMode(harness, '讲解视频')
  assert.equal(harness.currentNode.data.mode, '讲解视频')
  assert.equal(harness.graph.historyCalls, 1)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

function klingMenu(harness) {
  return findAll(
    harness.popupRoot,
    (target) => target.props.role === 'menu' && target.props['aria-label'] === '视频生成模式',
  )[0]
}

async function keydown(target, key) {
  const event = { key, currentTarget: target, stopPropagation() {}, preventDefault() {} }
  for (const listener of [target.props.onKeydown].flat()) await listener(event)
  await flush()
}

test('Omni alone exposes the compact three-row selectable mode menu', async (t) => {
  const params = { ratio: '9:16', resolution: '1080P', duration: 9, count: '4个' }
  const harness = await mountComposer(t, { kind: 'video', model: 'Kling 3.0', params })
  const trigger = button(harness, '生成模式')
  assert.ok(trigger)
  assert.equal(textContent(trigger).trim(), '视频参考')
  assert.equal(textContent(button(harness, '选择模型')).trim(), '可灵-Omni')
  assert.equal(trigger.props['aria-haspopup'], 'menu')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.ok(
    findAll(trigger, (target) => target.props['data-icon'] === 'klingModeVideoReference').length,
  )
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const menu = klingMenu(harness)
  assert.ok(menu)
  assert.equal(menu.props.id, trigger.props['aria-controls'])
  assert.equal(menu.props['data-direction'], 'below')
  assert.deepEqual(menu.props.style, {
    left: '320px',
    top: '592px',
    width: '162px',
    height: '156px',
  })
  assert.equal(findAll(menu, (target) => target.type === 'header').length, 0)
  const rows = findAll(menu, (target) => target.props.role === 'menuitemradio')
  assert.deepEqual(
    rows.map((row) => textContent(row).trim()),
    ['视频参考', '参考生', '首尾帧'],
  )
  assert.deepEqual(
    rows.map((row) => row.props.disabled),
    [false, false, false],
  )
  assert.deepEqual(
    rows.map((row) => row.props['aria-checked']),
    [true, false, false],
  )
  assert.deepEqual(
    rows.map((row) => findAll(row, (target) => target.type === 'svg')[0].props['data-icon']),
    ['klingModeVideoReference', 'klingModeReference', 'klingModeFrames'],
  )
  assert.doesNotMatch(textContent(menu), /文生视频|全能参考|图生视频|图片参考/)
  assert.equal(harness.currentNode.data.mode, undefined)
  assert.deepEqual(harness.currentNode.data.params, params)
  assert.equal(harness.graph.historyCalls, 0)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  rows[0].props.onClick()
  await flush()
  assert.equal(klingMenu(harness), undefined)
  assert.equal(globalThis.document.activeElement, trigger)
  assert.equal(
    harness.graph.historyCalls,
    0,
    'Closing the already-selected implicit default adds no undo entry',
  )
})

test('Kling keyboard navigation, trigger toggling, outside click and Escape do not edit node data', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: 'Kling 3.0' })
  const before = JSON.parse(JSON.stringify(harness.currentNode.data))
  const trigger = button(harness, '生成模式')
  await keydown(trigger, 'ArrowDown')
  const menu = klingMenu(harness)
  const enabled = findAll(
    menu,
    (target) => target.props.role === 'menuitemradio' && !target.props.disabled,
  )
  assert.equal(globalThis.document.activeElement, enabled[0])
  for (const [key, index] of [
    ['ArrowDown', 1],
    ['ArrowUp', 0],
    ['Home', 0],
    ['End', 2],
  ]) {
    await keydown(menu, key)
    assert.equal(
      globalThis.document.activeElement,
      enabled[index],
      'Keyboard navigation follows the three selectable choices',
    )
  }
  harness.pointerDown(enabled[0])
  await flush()
  assert.ok(klingMenu(harness), 'Inside pointer events leave the menu open')
  await keydown(menu, 'Escape')
  assert.equal(klingMenu(harness), undefined)
  assert.equal(globalThis.document.activeElement, trigger)
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  assert.equal(klingMenu(harness), undefined)
  await keydown(trigger, 'ArrowUp')
  assert.ok(klingMenu(harness))
  const outside = node('input')
  outside.focus()
  harness.pointerDown(outside)
  await flush()
  assert.equal(klingMenu(harness), undefined)
  assert.equal(
    globalThis.document.activeElement,
    outside,
    'Outside click preserves the destination focus',
  )
  await keydown(trigger, 'ArrowDown')
  const tabMenu = klingMenu(harness)
  outside.focus()
  await keydown(tabMenu, 'Tab')
  assert.equal(klingMenu(harness), undefined, 'Tab dismisses the ordinary menu')
  assert.equal(
    globalThis.document.activeElement,
    outside,
    'Tab never forces focus back to the trigger',
  )
  assert.deepEqual(harness.currentNode.data, before)
  assert.equal(harness.graph.historyCalls, 0)
})

test('the three Omni choices normalize only their own documented params without changing API identity or submitting', async (t) => {
  const params = { ratio: '9:16', duration: 8, custom: 'keep' }
  const harness = await mountComposer(t, { kind: 'video', model: 'Kling 3.0', params })
  const expected = [
    { mode: 'std', duration: '5', aspect_ratio: '16:9' },
    { mode: 'std', duration: '5' },
    {
      refer_type: 'feature',
      mode: 'std',
      duration: '5',
      aspect_ratio: '16:9',
      keep_original_sound: 'yes',
    },
  ]
  for (const [index, mode] of ['参考生', '首尾帧', '视频参考'].entries()) {
    await chooseMode(harness, mode)
    assert.equal(harness.currentNode.data.mode, mode)
    assert.equal(textContent(button(harness, '生成模式')).trim(), mode)
    assert.equal(klingMenu(harness), undefined)
    assert.equal(harness.graph.historyCalls, index + 1)
    assert.equal(harness.currentNode.data.model, 'Kling 3.0')
    assert.deepEqual(harness.currentNode.data.params, expected[index])
    assert.deepEqual(harness.tasks.runVideoCalls, [])
  }
  await chooseMode(harness, '视频参考')
  assert.equal(harness.graph.historyCalls, 3, 'Reselecting the current mode is a no-op')
})

test('opening Kling preserves drafts and references; an explicit mode change uses its documented parameter schema', async (t) => {
  const params = { ratio: '21:9', resolution: '4K', duration: 17, custom: 'keep' }
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '参考生',
    params,
  })
  await connectReferences(harness, [
    {},
    { kind: 'video', assetUrl: 'https://cdn.example.com/reference.mp4' },
  ])
  const edges = JSON.parse(JSON.stringify(harness.graph.edges))
  const trigger = button(harness, '生成模式')
  assert.equal(textContent(trigger).trim(), '参考生')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const rows = findAll(klingMenu(harness), (target) => target.props.role === 'menuitemradio')
  assert.deepEqual(
    rows.map((row) => row.props.disabled),
    [false, false, false],
    'UI mode selection does not submit a provider request',
  )
  assert.equal(rows[1].props['aria-checked'], true)
  assert.equal(harness.currentNode.data.mode, '参考生')
  assert.deepEqual(harness.currentNode.data.params, params)
  assert.equal(harness.graph.historyCalls, 0)
  rows[2].props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.mode, '首尾帧')
  assert.equal(harness.graph.historyCalls, 1)
  assert.deepEqual(harness.currentNode.data.params, { mode: 'std', duration: '5' })
  assert.deepEqual(harness.graph.edges, edges)
  assert.equal(harness.currentNode.data.model, 'Kling 3.0')
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  assert.equal(
    button(harness, '生成').props.disabled,
    true,
    'Unsupported video media blocks frame submission',
  )
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  assert.match(textContent(harness.root), /视频/)
})

test('Omni explicit generation dispatches each supported mode through the real video store without demo warnings', async (t) => {
  for (const mode of ['参考生', '视频参考', '首尾帧']) {
    await t.test(mode, async (subtest) => {
      const harness = await mountComposer(subtest, {
        kind: 'video',
        model: 'Kling 3.0',
        mode,
        params: { mode: 'std', duration: '5' },
      })
      harness.currentNode.data.prompt = '人物在海边漫步'
      await flush()
      if (mode === '视频参考')
        await connectReferences(harness, [
          { kind: 'video', assetUrl: 'https://cdn.example.com/reference.mp4', mediaDuration: 5 },
        ])
      if (mode === '首尾帧') await connectReferences(harness, [{}])
      assert.equal(button(harness, '生成').props.disabled, false)
      button(harness, '生成').props.onClick()
      await flush()
      assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
      assert.doesNotMatch(textContent(harness.root), /当前为交互演示/)
    })
  }
})

test('saved real Omni managed routes retain the three-mode controls and dispatch integration', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'model-api-key:omni-frames',
    mode: '首尾帧',
    params: { mode: 'pro', duration: '10' },
    videoModels: [
      {
        value: 'model-api-key:omni-frames',
        model: 'kling-v3-omni-shouweizhen',
        label: '帧专用线路',
      },
    ],
  })
  await connectReferences(harness, [{}])
  assert.match(textContent(button(harness, '选择模型')), /可灵-Omni/)
  assert.match(textContent(button(harness, '生成模式')), /首尾帧/)
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['生成模式', '视频时长'])
  await escapeComposer(harness)
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
})

test('Kling modes close on model or node changes and never leak into native or legacy video models', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: 'Kling 3.0', mode: '首尾帧' })
  const trigger = button(harness, '生成模式')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  assert.ok(klingMenu(harness))
  for (const model of [
    'minimax-h3',
    'doubao-seedance-2-5-260628',
    'seedance-2.0-anci',
    'seedance-2.0-mini',
    'HappyHorse 1.0',
    'Kling 3.0 Pro',
  ]) {
    harness.currentNode.data.model = model
    await flush()
    assert.equal(button(harness, '生成模式'), undefined)
    assert.equal(klingMenu(harness), undefined)
    assert.equal(harness.currentNode.data.mode, '首尾帧')
  }
  harness.currentNode.data.model = 'Kling 3.0'
  await flush()
  assert.ok(button(harness, '生成模式'))
  assert.equal(klingMenu(harness), undefined, 'Returning to Kling does not resurrect a stale popup')
  button(harness, '生成模式').props.onClick({ currentTarget: button(harness, '生成模式') })
  await flush()
  harness.currentNode.id = 'another-video-node'
  await flush()
  assert.equal(klingMenu(harness), undefined)
  assert.equal(harness.graph.historyCalls, 0)
})

test('a configured native model named Kling does not gain the Kling mode selector', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'model-api-key:82',
    videoModels: [{ value: 'model-api-key:82', model: 'MiniMax-H3', label: 'Kling 3.0' }],
  })
  assert.equal(button(harness, '生成模式'), undefined)
  assert.equal(harness.graph.historyCalls, 0)
})

function currentParameterRows(harness) {
  return findAll(
    harness.popupRoot,
    (target) => target.type === 'section' && hasClass(target, 'cv3-param-field'),
  )
}

async function chooseOmniParameter(harness, label, choice) {
  const row = parameterRow(currentParameterRows(harness), label)
  const option = versionButtons(row).find((target) => textContent(target).trim() === choice)
  assert.ok(option, `Expected ${label} choice ${choice}`)
  option.props.onClick()
  await flush()
  return currentParameterRows(harness)
}

test('Omni reference-generation popup shows only its documented quality, durations and three ratios', async (t) => {
  const raw = { ratio: 'Auto', resolution: '4K', duration: 8, count: '4个', mode: 'invalid' }
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '参考生',
    params: raw,
  })
  let rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['生成模式', '视频时长', '画面比例'])
  assert.deepEqual(parameterChoices(rows, '生成模式'), ['标准', '高品质'])
  assert.deepEqual(parameterChoices(rows, '视频时长'), ['5秒', '10秒', '15秒'])
  assert.deepEqual(parameterChoices(rows, '画面比例'), ['16:9', '9:16', '1:1'])
  assert.deepEqual(
    versionButtons(parameterRow(rows, '生成模式')).map((target) => target.props['data-value']),
    ['std', 'pro'],
  )
  assert.equal(
    button(harness, '高级设置'),
    undefined,
    'No inherited search/audio switches unsupported by the document',
  )
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /4K|Auto|4个|清晰度/)
  assert.match(textContent(harness.popupRoot), /最多7张|0\/7/)
  assert.equal(
    findAll(
      harness.popupRoot,
      (target) => target.props['data-api-model'] === 'kling-v3-omni-cankao',
    ).length,
    1,
  )
  assert.deepEqual(
    harness.currentNode.data.params,
    raw,
    'Opening does not migrate a historical draft',
  )
  assert.equal(harness.graph.historyCalls, 0)
  rows = await chooseOmniParameter(harness, '视频时长', '10秒')
  assert.deepEqual(harness.currentNode.data.params, {
    mode: 'std',
    duration: '10',
    aspect_ratio: '16:9',
  })
  assert.equal(versionButtons(parameterRow(rows, '视频时长'))[1].props['aria-pressed'], true)
  await chooseOmniParameter(harness, '生成模式', '高品质')
  await chooseOmniParameter(harness, '画面比例', '9:16')
  assert.deepEqual(harness.currentNode.data.params, {
    mode: 'pro',
    duration: '10',
    aspect_ratio: '9:16',
  })
  assert.match(textContent(button(harness, '输出参数')), /9:16.*高品质.*10s/)
  assert.equal(harness.graph.historyCalls, 3)
  assert.equal(
    harness.currentNode.data.mode,
    '参考生',
    'Quality params.mode must not overwrite the outer mode',
  )
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('Omni video editing hides and removes ineffective duration, ratio and original-sound overrides', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '视频参考',
    params: {
      refer_type: 'feature',
      mode: 'pro',
      duration: '10',
      aspect_ratio: '9:16',
      keep_original_sound: 'no',
      resolution: '4K',
    },
  })
  let rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['参考类型', '生成模式', '视频时长', '画面比例', '保留原声'])
  assert.deepEqual(parameterChoices(rows, '参考类型'), ['视频参考', '指令变换'])
  assert.deepEqual(parameterChoices(rows, '视频时长'), ['5秒', '10秒'])
  assert.deepEqual(parameterChoices(rows, '保留原声'), ['保留', '不保留'])
  const staleDurationClick = versionButtons(parameterRow(rows, '视频时长'))[0].props.onClick
  rows = await chooseOmniParameter(harness, '参考类型', '指令变换')
  assert.deepEqual(rows.map(rowLabel), ['参考类型', '生成模式'])
  assert.deepEqual(harness.currentNode.data.params, { refer_type: 'base', mode: 'pro' })
  assert.match(textContent(harness.popupRoot), /时长.*比例跟随输入视频.*始终保留原声/)
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /9:16|10s|不保留/)
  assert.match(textContent(button(harness, '输出参数')), /指令变换.*跟随视频.*保留原声/)
  staleDurationClick()
  await flush()
  assert.equal(
    harness.graph.historyCalls,
    1,
    'A removed field cannot be mutated through a stale click',
  )
  assert.deepEqual(harness.currentNode.data.params, { refer_type: 'base', mode: 'pro' })
  rows = await chooseOmniParameter(harness, '参考类型', '视频参考')
  assert.deepEqual(rows.map(rowLabel), ['参考类型', '生成模式', '视频时长', '画面比例', '保留原声'])
  assert.deepEqual(harness.currentNode.data.params, {
    refer_type: 'feature',
    mode: 'pro',
    duration: '5',
    aspect_ratio: '16:9',
    keep_original_sound: 'yes',
  })
  await chooseOmniParameter(harness, '保留原声', '不保留')
  assert.equal(harness.currentNode.data.params.keep_original_sound, 'no')
  assert.equal(harness.currentNode.data.mode, '视频参考')
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('Omni first/last popup follows the first image ratio and enforces one or two linked frames in its requirements', async (t) => {
  const raw = {
    mode: 'pro',
    duration: '15',
    aspect_ratio: '9:16',
    resolution: '1080P',
    count: '2个',
  }
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '首尾帧',
    params: raw,
  })
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['生成模式', '视频时长'])
  assert.deepEqual(parameterChoices(rows, '视频时长'), ['5秒', '10秒', '15秒'])
  assert.match(textContent(harness.popupRoot), /画面比例跟随首帧图片/)
  assert.match(textContent(harness.popupRoot), /需连接 1～2 张图片.*第1张为首帧.*第2张为尾帧/)
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /9:16|1080P|2个/)
  assert.match(textContent(button(harness, '输出参数')), /高品质.*15s.*比例跟随首帧/)
  assert.deepEqual(harness.currentNode.data.params, raw)
  await connectReferences(harness, [{}, {}])
  assert.equal(findAll(harness.popupRoot, (target) => target.props.role === 'alert').length, 0)
  assert.match(textContent(harness.popupRoot), /2\/2/)
  await connectReferences(harness, [{}, {}, {}])
  assert.match(textContent(harness.popupRoot), /最多支持 2 张图片/)
  assert.equal(harness.graph.edges.length, 3, 'Requirements never silently remove user references')
  assert.equal(harness.graph.historyCalls, 0)
})

test('Omni video requirements show documented file limits and only validate known linked metadata', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: 'Kling 3.0', mode: '视频参考' })
  await connectReferences(harness, [
    {
      kind: 'video',
      assetUrl: 'https://cdn.example.com/reference.webm',
      mediaDuration: 12,
      mediaWidth: 640,
      fileSize: 110 * 1024 * 1024,
    },
  ])
  await openParams(harness)
  const content = textContent(harness.popupRoot)
  for (const pattern of [/3～10 秒/, /700px/, /100MB/, /mp4.*mov/]) assert.match(content, pattern)
  assert.ok(findAll(harness.popupRoot, (target) => target.props.role === 'alert').length >= 4)
  await connectReferences(harness, [
    { kind: 'video', assetUrl: 'https://cdn.example.com/reference.mp4' },
  ])
  assert.equal(findAll(harness.popupRoot, (target) => target.props.role === 'alert').length, 0)
  assert.match(textContent(harness.popupRoot), /尚未读取参考视频时长/)
  assert.match(textContent(harness.popupRoot), /尚未读取参考视频宽度/)
  assert.match(textContent(harness.popupRoot), /尚未读取参考视频文件大小/)
  await connectReferences(harness, [
    { kind: 'audio', assetUrl: 'https://cdn.example.com/reference.mp3' },
  ])
  assert.match(textContent(harness.popupRoot), /不支持单独音频输入/)
  assert.equal(harness.graph.historyCalls, 0)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('Omni mode switches preserve compatible quality but clear unsupported API fields in one history step', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '参考生',
    params: {
      mode: 'pro',
      duration: '15',
      aspect_ratio: '9:16',
      resolution: '4K',
      count: '4个',
      notify_url: 'https://example.com/hook',
    },
  })
  await chooseMode(harness, '视频参考')
  assert.deepEqual(harness.currentNode.data.params, {
    refer_type: 'feature',
    mode: 'pro',
    duration: '5',
    aspect_ratio: '9:16',
    keep_original_sound: 'yes',
  })
  assert.equal(harness.graph.historyCalls, 1)
  await chooseMode(harness, '首尾帧')
  assert.deepEqual(harness.currentNode.data.params, { mode: 'pro', duration: '5' })
  assert.equal(harness.graph.historyCalls, 2)
  await chooseMode(harness, '参考生')
  assert.deepEqual(harness.currentNode.data.params, {
    mode: 'pro',
    duration: '5',
    aspect_ratio: '16:9',
  })
  assert.equal(harness.graph.historyCalls, 3)
  assert.equal(harness.currentNode.data.model, 'Kling 3.0')
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('an unrecognized saved Kling mode is not migrated until an explicit mode click', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'Kling 3.0',
    mode: '历史自定义模式',
    params: { custom: 'untouched' },
  })
  const trigger = button(harness, '生成模式')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  assert.equal(harness.currentNode.data.mode, '历史自定义模式')
  assert.equal(harness.graph.historyCalls, 0)
  const option = findAll(klingMenu(harness), (target) => target.props.role === 'menuitemradio')[0]
  option.props.onClick()
  await flush()
  assert.equal(harness.currentNode.data.mode, '视频参考')
  assert.deepEqual(harness.currentNode.data.params, {
    refer_type: 'feature',
    mode: 'std',
    duration: '5',
    aspect_ratio: '16:9',
    keep_original_sound: 'yes',
  })
  assert.equal(harness.graph.historyCalls, 1)
  assert.deepEqual(harness.tasks.runVideoCalls, [])
})

test('a stale non-video mode popup cannot remain visible after the composer becomes a video', async (t) => {
  const harness = await mountComposer(t, { kind: 'smartEdit', model: '', mode: '默认模式' })
  const trigger = button(harness, '生成模式')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  assert.equal(
    findAll(harness.popupRoot, (target) => target.props['aria-label'] === '生成模式').length,
    1,
  )
  harness.currentNode.data.kind = 'video'
  harness.currentNode.data.model = 'minimax-h3'
  await flush()
  assert.equal(button(harness, '生成模式'), undefined)
  assert.equal(
    findAll(harness.popupRoot, (target) => target.props['aria-label'] === '生成模式').length,
    0,
  )
  assert.equal(harness.currentNode.data.mode, '默认模式')
  assert.equal(harness.graph.historyCalls, 0)
})

test('legacy video count values are hidden from generic parameter popups and summaries without rewriting saved drafts', async (t) => {
  const params = { ratio: '16:9', resolution: '720P', duration: 5, count: '4个' }
  const harness = await mountComposer(t, { kind: 'video', model: 'seedance-2.0-mini', params })
  const rows = await openParams(harness)
  assert.deepEqual(rows.map(rowLabel), ['比例', '清晰度', '视频时长'])
  assert.doesNotMatch(textContent(button(harness, '输出参数')), /[1-9]\d*个|生成数量/)
  assert.deepEqual(harness.currentNode.data.params, params)
  assert.equal(harness.graph.historyCalls, 0)
})

test('configured native video families retain their opaque values and model-specific popup schema', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: '2.0',
    videoModels: [
      { value: 'model-api-key:81', model: 'doubao-seedance-2-5-260628', label: '我的 SD 2.5' },
      { value: 'model-api-key:82', model: 'MiniMax-H3', label: '我的 H3' },
    ],
  })
  await chooseModel(harness, '我的 SD 2.5')
  assert.equal(harness.currentNode.data.model, 'model-api-key:81')
  let rows = await openParams(harness)
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['480P', '720P', '1080P'])
  await escapeComposer(harness)
  await chooseModel(harness, '我的 H3')
  assert.equal(harness.currentNode.data.model, 'model-api-key:82')
  rows = await openParams(harness)
  assert.deepEqual(parameterChoices(rows, '清晰度'), ['768P', '1080P', '2K', '4K'])
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  await escapeComposer(harness)
  harness.currentNode.data.prompt = '商业产品展示'
  await flush()
  button(harness, '生成').props.onClick()
  await flush()
  assert.deepEqual(harness.tasks.runVideoCalls, [harness.currentNode.id])
  assert.equal(harness.currentNode.data.model, 'model-api-key:82')
})

test('saved native video choices retain their brand while configured route options replace the static menu', async (t) => {
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'doubao-seedance-2-5-260628',
    videoModels: [
      { value: 'model-api-key:81', model: 'doubao-seedance-2-5-260628', label: '我的 SD 2.5' },
    ],
  })
  const trigger = button(harness, '选择模型')
  assert.equal(textContent(trigger), 'Seedance 2.5 全能')
  assert.equal(
    findAll(trigger, (target) => target.props['data-icon'] === 'modelSeedanceMini').length,
    1,
  )
  assert.equal(harness.currentNode.data.model, 'doubao-seedance-2-5-260628')
  assert.equal(harness.graph.historyCalls, 0)
})

test('the image model menu merges fast and high entries without changing the selected high route', async (t) => {
  const models = [
    {
      value: 'model-api-key:41',
      label: 'image-2.5快速',
      model: 'tt-image-2.5',
      defaultVersion: 'flare',
    },
    { value: 'banana2', label: 'Banana 2', model: 'banana-2' },
    {
      value: 'model-api-key:42',
      label: 'image-2.5高质',
      model: 'tt-image-2.5',
      defaultVersion: 'sunburst',
    },
  ]
  const harness = await mountComposer(t, { model: 'model-api-key:42', models })
  const trigger = button(harness, '选择模型')
  assert.equal(textContent(trigger), 'image-2.5')
  trigger.props.onClick({ currentTarget: trigger })
  await flush()
  const options = findAll(harness.popupRoot, (target) => target.props.role === 'option')
  assert.equal(options.length, 2)
  assert.ok(textContent(options[0]).includes('image-2.5'))
  assert.doesNotMatch(textContent(options[0]), /快速|高质/)
  assert.equal(options[0].props['aria-selected'], true)
  assert.equal(harness.currentNode.data.model, 'model-api-key:42')
  assert.equal(harness.graph.historyCalls, 0)
  const rows = await openParams(harness)
  assert.equal(versionButtons(rows[0])[1].props['aria-pressed'], true)
})

test('custom-size help follows its label and explains pixel constraints in a teleported tooltip', async (t) => {
  const harness = await mountComposer(t)
  await toggleAdvanced(harness)
  const region = advancedRegion(harness)
  const help = button(harness, '关于自定义尺寸')
  assert.ok(help)
  const label = findAll(
    region,
    (target) =>
      hasClass(target, 'cv3-image-advanced-label') && textContent(target).startsWith('自定义尺寸'),
  )[0]
  assert.ok(label)
  assert.ok(findAll(label, (target) => target === help).length)
  assert.doesNotMatch(textContent(region), /AutoLink|智能引用/)
  assert.equal(button(harness, '关于智能引用 AutoLink'), undefined)
  help.props.onFocus({ currentTarget: help })
  await flush()
  const tooltip = findAll(harness.popupRoot, (target) => target.props.role === 'tooltip')[0]
  assert.ok(tooltip)
  assert.equal(help.props['aria-describedby'], tooltip.props.id)
  const helpText = textContent(tooltip)
  assert.match(helpText, /像素|宽/)
  assert.match(helpText, /auto/)
  assert.match(helpText, /16/)
  assert.match(helpText, /1[:：]3.*3[:：]1/)
  assert.match(helpText, /655360.*8294400/)
  assert.match(helpText, /覆盖.*比例.*清晰度/)
  assert.equal(findAll(region, (target) => target.props.role === 'tooltip').length, 0)
  help.props.onBlur()
  await flush()
  assert.equal(findAll(harness.popupRoot, (target) => target.props.role === 'tooltip').length, 0)

  help.props.onMouseenter({ currentTarget: help })
  await flush()
  assert.ok(findAll(harness.popupRoot, (target) => target.props.role === 'tooltip').length)
  await escapeComposer(harness)
  assert.equal(findAll(harness.popupRoot, (target) => target.props.role === 'tooltip').length, 0)
})

test('image advanced settings start folded and open inline below the composer footer', async (t) => {
  const harness = await mountComposer(t)
  const trigger = button(harness, '高级设置')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.notEqual(trigger.props['aria-haspopup'], 'dialog')
  assert.equal(
    Boolean(advancedRegion(harness) && hasClass(advancedRegion(harness), 'is-open')),
    false,
  )

  await toggleAdvanced(harness)
  const region = advancedRegion(harness)
  assert.ok(region)
  assert.ok(hasClass(region, 'cv3-image-advanced'))
  assert.ok(hasClass(region, 'is-open'))
  assert.equal(trigger.props['aria-expanded'], true)
  assert.equal(trigger.props['aria-controls'], region.props.id)
  const composer = findAll(harness.root, (target) => hasClass(target, 'cv3-composer'))[0]
  const footer = findAll(composer, (target) => hasClass(target, 'cv3-composer-footer'))[0]
  assert.equal(region.parent, composer)
  assert.ok(composer.children.indexOf(region) > composer.children.indexOf(footer))
  assert.equal(
    findAll(
      harness.popupRoot,
      (target) => target.props.role === 'dialog' && target.props['aria-label'] === '高级设置',
    ).length,
    0,
  )
  assert.ok(textContent(region).includes('高级设置'))
  assert.ok(button(harness, '关于自定义尺寸'))
  assert.doesNotMatch(textContent(region), /AutoLink|智能引用/)
})

test('the custom-size switch survives focus and popup changes without rewriting removed AutoLink data', async (t) => {
  const harness = await mountComposer(t)
  harness.currentNode.data.switches = { '智能引用 AutoLink': false }
  await flush()
  await toggleAdvanced(harness)
  const region = advancedRegion(harness)
  const toggle = findAll(
    region,
    (target) =>
      target.type === 'input' &&
      target.props.role === 'switch' &&
      target.props['aria-label'] === '自定义尺寸',
  )[0]
  assert.ok(toggle)
  assert.equal(toggle.props.type, 'checkbox')
  assert.equal(toggle.props.checked, false)
  toggle.props.onChange({ target: { checked: true } })
  await flush()
  assert.equal(harness.currentNode.data.switches.自定义尺寸, true)
  assert.equal(harness.currentNode.data.switches['智能引用 AutoLink'], false)
  assert.equal(toggle.props.checked, true)
  assert.equal(harness.graph.historyCalls, 1)

  const prompt = findAll(
    harness.root,
    (target) => target.type === 'textarea' && target.props['aria-label'] === '生成提示词',
  )[0]
  prompt.props.onFocus()
  await flush()
  assert.ok(hasClass(advancedRegion(harness), 'is-open'))
  await openParams(harness)
  assert.ok(hasClass(advancedRegion(harness), 'is-open'))
  await escapeComposer(harness)
  assert.ok(
    hasClass(advancedRegion(harness), 'is-open'),
    'Escape dismisses the parameter popup before folding advanced settings',
  )
  assert.equal(findAll(harness.popupRoot, (target) => target.props.role === 'dialog').length, 0)

  await toggleAdvanced(harness)
  assert.equal(button(harness, '高级设置').props['aria-expanded'], false)
  assert.equal(
    Boolean(advancedRegion(harness) && hasClass(advancedRegion(harness), 'is-open')),
    false,
  )
  await toggleAdvanced(harness)
  const reopened = findAll(
    advancedRegion(harness),
    (target) =>
      target.type === 'input' &&
      target.props.role === 'switch' &&
      target.props['aria-label'] === '自定义尺寸',
  )[0]
  assert.equal(reopened.props.checked, true)
  assert.equal(harness.currentNode.data.switches['智能引用 AutoLink'], false)
})

test('Escape folds image advanced settings and returns focus to their trigger', async (t) => {
  const harness = await mountComposer(t)
  const trigger = await toggleAdvanced(harness)
  await escapeComposer(harness)
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(
    Boolean(advancedRegion(harness) && hasClass(advancedRegion(harness), 'is-open')),
    false,
  )
  assert.equal(globalThis.document.activeElement, trigger)
})

test('changing the selected node or media kind resets inline advanced expansion', async (t) => {
  const harness = await mountComposer(t)
  await toggleAdvanced(harness)
  harness.currentNode.id = 'image-2'
  await flush()
  assert.equal(button(harness, '高级设置').props['aria-expanded'], false)
  await toggleAdvanced(harness)
  assert.ok(hasClass(advancedRegion(harness), 'is-open'))
  harness.currentNode.data.kind = 'video'
  await flush()
  assert.equal(advancedRegion(harness), undefined)
  harness.currentNode.data.kind = 'image'
  await flush()
  assert.equal(button(harness, '高级设置').props['aria-expanded'], false)
})

test('video retains the existing advanced-settings popup and does not render image-only inline controls', async (t) => {
  const harness = await mountComposer(t, { kind: 'video', model: '2.0' })
  await toggleAdvanced(harness)
  assert.equal(advancedRegion(harness), undefined)
  const dialog = findAll(
    harness.popupRoot,
    (target) => target.props.role === 'dialog' && target.props['aria-label'] === '高级设置',
  )[0]
  assert.ok(dialog)
  assert.deepEqual(
    findAll(dialog, (target) => hasClass(target, 'cv3-switch-row')).map(textContent),
    ['生成音频', '联网搜索', '自动校验素材', '智能引用 AutoLink'],
  )
})

function customSizeToggle(harness) {
  return findAll(
    harness.root,
    (target) =>
      target.type === 'input' &&
      target.props.role === 'switch' &&
      target.props['aria-label'] === '自定义尺寸',
  )[0]
}

function customSizeInput(harness) {
  return findAll(
    harness.root,
    (target) => target.type === 'input' && target.props.placeholder === '1536x864 或 auto',
  )[0]
}

test('TT custom size starts off, enables auto explicitly, and disables only overridden parameter controls', async (t) => {
  const harness = await mountComposer(t, {
    params: { ratio: '3:4', resolution: '4K', quality: '高画质' },
  })
  await toggleAdvanced(harness)
  const toggle = customSizeToggle(harness)
  assert.ok(toggle)
  assert.equal(toggle.props.checked, false)
  assert.equal(customSizeInput(harness), undefined)
  assert.equal(Object.hasOwn(harness.currentNode.data.params, 'customSize'), false)
  assert.equal(harness.graph.historyCalls, 0)

  toggle.props.onChange({ target: { checked: true } })
  await flush()
  assert.equal(toggle.props.checked, true)
  assert.equal(harness.currentNode.data.switches.自定义尺寸, true)
  assert.equal(harness.currentNode.data.params.customSize, 'auto')
  assert.equal(harness.currentNode.data.params.ratio, '3:4')
  assert.equal(harness.currentNode.data.params.resolution, '4K')
  assert.equal(harness.graph.historyCalls, 1)
  assert.ok(customSizeInput(harness))
  const summary = textContent(button(harness, '输出参数'))
  assert.match(summary, /auto/)
  assert.match(summary, /高画质/)
  assert.doesNotMatch(summary, /3:4|4K/)

  let rows = await openParams(harness)
  for (const label of ['比例', '清晰度']) {
    assert.ok(versionButtons(parameterRow(rows, label)).every((choice) => choice.props.disabled))
  }
  for (const label of ['版本', '画质', '背景']) {
    assert.ok(versionButtons(parameterRow(rows, label)).every((choice) => !choice.props.disabled))
  }
  toggle.props.onChange({ target: { checked: false } })
  await flush()
  assert.equal(customSizeInput(harness), undefined)
  assert.equal(harness.currentNode.data.params.ratio, '3:4')
  assert.equal(harness.currentNode.data.params.resolution, '4K')
  assert.equal(harness.currentNode.data.params.customSize, 'auto')
  rows = findAll(
    harness.popupRoot,
    (target) => target.type === 'section' && hasClass(target, 'cv3-param-field'),
  )
  for (const label of ['比例', '清晰度']) {
    assert.ok(versionButtons(parameterRow(rows, label)).every((choice) => !choice.props.disabled))
  }
  const restoredSummary = textContent(button(harness, '输出参数'))
  assert.match(restoredSummary, /3:4/)
  assert.match(restoredSummary, /4K/)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('custom-size input persists editable raw values and adds one undo point per edit session', async (t) => {
  const harness = await mountComposer(t, { params: { customSize: '1536x864' } })
  await toggleAdvanced(harness)
  const toggle = customSizeToggle(harness)
  toggle.props.onChange({ target: { checked: true } })
  await flush()
  assert.equal(harness.currentNode.data.params.customSize, '1536x864')
  const input = customSizeInput(harness)
  input.props.onFocus?.()
  input.props.onInput({ target: { value: '1536X864' } })
  await flush()
  assert.equal(harness.currentNode.data.params.customSize, '1536X864')
  assert.equal(harness.graph.historyCalls, 2)
  input.props.onInput({ target: { value: 'invalid-size' } })
  await flush()
  assert.equal(harness.currentNode.data.params.customSize, 'invalid-size')
  assert.equal(harness.graph.historyCalls, 2)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('custom-size advanced controls are absent on Banana models and ignore stale switches', async (t) => {
  const harness = await mountComposer(t, {
    params: { customSize: '1536x864', ratio: '3:4', resolution: '4K' },
    models: [
      { value: 'tt-image-2.5', model: 'tt-image-2.5', label: 'image-2.5' },
      { value: 'model-api-key:51', model: 'banana-pro', label: '香蕉专业版' },
      { value: 'model-api-key:52', model: 'banana-2.1', label: 'banana-2.1' },
    ],
  })
  await toggleAdvanced(harness)
  customSizeToggle(harness).props.onChange({ target: { checked: true } })
  await flush()
  for (const label of ['banana-pro', 'banana-2.1']) {
    await chooseModel(harness, label)
    assert.equal(customSizeToggle(harness), undefined)
    assert.equal(customSizeInput(harness), undefined)
    assert.equal(Object.hasOwn(harness.currentNode.data.params, 'customSize'), false)
    const summary = textContent(button(harness, '输出参数'))
    assert.doesNotMatch(summary, /1536x864/)
    const rows = await openParams(harness)
    for (const name of ['比例', '清晰度']) {
      assert.ok(versionButtons(parameterRow(rows, name)).every((choice) => !choice.props.disabled))
    }
  }
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('expanded custom-size composer responds to measured height and keeps controls in the viewport', async (t) => {
  const harness = await mountComposer(t, { observeComposer: true })
  const composer = findAll(harness.root, (target) => hasClass(target, 'cv3-composer'))[0]
  assert.equal(harness.observers.length, 1)
  assert.equal(harness.observers[0].target, composer)
  await toggleAdvanced(harness)
  customSizeToggle(harness).props.onChange({ target: { checked: true } })
  await flush()

  harness.resizeComposer(600)
  await flush()
  assert.equal(composer.props.style.top, '276px')
  assert.ok(parseFloat(composer.props.style.top) + 600 <= globalThis.window.innerHeight - 16)
  assert.equal(composer.props.style.overflowY, undefined)

  harness.resizeViewport(680)
  await flush()
  assert.equal(composer.props.style.top, '64px')
  assert.ok(parseFloat(composer.props.style.top) + 600 <= globalThis.window.innerHeight - 16)

  harness.resizeComposer(900)
  await flush()
  assert.equal(composer.props.style.top, '48px')
  assert.equal(composer.props.style.maxHeight, 'calc(100dvh - 64px)')
  assert.equal(composer.props.style.overflowY, 'auto')
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('live pricing stays beside Generate without a lightning icon, uses two decimals and warns only above 500', async (t) => {
  const requests = []
  const harness = await mountComposer(t, {
    kind: 'video',
    model: 'model-api-key:pricing-wan',
    videoModels: [{ value: 'model-api-key:pricing-wan', model: 'wan3.0-video-quannengcankao' }],
    pricingUser: { isAuthenticated: true, token: 'local-test-session', profile: { id: 1 } },
    pricingFetch: async (url, options) => {
      assert.equal(url, '/api/canvas-pricing/estimate')
      assert.equal(options.method, 'POST')
      const request = JSON.parse(options.body)
      requests.push(request)
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            available: true,
            amount: request.params.resolution === '1080P' ? '500.01' : '500',
            unit: '米值',
            kind: 'estimate',
            platformUnit: '算力',
            conversionMultiplier: 100,
            expiresAt: Date.now() + 30000,
          },
        }),
      }
    },
  })
  const cost = () => findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]
  const warning = () => findAll(harness.root, (target) => hasClass(target, 'cv3-pricing-warning'))
  assert.equal(textContent(cost()).trim(), '预计 … 米值')
  await new Promise((resolve) => setTimeout(resolve, 340))
  await flush()
  assert.equal(textContent(cost()).trim(), '预计 500.00 米值')
  assert.match(cost().props.title, /×100/)
  assert.equal(warning().length, 0)
  assert.equal(findAll(cost(), (target) => target.props['data-icon'] === 'power').length, 0)
  await openParams(harness)
  findAll(
    harness.popupRoot,
    (target) => target.type === 'button' && target.props['data-value'] === '1080P',
  )[0].props.onClick()
  await flush()
  assert.equal(textContent(cost()).trim(), '预计 … 米值')
  await new Promise((resolve) => setTimeout(resolve, 340))
  await flush()
  assert.equal(textContent(cost()).trim(), '预计 500.01 米值')
  assert.match(textContent(warning()[0]), /约合超过 5 元/)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].params.resolution, '1080P')
  assert.deepEqual(harness.tasks.runVideoCalls, [])
  harness.user.isAuthenticated = false
  await flush()
  assert.equal(textContent(cost()).trim(), '预计 — 米值')
  assert.equal(warning().length, 0)
})

test('unavailable pricing explains the reason without inventing a cost or disabling generation', async (t) => {
  const harness = await mountComposer(t, {
    model: 'model-api-key:pricing-banana',
    models: [{ value: 'model-api-key:pricing-banana', model: 'banana-2.1' }],
    pricingUser: { isAuthenticated: true },
    pricingFetch: async () => ({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          available: false,
          message: '当前渠道按未知 token 数计费，暂不能可靠预估',
        },
      }),
    }),
  })
  harness.currentNode.data.prompt = '一只猫'
  await new Promise((resolve) => setTimeout(resolve, 340))
  await flush()
  const cost = findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]
  assert.equal(textContent(cost).trim(), '预计 — 米值')
  assert.match(cost.props.title, /token/)
  assert.equal(button(harness, '生成').props.disabled, false)
  assert.deepEqual(harness.tasks.runImageCalls, [])
})

test('editing an existing image quotes its source plus unique image references without creating a result node', async (t) => {
  const requests = []
  const harness = await mountComposer(t, {
    model: 'model-api-key:pricing-banana',
    models: [{ value: 'model-api-key:pricing-banana', model: 'banana-2.1' }],
    pricingUser: { isAuthenticated: true },
    pricingFetch: async (_url, options) => {
      requests.push(JSON.parse(options.body))
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            available: true,
            amount: '0',
            unit: '米值',
            kind: 'estimate',
            expiresAt: Date.now() + 30000,
          },
        }),
      }
    },
  })
  harness.currentNode.data.assetUrl = 'https://example.com/original.png'
  await connectReferences(harness, [
    { assetUrl: 'https://example.com/reference.png' },
    { assetUrl: 'https://example.com/reference.png' },
    { kind: 'video', assetUrl: 'https://example.com/ignored.mp4' },
  ])
  await new Promise((resolve) => setTimeout(resolve, 340))
  await flush()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].reference.imageCount, 2)
  assert.equal(requests[0].reference.videoCount, 0)
  assert.equal(harness.graph.nodes.length, 4)
  assert.equal(harness.graph.historyCalls, 0)
  const cost = findAll(harness.root, (target) => hasClass(target, 'cv3-composer-cost'))[0]
  assert.equal(textContent(cost).trim(), '预计 0.00 米值')
  assert.deepEqual(harness.tasks.runImageCalls, [])
})
