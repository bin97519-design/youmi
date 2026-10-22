import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateTextTokens, formatAgentContextUsage } from '../src/utils/agentContextUsage.js'

test('reported usage displays a percentage and token budget without claiming model capacity', () => {
  const display = formatAgentContextUsage({ inputTokens: 12000, outputTokens: 4000, budgetTokens: 64000, estimated: false })
  assert.equal(display.label, '25.0% · 16.0K / 64.0K')
  assert.equal(display.percent, 25)
  assert.match(display.title, /不代表模型官方最大容量/)
})

test('100K budget changes the denominator and percentage', () => {
  const display = formatAgentContextUsage({ inputTokens: 20000, outputTokens: 4000, budgetTokens: 100000, estimated: false })
  assert.equal(display.label, '24.0% · 24.0K / 100.0K')
})
test('estimates and newly typed text are visibly distinguished from reported usage', () => {
  const usage = { inputTokens: 16000, outputTokens: 0, budgetTokens: 64000, estimated: false }
  assert.ok(formatAgentContextUsage(usage, '新增要求').label.startsWith('≈'))
  assert.ok(formatAgentContextUsage({ ...usage, estimated: true }).label.startsWith('≈'))
  assert.equal(estimateTextTokens('四个汉字'), 4)
})
test('unknown usage does not invent a 300K model window and the ring clamps at 100 percent', () => {
  assert.equal(formatAgentContextUsage(null).label, '上下文 · 待计算')
  const display = formatAgentContextUsage({ inputTokens: 128000, budgetTokens: 64000, estimated: false })
  assert.equal(display.percent, 100)
  assert.ok(display.label.startsWith('200.0%'))
})
