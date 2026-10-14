import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse: parseJs } = require('@babel/parser')
const source = parse(
  fs.readFileSync(
    new URL('../src/components/canvas/ImageNodeComposer.vue', import.meta.url),
    'utf8',
  ),
).descriptor.scriptSetup.content
const ast = parseJs(source, { sourceType: 'module' })
function setup() {
  const emitted = [],
    focus = []
  const props = {
    disabled: false,
    draft: {
      prompt: 'Keep the product',
      references: [{ id: 'ref', url: 'https://media.test/image.png' }],
      config: { model: 'a', models: ['a', 'b'], ratio: '9:16', resolution: '2K', count: 1 },
    },
  }
  const context = vm.createContext({
    props,
    open: { value: '' },
    emit: (event, value) => {
      emitted.push({ event, value })
      props.draft = value
    },
  })
  vm.runInContext('let settingsTrigger', context)
  for (const name of [
    'update',
    'config',
    'changeCount',
    'updateCount',
    'toggle',
    'closeSettings',
  ]) {
    const fn = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    vm.runInContext(source.slice(fn.start, fn.end), context)
  }
  return { context, props, emitted, focus, trigger: { focus: (options) => focus.push(options) } }
}

test('quantity buttons retain the 1 to 4 limit and preserve other image settings', () => {
  const item = setup()
  item.context.changeCount(-1)
  assert.equal(item.props.draft.config.count, 1)
  for (let i = 0; i < 5; i++) item.context.changeCount(1)
  assert.equal(item.props.draft.config.count, 4)
  assert.equal(item.props.draft.config.models.length * item.props.draft.config.count, 8)
  assert.equal(item.props.draft.config.ratio, '9:16')
  assert.equal(item.props.draft.config.resolution, '2K')
  assert.equal(item.props.draft.references.length, 1)
  assert.equal(item.props.draft.prompt, 'Keep the product')
})

test('typed quantities are clamped and blank values restore the current quantity', () => {
  const item = setup()
  for (const [value, expected] of [
    ['9', 4],
    ['0', 1],
    ['2.5', 3],
  ]) {
    const event = { target: { value } }
    item.context.updateCount(event)
    assert.equal(item.props.draft.config.count, expected)
    assert.equal(event.target.value, expected)
  }
  const empty = { target: { value: '' } }
  item.context.updateCount(empty)
  assert.equal(empty.target.value, 3)
  assert.equal(item.props.draft.config.count, 3)
})

test('disabled settings cannot mutate generation parameters', () => {
  const item = setup()
  item.props.disabled = true
  item.context.changeCount(1)
  item.context.config({ ratio: '3:4' })
  assert.equal(item.emitted.length, 0)
})

test('closing the settings restores trigger focus without scrolling the canvas', () => {
  const item = setup()
  item.context.toggle('settings', { currentTarget: item.trigger })
  assert.equal(item.context.open.value, 'settings')
  item.context.closeSettings()
  assert.equal(item.context.open.value, '')
  assert.equal(item.focus.length, 1)
  assert.equal(item.focus[0].preventScroll, true)
})
