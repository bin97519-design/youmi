import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  createNodeClipboard,
  parseNodeClipboard,
  serializeNodeClipboard,
} from '../src/features/canvas-v3/config/nodeClipboard.js'
import {
  canvasImageFiles,
  canvasImageTargetIsEditable,
} from '../src/features/canvas-v3/sync/canvasImageImport.js'
import { copyCanvasImage } from '../src/features/canvas-v3/sync/imageClipboard.js'
import { moveSelectedByKey } from '../src/features/canvas-v3/sync/selectionFrameDrag.js'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII='
const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = () => new Promise((resolve) => setImmediate(resolve))
const imageNode = (id = 'image-a', position = { x: 140, y: 120 }, data = {}) => ({
  id,
  type: 'generator',
  selected: true,
  position,
  data: {
    kind: 'image',
    title: id,
    prompt: '保留主体与产品结构',
    model: 'model-api-key:3',
    params: { ratio: '3:4', resolution: '4K' },
    assetUrl: png,
    rating: 3,
    ...data,
  },
})
const dependency = (source, target, id = 'edge-a') => ({
  id,
  source,
  target,
  sourceHandle: 'output',
  targetHandle: 'input',
  type: 'default',
  selected: true,
  data: { semantic: 'dependency' },
})

let server
let useCanvasV3GraphStore
before(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  ))
})
after(async () => server?.close())

function graphWith(nodes = [], edges = []) {
  setActivePinia(createPinia())
  const graph = useCanvasV3GraphStore()
  graph.hydrate({ projectId: 'context-integration', nodes, edges })
  return graph
}

test('real graph paste anchors the group and remaps internal node references and edge identities', () => {
  const graph = graphWith([imageNode('existing')])
  const a = imageNode('source', { x: -100, y: 80 })
  const b = imageNode(
    'edited',
    { x: 320, y: 240 },
    {
      sourceImageNodeId: 'source',
      editTemplate: { id: 'portrait-texture', sourceNodeId: 'source' },
      localEdit: {
        operation: '裁剪',
        sourceNodeId: 'source',
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
    },
  )
  const snapshot = createNodeClipboard([a, b], [dependency('source', 'edited')])
  const before = plain(snapshot)
  const [first, second] = graph.pasteNodeClipboard(snapshot, { x: 600, y: -300 })
  assert.deepEqual(first.position, { x: 600, y: -300 })
  assert.deepEqual(second.position, { x: 1020, y: -140 })
  assert.notEqual(first.id, 'source')
  assert.notEqual(second.id, 'edited')
  assert.equal(second.data.sourceImageNodeId, first.id)
  assert.equal(second.data.editTemplate.sourceNodeId, first.id)
  assert.equal(second.data.localEdit.sourceNodeId, first.id)
  assert.equal(graph.edges[0].source, first.id)
  assert.equal(graph.edges[0].target, second.id)
  assert.notEqual(graph.edges[0].id, 'edge-a')
  assert.equal(graph.edges[0].selected, false)
  assert.equal(graph.nodes[0].selected, false)
  assert.equal(graph.selectedNodes.length, 2)
  assert.deepEqual(snapshot, before)
})

test('a multi-node paste and all its edges undo and redo as one actual graph operation', () => {
  const original = imageNode('existing')
  const graph = graphWith([original])
  const snapshot = createNodeClipboard(
    [imageNode('one'), imageNode('two', { x: 620, y: 120 })],
    [dependency('one', 'two')],
  )
  const copies = graph.pasteNodeClipboard(snapshot, { x: 1000, y: 500 })
  const pasted = plain({ nodes: graph.nodes, edges: graph.edges })
  assert.equal(copies.length, 2)
  assert.equal(graph.undo(), true)
  assert.deepEqual(plain(graph.nodes), [original])
  assert.deepEqual(graph.edges, [])
  assert.equal(graph.canUndo, false, 'one undo consumes the complete paste transaction')
  assert.equal(graph.redo(), true)
  assert.deepEqual(plain({ nodes: graph.nodes, edges: graph.edges }), pasted)
})

test('real duplicate keeps rendered media and settings but never inherits completed task ownership', () => {
  const graph = graphWith([
    imageNode(
      'paid-result',
      { x: 200, y: 300 },
      {
        runState: 'succeeded',
        artifactStatus: 'ready',
        generation: {
          taskIds: ['old-task'],
          clientTaskId: 'old-client',
          clientRequestId: 'old-request',
        },
        directorRunId: 'old-director',
        error: 'old-error',
        progress: 100,
      },
    ),
  ])
  assert.equal(graph.duplicateSelected(), true)
  const copy = graph.selectedNodes[0]
  assert.equal(graph.nodes.length, 2)
  assert.deepEqual(copy.position, { x: 244, y: 344 })
  assert.equal(copy.data.title, 'paid-result 副本')
  assert.equal(copy.data.assetUrl, png)
  assert.equal(copy.data.prompt, graph.nodes[0].data.prompt)
  assert.deepEqual(copy.data.params, graph.nodes[0].data.params)
  assert.equal(copy.data.rating, 3)
  assert.equal(copy.data.runState, 'idle')
  assert.equal(copy.data.artifactStatus, 'ready')
  for (const key of ['generation', 'directorRunId', 'error', 'progress'])
    assert.equal(Object.hasOwn(copy.data, key), false, key)
  assert.deepEqual(graph.nodes[0].data.generation.taskIds, ['old-task'])
  assert.equal(graph.undo(), true)
  assert.equal(graph.nodes.length, 1)
})

test('actual protected tasks cannot duplicate or enter the graph through a clipboard snapshot', () => {
  for (const generation of [
    { persistPending: true },
    { queryPending: true },
    { unresolvedTaskIds: ['task-1'] },
  ]) {
    const graph = graphWith([imageNode('pending', { x: 0, y: 0 }, { generation })])
    assert.equal(graph.duplicateSelected(), false)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.canUndo, false)
    const target = graphWith()
    const snapshot = { format: 'youmi-canvas-v3', version: 1, nodes: plain(graph.nodes), edges: [] }
    assert.throws(() => target.pasteNodeClipboard(snapshot), /不能复制/)
    assert.equal(target.nodes.length, 0)
    assert.equal(target.canUndo, false)
  }
})

