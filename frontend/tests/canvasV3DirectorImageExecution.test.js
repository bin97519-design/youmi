import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import {
  DIRECTOR_IMAGE_COUNTS,
  DIRECTOR_IMAGE_RATIOS,
  DIRECTOR_IMAGE_RESOLUTIONS,
  createDirectorImageExecutionIntent,
  validateDirectorImageExecution,
} from '../src/features/canvas-v3/config/directorImageExecution.js'

const configuredModels = [
  { value: 'banana2', label: '香蕉 2' },
  { value: 'banana-pro-api', label: '香蕉 Pro' },
]
const settings = { model: 'banana2', ratio: '16:9', resolution: '2K', count: 1 }

test('execution validates actual configured model values and strict selectable parameters', () => {
  assert.equal(validateDirectorImageExecution(settings, configuredModels), '')
  for (const model of ['', '香蕉 2', 'Banana2', 'banana2 ', 'unconfigured'])
    assert.match(validateDirectorImageExecution({ ...settings, model }, configuredModels), /模型/)
  assert.match(validateDirectorImageExecution(settings, []), /模型/)
  assert.match(validateDirectorImageExecution(null, configuredModels), /模型/)
  for (const ratio of ['16/9', 'landscape', '', undefined])
    assert.match(validateDirectorImageExecution({ ...settings, ratio }, configuredModels), /比例/)
  for (const resolution of ['8K', '2k', '', undefined])
    assert.match(
      validateDirectorImageExecution({ ...settings, resolution }, configuredModels),
      /分辨率/,
    )
  for (const count of [0, 3, 8, '1', 1.5])
    assert.match(validateDirectorImageExecution({ ...settings, count }, configuredModels), /张/)
  for (const ratio of DIRECTOR_IMAGE_RATIOS)
    assert.equal(validateDirectorImageExecution({ ...settings, ratio }, configuredModels), '')
  for (const resolution of DIRECTOR_IMAGE_RESOLUTIONS)
    assert.equal(validateDirectorImageExecution({ ...settings, resolution }, configuredModels), '')
  for (const count of DIRECTOR_IMAGE_COUNTS)
    assert.equal(validateDirectorImageExecution({ ...settings, count }, configuredModels), '')
})

test('confirmed settings create a new frozen intent without rewriting references or other paid settings', () => {
  const references = Object.freeze([{ id: 'product', url: 'https://assets.test/product.jpg' }])
  const intent = Object.freeze({
    generationType: 'image',
    requestedModels: Object.freeze([]),
    nodeModel: '',
    referenceAssets: references,
    referenceLayerIds: Object.freeze(['product']),
    attachments: references,
    imageSourceMode: 'reference',
    quality: '高画质',
    background: '透明背景',
    width: 1600,
    height: 900,
    ratio: '16:9',
    resolution: '1K',
    count: 1,
  })
  const next = createDirectorImageExecutionIntent(
    intent,
    { ...settings, ratio: '1:1', count: 2, background: '自动', referenceAssets: [] },
    configuredModels,
  )
  assert.notEqual(next, intent)
  assert.equal(Object.isFrozen(next), true)
  assert.equal(Object.isFrozen(next.requestedModels), true)
  assert.equal(Object.isFrozen(next.requestedModels[0]), true)
  assert.deepEqual(next.requestedModels, [{ id: 'banana2', name: '香蕉 2', modality: 'image' }])
  assert.equal(next.nodeModel, 'banana2')
  assert.equal(next.ratio, '1:1')
  assert.equal(next.resolution, '2K')
  assert.equal(next.count, 2)
  assert.equal(next.width, null)
  assert.equal(next.height, null)
  assert.equal(next.executionConfirmed, true)
  assert.equal(next.referenceAssets, references)
  assert.equal(next.attachments, references)
  assert.equal(next.referenceLayerIds, intent.referenceLayerIds)
  assert.equal(next.imageSourceMode, 'reference')
  assert.equal(next.quality, '高画质')
  assert.equal(next.background, '透明背景')
  assert.equal(intent.nodeModel, '')
  assert.equal(intent.width, 1600)
  assert.throws(() =>
    createDirectorImageExecutionIntent(intent, { ...settings, model: '假的' }, configuredModels),
  )
})

