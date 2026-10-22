import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  canvasImageFiles,
  canvasImageTargetIsEditable,
  canvasTransferHasFiles,
  createCanvasImageImporter,
  readCanvasImage,
} from '../src/features/canvas-v3/sync/canvasImageImport.js'

const MAX_BYTES = 20 * 1024 * 1024
const file = (name = 'picture.png', size = 120, type = 'image/png') => ({ name, size, type })
const decoded = { dataUrl: 'data:image/png;base64,aGVsbG8=', width: 900, height: 600 }
const flush = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => (resolve = yes))
  return { promise, resolve }
}
function importer(options = {}) {
  const uploads = []
  const batches = []
  const statuses = []
  const graph = {
    projectId: 'canvas-a',
    nodes: [],
    addImageAssets(assets, anchor) {
      batches.push({ assets, anchor })
      return assets.map((asset, index) => ({ id: `import-${index}`, data: asset }))
    },
  }
  const instance = createCanvasImageImporter({
    graph,
    maxBytes: MAX_BYTES,
    readImage: async () => decoded,
    upload: async (value, settings) => {
      uploads.push({ value, settings })
      return `https://example.test/${value.name}`
    },
    onStatus: (status) => statuses.push(status),
    ...options,
  })
  return { instance, graph, uploads, batches, statuses }
}

test('clipboard and drag transfers extract images once, including MIME-less file copies', () => {
  const image = file()
  const jpg = file('photo.jpg', 12, '')
  const transfer = {
    files: [image, jpg, file('note.txt', 10, 'text/plain')],
    items: [{ kind: 'file', getAsFile: () => image }],
  }
  assert.deepEqual(canvasImageFiles(transfer), [image, jpg])
  assert.deepEqual(canvasImageFiles({ items: transfer.items }), [image])
  assert.deepEqual(canvasImageFiles({ items: [{ kind: 'file', getAsFile: () => null }] }), [])
  assert.deepEqual(
    canvasImageFiles({ files: [], items: [{ kind: 'string', type: 'text/html' }] }),
    [],
  )
  assert.deepEqual(canvasImageFiles(null), [])
})

test('protected dragover mode detects Files before browsers expose file bytes', () => {
  assert.equal(canvasTransferHasFiles({ types: ['Files'], files: [] }), true)
  assert.equal(canvasTransferHasFiles({ items: [{ kind: 'file', type: '' }] }), true)
  assert.equal(canvasTransferHasFiles({ files: [file()] }), true)
  assert.equal(canvasTransferHasFiles({ types: ['text/plain', 'application/x-node'] }), false)
})

test('native paste belongs to text inputs, contenteditables, dialogs and Director controls', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
    assert.equal(canvasImageTargetIsEditable({ tagName }), true)
  assert.equal(canvasImageTargetIsEditable({ isContentEditable: true }), true)
  assert.equal(canvasImageTargetIsEditable({ closest: () => ({}) }), true)
  assert.equal(canvasImageTargetIsEditable({ tagName: 'DIV', closest: () => null }), false)
  assert.equal(canvasImageTargetIsEditable(null), false)
})

test('a batch uploads original files and inserts durable image nodes only after all files resolve', async () => {
  const h = importer()
  const files = [file('first.png'), file('second.png')]
  const anchor = { x: -320, y: 140 }
  const pending = h.instance.importFiles(files, anchor)
  anchor.x = 9999
  const nodes = await pending
  assert.equal(nodes.length, 2)
  assert.equal(h.batches.length, 1)
  assert.deepEqual(h.batches[0].anchor, { x: -320, y: 140 })
  assert.deepEqual(
    h.batches[0].assets.map((asset) => asset.title),
    ['first.png', 'second.png'],
  )
  assert.ok(h.batches[0].assets.every((asset) => asset.assetUrl.startsWith('https://')))
  assert.equal(h.batches[0].assets[0].mediaWidth, 900)
  assert.equal(h.batches[0].assets[0].mediaHeight, 600)
  assert.deepEqual(
    h.uploads.map((call) => call.value),
    files,
  )
  assert.equal(h.uploads[0].settings.dir, 'youmi-canvas/uploads')
  assert.equal(h.uploads[0].settings.signal.aborted, false)
  assert.match(h.statuses.at(-1).message, /2 张图片加入画布/)
})