test('invalid or foreign clipboard snapshots fail atomically without graph edits or history entries', () => {
  const snapshot = createNodeClipboard([imageNode('copy')])
  const variants = [
    { ...snapshot, format: 'foreign-app' },
    { ...snapshot, version: 999 },
    { ...snapshot, nodes: [] },
    { ...snapshot, nodes: [imageNode('bad', { x: Infinity, y: 0 })] },
    { ...snapshot, nodes: [imageNode('bad', { x: 0, y: 0 }, { assetUrl: 'javascript:alert(1)' })] },
  ]
  for (const variant of variants) {
    const graph = graphWith([imageNode('existing')])
    const before = plain({ nodes: graph.nodes, edges: graph.edges, revision: graph.revision })
    assert.throws(
      () => graph.pasteNodeClipboard(variant),
      'invalid envelopes must not become paste operations',
    )
    assert.deepEqual(
      plain({ nodes: graph.nodes, edges: graph.edges, revision: graph.revision }),
      before,
    )
    assert.equal(graph.canUndo, false)
    assert.equal(graph.canRedo, false)
  }
})

test('paste removes external references and never changes the caller snapshot when remapping internal references', () => {
  const graph = graphWith()
  const snapshot = createNodeClipboard([
    imageNode(
      'one',
      { x: 0, y: 0 },
      { sourceImageNodeId: 'outside', localEdit: { sourceNodeId: 'outside', operation: '裁剪' } },
    ),
    imageNode(
      'two',
      { x: 400, y: 0 },
      { editTemplate: { id: 'scene-sheet', sourceNodeId: 'one' } },
    ),
  ])
  const before = plain(snapshot)
  const copies = graph.pasteNodeClipboard(snapshot)
  assert.equal(copies[0].data.sourceImageNodeId, undefined)
  assert.equal(copies[0].data.localEdit.sourceNodeId, undefined)
  assert.equal(copies[1].data.editTemplate.sourceNodeId, copies[0].id)
  assert.deepEqual(snapshot, before)
  assert.deepEqual(copies[0].position, { x: 44, y: 44 })
})

