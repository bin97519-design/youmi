import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse: parseJs } = require('@babel/parser')
const source = parse(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const ast = parseJs(source, { sourceType: 'module' })
const fn = ast.program.body.find(
  (item) => item.type === 'FunctionDeclaration' && item.id.name === 'agentModelDisplayLabel',
)
const context = vm.createContext({})
vm.runInContext(source.slice(fn.start, fn.end), context)
const label = context.agentModelDisplayLabel

test('repeated model names are displayed once regardless of spacing or case', () => {
  for (const name of [
    'gpt-5.6-luna · gpt-5.6-luna',
    ' gpt-5.6-luna·gpt-5.6-luna ',
    'gpt-5.6-luna · GPT-5.6-LUNA',
  ]) {
    assert.equal(label({ value: 'luna', label: name, configured: true }), 'gpt-5.6-luna')
  }
})

test('distinct display names and identifiers remain distinguishable', () => {
  const name = 'GEM 3.8 flash · gem-3.8-flash'
  assert.equal(label({ value: 'gem-3.8-flash', label: name, configured: true }), name)
  assert.equal(label({ value: 'default', label: '默认 Agent', configured: null }), '默认 Agent')
  assert.equal(label({ value: 'luna' }), 'luna')
})

test('unconfigured models retain their warning without repeating the model name', () => {
  assert.equal(
    label({ value: 'luna', label: 'gpt-5.6-luna · gpt-5.6-luna', configured: false }),
    'gpt-5.6-luna · 未配置密钥',
  )
})

test('display normalization preserves the actual model identifiers and availability', () => {
  const options = ast.program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declarations.some((declaration) => declaration.id.name === 'agentModelOptions'),
  )
  const original = {
    value: 'route-model-key',
    label: 'gpt-5.6-luna · gpt-5.6-luna',
    configured: false,
  }
  context.agentModelRecords = { value: [original] }
  context.computed = (read) => ({ value: read() })
  vm.runInContext(source.slice(options.start, options.end), context)
  const normalized = vm.runInContext('agentModelOptions.value[0]', context)
  assert.equal(normalized.value, original.value)
  assert.equal(normalized.configured, false)
  assert.equal(normalized.label, 'gpt-5.6-luna · 未配置密钥')
  assert.equal(original.label, 'gpt-5.6-luna · gpt-5.6-luna')
})