test('small unauthenticated imports persist data URLs without any cloud calls', async () => {
  const h = importer({ canUpload: () => false })
  await h.instance.importFiles([file()], { x: 0, y: 0 })
  assert.equal(h.uploads.length, 0)
  assert.equal(h.batches[0].assets[0].assetUrl, decoded.dataUrl)
  assert.match(h.statuses.at(-1).message, /本地保存/)
})

test('MIME-less local file copies retain their bytes while uploads receive an image content type', async () => {
  const h = importer()
  const original = new File(['actual-image-bytes'], 'PHOTO.PNG', { type: '' })
  await h.instance.importFiles([original], { x: 0, y: 0 })
  const uploaded = h.uploads[0].value
  assert.equal(uploaded.type, 'image/png')
  assert.equal(uploaded.size, original.size)
  assert.equal(await uploaded.text(), await original.text())
  assert.equal(original.type, '')
})

test('failed uploads fall back only to bounded persistent data, never ephemeral blob URLs', async () => {
  const h = importer({ upload: async () => 'blob:temporary' })
  await h.instance.importFiles([file()], { x: 1, y: 2 })
  assert.equal(h.batches[0].assets[0].assetUrl, decoded.dataUrl)
  const large = importer({
    upload: async () => {
      throw new Error('offline')
    },
  })
  await large.instance.importFiles([file('big.png', 2 * 1024 * 1024)], { x: 0, y: 0 })
  assert.equal(large.batches.length, 0)
  assert.match(large.statuses.at(-1).message, /上传失败.*offline/)
})

test('local storage budget and large anonymous files fail visibly instead of losing saved images', async () => {
  const h = importer({ canUpload: () => false })
  h.graph.nodes = [{ data: { assetUrl: `data:${'x'.repeat(2500000)}` } }]
  await h.instance.importFiles([file()], { x: 0, y: 0 })
  assert.equal(h.batches.length, 0)
  assert.match(h.statuses.at(-1).message, /存储空间不足/)
})

test('unsupported SVG, oversize and corrupt files do not prevent valid batch members from importing', async () => {
  const h = importer({
    readImage: async (value) => {
      if (value.name === 'corrupt.png') throw new Error('无法解码图片')
      return decoded
    },
  })
  await h.instance.importFiles(
    [
      file('vector.svg', 10, 'image/svg+xml'),
      file('huge.png', MAX_BYTES + 1),
      file('corrupt.png'),
      file('ok.png'),
    ],
    { x: 0, y: 0 },
  )
  assert.equal(h.uploads.length, 1)
  assert.equal(h.batches[0].assets[0].title, 'ok.png')
  assert.equal(h.statuses.at(-1).error, true)
  assert.match(h.statuses.at(-1).message, /3 张导入失败/)
})

test('navigation or account scope changes never insert asynchronous results into another canvas', async () => {
  const wait = deferred()
  const h = importer({ upload: () => wait.promise })
  const pending = h.instance.importFiles([file()], { x: 0, y: 0 })
  await flush()
  h.graph.projectId = 'canvas-b'
  wait.resolve('https://example.test/original.png')
  assert.deepEqual(await pending, [])
  assert.equal(h.batches.length, 0)
})

test('dispose aborts uploads and cancels queued imports without creating nodes', async () => {
  const wait = deferred()
  let signal
  const h = importer({
    upload: (_file, settings) => {
      signal = settings.signal
      return wait.promise
    },
  })
  const first = h.instance.importFiles([file()], { x: 0, y: 0 })
  const second = h.instance.importFiles([file('next.png')], { x: 2, y: 3 })
  await flush()
  h.instance.dispose()
  assert.equal(signal.aborted, true)
  wait.resolve('https://example.test/original.png')
  assert.deepEqual(await first, [])
  assert.deepEqual(await second, [])
  assert.deepEqual(await h.instance.importFiles([file()], {}), [])
  assert.equal(h.batches.length, 0)
})

