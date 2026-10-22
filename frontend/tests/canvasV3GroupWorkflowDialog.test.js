import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const savedGlobals = ['document', 'Document', 'ShadowRoot'].map((name) => [
  name,
  Object.getOwnPropertyDescriptor(globalThis, name),
])
for (const name of ['Document', 'ShadowRoot'])
  if (typeof globalThis[name] === 'undefined')
    Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
const fakeDocument = { activeElement: null }
Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
after(() => {
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
})

const source = await readFile(
  new URL('../src/features/canvas-v3/components/GroupWorkflowDialog.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(
  source.replace('<Teleport to="body">', '<div>').replace('</Teleport>', '</div>'),
)
const compiled = compileScript(descriptor, {
  id: 'group-workflow-dialog-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content.replace(
  /from (['"])vue\1/g,
  `from '${import.meta.resolve('vue')}'`,
)
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const text = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`
function element(type, value = '') {
  return markRaw({
    type,
    tagName: type.toUpperCase(),
    text: value,
    props: {},
    children: [],
    parent: null,
    value: '',
    focusCalls: 0,
    isConnected: true,
    focus() {
      this.focusCalls++
      fakeDocument.activeElement = this
    },
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return null
    },
    querySelectorAll() {
      return all(this, (entry) => ['input', 'button'].includes(entry.type) && !entry.props.disabled)
    },
  })
}
function detach(target) {
  if (!target.parent) return
  const index = target.parent.children.indexOf(target)
  if (index >= 0) target.parent.children.splice(index, 1)
  target.parent = null
}
const renderer = createRenderer({
  createElement: (type) => element(type),
  createText: (value) => element('#text', value),
  createComment: (value) => element('#comment', value),
  setText: (target, value) => {
    target.text = value
  },
  setElementText: (target, value) => {
    target.text = value
    target.children = []
  },
  patchProp: (target, name, _old, value) => {
    target.props[name] = value
    if (name === 'value') target.value = value
  },
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (target, parent, anchor) => {
    detach(target)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
  },
  remove: detach,
})
const settle = async () => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
const keyEvent = (key, extra = {}) => ({
  key,
  prevented: false,
  stopped: false,
  preventDefault() {
    this.prevented = true
  },
  stopPropagation() {
    this.stopped = true
  },
  ...extra,
})
async function mount(overrides = {}) {
  const events = []
  const props = reactive({ open: true, generationCount: 2, groupName: 'Group 1', ...overrides })
  const host = element('root')
  const before = element('button')
  fakeDocument.activeElement = before
  const app = renderer.createApp({
    render: () =>
      h(Component, {
        ...props,
        onConfirm: (...args) => events.push(['confirm', ...args]),
        onCancel: () => events.push(['cancel']),
        onLoad: (id) => events.push(['load', id]),
        onRemove: (id) => events.push(['remove', id]),
      }),
  })
  app.mount(host)
  await settle()
  return {
    host,
    props,
    before,
    events,
    app,
    find: (predicate) => all(host, predicate)[0],
    button: (name) =>
      all(
        host,
        (entry) =>
          entry.type === 'button' && (text(entry) === name || entry.props['aria-label'] === name),
      )[0],
    dialog: () => all(host, (entry) => entry.props.role === 'dialog')[0],
    backdrop: () => all(host, (entry) => entry.props.class === 'cv3-group-dialog-backdrop')[0],
  }
}

test('execute dialog is inert until explicit confirmation and discloses actual billing semantics', async () => {
  const view = await mount()
  assert.deepEqual(view.events, [])
  assert.equal(view.dialog().props['aria-modal'], 'true')
  assert.match(text(view.host), /2 个待生成节点/)
  assert.match(text(view.host), /当前模型、生成数量与参数提交，可能产生费用/)
  assert.match(text(view.host), /已有图片或视频仅作为参考，不会重新生成/)
  assert.match(text(view.host), /等待上游成功后继续/)
  assert.equal(fakeDocument.activeElement, view.button('确认执行'))
  view.button('确认执行').props.onClick()
  assert.deepEqual(view.events, [['confirm']])
  view.app.unmount()
})

test('zero generation count or unavailable original snapshot cannot confirm execution', async () => {
  const view = await mount({ generationCount: 0 })
  assert.equal(view.button('确认执行').props.disabled, true)
  assert.match(text(view.host), /组内没有待生成节点/)
  view.button('确认执行').props.onClick()
  assert.deepEqual(view.events, [])
  view.props.generationCount = 2
  view.props.hasSavedSnapshot = false
  await settle()
  assert.equal(view.button('确认执行').props.disabled, true)
  assert.match(text(view.host), /原分组已改变或不可用/)
  view.button('确认执行').props.onClick()
  assert.deepEqual(view.events, [])
  view.app.unmount()
})

test('busy execution prevents duplicate submission, displays real progress, and exposes stop semantics', async () => {
  const view = await mount({ busy: true, progress: { completed: 1, total: 3 } })
  assert.equal(view.button('执行中…').props.disabled, true)
  assert.match(text(view.host), /已完成 1 \/ 3 个生成节点/)
  assert.match(text(view.host), /不会撤销已提交的任务/)
  view.button('执行中…').props.onClick()
  assert.deepEqual(view.events, [])
  view.button('停止后续执行').props.onClick()
  assert.deepEqual(view.events, [['cancel']])
  assert.ok(view.dialog())
  view.app.unmount()
})

test('toolbox dialog defaults name and validates trimmed input without automatically saving', async () => {
  const view = await mount({ type: 'toolbox', groupName: 'My Group' })
  const input = view.find((entry) => entry.type === 'input')
  assert.equal(input.value, 'My Group')
  assert.equal(fakeDocument.activeElement, input)
  assert.match(text(view.host), /仅保存在当前浏览器，并按登录账号隔离，不会上传到云端/)
  assert.deepEqual(view.events, [])
  input.props['onUpdate:modelValue']('   ')
  await settle()
  assert.equal(view.button('保存到工具箱').props.disabled, true)
  view.button('保存到工具箱').props.onClick()
  await settle()
  assert.match(text(view.host), /1～100 个字符/)
  input.props['onUpdate:modelValue']('  Reusable group  ')
  await settle()
  view.button('保存到工具箱').props.onClick()
  assert.deepEqual(view.events, [['confirm', 'Reusable group']])
  view.app.unmount()
})

test('toolbox rejects overlong/control-character names and supports explicit Enter confirmation', async () => {
  const view = await mount({ type: 'toolbox' })
  const input = view.find((entry) => entry.type === 'input')
  for (const name of ['x'.repeat(101), 'bad\nname']) {
    input.props['onUpdate:modelValue'](name)
    await settle()
    view.button('保存到工具箱').props.onClick()
    assert.deepEqual(view.events, [])
  }
  input.props['onUpdate:modelValue']('Group template')
  await settle()
  input.props.onKeydown(keyEvent('Enter'))
  assert.deepEqual(view.events, [['confirm', 'Group template']])
  view.app.unmount()
})

test('saved templates load only after click and require two explicit clicks to remove', async () => {
  const view = await mount({
    type: 'toolbox',
    templates: [{ id: 'one', name: 'First', nodeCount: 3 }],
  })
  assert.match(text(view.host), /3 个节点/)
  view.button('添加模板 First 到画布').props.onClick()
  assert.deepEqual(view.events, [['load', 'one']])
  view.button('移除模板 First').props.onClick()
  await settle()
  assert.match(text(view.host), /确认移除/)
  assert.deepEqual(view.events, [['load', 'one']])
  view.button('确认移除模板 First').props.onClick()
  assert.deepEqual(view.events, [
    ['load', 'one'],
    ['remove', 'one'],
  ])
  assert.equal(view.props.templates.length, 1)
  view.app.unmount()
})

test('Escape first dismisses remove confirmation, then cancels dialog; click outside also cancels', async () => {
  const view = await mount({ type: 'toolbox', templates: [{ id: 'one', name: 'First' }] })
  view.button('移除模板 First').props.onClick()
  await settle()
  const first = keyEvent('Escape')
  view.backdrop().props.onKeydown(first)
  await settle()
  assert.equal(first.prevented, true)
  assert.equal(first.stopped, true)
  assert.deepEqual(view.events, [])
  assert.ok(view.button('移除模板 First'))
  view.backdrop().props.onKeydown(keyEvent('Escape'))
  assert.deepEqual(view.events, [['cancel']])
  const backdrop = view.backdrop()
  backdrop.props.onPointerdown({ target: view.dialog(), currentTarget: backdrop })
  assert.deepEqual(view.events, [['cancel']])
  backdrop.props.onPointerdown({ target: backdrop, currentTarget: backdrop })
  assert.deepEqual(view.events, [['cancel'], ['cancel']])
  view.app.unmount()
})

test('busy toolbox does not load/remove/save, but cancel remains available', async () => {
  const view = await mount({
    type: 'toolbox',
    busy: true,
    templates: [{ id: 'one', name: 'First' }],
  })
  assert.equal(view.find((entry) => entry.type === 'input').props.disabled, true)
  view.button('添加模板 First 到画布').props.onClick()
  view.button('移除模板 First').props.onClick()
  view.button('保存中…').props.onClick()
  assert.deepEqual(view.events, [])
  view.button('取消').props.onClick()
  assert.deepEqual(view.events, [['cancel']])
  view.app.unmount()
})

test('Tab cycles within dialog and closing restores focus to original trigger', async () => {
  const view = await mount({ type: 'toolbox' })
  const entries = view.dialog().querySelectorAll()
  entries.at(-1).focus()
  const forward = keyEvent('Tab')
  view.backdrop().props.onKeydown(forward)
  assert.equal(forward.prevented, true)
  assert.equal(fakeDocument.activeElement, entries[0])
  const backward = keyEvent('Tab', { shiftKey: true })
  view.backdrop().props.onKeydown(backward)
  assert.equal(backward.prevented, true)
  assert.equal(fakeDocument.activeElement, entries.at(-1))
  view.props.open = false
  await settle()
  assert.equal(view.dialog(), undefined)
  assert.equal(fakeDocument.activeElement, view.before)
  assert.equal(view.before.focusCalls, 1)
  view.app.unmount()
})

test('reopening resets draft/removal state; error text is accurate and does not claim save success', async () => {
  const view = await mount({ type: 'toolbox', error: '存储空间不足' })
  assert.match(text(view.host), /存储空间不足/)
  const input = view.find((entry) => entry.type === 'input')
  input.props['onUpdate:modelValue']('unsaved draft')
  view.props.open = false
  await settle()
  view.props.groupName = 'Next group'
  view.props.open = true
  await settle()
  assert.equal(view.find((entry) => entry.type === 'input').value, 'Next group')
  assert.deepEqual(view.events, [])
  view.app.unmount()
})

test('dialog CSS stays scoped/fixed-size and component contains no storage/provider submission', () => {
  assert.match(source, /<style scoped>/)
  assert.match(source, /width: 480px/)
  assert.match(source, /520px/)
  assert.match(source, /border-radius: 16px/)
  assert.match(source, /font:\s*13px/)
  assert.doesNotMatch(source, /fetch\(|localStorage|runImage\(|runVideo\(|saveGroupToolbox\(/)
})