test('actual rating changes, cancellation and no-op ratings preserve undo/redo transaction boundaries', () => {
  const graph = graphWith([imageNode('rated', { x: 0, y: 0 }, { rating: 0 })])
  assert.equal(graph.rateNode('rated', 4), true)
  assert.equal(graph.rateNode('rated', 4), true)
  assert.equal(graph.nodes[0].data.rating, 4)
  assert.equal(graph.undo(), true)
  assert.equal(graph.nodes[0].data.rating, 0)
  assert.equal(graph.canUndo, false)
  assert.equal(graph.redo(), true)
  assert.equal(graph.nodes[0].data.rating, 4)
  assert.equal(graph.rateNode('rated', 0), true)
  assert.equal(graph.undo(), true)
  assert.equal(graph.nodes[0].data.rating, 4)
  for (const value of [-1, 6, 1.5, '3']) assert.equal(graph.rateNode('rated', value), false)
  assert.equal(graph.rateNode('missing', 3), false)
})

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const handlerNames = [
  'imageActionNotice',
  'openImageContextMenu',
  'selectedNodeClipboard',
  'copySelectedNodes',
  'handleCanvasNodeCopy',
  'pasteNodes',
  'pasteFromSystemClipboard',
  'handleImageContextAction',
  'canImportCanvasImages',
  'importCanvasImages',
  'handleCanvasImagePaste',
  'onKeydown',
]
const actualHandlers = handlerNames
  .map((name) => {
    const found = shell.match(
      new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
    )?.[0]
    assert.ok(found, `production Shell still exposes ${name}`)
    return found
  })
  .join('\n')
const projectClipboardWatch = shell.match(
  /^watch\(\r?\n {2}\(\) => props\.projectId,\r?\n {2}\(\) => \{[\s\S]*?^ {2}\},\r?\n\)/m,
)?.[0]
assert.ok(projectClipboardWatch, 'the production project-change watcher must cancel image copying')

function shellHarness(initialNodes = [imageNode()], initialEdges = [], options = {}) {
  const graph = graphWith(initialNodes, initialEdges)
  const binaryWrites = [],
    binaryCommits = [],
    textWrites = [],
    imports = [],
    network = [],
    calls = []
  let clipboardText = ''
  const clipboard = {
    async write(items) {
      binaryWrites.push(items)
      const blobs = await Promise.all(items.map((item) => item.data['image/png']))
      binaryCommits.push(blobs)
    },
    async writeText(text) {
      textWrites.push(text)
      clipboardText = text
    },
    async readText() {
      return clipboardText
    },
  }
  class ClipboardItem {
    constructor(data) {
      this.data = data
    }
    static supports(type) {
      return type === 'image/png'
    }
  }
  const watchers = []
  const context = {
    console,
    JSON, // Production imports and JSON.parse share one browser realm; the VM must do the same.
    AbortController,
    File,
    props: { projectId: graph.projectId },
    imageClipboardRequest: null,
    watch: (getValue, callback) => watchers.push({ getValue, callback }),
    navigator: { clipboard },
    graph,
    nodes: {
      get value() {
        return graph.nodes
      },
    },
    edges: {
      get value() {
        return graph.edges
      },
    },
    mode: { value: 'workflow' },
    activePanel: { value: '' },
    previewImage: { value: '' },
    previewVideo: { value: null },
    previewPanorama: { value: false },
    emotionSource: { value: null },
    angleSource: { value: null },
    imageDialog: { value: null },
    imageContext: { value: null },
    videoDialog: { value: null },
    videoContext: { value: null },
    selectionSaveNodes: { value: null },
    groupWorkflow: { value: null },
    pendingGroupConnection: { value: null },
    groupConnectionDrag: { active: false },
    multiSelection: {
      get value() {
        return graph.selectedNodes.length >= 2
      },
    },
    imageContextNode: {},
    imageImportStatus: { value: null },
    spaceHeld: { value: false },
    tool: { value: 'select' },
    zoomMenu: { value: false },
    canvasWrap: {
      value: { getBoundingClientRect: () => ({ left: 100, top: 40, width: 900, height: 600 }) },
    },
    screenToFlowCoordinate: ({ x, y }) => ({ x: (x - 100) / 2, y: (y + 80) / 2 }),
    user: { profile: { id: 'user-a' }, authHeaders: () => ({ Authorization: 'Bearer test-only' }) },
    apiPath: (path) => `/test-api${path}`,
    createNodeClipboard,
    serializeNodeClipboard,
    parseNodeClipboard,
    canvasImageFiles,
    canvasImageTargetIsEditable,
    moveSelectedByKey,
    clearPendingReference: () => calls.push('clear-reference'),
    resetVideoActions: () => {
      calls.push('reset-video')
      context.videoContext.value = null
      context.videoDialog.value = null
      context.previewVideo.value = null
    },
    closeDirector: () => calls.push('close-director'),
    fitCanvas: () => calls.push('fit'),
    toggleNodeLibrary: () => calls.push('library'),
    openPanel: (name) => calls.push(['panel', name]),
    layoutCanvas: async () => {
      calls.push('layout')
      graph.autoLayout()
    },
    copyCanvasImage: (source, request) =>
      copyCanvasImage(source, {
        ...request,
        clipboard,
        ClipboardItemCtor: ClipboardItem,
        fetcher: async (url, options) => {
          network.push({ url, options })
          if (context.fetchImage) return context.fetchImage(url, options)
          return new Response(
            new Blob([Buffer.from(png.split(',')[1], 'base64')], { type: 'image/png' }),
          )
        },
      }),
    imageImporter: {
      async importFiles(files, anchor) {
        imports.push({ files, anchor })
        return graph.addImageAssets(
          files.map((file) => ({ title: file.name, assetUrl: png, mediaWidth: 1, mediaHeight: 1 })),
          anchor,
        )
      },
    },
  }
  context.fetchImage = options.fetchImage
  Object.defineProperty(context.imageContextNode, 'value', {
    get: () => graph.nodes.find((node) => node.id === context.imageContext.value?.nodeId),
  })
  runInNewContext(
    `${actualHandlers}\n${projectClipboardWatch}\nthis.handlers = { ${handlerNames.join(', ')} }`,
    context,
  )
  const event = (extra = {}) => ({
    key: 'Escape',
    code: 'Escape',
    defaultPrevented: false,
    target: { tagName: 'DIV', closest: () => null },
    clientX: 700,
    clientY: 420,
    clipboardData: {
      files: [],
      getData: () => clipboardText,
      setData: (type, text) => {
        calls.push(['set-data', type])
        clipboardText = text
      },
    },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
    ...extra,
  })
  const open = (id = graph.nodes[0]?.id, extra = {}) => {
    const input = event(extra)
    context.handlers.openImageContextMenu({
      event: input,
      node: graph.nodes.find((node) => node.id === id),
    })
    return input
  }
  return {
    graph,
    context,
    handlers: context.handlers,
    clipboard,
    binaryWrites,
    binaryCommits,
    textWrites,
    imports,
    network,
    calls,
    event,
    open,
    changeProject(projectId) {
      const prior = context.props.projectId
      context.props.projectId = projectId
      for (const watcher of watchers) watcher.callback(watcher.getValue(), prior)
    },
  }
}

