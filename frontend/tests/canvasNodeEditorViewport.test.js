import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' })

function load(context, name) {
  const fn = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id?.name === name)
  assert.ok(fn, `Missing function ${name}`)
  vm.runInContext(source.slice(fn.start, fn.end), context)
}

test('opening image modification focuses only its input without scrolling, zooming or hiding the sidebar', async () => {
  for (const groupId of ['', 'group-1']) {
    const layer = { id: 'image', type: 'image', groupId, url: '/image.png' }
    const view = { scale: 0.4, offset: { x: 32, y: 96 } }
    const focus = []
    const context = vm.createContext({
      props: { id: 'canvas' }, layers: { value: [layer] },
      selectedLayerId: { value: '' }, selectedLayerIds: { value: [] },
      expandedLayerToolbarId: { value: 'image' },
      canvasNodeFocusSuspended: false, canvasNodeFocusRevision: 0,
      rightPanelVisible: { value: true }, doc: { value: { payload: { view } } },
      nextTick: () => Promise.resolve(), isEditableImageNode: () => true,
      activateImageNodeEditor: () => {}, CSS: { escape: value => value },
      document: { querySelector: () => ({ querySelector: () => ({ focus: options => focus.push(options) }) }) },
      canvas: { updateDocument: () => assert.fail('Opening an editor must not change the viewport') },
    })
    load(context, 'getCanvasNodeEditor')
    load(context, 'openLayerDialogModification')
    const before = JSON.stringify(view)
    await context.openLayerDialogModification(layer)
    assert.equal(context.selectedLayerId.value, 'image')
    assert.deepEqual([...context.selectedLayerIds.value], ['image'])
    assert.equal(focus.length, 1)
    assert.equal(focus[0].preventScroll, true)
    assert.equal(JSON.stringify(view), before)
    assert.equal(context.rightPanelVisible.value, true)
  }
})

test('image selection opens the editor immediately without queuing automatic focus after dragging', () => {
  const watcher = ast.program.body.find(node =>
    node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' &&
    node.expression.callee.name === 'watch' && node.expression.arguments[1]?.type === 'ArrowFunctionExpression' &&
    source.slice(node.expression.arguments[1].start, node.expression.arguments[1].end).includes('activateImageNodeEditor(layer)'),
  )
  const callback = watcher.expression.arguments[1]
  const activated = []
  const context = vm.createContext({
    selectedLayerIds: { value: ['image'] }, selectedLayer: { value: { id: 'image', type: 'image' } },
    activateImageNodeEditor: layer => activated.push(layer?.id || ''),
    nextTick: () => assert.fail('Selection must not queue automatic editor positioning'),
    canvas: { updateDocument: () => assert.fail('Selection must not move the viewport') },
  })
  vm.runInContext(`globalThis.runSelectionWatcher = ${source.slice(callback.start, callback.end)}`, context)
  context.runSelectionWatcher()
  context.selectedLayer.value = { id: 'empty-image', type: 'image-placeholder' }
  context.runSelectionWatcher()
  context.selectedLayerIds.value = ['image', 'empty-image']
  context.runSelectionWatcher()
  assert.deepEqual(activated, ['image', 'empty-image', ''])
})
