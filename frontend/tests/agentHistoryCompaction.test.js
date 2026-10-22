import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'
import { agentProviderRejection } from '../src/utils/agentProviderError.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse: parseJs } = require('@babel/parser')
const source = parse(fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
const ast = parseJs(source, { sourceType: 'module' })
const fn = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'buildCanvasAgentHistory')

test('backend compaction receives full history instead of silently dropping older requirements', () => {
  const rules = '完整规则'.repeat(5000)
  const messages = [{ agent: true, role: 'user', text: rules }, ...Array.from({ length: 18 }, (_, i) => ({
    agent: true, role: i % 2 ? 'assistant' : 'user', text: `要求${i}`,
  })), { agent: true, role: 'assistant', text: '失败内容', failed: true },
  { agent: true, role: 'assistant', text: '仍在生成', generating: true }]
  const context = vm.createContext({ chatMessages: { value: messages }, agentDraftItems: () => [], agentProviderRejection,
    agentVideoContext: () => null, agentImageContext: () => null,
    describeAgentVideoContext: () => '', describeAgentImageContext: () => '' })
  vm.runInContext(source.slice(fn.start, fn.end), context)
  const history = context.buildCanvasAgentHistory()
  assert.equal(history.length, 19)
  assert.equal(history[0].content, rules)
  assert.equal(history.at(-1).content, '要求17')
})

test('conversation sync preserves original messages independently of model context compaction', () => {
  const saveFn = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'agentConversationMessages')
  const messages = Array.from({ length: 205 }, (_, i) => ({ id: `message-${i}`, text: `内容${i}` }))
  const context = vm.createContext({ agentConversationMessagesById: { value: { conversation: messages } } })
  vm.runInContext(source.slice(saveFn.start, saveFn.end), context)
  const saved = context.agentConversationMessages('conversation')
  assert.equal(saved.length, 205)
  assert.equal(saved[0].id, 'message-0')
  assert.equal(saved.at(-1).id, 'message-204')
})