test('actual right-click selects an unselected image alone and clears edge selection without history', () => {
  const a = imageNode('a'),
    b = imageNode('b')
  b.selected = false
  const harness = shellHarness([a, b], [dependency('a', 'b')])
  const event = harness.open('b')
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.deepEqual(
    harness.graph.selectedNodes.map((node) => node.id),
    ['b'],
  )
  assert.equal(harness.graph.edges[0].selected, false)
  assert.deepEqual(plain(harness.context.imageContext.value), { nodeId: 'b', x: 700, y: 420 })
  assert.equal(harness.graph.canUndo, false)
  assert.deepEqual(harness.calls, ['clear-reference'])
})

test('right-click on an already-selected image preserves the existing multi-selection', () => {
  const harness = shellHarness([imageNode('a'), imageNode('b')], [dependency('a', 'b')])
  harness.open('b')
  assert.deepEqual(
    harness.graph.selectedNodes.map((node) => node.id),
    ['a', 'b'],
  )
  assert.equal(harness.graph.edges[0].selected, true)
  assert.equal(harness.context.imageContext.value.nodeId, 'b')
})

test('empty media, non-visual kinds and modal-owned canvases cannot steal either context menu', () => {
  const harness = shellHarness([
    imageNode('empty', undefined, { assetUrl: '' }),
    imageNode('empty-video', undefined, { kind: 'video', assetUrl: '' }),
    imageNode('audio', undefined, { kind: 'audio' }),
    imageNode('video', undefined, {
      kind: 'video',
      assetUrl: 'https://assets.example.com/clip.mp4',
    }),
    imageNode('valid'),
  ])
  for (const id of ['empty', 'empty-video', 'audio']) {
    const event = harness.open(id)
    assert.equal(event.prevented, false)
    assert.equal(harness.context.imageContext.value, null)
    assert.equal(harness.context.videoContext.value, null)
  }
  for (const owner of ['imageDialog', 'videoDialog', 'previewVideo']) {
    harness.context[owner].value = { kind: 'save-asset' }
    for (const id of ['valid', 'video']) {
      const event = harness.open(id)
      assert.equal(event.prevented, false, `${owner}: ${id}`)
      assert.equal(harness.context.imageContext.value, null)
      assert.equal(harness.context.videoContext.value, null)
    }
    harness.context[owner].value = null
  }
})

