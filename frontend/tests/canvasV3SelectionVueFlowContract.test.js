import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { VueFlow } from '@vue-flow/core'
import { canvasGestures } from '../src/features/canvas-v3/config/canvasGestures.js'

test('left-button box selection uses the installed VueFlow selectionKeyCode contract, not an ignored attribute', async () => {
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
    'utf8',
  )
  assert.ok(VueFlow.props.selectionKeyCode)
  assert.equal(VueFlow.props.selectionOnDrag, undefined)
  assert.match(source, /:selection-key-code="gestures.selectionOnDrag"/)
  assert.doesNotMatch(source, /:selection-on-drag=/)
  assert.equal(canvasGestures('select', false).selectionOnDrag, true)
  for (const [tool, space] of [
    ['select', true],
    ['hand', false],
    ['hand', true],
  ]) {
    const gestures = canvasGestures(tool, space)
    assert.equal(gestures.selectionOnDrag, false)
    assert.ok(gestures.panOnDrag.includes(0))
  }
})
