import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@vue/compiler-sfc'

test('composer generation parameters only render in their matching image or video mode', () => {
  const source = fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8')
  const ast = parse(source).descriptor.template.ast
  const panels = []
  function visit(node) {
    if (node.type === 1 && node.props.some(prop =>
      prop.type === 6 && prop.name === 'class' && prop.value?.content.split(/\s+/).includes('uc-chat-generate-options'),
    )) panels.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(ast)
  assert.equal(panels.length, 2)
  const conditions = panels.map(panel => panel.props.find(prop => prop.type === 7 && ['if', 'else-if', 'else'].includes(prop.name)))
  assert.equal(conditions[0].name, 'if')
  assert.equal(conditions[1].name, 'else-if')
  for (const [chatMode, expected] of [['agent', [false, false]], ['image', [true, false]], ['video', [false, true]]]) {
    assert.deepEqual(conditions.map(condition => vm.runInNewContext(condition.exp.content, { chatMode })), expected)
  }
})