test('image and playable-video right-click menus are mutually exclusive without hijacking image context', () => {
  const image = imageNode('image')
  const video = imageNode('video', undefined, {
    kind: 'video',
    assetUrl: 'https://assets.example.com/clip.mp4',
  })
  video.selected = false
  const harness = shellHarness([image, video], [dependency('image', 'video')])
  harness.open('image')
  assert.equal(harness.context.imageContext.value.nodeId, 'image')
  assert.equal(harness.context.videoContext.value, null)
  const event = harness.open('video', { clientX: 420, clientY: 250 })
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(harness.context.imageContext.value, null)
  assert.deepEqual(plain(harness.context.videoContext.value), { nodeId: 'video', x: 420, y: 250 })
  assert.deepEqual(
    harness.graph.selectedNodes.map((node) => node.id),
    ['video'],
  )
  assert.equal(harness.graph.edges[0].selected, false)
  harness.open('image')
  assert.equal(harness.context.videoContext.value, null)
  assert.equal(harness.context.imageContext.value.nodeId, 'image')
  assert.deepEqual(
    harness.graph.selectedNodes.map((node) => node.id),
    ['image'],
  )
  assert.equal(harness.graph.canUndo, false)
})

test('both image-copy actions synchronously write real PNG bytes after closing the menu, never URL text', async () => {
  const harness = shellHarness()
  for (const action of ['copy-image', 'copy-to-clipboard']) {
    harness.graph.nodes[0].data.assetUrl = png
    harness.open()
    const pending = harness.handlers.handleImageContextAction(action)
    assert.equal(harness.context.imageContext.value, null)
    assert.equal(
      harness.context.imageContextNode.value,
      undefined,
      'the action can no longer consult the dismissed context',
    )
    assert.equal(
      harness.binaryWrites.length,
      action === 'copy-image' ? 1 : 2,
      'write is invoked during the original activation',
    )
    harness.graph.nodes[0].data.assetUrl = 'https://unrelated.test/changed.png'
    await pending
    const blob = await harness.binaryWrites.at(-1)[0].data['image/png']
    assert.equal(blob.type, 'image/png')
    assert.deepEqual(
      Buffer.from(await blob.arrayBuffer()),
      Buffer.from(png.split(',')[1], 'base64'),
    )
  }
  assert.equal(harness.textWrites.length, 0)
  assert.equal(harness.network.length, 0)
  assert.match(harness.context.imageImportStatus.value.message, /图片已复制/)
})

test('remote image copy routes real raster bytes through the authenticated local proxy only', async () => {
  const url = 'https://cdn.example.test/product.png?public=1'
  const harness = shellHarness([imageNode('remote', undefined, { assetUrl: url })])
  harness.open()
  await harness.handlers.handleImageContextAction('copy-image')
  assert.equal(harness.network.length, 1)
  assert.equal(
    harness.network[0].url,
    `/test-api/api/image-tasks/proxy-download?url=${encodeURIComponent(url)}`,
  )
  assert.deepEqual(harness.network[0].options.headers, { Authorization: 'Bearer test-only' })
  assert.equal(harness.binaryWrites.length, 1)
  assert.equal(harness.textWrites.length, 0)
})

test('dialog and panorama actions retain the clicked image before menu close, not a later selection', async () => {
  const harness = shellHarness([imageNode('one'), imageNode('two', undefined, { title: '第二张' })])
  for (const action of ['save-asset', 'create-subject', 'compliance']) {
    const originalTitle = `before ${action}`
    harness.graph.nodes[1].data.title = originalTitle
    harness.open('two')
    await harness.handlers.handleImageContextAction(action)
    assert.equal(harness.context.imageContext.value, null)
    assert.equal(harness.context.imageDialog.value.kind, action)
    assert.equal(harness.context.imageDialog.value.node.id, 'two')
    harness.graph.nodes[1].data.title = 'changed after opening'
    assert.equal(harness.context.imageDialog.value.node.data.title, originalTitle)
    harness.context.imageDialog.value = null
  }
  harness.open('two')
  await harness.handlers.handleImageContextAction('panorama')
  assert.equal(harness.context.previewPanorama.value, true)
  assert.equal(harness.context.previewImage.value, png)
  assert.equal(harness.context.imageContext.value, null)
})

