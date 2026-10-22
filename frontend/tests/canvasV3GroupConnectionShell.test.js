import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parse as parseVue } from '@vue/compiler-sfc'
import { createGroupConnectionDrag } from '../src/features/canvas-v3/sync/groupConnectionDrag.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const css = await readFile(
  new URL('../src/features/canvas-v3/canvas-v3.css', import.meta.url),
  'utf8',
)
const source = parseVue(shell).descriptor.scriptSetup.content
const require = createRequire(import.meta.url)
const ast = require('@babel/parser').parse(source, { sourceType: 'module' })
const plain = (value) => JSON.parse(JSON.stringify(value))
const node = (id) => ({
  id,
  position: { x: 10, y: 20 },
  selected: true,
  data: { kind: 'image', groupId: 'g', groupType: 'normal' },
})
function harness() {
  const timers = [],
    actions = [],
    notices = []
  const state = { now: 1000, hit: { inside: true } }
  const nodes = { value: [node('one'), node('two')] }
  const wrapper = {
    getBoundingClientRect: () => ({ left: 20, top: 40, width: 800, height: 600 }),
    contains: (target) => target?.inside === true,
  }
  const context = vm.createContext({
    nodes,
    props: { projectId: 'p' },
    user: { token: 't', profile: { id: 'u' } },
    graph: {
      get nodes() {
        return nodes.value
      },
      get selectedNodes() {
        return nodes.value.filter((item) => item.selected)
      },
      get selectedGroup() {
        return this.selectedNodes.length >= 2 ? { id: 'g', type: 'normal' } : null
      },
      selectionMutable: true,
      selectGroup: () => true,
      createGroupConnectedNode: (kind, position, groupId) => {
        actions.push({ kind, position, groupId })
        return { id: 'new', position, data: { kind } }
      },
    },
    gestures: { value: { hand: false } },
    mode: { value: 'workflow' },
    canvasWrap: { value: wrapper },
    document: { elementFromPoint: () => state.hit },
    pendingGroupConnection: { value: null },
    groupConnectionPreview: { value: null },
    groupConnectionResetKey: { value: 0 },
    pendingReference: { value: null },
    connectionStart: { value: null },
    menuPosition: { value: null },
    menuFlowPosition: { value: null },
    activePanel: { value: '' },
    imageContext: { value: null },
    videoContext: { value: null },
    suppressPaneClick: false,
    suppressGroupContextMenuUntil: 0,
    Date: { now: () => state.now },
    setTimeout: (callback) => timers.push(callback),
    screenToFlowCoordinate: ({ x, y }) => ({ x: (x - 20) / 2, y: (y - 40) / 2 }),
    computed: (getter) => ({
      get value() {
        return getter()
      },
    }),
    selectionGroups: { value: [{ id: 'g', bounds: { right: 400, centerY: 200 } }] },
    createGroupConnectionDrag,
    nodeSize: () => ({ width: 100, height: 60 }),
    tasks: { imageModels: [] },
    nextTick: async () => {},
    setCenter: async (...args) => actions.push(['center', ...args]),
    getViewport: () => ({ zoom: 0.8 }),
    imageActionNotice: (message, error) => notices.push({ message, error }),
    groupHoverPoint: { value: null },
    cancelGroupResize: () => {},
    spaceHeld: { value: false },
    imageDragActive: { value: false },
    selectionDragging: { value: false },
    cancelSelectionFrameDrag: () => {},
  })
  for (const name of [
    'groupScope',
    'groupScopeCurrent',
    'groupConnectionSnapshot',
    'groupConnectionCurrent',
    'openGroupConnection',
    'beginGroupConnection',
    'endGroupConnection',
    'finishGroupConnection',
    'clearPendingReference',
    'openCanvasMenu',
    'onKeydown',
    'resetSpace',
    'addNode',
  ]) {
    const declaration = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    assert.ok(declaration, name)
    vm.runInContext(source.slice(declaration.start, declaration.end), context)
  }
  for (const name of ['groupConnectionDrag', 'groupConnectionPath']) {
    const declaration = ast.program.body.find(
      (item) =>
        item.type === 'VariableDeclaration' &&
        item.declarations.some((entry) => entry.id.name === name),
    )
    assert.ok(declaration, name)
    vm.runInContext(source.slice(declaration.start, declaration.end), context)
  }
  const run = (expression) => vm.runInContext(expression, context)
  return { context, state, timers, actions, notices, run }
}
function pointer(extra = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 9,
    clientX: 440,
    clientY: 240,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...extra,
  }
}

