import test from 'node:test'
import assert from 'node:assert/strict'
import { createGroupConnectionDrag } from '../src/features/canvas-v3/sync/groupConnectionDrag.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const pointer = (x = 200, y = 200, fields = {}) => ({
  button: 0,
  buttons: 1,
  pointerId: 8,
  clientX: x,
  clientY: y,
  ...fields,
})
function setup() {
  const graph = {
    nodes: ['a', 'b', 'outside'].map((id, index) => ({
      id,
      selected: index < 2,
      position: { x: 100 + index * 800, y: 200 },
      data: { groupId: index < 2 ? 'group' : 'other', groupType: 'normal', kind: 'image' },
    })),
    edges: [{ source: 'outside', target: 'a' }],
    locked: false,
    get selectedNodes() {
      return this.nodes.filter((node) => node.selected)
    },
    get selectedGroup() {
      const members = this.selectedNodes
      const id = members[0]?.data.groupId
      return members.length >= 2 &&
        members.every((node) => node.data.groupId === id) &&
        this.nodes.filter((node) => node.data.groupId === id).length === members.length
        ? { id, type: members[0].data.groupType }
        : null
    },
    get selectionMutable() {
      return !this.locked && Boolean(this.selectedGroup)
    },
    remember() {
      throw new Error('Dragging a preview must not create undo history')
    },
    markChanged() {
      throw new Error('Dragging a preview must not edit the graph')
    },
  }
  let scope = { projectId: 'canvas', token: 'account-session', userId: 'owner' }
  let rect = { left: 40, top: 80, width: 1000, height: 700 }
  const events = []
  const drag = createGroupConnectionDrag({
    graph,
    getScope: () => scope,
    getCanvasRect: () => rect,
    onPreview: (value) => events.push(['preview', value && clone(value)]),
    onRelease: (value) => events.push(['release', clone(value)]),
    onCancel: () => events.push(['cancel']),
  })
  return {
    graph,
    drag,
    events,
    setScope: (value) => {
      scope = value
    },
    get scope() {
      return scope
    },
    setRect: (value) => {
      rect = value
    },
  }
}

test('left drag previews canvas-local screen coordinates and clears before release without changing the graph', () => {
  const { graph, drag, events } = setup()
  const before = clone({ nodes: graph.nodes, edges: graph.edges })
  assert.equal(drag.start('group', pointer()), true)
  assert.equal(drag.active, true)
  assert.equal(drag.move(pointer(300, 350)), true)
  assert.deepEqual(events, [['preview', { groupId: 'group', screen: { x: 260, y: 270 } }]])
  assert.equal(drag.end(pointer(330, 360, { buttons: 0 })), true)
  assert.equal(drag.active, false)
  assert.deepEqual(events.slice(-2), [
    ['preview', null],
    ['release', { groupId: 'group', screen: { x: 290, y: 280 } }],
  ])
  assert.deepEqual({ nodes: graph.nodes, edges: graph.edges }, before)
})

test('three-screen-pixel threshold rejects clicks and tiny jitter; last mouseup point may complete an actual drag', () => {
  const { drag, events } = setup()
  drag.start('group', pointer())
  assert.equal(drag.move(pointer(203, 200)), false)
  assert.equal(drag.end(pointer(203, 200, { buttons: 0 })), false)
  assert.deepEqual(events, [['preview', null]])
  assert.equal(drag.start('group', pointer()), true)
  assert.equal(drag.end(pointer(203.01, 200, { buttons: 0 })), true)
  assert.deepEqual(events.at(-1), ['release', { groupId: 'group', screen: { x: 163.01, y: 120 } }])
})

test('threshold is screen-based and diagonal; repeated same point does not publish duplicate previews', () => {
  const { drag, events } = setup()
  drag.start('group', pointer())
  assert.equal(drag.move(pointer(201, 202)), false)
  assert.equal(drag.move(pointer(202, 202.25)), true)
  assert.equal(drag.move(pointer(202, 202.25)), true)
  assert.equal(events.length, 1)
  drag.end(pointer(202, 202.25, { buttons: 0 }))
  assert.equal(events.filter(([kind]) => kind === 'preview').length, 2)
})

test('only the captured pointer and left-button release can finish the drag', () => {
  const { drag, events } = setup()
  drag.start('group', pointer())
  assert.equal(drag.move(pointer(300, 300, { pointerId: 9 })), false)
  assert.equal(drag.end(pointer(300, 300, { pointerId: 9, buttons: 0 })), false)
  assert.equal(drag.end(pointer(300, 300, { button: 2, buttons: 1 })), false)
  assert.equal(drag.end(pointer(300, 300, { button: 2, buttons: 0 })), false)
  assert.equal(drag.active, true)
  assert.equal(events.length, 0)
  assert.equal(drag.end(pointer(300, 300, { buttons: 0 })), true)
  assert.equal(events.at(-1)[0], 'release')
})

test('losing the left-button mask cancels instead of releasing a menu', () => {
  for (const buttons of [0, 2, undefined, NaN]) {
    const { drag, events } = setup()
    drag.start('group', pointer())
    drag.move(pointer(300, 300))
    assert.equal(drag.move(pointer(310, 310, { buttons })), false)
    assert.equal(drag.active, false)
    assert.deepEqual(events.slice(-2), [['preview', null], ['cancel']])
    assert.equal(
      events.some(([kind]) => kind === 'release'),
      false,
    )
    assert.equal(drag.end(pointer(310, 310, { buttons: 0 })), false)
  }
})

