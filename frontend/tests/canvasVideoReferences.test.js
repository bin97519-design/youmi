import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { incomingImageReferencesByNode, incomingVideoReferencesByNode } from '../src/utils/canvasNodeConnections.js'
import { normalizeVideoNodeDraft } from '../src/utils/videoNodeDraft.js'
import { VIDEO_MODELS, ANMIAO25_VIDEO_MODEL } from '../src/utils/productVideo.js'

test('incoming video edges preserve type, duration and thumbnail without entering image references', () => {
  const layers = [
    { id: 'a', type: 'video', url: 'https://assets.example/a.mp4', duration: 8.5, posterUrl: '/a.jpg', name: 'a', generating: true, status: 'processing' },
    { id: 'b', type: 'video', url: 'https://assets.example/b.mp4', visible: false },
    { id: 'copy', type: 'video', url: 'https://assets.example/a.mp4' },
    { id: 'busy', type: 'video', url: '', generating: true },
    { id: 'image', type: 'image', url: '/image.png' },
    { id: 'target', type: 'video', url: '' },
  ]
  const edges = ['a', 'b', 'copy', 'busy', 'image', 'target'].map(fromLayerId => ({ fromLayerId, fromPort: 'right', toLayerId: 'target', toPort: 'left' }))
  const rendered = new Set(layers.map(layer => layer.id))
  const videos = incomingVideoReferencesByNode(layers, edges, rendered).get('target')
  assert.deepEqual(videos.map(video => video.layerId), ['a', 'b'])
  assert.equal(videos[0].duration, 8.5)
  assert.equal(videos[0].thumbnailUrl, '/a.jpg')
  assert.deepEqual(incomingImageReferencesByNode(layers, edges, rendered).get('target').map(image => image.layerId), ['image'])
  assert.equal(incomingVideoReferencesByNode(layers, []).size, 0)
})

test('reverse left-port connections share the existing reference direction rule', () => {
  const layers = [{ id: 'source', type: 'video', url: 'https://assets.example/a.mp4' }]
  const refs = incomingVideoReferencesByNode(layers, [{ fromLayerId: 'target', fromPort: 'left', toLayerId: 'source', toPort: 'right' }])
  assert.equal(refs.get('target')[0].layerId, 'source')
})

test('removing a reference video cuts duplicate-source edges without moving or ungrouping sources', () => {
  const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
  const { parse } = require('@babel/parser')
  const source = parseVue(fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = parse(source, { sourceType: 'module' })
  const fn = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id?.name === 'saveVideoNodeDraft')
  const original = normalizeVideoNodeDraft({
    config: { model: ANMIAO25_VIDEO_MODEL },
    referenceVideos: [{ url: 'https://assets.example/a.mp4', layerId: 'a', duration: 5 }],
    connectedVideoLayerIds: ['a'],
  })
  const layers = [
    { id: 'target', type: 'video', videoNodeDraft: original },
    { id: 'a', type: 'video', url: 'https://assets.example/a.mp4', groupId: 'group', x: 1, y: 2 },
    { id: 'duplicate', type: 'video', url: 'https://assets.example/a.mp4', groupId: 'group', x: 3, y: 4 },
  ]
  const before = JSON.stringify(layers.slice(1))
  const connections = { value: [
    { fromLayerId: 'a', fromPort: 'right', toLayerId: 'target' },
    { fromLayerId: 'target', fromPort: 'left', toLayerId: 'duplicate' },
    { fromLayerId: 'a', fromPort: 'right', toLayerId: 'other-target' },
    { fromLayerId: 'target', fromPort: 'right', toLayerId: 'a' },
  ] }
  let saves = 0
  const context = vm.createContext({
    normalizeVideoNodeDraft, videoModelOptions: VIDEO_MODELS, layers: { value: layers }, connections,
    persistConnections: () => { saves++ },
    updateLayer: (id, patch) => Object.assign(layers.find(layer => layer.id === id), patch),
  })
  vm.runInContext(source.slice(fn.start, fn.end), context)
  context.saveVideoNodeDraft(layers[0], { ...original, referenceVideos: [] })
  assert.equal(saves, 1)
  assert.equal(connections.value.length, 2)
  assert.equal(connections.value[0].toLayerId, 'other-target')
  assert.equal(connections.value[1].fromPort, 'right')
  assert.equal(JSON.stringify(layers.slice(1)), before)
  assert.deepEqual(layers[0].videoNodeDraft.referenceVideos, [])
})