test('group reference snapshots bind scope and node identities, rejecting membership and owner changes', () => {
  const h = harness(),
    c = h.context
  const snapshot = c.groupConnectionSnapshot('g', { x: 600, y: 300 })
  assert.equal(c.groupConnectionCurrent(snapshot), true)
  assert.equal(snapshot.members[0], c.nodes.value[0])
  c.nodes.value.push(node('three'))
  assert.equal(c.groupConnectionCurrent(snapshot), false)
  c.nodes.value.pop()
  c.nodes.value[0] = { ...c.nodes.value[0] }
  assert.equal(c.groupConnectionCurrent(snapshot), false)
  const fresh = c.groupConnectionSnapshot('g')
  c.user.token = 'other'
  assert.equal(c.groupConnectionCurrent(fresh), false)
  assert.equal(c.groupConnectionCurrent(null), false)
  assert.deepEqual(h.actions, [])
})

test('actual left anchor gesture previews before release, opens the clamped reference menu only on release and preserves the endpoint', () => {
  const h = harness(),
    c = h.context
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer())
  assert.equal(h.run('groupConnectionDrag.active'), true)
  assert.equal(c.activePanel.value, '')
  assert.equal(c.pendingGroupConnection.value, null)
  h.run('groupConnectionDrag').move(pointer({ clientX: 720, clientY: 460 }))
  assert.deepEqual(plain(c.groupConnectionPreview.value), {
    groupId: 'g',
    screen: { x: 700, y: 420 },
  })
  assert.match(h.run('groupConnectionPath.value'), /^M 420 200 C /)
  assert.match(h.run('groupConnectionPath.value'), /700 420$/)
  c.endGroupConnection(pointer({ clientX: 720, clientY: 460, buttons: 0 }))
  assert.equal(c.groupConnectionPreview.value, null)
  assert.equal(c.activePanel.value, 'nodes')
  assert.deepEqual(plain(c.pendingGroupConnection.value.screen), { x: 700, y: 420 })
  assert.deepEqual(plain(c.menuPosition.value), { x: 572, y: 210 })
  assert.deepEqual(plain(c.menuFlowPosition.value), { x: 350, y: 210 })
  assert.match(h.run('groupConnectionPath.value'), /700 420$/)
  assert.equal(c.suppressPaneClick, true)
  h.timers.forEach((callback) => callback())
  assert.equal(c.suppressPaneClick, false)
  assert.deepEqual(h.actions, [])
})

test('curve tracks live group bounds rather than a representative node or stale camera', () => {
  const h = harness(),
    c = h.context
  c.pendingGroupConnection.value = c.groupConnectionSnapshot('g', { x: 650, y: 400 })
  assert.match(h.run('groupConnectionPath.value'), /^M 420 200 /)
  c.selectionGroups.value[0].bounds = { right: 510, centerY: 280 }
  assert.match(h.run('groupConnectionPath.value'), /^M 530 280 /)
  c.groupConnectionPreview.value = { groupId: 'g', screen: { x: 700, y: 500 } }
  assert.match(h.run('groupConnectionPath.value'), /700 500$/)
  c.selectionGroups.value = []
  assert.equal(h.run('groupConnectionPath.value'), '')
})

test('release outside canvas, over a sibling overlay or outside workflow never opens a menu', () => {
  for (const [screen, hit, mode] of [
    [{ x: -1, y: 200 }, { inside: true }, 'workflow'],
    [{ x: 801, y: 200 }, { inside: true }, 'workflow'],
    [{ x: 300, y: 601 }, { inside: true }, 'workflow'],
    [{ x: 300, y: 200 }, null, 'workflow'],
    [{ x: 300, y: 200 }, { inside: false }, 'workflow'],
    [{ x: 300, y: 200 }, { inside: true }, 'storyboard'],
  ]) {
    const h = harness(),
      c = h.context
    h.state.hit = hit
    c.mode.value = mode
    c.finishGroupConnection({ groupId: 'g', screen })
    assert.equal(c.activePanel.value, '')
    assert.equal(c.pendingGroupConnection.value, null)
    assert.equal(c.menuPosition.value, null)
    assert.deepEqual(h.actions, [])
  }
})

test('click without drag does not create a drag menu, and the post-release context fence preserves group references', () => {
  const h = harness(),
    c = h.context
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer())
  const early = pointer({ target: { closest: () => ({}) } })
  c.openCanvasMenu(early)
  assert.equal(early.prevented, true)
  assert.equal(early.stopped, true)
  c.endGroupConnection(pointer({ buttons: 0 }))
  assert.equal(c.activePanel.value, '')
  c.pendingGroupConnection.value = c.groupConnectionSnapshot('g', { x: 300, y: 200 })
  const pending = c.pendingGroupConnection.value
  const after = pointer({ target: { closest: () => ({}) } })
  c.openCanvasMenu(after)
  assert.equal(after.prevented, true)
  assert.equal(c.pendingGroupConnection.value, pending)
  h.state.now += 401
  c.openCanvasMenu(pointer({ target: { closest: () => ({}) } }))
  assert.equal(c.pendingGroupConnection.value, null)
  assert.equal(c.activePanel.value, 'nodes')
})