test('node copy uses real serialized selected-node JSON and the native copy event follows the same format', async () => {
  const harness = shellHarness(
    [
      imageNode('one', undefined, {
        generation: { taskIds: ['completed'] },
        runState: 'succeeded',
      }),
      imageNode('two', { x: 600, y: 100 }),
    ],
    [dependency('one', 'two')],
  )
  harness.open('one')
  await harness.handlers.handleImageContextAction('copy-node')
  const snapshot = parseNodeClipboard(harness.textWrites[0])
  assert.equal(snapshot.nodes.length, 2)
  assert.equal(snapshot.edges.length, 1)
  assert.equal(snapshot.nodes[0].data.generation, undefined)
  assert.equal(harness.binaryWrites.length, 0)
  const native = harness.event()
  harness.handlers.handleCanvasNodeCopy(native)
  assert.equal(native.prevented, true)
  assert.deepEqual(harness.calls.at(-1), ['set-data', 'text/plain'])
  assert.equal(harness.graph.canUndo, false)
})

test('clipboard denial and protected node copying surface an error and never fall back to copying URLs', async () => {
  const harness = shellHarness()
  harness.clipboard.write = undefined
  harness.open()
  await harness.handlers.handleImageContextAction('copy-image')
  assert.equal(harness.context.imageImportStatus.value.error, true)
  assert.match(harness.context.imageImportStatus.value.message, /不支持复制图片/)
  assert.equal(harness.textWrites.length, 0)
  harness.graph.nodes[0].data.generation = { queryPending: true }
  harness.open()
  await harness.handlers.handleImageContextAction('copy-node')
  assert.equal(harness.context.imageImportStatus.value.error, true)
  assert.match(harness.context.imageImportStatus.value.message, /不能复制/)
  assert.equal(harness.textWrites.length, 0)
  assert.equal(harness.graph.canUndo, false)
})

test('native editable text, dialogs and already-handled paste events retain ownership of their content', async () => {
  const harness = shellHarness()
  const text = serializeNodeClipboard(createNodeClipboard([imageNode('pasted')]))
  for (const extra of [
    { target: { tagName: 'INPUT' } },
    { target: { tagName: 'TEXTAREA' } },
    { target: { tagName: 'DIV', isContentEditable: true } },
    { target: { tagName: 'DIV', closest: () => ({}) } },
    { defaultPrevented: true },
  ]) {
    const event = harness.event({ clipboardData: { files: [], getData: () => text }, ...extra })
    harness.handlers.handleCanvasImagePaste(event)
    assert.equal(event.prevented, false)
  }
  await flush()
  assert.equal(harness.graph.nodes.length, 1)
  assert.equal(harness.imports.length, 0)
  assert.equal(harness.graph.canUndo, false)
})

test('image files take precedence over clipboard node JSON in actual native paste', async () => {
  const harness = shellHarness()
  harness.open()
  const image = new File(['local bytes'], 'priority.png', { type: 'image/png' })
  const event = harness.event({
    clipboardData: {
      files: [image],
      getData() {
        assert.fail('node text must not be read when image files exist')
      },
    },
  })
  harness.handlers.handleCanvasImagePaste(event)
  await flush()
  assert.equal(event.prevented, true)
  assert.equal(harness.context.imageContext.value, null)
  assert.equal(harness.imports.length, 1)
  assert.deepEqual(harness.imports[0].files, [image])
  assert.equal(harness.graph.nodes.length, 2)
  assert.equal(harness.graph.nodes[1].data.title, 'priority.png')
})

test('valid node JSON pastes at viewport center through actual Shell and actual graph coordinates', () => {
  const harness = shellHarness()
  const snapshot = createNodeClipboard([imageNode('pasted', { x: -400, y: -300 })])
  const event = harness.event({
    clipboardData: { files: [], getData: () => serializeNodeClipboard(snapshot) },
  })
  harness.handlers.handleCanvasImagePaste(event)
  assert.equal(event.prevented, true)
  assert.deepEqual(harness.graph.nodes[1].position, { x: 225, y: 210 })
  assert.equal(harness.imports.length, 0)
  assert.equal(harness.graph.undo(), true)
  assert.equal(harness.graph.nodes.length, 1)
})