const componentUrl = new URL(
  '../src/features/canvas-v3/components/DirectorImageExecutionCard.vue',
  import.meta.url,
)
const componentPromise = readFile(componentUrl, 'utf8').then(async (source) => {
  assert.doesNotMatch(source, /v-html|innerHTML|fetch\s*\(|axios|setTimeout/)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'image-execution-test', inlineTemplate: true })
  const moduleSource = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /from (["'])\.\.\/config\/directorImageExecution\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/directorImageExecution.js', import.meta.url).href}'`,
    )
    .replace(
      /from (["'])\.\.\/config\/imageModelVersions\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/imageModelVersions.js', import.meta.url).href}'`,
    )
    .replace(
      /from (["'])\.\.\/\.\.\/\.\.\/utils\/imageMiPricing\.js\1/g,
      `from '${new URL('../src/utils/imageMiPricing.js', import.meta.url).href}'`,
    )
  return (
    await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
  ).default
})

function node(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
}
function detach(child) {
  const parent = child.parent
  if (!parent) return
  const index = parent.children.indexOf(child)
  if (index >= 0) parent.children.splice(index, 1)
  child.parent = null
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
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
  },
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
})
function all(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => all(child, predicate)),
  ]
}
function text(target) {
  return `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`
}
async function mountCard(initial = {}) {
  const Card = await componentPromise
  const state = reactive({
    models: configuredModels,
    configuration: settings,
    nodeId: 'output-1',
    phase: 'ready',
    ...initial,
  })
  const root = node('root')
  const events = []
  const app = renderer.createApp({
    setup: () => () =>
      h(Card, {
        ...state,
        onConfirm: (value) => events.push(['confirm', value]),
        onLocate: () => events.push(['locate']),
        onRefreshModels: () => events.push(['refresh-models']),
      }),
  })
  app.mount(root)
  return { root, events, state, app }
}
function submit(root) {
  all(root, (target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
}

test('execution card uses native labeled selects and confirms only explicit choices with correct cost', async () => {
  const { root, events, app } = await mountCard()
  const selects = all(root, (target) => target.type === 'select')
  assert.equal(selects.length, 4)
  const labels = all(root, (target) => target.type === 'label')
  assert.deepEqual(
    labels.map((label) => label.props.for),
    selects.map((select) => select.props.id),
  )
  assert.match(text(root), /图片节点已创建，确认后开始生成/)
  assert.match(text(root), /预计 9 米/)
  selects[0].props.onChange({ target: { value: 'banana-pro-api' } })
  selects[1].props.onChange({ target: { value: '1:1' } })
  selects[2].props.onChange({ target: { value: '4K' } })
  selects[3].props.onChange({ target: { value: '2' } })
  await nextTick()
  assert.deepEqual(events, [])
  assert.match(text(root), /预计 42 米/)
  submit(root)
  assert.deepEqual(events, [
    ['confirm', { model: 'banana-pro-api', ratio: '1:1', resolution: '4K', count: 2 }],
  ])
  all(root, (target) => target.type === 'button' && text(target) === '定位节点')[0].props.onClick()
  assert.deepEqual(events.at(-1), ['locate'])
  app.unmount()
})

test('one image-2.5 menu entry keeps an existing enhanced route through refresh and confirmation', async () => {
  const ttModels = [
    { value: 'model-api-key:44', model: 'tt-image-2.5', label: '快速', defaultVersion: 'flare' },
    { value: 'model-api-key:45', model: 'tt-image-2.5', label: '高质', defaultVersion: 'sunburst' },
  ]
  const { root, events, state, app } = await mountCard({
    models: [ttModels[0], configuredModels[0], ttModels[1]],
    configuration: { ...settings, model: ttModels[1].value },
  })
  const select = () => all(root, (target) => target.type === 'select')[0]
  const selectable = () => all(select(), (target) => target.type === 'option' && target.props.value)
  assert.deepEqual(
    selectable().map((option) => option.props.value),
    [ttModels[1].value, configuredModels[0].value],
  )
  assert.equal(text(selectable()[0]), 'image-2.5')
  assert.equal(select().props.value, ttModels[1].value)
  state.models = [...ttModels].reverse()
  await nextTick()
  assert.equal(select().props.value, ttModels[1].value)
  assert.equal(selectable().length, 1)
  assert.deepEqual(events, [])
  submit(root)
  assert.deepEqual(events, [['confirm', { ...settings, model: ttModels[1].value }]])
  assert.equal(ttModels[1].label, '高质')
  app.unmount()
})

test('an empty model never auto-selects a chargeable route; absent or invalid node/config blocks confirmation', async () => {
  const { root, events, state, app } = await mountCard({
    configuration: { ...settings, model: '' },
  })
  assert.equal(all(root, (target) => target.type === 'select')[0].props.value, '')
  submit(root)
  assert.deepEqual(events, [])
  state.configuration = { ...settings, model: 'fake-model' }
  await nextTick()
  submit(root)
  assert.deepEqual(events, [])
  state.configuration = { ...settings, ratio: 'invented-ratio' }
  await nextTick()
  submit(root)
  assert.deepEqual(events, [])
  state.configuration = { ...settings }
  state.nodeId = ''
  await nextTick()
  assert.match(text(root), /准备图片节点/)
  submit(root)
  assert.deepEqual(events, [])
  app.unmount()
})

test('empty or failed model loading exposes reload without inventing options', async () => {
  const { root, events, app } = await mountCard({ models: [], modelError: '模型目录加载失败' })
  assert.equal(all(root, (target) => target.type === 'select')[0].props.disabled, true)
  assert.equal(
    all(root, (target) => target.type === 'option' && target.props.value === 'banana2').length,
    0,
  )
  assert.match(text(root), /模型目录加载失败/)
  submit(root)
  assert.deepEqual(events, [])
  all(
    root,
    (target) => target.type === 'button' && text(target).includes('重新加载模型'),
  )[0].props.onClick()
  assert.deepEqual(events, [['refresh-models']])
  app.unmount()
})

test('a stale option list cannot authorize generation while model loading has failed', async () => {
  const { root, events, app } = await mountCard({ modelError: '模型目录暂不可用' })
  submit(root)
  assert.deepEqual(events, [])
  assert.match(text(root), /模型目录暂不可用/)
  app.unmount()
})

test('disabled and submitted lifecycle states guard handlers as well as the visual controls', async () => {
  const { root, events, state, app } = await mountCard({ disabled: true })
  for (const phase of ['ready', 'submitting', 'submitted', 'succeeded']) {
    state.phase = phase
    state.disabled = phase === 'ready'
    await nextTick()
    const selects = all(root, (target) => target.type === 'select')
    assert.equal(
      selects.every((select) => select.props.disabled),
      true,
    )
    selects[0].props.onChange({ target: { value: 'banana-pro-api' } })
    submit(root)
    assert.deepEqual(events, [])
    assert.equal(selects[0].props.value, 'banana2')
    if (phase !== 'ready')
      assert.equal(
        all(root, (target) => target.type === 'button' && text(target).includes('确认生图')).length,
        0,
      )
  }
  assert.match(text(root), /图片已生成/)
  state.phase = 'failed'
  await nextTick()
  assert.match(text(root), /重试生图/)
  submit(root)
  assert.equal(events.length, 1)
  app.unmount()
})