test('the browser decoder preserves intrinsic image size, rejects bad images and supports abort', async (t) => {
  const original = { FileReader: globalThis.FileReader, Image: globalThis.Image }
  t.after(() => Object.assign(globalThis, original))
  let fail = false
  globalThis.FileReader = class {
    result = decoded.dataUrl
    abort() {}
    readAsDataURL() {
      queueMicrotask(() => this.onload())
    }
  }
  globalThis.Image = class {
    naturalWidth = 900
    naturalHeight = 600
    set src(_value) {
      queueMicrotask(() => (fail ? this.onerror() : this.onload()))
    }
  }
  assert.deepEqual(await readCanvasImage(file()), decoded)
  fail = true
  await assert.rejects(readCanvasImage(file()), /无法解码图片/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readCanvasImage(file(), { signal: controller.signal }), {
    name: 'AbortError',
  })
})

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
function shellHandlers() {
  const imports = []
  const context = {
    mode: { value: 'workflow' },
    activePanel: { value: '' },
    previewImage: { value: '' },
    previewVideo: { value: null },
    emotionSource: { value: null },
    angleSource: { value: null },
    imageDialog: { value: null },
    imageContext: { value: null },
    videoDialog: { value: null },
    videoContext: { value: null },
    selectionSaveNodes: { value: null },
    groupWorkflow: { value: null },
    parseNodeClipboard: () => null,
    graph: { hydrated: true },
    imageDragActive: { value: false },
    imageImportStatus: { value: null },
    canvasWrap: {
      value: { getBoundingClientRect: () => ({ left: 100, top: 40, width: 900, height: 600 }) },
    },
    screenToFlowCoordinate: ({ x, y }) => ({ x: (x - 100) / 2, y: (y + 80) / 2 }),
    clearPendingReference() {},
    resetVideoActions() {},
    canvasImageFiles,
    canvasImageTargetIsEditable,
    canvasTransferHasFiles,
    imageImporter: { importFiles: async (files, point) => imports.push({ files, point }) },
  }
  const names = [
    'canImportCanvasImages',
    'importCanvasImages',
    'handleCanvasImagePaste',
    'handleCanvasImageDragOver',
    'handleCanvasImageDragLeave',
    'handleCanvasImageDrop',
  ]
  const source = names
    .map(
      (name) => shell.match(new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0],
    )
    .join('\n')
  runInNewContext(`${source}\nthis.handlers = { ${names.join(', ')} }`, context)
  const event = (extra = {}) => ({
    defaultPrevented: false,
    target: { tagName: 'DIV', closest: () => null },
    clipboardData: { files: [file()] },
    dataTransfer: { types: ['Files'], files: [file()] },
    clientX: 500,
    clientY: 240,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...extra,
  })
  return { context, imports, handlers: context.handlers, event }
}

test('actual Shell paste handler imports at viewport center without stealing native text or handled pastes', async () => {
  const h = shellHandlers()
  const event = h.event()
  h.handlers.handleCanvasImagePaste(event)
  await flush()
  assert.equal(event.prevented, true)
  assert.deepEqual(JSON.parse(JSON.stringify(h.imports[0].point)), { x: 225, y: 210 })
  for (const extra of [
    { target: { tagName: 'TEXTAREA' } },
    { defaultPrevented: true },
    { clipboardData: { items: [{ kind: 'string' }] } },
  ]) {
    const ignored = h.event(extra)
    h.handlers.handleCanvasImagePaste(ignored)
    assert.equal(ignored.prevented, false)
  }
  assert.equal(h.imports.length, 1)
  h.context.activePanel.value = 'characters'
  h.handlers.handleCanvasImagePaste(h.event())
  assert.equal(h.imports.length, 1)
})