test('explicit menu paste also prioritizes binary images over node text and cancels after scope changes', async () => {
  const harness = shellHarness()
  const snapshot = createNodeClipboard([imageNode('node-json')])
  const bytes = new Blob([Buffer.from(png.split(',')[1], 'base64')], { type: 'image/png' })
  harness.clipboard.read = async () => [
    {
      types: ['text/plain'],
      getType: async () => new Blob([serializeNodeClipboard(snapshot)], { type: 'text/plain' }),
    },
    { types: ['image/png'], getType: async () => bytes },
  ]
  harness.open()
  await harness.handlers.handleImageContextAction('paste')
  assert.equal(harness.imports.length, 1)
  assert.equal(harness.graph.nodes[1].data.title, 'clipboard.png')
  assert.deepEqual(plain(harness.imports[0].anchor), { x: 300, y: 250 })
  const count = harness.graph.nodes.length
  harness.clipboard.read = async () => {
    harness.context.user.profile.id = 'other-user'
    return [{ types: ['image/png'], getType: async () => bytes }]
  }
  await harness.handlers.pasteFromSystemClipboard({ x: 300, y: 200 })
  assert.equal(harness.imports.length, 1)
  assert.equal(harness.graph.nodes.length, count)
})

test('actual capturing key handler defers image menu/dialog keys without closing the Director or mutating graph', () => {
  const harness = shellHarness()
  harness.context.activePanel.value = 'assistant'
  harness.open()
  for (const marker of [
    'data-image-context-menu',
    'data-image-context-dialog',
    'data-cv3-image-dialog',
  ]) {
    for (const key of ['Escape', 'Delete', 'd', 'z', 'Tab', ' ']) {
      const event = harness.event({
        key,
        code: key === ' ' ? 'Space' : key,
        ctrlKey: ['d', 'z'].includes(key),
        target: {
          tagName: 'BUTTON',
          closest: (selector) => (selector.includes(`[${marker}]`) ? {} : null),
        },
      })
      harness.handlers.onKeydown(event)
      assert.equal(event.prevented, false)
    }
  }
  harness.context.imageDialog.value = { kind: 'compliance' }
  harness.handlers.onKeydown(harness.event())
  assert.equal(harness.context.activePanel.value, 'assistant')
  assert.ok(harness.context.imageContext.value)
  assert.equal(harness.context.spaceHeld.value, false)
  assert.equal(harness.calls.includes('close-director'), false)
  assert.equal(harness.graph.nodes.length, 1)
  assert.equal(harness.graph.canUndo, false)
})

test('native video controls, toolbar, menu and dialogs own capture-phase Space/Delete/Tab and clipboard shortcuts', () => {
  for (const selector of [
    '.cv3-video-node-player',
    '.cv3-video-toolbar',
    '[data-video-context-menu]',
    '[data-cv3-video-dialog]',
  ]) {
    const harness = shellHarness()
    harness.context.activePanel.value = 'assistant'
    harness.open()
    const before = plain({ nodes: harness.graph.nodes, edges: harness.graph.edges })
    for (const key of ['Escape', 'Delete', 'Backspace', 'Tab', ' ', 'd', 'z']) {
      const event = harness.event({
        key,
        code: key === ' ' ? 'Space' : key,
        ctrlKey: ['d', 'z'].includes(key),
        target: {
          tagName: 'BUTTON',
          closest: (selectors) => (selectors.includes(selector) ? {} : null),
        },
      })
      harness.handlers.onKeydown(event)
      assert.equal(event.prevented, false, `${selector}: ${key}`)
      assert.equal(event.stopped, false)
    }
    assert.equal(harness.context.spaceHeld.value, false)
    assert.equal(harness.context.activePanel.value, 'assistant')
    assert.ok(harness.context.imageContext.value)
    assert.deepEqual(plain({ nodes: harness.graph.nodes, edges: harness.graph.edges }), before)
    assert.equal(harness.graph.canUndo, false)
    assert.equal(harness.calls.includes('library'), false)
    assert.equal(harness.calls.includes('close-director'), false)
  }
})