test('right-button input cannot start a connector and an unmoved left click keeps the original add-menu action', () => {
  const h = harness(),
    c = h.context
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer({ button: 2, buttons: 2 }))
  assert.equal(h.run('groupConnectionDrag.active'), false)
  assert.equal(c.groupConnectionPreview.value, null)
  assert.equal(c.pendingGroupConnection.value, null)
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer())
  c.endGroupConnection(pointer({ buttons: 0 }))
  assert.equal(c.activePanel.value, '')
  c.openGroupConnection(
    { id: 'g', nodeId: 'one', bounds: { right: 400, centerY: 200 } },
    pointer({ buttons: 0 }),
  )
  assert.equal(c.activePanel.value, 'nodes')
  assert.equal(c.pendingGroupConnection.value.groupId, 'g')
  assert.equal(c.pendingGroupConnection.value.screen, null)
  assert.deepEqual(h.actions, [])
})

test('Escape on the selected anchor cancels before the generic UI shortcut guard and blur cleanup cannot open a menu', () => {
  const h = harness(),
    c = h.context
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer())
  h.run('groupConnectionDrag').move(pointer({ clientX: 700, clientY: 450 }))
  const escape = {
    key: 'Escape',
    target: { closest: () => ({}) },
    preventDefault() {
      this.prevented = true
    },
  }
  c.onKeydown(escape)
  assert.equal(escape.prevented, true)
  assert.equal(h.run('groupConnectionDrag.active'), false)
  assert.equal(c.groupConnectionPreview.value, null)
  c.endGroupConnection(pointer({ clientX: 700, clientY: 450, buttons: 0 }))
  assert.equal(c.pendingGroupConnection.value, null)
  c.beginGroupConnection({ id: 'g', nodeId: 'one' }, pointer())
  c.resetSpace()
  assert.equal(h.run('groupConnectionDrag.active'), false)
  assert.equal(c.activePanel.value, '')
  assert.deepEqual(h.actions, [])
})

test('choosing a menu item uses captured group scope and references once; stale membership refuses node creation', async () => {
  const h = harness(),
    c = h.context
  c.finishGroupConnection({ groupId: 'g', screen: { x: 600, y: 300 } })
  await c.addNode('video')
  assert.deepEqual(plain(h.actions[0]), {
    kind: 'video',
    position: { x: 400, y: 120 },
    groupId: 'g',
  })
  assert.equal(c.pendingGroupConnection.value, null)
  const stale = harness()
  stale.context.finishGroupConnection({ groupId: 'g', screen: { x: 600, y: 300 } })
  stale.context.nodes.value[0] = { ...stale.context.nodes.value[0] }
  await stale.context.addNode('video')
  assert.deepEqual(stale.actions, [])
  assert.equal(stale.context.pendingGroupConnection.value, null)
})

test('actual template forwards all connection events and renders a non-intercepting preview', () => {
  for (const event of ['connect-start', 'connect-move', 'connect-end', 'connect-cancel'])
    assert.ok(shell.includes(`@${event}=`))
  assert.match(
    shell,
    /v-if="groupConnectionPath"[\s\S]*?class="[^"]*\bcv3-pending-reference-line\b[^"]*"/,
  )
  assert.match(shell, /:connection-reset-key="groupConnectionResetKey"/)
  assert.match(css, /\.cv3-pending-reference-line\s*\{[^}]*pointer-events:\s*none/)
  const keydown = source.slice(
    source.indexOf('function onKeydown'),
    source.indexOf('function onKeyup'),
  )
  assert.ok(
    keydown.indexOf('groupConnectionDrag.active') < keydown.indexOf('[data-cv3-selection-ui]'),
  )
  const scopeWatch = ast.program.body.find(
    (item) =>
      item.type === 'ExpressionStatement' &&
      item.expression.type === 'CallExpression' &&
      item.expression.callee.name === 'watch' &&
      item.expression.arguments[0]?.type === 'ArrayExpression' &&
      source.slice(item.start, item.end).includes('stopGroupPreparation()'),
  )
  assert.match(source.slice(scopeWatch.start, scopeWatch.end), /groupConnectionDrag.cancel\(\)/)
})