test('actual Shell drop handles world coordinates under pan/zoom and rejects non-images without navigation', async () => {
  const h = shellHandlers()
  const event = h.event()
  h.handlers.handleCanvasImageDragOver(event)
  assert.equal(event.dataTransfer.dropEffect, 'copy')
  assert.equal(h.context.imageDragActive.value, true)
  h.handlers.handleCanvasImageDrop(event)
  await flush()
  assert.equal(event.stopped, true)
  assert.equal(h.context.imageDragActive.value, false)
  assert.deepEqual(JSON.parse(JSON.stringify(h.imports[0].point)), { x: 200, y: 160 })
  const pdf = h.event({
    dataTransfer: { types: ['Files'], files: [file('book.pdf', 100, 'application/pdf')] },
  })
  h.handlers.handleCanvasImageDrop(pdf)
  assert.equal(pdf.prevented, true)
  assert.equal(h.imports.length, 1)
  assert.match(h.context.imageImportStatus.value.message, /请拖入.*图片文件/)
  const nodeDrag = h.event({ dataTransfer: { types: ['application/x-node'] } })
  h.handlers.handleCanvasImageDragOver(nodeDrag)
  assert.equal(nodeDrag.prevented, false)
})

test('video dialogs and fullscreen playback prevent global paste, upload and file-drop imports', async () => {
  for (const owner of ['videoDialog', 'previewVideo']) {
    const h = shellHandlers()
    h.context[owner].value = { nodeId: 'video' }
    assert.equal(h.handlers.canImportCanvasImages(), false)
    const paste = h.event()
    h.handlers.handleCanvasImagePaste(paste)
    assert.equal(paste.prevented, false)
    const over = h.event()
    h.handlers.handleCanvasImageDragOver(over)
    assert.equal(over.prevented, false)
    assert.equal(h.context.imageDragActive.value, false)
    const drop = h.event()
    h.handlers.handleCanvasImageDrop(drop)
    assert.equal(drop.prevented, false)
    assert.equal(drop.stopped, false)
    h.handlers.importCanvasImages([file()])
    await flush()
    assert.equal(h.imports.length, 0)
    assert.equal(h.context.imageImportStatus.value, null)
    h.context[owner].value = null
    assert.equal(h.handlers.canImportCanvasImages(), true)
    h.handlers.handleCanvasImagePaste(h.event())
    await flush()
    assert.equal(h.imports.length, 1, 'closing the video layer restores normal image imports')
  }
})

test('Shell installs and cleans up paste/drop handlers and shares the asset-panel upload path', () => {
  assert.match(shell, /addEventListener\('paste', handleCanvasImagePaste\)/)
  assert.match(shell, /removeEventListener\('paste', handleCanvasImagePaste\)/)
  assert.match(shell, /@dragover="handleCanvasImageDragOver"/)
  assert.match(shell, /@drop="handleCanvasImageDrop"/)
  assert.match(shell, /<CanvasUtilityPanel[\s\S]*?@import-images="importCanvasImages"/)
  assert.match(shell, /imageImporter\.dispose\(\)/)
})

test('batch imports preserve aspect ratio, select all assets and undo/redo as one graph operation', async (t) => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(() => server.close())
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )
  const { nodeSize, isStandaloneUploadedImage } = await server.ssrLoadModule(
    '/src/features/canvas-v3/config/nodeGeometry.js',
  )
  setActivePinia(createPinia())
  const graph = useCanvasV3GraphStore()
  graph.hydrate({ projectId: 'import-batch', nodes: [], edges: [] })
  const node = graph.addNode('video')
  const previousModel = node.data.model
  const assets = [
    {
      title: 'wide.png',
      assetUrl: 'https://example.test/wide.png',
      mediaWidth: 1200,
      mediaHeight: 600,
    },
    { title: 'tall.png', assetUrl: decoded.dataUrl, mediaWidth: 600, mediaHeight: 1200 },
  ]
  const result = graph.addImageAssets(assets, { x: 1200, y: 600 })
  assert.equal(result.length, 2)
  assert.equal(graph.selectedNodes.length, 2)
  assert.ok(result.every((image) => isStandaloneUploadedImage(image.data)))
  const size = nodeSize('image', result[0].data)
  assert.deepEqual(result[0].position, { x: 1200 - size.width / 2, y: 600 - size.height / 2 })
  assert.equal(size.width / size.height, 2)
  assert.ok(result[1].position.x > result[0].position.x)
  assert.equal(graph.nodes[0].data.model, previousModel)
  assert.equal(graph.nodes[0].selected, false)
  assert.equal(graph.undo(), true)
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.redo(), true)
  assert.equal(graph.nodes.length, 3)
  assert.ok(graph.nodes.every((item) => !item.data.generation))
})