test('an open video modal or fullscreen preview blocks canvas import, node copy and global shortcuts even from canvas targets', async () => {
  for (const owner of ['videoDialog', 'previewVideo']) {
    const harness = shellHarness()
    harness.context.activePanel.value = 'assistant'
    harness.context[owner].value = { nodeId: 'video' }
    assert.equal(harness.handlers.canImportCanvasImages(), false)
    const files = new File(['test'], 'ignored.png', { type: 'image/png' })
    const paste = harness.event({ clipboardData: { files: [files] } })
    harness.handlers.handleCanvasImagePaste(paste)
    assert.equal(paste.prevented, false)
    const copy = harness.event()
    harness.handlers.handleCanvasNodeCopy(copy)
    assert.equal(copy.prevented, false)
    harness.handlers.importCanvasImages([files])
    for (const key of [' ', 'Delete', 'Backspace', 'Tab', 'Escape', 'd', 'z']) {
      const event = harness.event({
        key,
        code: key === ' ' ? 'Space' : key,
        ctrlKey: ['d', 'z'].includes(key),
      })
      harness.handlers.onKeydown(event)
      assert.equal(event.prevented, false, `${owner}: ${key}`)
    }
    await flush()
    assert.equal(harness.imports.length, 0)
    assert.equal(harness.textWrites.length, 0)
    assert.equal(harness.graph.nodes.length, 1)
    assert.equal(harness.graph.canUndo, false)
    assert.equal(harness.context.spaceHeld.value, false)
    assert.equal(harness.context.activePanel.value, 'assistant')
    assert.equal(harness.calls.includes('library'), false)
    assert.equal(harness.calls.includes('close-director'), false)
  }
})

test('global Ctrl/Cmd+D reports oversize selection errors instead of throwing or creating partial copies', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const harness = shellHarness(
      Array.from({ length: 101 }, (_, index) => imageNode(`selected-${index}`)),
    )
    const event = harness.event({ key: 'd', code: 'KeyD', [modifier]: true })
    assert.doesNotThrow(() => harness.handlers.onKeydown(event))
    assert.equal(event.prevented, true)
    assert.equal(harness.graph.nodes.length, 101)
    assert.equal(harness.graph.canUndo, false)
    assert.equal(harness.context.imageImportStatus.value.error, true)
    assert.match(harness.context.imageImportStatus.value.message, /100/)
  }
})

test('the actual project watcher aborts an in-flight image copy without clipboard commit or stale notice', async () => {
  let finishFetch
  const delayed = new Promise((resolve) => {
    finishFetch = resolve
  })
  const harness = shellHarness(
    [imageNode('remote', undefined, { assetUrl: 'https://cdn.example.test/slow.png' })],
    [],
    { fetchImage: () => delayed },
  )
  harness.open()
  const pending = harness.handlers.handleImageContextAction('copy-image')
  const request = harness.context.imageClipboardRequest
  assert.equal(request.signal.aborted, false)
  assert.equal(harness.binaryWrites.length, 1)
  await flush()
  assert.equal(harness.network.length, 1)
  harness.context.videoContext.value = { nodeId: 'old-video' }
  harness.context.videoDialog.value = { kind: 'save-asset' }
  harness.context.previewVideo.value = { nodeId: 'old-video' }
  harness.changeProject('different-project')
  const currentNotice = { busy: false, message: '另一个画布的消息', error: false }
  harness.context.imageImportStatus.value = currentNotice
  assert.equal(request.signal.aborted, true)
  assert.equal(harness.context.imageContext.value, null)
  assert.equal(harness.context.videoContext.value, null)
  assert.equal(harness.context.videoDialog.value, null)
  assert.equal(harness.context.previewVideo.value, null)
  assert.ok(harness.calls.includes('reset-video'))
  await pending
  assert.equal(harness.context.imageClipboardRequest, null)
  assert.equal(harness.binaryCommits.length, 0)
  assert.equal(harness.context.imageImportStatus.value, currentNotice)
  finishFetch(
    new Response(new Blob([Buffer.from(png.split(',')[1], 'base64')], { type: 'image/png' })),
  )
  await flush()
  assert.equal(
    harness.binaryCommits.length,
    0,
    'even a late network result cannot complete clipboard contents',
  )
  assert.equal(harness.context.imageImportStatus.value, currentNotice)
  const unmount = shell.match(/^onBeforeUnmount\(\(\) => \{([\s\S]*?)^\}\)/m)?.[1]
  assert.ok(unmount, 'the actual Shell unmount hook is present')
  assert.match(unmount, /imageClipboardRequest\?\.abort\(\)/)
  assert.match(unmount, /videoActions\.dispose\(\)/)
  assert.match(
    shell,
    /\(\) => String\(user\.profile\?\.id \|\| ''\),[\s\S]*?imageClipboardRequest\?\.abort\(\)/,
  )
})