test('explicit cancellation is idempotent and stale release never creates a menu', () => {
  const { drag, events } = setup()
  assert.equal(drag.cancel(), false)
  drag.start('group', pointer())
  assert.equal(drag.cancel(), true)
  assert.equal(drag.cancel(), false)
  assert.equal(drag.end(pointer(400, 400, { buttons: 0 })), false)
  assert.deepEqual(events, [['preview', null], ['cancel']])
})

test('rejects right/middle, missing button state, invalid coordinates, and duplicate starts', () => {
  for (const fields of [
    { button: 2 },
    { button: 2, buttons: 2 },
    { button: 1 },
    { button: 0, buttons: 2 },
    { buttons: 0 },
    { buttons: undefined },
    { pointerId: undefined },
    { clientX: Infinity },
    { clientY: NaN },
  ]) {
    const { drag, events } = setup()
    assert.equal(drag.start('group', pointer(200, 200, fields)), false)
    assert.equal(drag.active, false)
    assert.deepEqual(events, [])
  }
  const { drag } = setup()
  assert.equal(drag.start('group', pointer()), true)
  assert.equal(drag.start('group', pointer()), false)
})

test('requires a valid complete mutable group and valid canvas wrapper', () => {
  for (const modify of [
    (h) => {
      h.graph.locked = true
    },
    (h) => {
      h.graph.nodes[1].selected = false
    },
    (h) => {
      h.graph.nodes.push({
        id: 'third',
        selected: false,
        position: { x: 1, y: 2 },
        data: { groupId: 'group' },
      })
    },
    (h) => {
      h.graph.nodes[1].position.x = NaN
    },
    (h) => {
      h.graph.nodes[1].id = 'a'
    },
    (h) => {
      h.setRect(null)
    },
    (h) => {
      h.setRect({ left: Infinity, top: 0 })
    },
  ]) {
    const h = setup()
    modify(h)
    assert.equal(h.drag.start('group', pointer()), false)
    assert.equal(h.drag.active, false)
    assert.deepEqual(h.events, [])
  }
  assert.equal(setup().drag.start('missing', pointer()), false)
})

test('scope changes, moved or replaced members, type changes, selection changes and newly locked groups cancel safely', () => {
  for (const change of [
    (h) => {
      h.setScope({ ...h.scope, projectId: 'other' })
    },
    (h) => {
      h.setScope({ ...h.scope, token: 'different' })
    },
    (h) => {
      h.setScope({ ...h.scope, userId: 'other' })
    },
    (h) => {
      h.graph.nodes[0].position.x += 1
    },
    (h) => {
      h.graph.nodes[0].position.y += 1
    },
    (h) => {
      h.graph.nodes = clone(h.graph.nodes)
    },
    (h) => {
      h.graph.nodes.splice(0, 1)
    },
    (h) => {
      h.graph.nodes[0].data.groupId = 'other'
    },
    (h) => {
      h.graph.nodes.forEach((node) => {
        node.data.groupType = 'storyboard'
      })
    },
    (h) => {
      h.graph.nodes[0].selected = false
    },
    (h) => {
      h.graph.locked = true
    },
  ]) {
    const h = setup()
    h.drag.start('group', pointer())
    h.drag.move(pointer(300, 300))
    change(h)
    assert.equal(h.drag.move(pointer(350, 350)), false)
    assert.equal(h.drag.active, false)
    assert.equal(
      h.events.some(([kind]) => kind === 'release'),
      false,
    )
    assert.deepEqual(h.events.slice(-2), [['preview', null], ['cancel']])
  }
})

test('release revalidates the frozen scope and members rather than trusting a previous preview', () => {
  const h = setup()
  h.drag.start('group', pointer())
  h.drag.move(pointer(300, 300))
  h.setScope({ ...h.scope, token: 'new-session' })
  assert.equal(h.drag.end(pointer(350, 350, { buttons: 0 })), false)
  assert.equal(
    h.events.some(([kind]) => kind === 'release'),
    false,
  )
})

test('canvas origin changes are applied to each current pointer point with no extra zoom conversion', () => {
  const h = setup()
  h.drag.start('group', pointer())
  h.setRect({ left: 120, top: 140, width: 1000, height: 700 })
  h.drag.move(pointer(300, 350))
  assert.deepEqual(h.events[0], ['preview', { groupId: 'group', screen: { x: 180, y: 210 } }])
  h.setRect(null)
  assert.equal(h.drag.move(pointer(320, 370)), false)
  assert.equal(h.drag.active, false)
})

test('scope object key reordering is not a scope change and invalid terminal coordinates cancel', () => {
  const h = setup()
  h.drag.start('group', pointer())
  h.setScope({ token: 'account-session', userId: 'owner', projectId: 'canvas' })
  assert.equal(h.drag.move(pointer(300, 300)), true)
  assert.equal(h.drag.end(pointer(Infinity, 400, { buttons: 0 })), false)
  assert.deepEqual(h.events.slice(-2), [['preview', null], ['cancel']])
})
