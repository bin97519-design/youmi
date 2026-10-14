import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@vue/compiler-sfc'

const component = parse(
  fs.readFileSync(
    new URL('../src/components/canvas/CanvasRatioPicker.vue', import.meta.url),
    'utf8',
  ),
)
const context = vm.createContext({ defineProps: () => ({}), defineEmits: () => () => {} })
vm.runInContext(component.descriptor.scriptSetup.content, context)

test('shared image and video ratio previews have bounded dimensions and preserve orientation', () => {
  for (const ratio of ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']) {
    const shape = context.ratioShape(ratio),
      width = parseFloat(shape.width),
      height = parseFloat(shape.height)
    assert.ok(width > 0 && width <= 25 && height > 0 && height <= 25)
    const [x, y] = ratio.split(':').map(Number)
    assert.equal(Math.sign(width - height), Math.sign(x - y))
  }
})

test('both automatic ratio IDs use the same adaptive preview', () => {
  for (const value of ['auto', 'adaptive'])
    assert.equal(Object.keys(context.ratioShape(value)).length, 0)
  assert.match(
    component.descriptor.template.content,
    /\['auto', 'adaptive'\]\.includes\(option.value\)/,
  )
})
