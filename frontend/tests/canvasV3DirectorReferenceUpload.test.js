import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/DirectorReferenceUpload.vue',
  import.meta.url,
)
const componentPromise = readFile(componentUrl, 'utf8').then(async (source) => {
  assert.doesNotMatch(source, /v-html|innerHTML/)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'reference-upload-test', inlineTemplate: true })
  const vueUrl = import.meta.resolve('vue')
  const pickerStub = `
    const DirectorAttachmentPicker = {
      props: ['open', 'availableAssets', 'attachedIds'],
      emits: ['update:open', 'local-files', 'select-assets'],
      setup: (props, { emit }) => () => testH('attachment-picker-stub', {
        open: props.open,
        availableAssets: props.availableAssets,
        attachedIds: props.attachedIds,
        onUpdateOpen: (value) => emit('update:open', value),
        onLocalFiles: (files) => emit('local-files', files),
        onSelectAssets: (assets) => emit('select-assets', assets),
      }),
    }
  `
  const moduleSource = `import { h as testH } from '${vueUrl}';\n${compiled.content}`
    .replace(/from (["'])vue\1/g, `from '${vueUrl}'`)
    .replace(
      /from (["'])\.\.\/config\/directorAttachments\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/directorAttachments.js', import.meta.url).href}'`,
    )
    .replace(
      /from (["'])\.\.\/config\/directorClarifications\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/directorClarifications.js', import.meta.url).href}'`,
    )
    .replace(
      /import DirectorAttachmentPicker from ['"]\.\/DirectorAttachmentPicker\.vue['"]/,
      pickerStub,
    )
    .replace(
      /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
      'const CanvasIcon = { render: () => null }',
    )
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
  )
  return module.default
})

function node(type, text = '') {
  return {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    clicks: 0,
    click() {
      this.clicks += 1
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

function findAll(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => findAll(child, predicate)),
  ]
}

function textContent(target) {
  return `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
}

async function mountUpload(initial = {}) {
  const Upload = await componentPromise
  const state = reactive({
    images: [],
    availableAssets: [],
    disabled: false,
    open: false,
    ...initial,
  })
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Upload, {
        ...state,
        onLocalFiles: (files) => events.push(['local-files', files]),
        onSelectAssets: (assets) => events.push(['select-assets', assets]),
        onRemove: (image) => events.push(['remove', image]),
        onRetry: (image) => events.push(['retry', image]),
        onUpdateRole: (image, role) => events.push(['update-role', image, role]),
        'onUpdate:open': (open) => events.push(['update:open', open]),
      }),
  })
  app.mount(root)
  return { state, events, root, app }
}

test('reference upload exposes an image-only multiple file input and clears each selection', async () => {
  const { root, events, app } = await mountUpload()
  const input = findAll(root, (target) => target.type === 'input')[0]
  const upload = findAll(root, (target) => target.type === 'button')[0]
  assert.equal(input.props.type, 'file')
  assert.equal(input.props.accept, 'image/*')
  assert.equal(input.props.multiple, '')
  assert.equal(input.props.hidden, '')
  assert.equal(input.props.disabled, false)
  assert.match(textContent(upload), /上传参考图片/)
  upload.props.onClick()
  assert.equal(input.clicks, 1)
  const files = [
    { name: '床垫.jpg', type: 'image/jpeg' },
    { name: '窗帘.png', type: 'image/png' },
  ]
  const target = { files, value: 'C:\\fakepath\\床垫.jpg' }
  input.props.onChange({ target })
  assert.equal(target.value, '')
  assert.deepEqual(events, [['local-files', files]])
  input.props.onChange({ target: { files: [], value: '' } })
  assert.equal(events.length, 1)
  app.unmount()
})

test('reference image rows render uploading ready and failed states and emit image actions', async () => {
  const images = [
    {
      id: 'uploading',
      name: '上传中.jpg',
      previewUrl: 'blob:test-image',
      status: 'uploading',
      progress: 42.6,
    },
    {
      id: 'ready',
      name: '商品原图.jpg',
      url: 'https://example.test/product.jpg',
      status: 'ready',
      referenceRole: 'product',
    },
    { id: 'error', name: '重试.jpg', status: 'error', error: '网络异常，请重试' },
    { id: 'failed', name: '不支持.jpg', status: 'failed', retryable: false },
  ]
  const { root, events, app } = await mountUpload({ images })
  const list = findAll(root, (target) => target.type === 'ul')[0]
  assert.equal(list.props['aria-label'], '已选择的参考图片')
  assert.equal(findAll(list, (target) => target.type === 'li').length, 4)
  assert.equal(findAll(list, (target) => target.props.role === 'status').length, 1)
  assert.match(textContent(list), /上传中 43%/)
  assert.equal(findAll(list, (target) => target.props.role === 'alert').length, 2)
  assert.match(textContent(list), /已就绪/)
  assert.match(textContent(list), /网络异常，请重试/)
  assert.deepEqual(
    findAll(list, (target) => target.type === 'img').map((target) => [
      target.props.src,
      target.props.alt,
    ]),
    [
      ['blob:test-image', '上传中.jpg'],
      ['https://example.test/product.jpg', '商品原图.jpg'],
    ],
  )
  const retry = findAll(
    list,
    (target) => target.type === 'button' && textContent(target).trim() === '重新上传',
  )
  assert.equal(retry.length, 1)
  retry[0].props.onClick()
  const remove = findAll(
    list,
    (target) => target.props['aria-label'] === '移除参考图片 商品原图.jpg',
  )[0]
  remove.props.onClick()
  const role = findAll(
    list,
    (target) => target.type === 'select' && target.props['aria-label'] === '商品原图.jpg的参考用途',
  )[0]
  assert.equal(role.props.value, 'product')
  assert.deepEqual(
    role.children.map((target) => target.props.value),
    ['', 'product', 'style', 'other'],
  )
  role.props.onChange({ target: { value: 'style' } })
  assert.deepEqual(events, [
    ['retry', images[2]],
    ['remove', images[1]],
    ['update-role', images[1], 'style'],
  ])
  app.unmount()
})

test('reference library receives only images and selected layer ids and forwards picker events', async () => {
  const assets = [
    { id: 'image', kind: 'image', url: '/product.jpg' },
    { id: 'mime-image', mimeType: 'image/png', url: '/curtain.png' },
    { id: 'video', kind: 'video', url: '/product.mp4' },
    { id: 'audio', type: 'audio/mpeg', url: '/voice.mp3' },
    { id: 'file', mimeType: 'application/pdf', url: '/spec.pdf' },
  ]
  const { state, root, events, app } = await mountUpload({
    images: [{ id: 'local-1' }, { id: 'asset-id', layerId: 'canvas-layer' }],
    availableAssets: assets,
    open: true,
  })
  const picker = findAll(root, (target) => target.type === 'attachment-picker-stub')[0]
  assert.equal(picker.props.open, true)
  assert.deepEqual(picker.props.availableAssets, assets.slice(0, 2))
  assert.deepEqual(picker.props.attachedIds, ['local-1', 'canvas-layer'])
  const files = [{ name: '更多参考.jpg', type: 'image/jpeg' }]
  picker.props.onUpdateOpen(false)
  picker.props.onLocalFiles(files)
  picker.props.onSelectAssets([assets[0]])
  assert.deepEqual(events, [
    ['update:open', false],
    ['local-files', files],
    ['select-assets', [assets[0]]],
  ])
  state.disabled = true
  await nextTick()
  assert.equal(findAll(root, (target) => target.type === 'attachment-picker-stub').length, 0)
  picker.props.onLocalFiles(files)
  picker.props.onSelectAssets([assets[0]])
  assert.equal(events.length, 3)
  app.unmount()
})

test('disabled upload guards local file events and disables native image controls', async () => {
  const { state, root, events, app } = await mountUpload({
    disabled: true,
    images: [{ id: 'error', name: '床垫.jpg', status: 'error' }],
  })
  const input = findAll(root, (target) => target.type === 'input')[0]
  assert.equal(input.props.disabled, true)
  assert.ok(
    findAll(root, (target) => ['button', 'select'].includes(target.type)).every(
      (target) => target.props.disabled,
    ),
  )
  const target = {
    files: [{ name: 'ignored.jpg', type: 'image/jpeg' }],
    value: 'C:\\fakepath\\ignored.jpg',
  }
  input.props.onChange({ target })
  assert.equal(target.value, '')
  assert.equal(events.length, 0)
  state.disabled = false
  await nextTick()
  input.props.onChange({ target })
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'local-files')
  app.unmount()
})
