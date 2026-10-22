import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import {
  normalizeTextNodeDraft,
  textNodeRequest,
  textNodeResultPatch,
} from '../src/utils/textNodeDraft.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' })
function setup() {
  let resolve, reject
  const layer = {
    id: 'node',
    type: 'text',
    text: 'original',
    x: 20,
    y: 40,
    width: 360,
    height: 480,
    textNodeDraft: normalizeTextNodeDraft({ prompt: 'improve', model: 'agent' }),
  }
  const requests = [],
    undo = []
  const context = vm.createContext({
    props: { id: 'canvas' },
    layers: { value: [layer] },
    textNodeActivity: {},
    textNodeConnectionReferences: { value: { videos: new Map() } },
    textNodeRequests: new Map(),
    editingTextLayerId: { value: '' },
    agentModelRecords: { value: [{ value: 'agent', configured: true }] },
    userStore: { requireLogin: () => true, authHeaders: () => ({}) },
    AbortController,
    textNodeRequest,
    textNodeResultPatch,
    textNodeDraftFor: (item) => normalizeTextNodeDraft(item.textNodeDraft),
    apiPath: (value) => value,
    readApiResponse: async (value) => value,
    fetch: (path, options) => {
      requests.push({ path, options })
      return new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
    },
    updateLayer: (id, patch) => {
      const target = context.layers.value.find((item) => item.id === id)
      if (target) Object.assign(target, patch)
    },
    pushUndo: () => undo.push(layer.text),
    finishEditText: () => {},
  })
  for (const name of [
    'isEditableTextNode',
    'textNodeReferenceError',
    'submitTextNode',
    'cancelTextNodeRequest',
    'resolveTextNodeResult',
  ]) {
    const fn = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id?.name === name,
    )
    vm.runInContext(source.slice(fn.start, fn.end), context)
  }
  return {
    context,
    layer,
    requests,
    undo,
    resolve: (response) => resolve(response),
    reject: (error) => reject(error),
  }
}

test('text composer submits only the text endpoint and prevents duplicate requests', async () => {
  const item = setup(),
    view = { scale: 0.4, offset: { x: 50, y: 20 } }
  item.context.view = view
  const pending = item.context.submitTextNode(item.layer)
  await item.context.submitTextNode(item.layer)
  assert.equal(item.requests.length, 1)
  assert.equal(item.requests[0].path, '/api/ai/canvas-agent/text')
  assert.equal(JSON.parse(item.requests[0].options.body).text, 'original')
  item.resolve({ text: 'new', model: 'agent' })
  await pending
  assert.equal(item.layer.text, 'new')
  assert.equal(item.layer.x, 20)
  assert.deepEqual(view, { scale: 0.4, offset: { x: 50, y: 20 } })
  assert.equal(item.context.textNodeActivity.node.submitting, false)
  assert.deepEqual(item.undo, ['original'])
})

test('request failure keeps original text and retryable instructions', async () => {
  const item = setup(),
    pending = item.context.submitTextNode(item.layer)
  item.reject(new Error('offline'))
  await pending
  assert.equal(item.layer.text, 'original')
  assert.equal(item.layer.textNodeDraft.prompt, 'improve')
  assert.equal(item.context.textNodeActivity.node.error, 'offline')
})

test('manual text edits cause a pending result rather than an overwrite', async () => {
  const item = setup(),
    pending = item.context.submitTextNode(item.layer)
  item.layer.text = 'manual'
  item.resolve({ text: 'candidate' })
  await pending
  assert.equal(item.layer.text, 'manual')
  assert.equal(item.layer.textNodeDraft.pendingResult, 'candidate')
  item.context.resolveTextNodeResult(item.layer, true)
  assert.equal(item.layer.text, 'candidate')
  assert.equal(item.layer.textNodeDraft.pendingResult, '')
})

test('cancellation and canvas switches cannot apply late responses', async () => {
  for (const mode of ['cancel', 'switch', 'delete']) {
    const item = setup(),
      pending = item.context.submitTextNode(item.layer)
    if (mode === 'cancel') item.context.cancelTextNodeRequest('node')
    if (mode === 'switch') item.context.props.id = 'other'
    if (mode === 'delete') item.context.layers.value = []
    item.resolve({ text: 'late' })
    await pending
    assert.equal(item.layer.text, 'original')
    assert.equal(item.undo.length, 0)
  }
})

test('locked or currently reverse-planning text nodes never submit', async () => {
  for (const patch of [
    { locked: true },
    { generating: true },
    { videoReversePrompt: { status: 'pending' } },
  ]) {
    const item = setup()
    Object.assign(item.layer, patch)
    await item.context.submitTextNode(item.layer)
    assert.equal(item.requests.length, 0)
  }
})

test('connected video inputs are rejected explicitly rather than silently ignored', async () => {
  const item = setup()
  item.context.textNodeConnectionReferences.value.videos.set('node', [
    { url: 'https://media.test/video.mp4' },
  ])
  await item.context.submitTextNode(item.layer)
  assert.equal(item.requests.length, 0)
  assert.ok(item.context.textNodeActivity.node.error)
})

test('text editor selection remains node anchored and never changes the canvas camera', () => {
  const context = vm.createContext({
    conversationWindowsVisible: { value: true },
    selectedLayerId: { value: 'node' },
    selectedLayerIds: { value: ['node'] },
    canvas: { updateDocument: () => assert.fail('Selection must not move the camera') },
  })
  for (const name of ['isEditableTextNode', 'isTextNodeEditorVisible']) {
    const fn = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id?.name === name,
    )
    vm.runInContext(source.slice(fn.start, fn.end), context)
  }
  assert.equal(context.isTextNodeEditorVisible({ id: 'node', type: 'text' }), true)
  context.selectedLayerIds.value = ['node', 'other']
  assert.equal(context.isTextNodeEditorVisible({ id: 'node', type: 'text' }), false)
  const component = fs.readFileSync(
    new URL('../src/components/canvas/TextNodeComposer.vue', import.meta.url),
    'utf8',
  )
  assert.match(component, /position: absolute;/)
  assert.match(component, /left: 50%;/)
  assert.match(
    component,
    /transform: translateX\(-50%\) scale\(var\(--canvas-inverse-scale, 1\)\);/,
  )
})
