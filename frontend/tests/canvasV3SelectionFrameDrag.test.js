import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSelectionFrameDrag,
  moveSelectedByKey,
} from '../src/features/canvas-v3/sync/selectionFrameDrag.js'

const node = (id, x, y, selected = true) => ({ id, position: { x, y }, selected })
const point = (x = 100, y = 100, extra = {}) => ({
  button: 0,
  pointerId: 11,
  clientX: x,
  clientY: y,
  ...extra,
})

function setup({ zoom = 1, nodes } = {}) {
  const graph = {
    nodes: nodes ?? [node('a', 10, 20), node('b', -30, 40), node('other', 600, 800, false)],
    history: [],
    rememberCalls: 0,
    changedCalls: 0,
    get selectedNodes() {
      return this.nodes.filter((entry) => entry.selected)
    },
    get selectionMutable() {
      return this.selectedNodes.length >= 2 && !this.selectedNodes.some((entry) => entry.protected)
    },
    remember() {
      this.rememberCalls += 1
      this.history.push(
        this.nodes.map((entry) => ({ id: entry.id, position: { ...entry.position } })),
      )
    },
    markChanged() {
      this.changedCalls += 1
    },
    undo() {
      const snapshot = this.history.pop()
      for (const entry of snapshot ?? []) {
        const original = this.nodes.find((candidate) => candidate.id === entry.id)
        if (original) original.position = { ...entry.position }
      }
    },
  }
  let currentZoom = zoom
  let scope = { projectId: 'project-a', token: 'session-a', userId: 'user-a' }
  const drag = createSelectionFrameDrag({
    graph,
    getScope: () => scope,
    getZoom: () => currentZoom,
  })
  return {
    graph,
    drag,
    get scope() {
      return scope
    },
    setScope: (value) => {
      scope = value
    },
    setZoom: (value) => {
      currentZoom = value
    },
  }
}

const positions = (graph) => graph.nodes.map((entry) => ({ ...entry.position }))

test('starting a selection drag does not mutate nodes, history, or the project revision', () => {
  const { graph, drag } = setup()
  const before = positions(graph)
  assert.equal(drag.start(point()), true)
  assert.deepEqual(positions(graph), before)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
  assert.equal(drag.end(point()), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('the drag threshold is strictly more than three screen pixels, including diagonal travel', () => {
  const { graph, drag } = setup()
  assert.equal(drag.start(point()), true)
  assert.equal(drag.move(point(103, 100)), false)
  assert.equal(drag.move(point(101.8, 102.4)), false)
  assert.deepEqual(positions(graph), [
    { x: 10, y: 20 },
    { x: -30, y: 40 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 0)
  assert.equal(drag.move(point(102.5, 102.5)), true)
  assert.deepEqual(positions(graph), [
    { x: 12.5, y: 22.5 },
    { x: -27.5, y: 42.5 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 1)
})

for (const zoom of [0.25, 0.5, 1, 2, 3]) {
  test(`a screen delta is converted to world coordinates at zoom ${zoom}`, () => {
    const { graph, drag } = setup({ zoom })
    drag.start(point(40, 50))
    assert.equal(drag.move(point(60, 40)), true)
    assert.deepEqual(positions(graph), [
      { x: 10 + 20 / zoom, y: 20 - 10 / zoom },
      { x: -30 + 20 / zoom, y: 40 - 10 / zoom },
      { x: 600, y: 800 },
    ])
  })
}

test('successive moves are calculated from the initial position, not accumulated twice', () => {
  const { graph, drag } = setup({ zoom: 2 })
  drag.start(point())
  drag.move(point(110, 120))
  drag.move(point(120, 140))
  assert.deepEqual(positions(graph), [
    { x: 20, y: 40 },
    { x: -20, y: 60 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 0)
  assert.equal(drag.end(point(120, 140)), true)
  assert.equal(graph.changedCalls, 1)
  assert.equal(drag.end(point(140, 160)), false)
  assert.equal(drag.cancel(), false)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
  graph.undo()
  assert.deepEqual(positions(graph), [
    { x: 10, y: 20 },
    { x: -30, y: 40 },
    { x: 600, y: 800 },
  ])
})

test('zoom is snapshotted at the start of a drag', () => {
  const { graph, drag, setZoom } = setup({ zoom: 0.5 })
  drag.start(point())
  setZoom(3)
  drag.move(point(110, 105))
  assert.deepEqual(positions(graph), [
    { x: 30, y: 30 },
    { x: -10, y: 50 },
    { x: 600, y: 800 },
  ])
})

test('a valid final pointer coordinate is applied even without a preceding move event', () => {
  const { graph, drag } = setup()
  drag.start(point())
  assert.equal(drag.end(point(115, 90)), true)
  assert.deepEqual(positions(graph), [
    { x: 25, y: 10 },
    { x: -15, y: 30 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
})

test('end without usable coordinates commits a previous move without another delta', () => {
  const { graph, drag } = setup()
  drag.start(point())
  drag.move(point(112, 94))
  const beforeEnd = positions(graph)
  assert.equal(drag.end(), true)
  assert.deepEqual(positions(graph), beforeEnd)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
})

test('cancel keeps a moved selection and its undo entry, and commits only once', () => {
  const { graph, drag } = setup()
  drag.start(point())
  drag.move(point(109, 108))
  const moved = positions(graph)
  assert.equal(drag.cancel(), true)
  assert.deepEqual(positions(graph), moved)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
  assert.equal(drag.cancel(), false)
  assert.equal(drag.move(point(150, 150)), false)
  graph.undo()
  assert.deepEqual(positions(graph), [
    { x: 10, y: 20 },
    { x: -30, y: 40 },
    { x: 600, y: 800 },
  ])
})

test('cancel before movement has no history or revision side effects', () => {
  const { graph, drag } = setup()
  assert.equal(drag.cancel(), false)
  drag.start(point())
  drag.move(point(101, 101))
  assert.equal(drag.cancel(), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('a different pointer cannot move or finish the active drag', () => {
  const { graph, drag } = setup()
  drag.start(point())
  assert.equal(drag.move(point(120, 140, { pointerId: 12 })), false)
  assert.equal(drag.end(point(120, 140, { pointerId: 12 })), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(drag.move(point(110, 100)), true)
  assert.equal(drag.end(point(110, 100)), true)
  assert.equal(graph.changedCalls, 1)
})

test('pointer-less mouse events can be used when no pointer id was captured', () => {
  const { graph, drag } = setup()
  assert.equal(drag.start({ button: 0, clientX: 100, clientY: 100 }), true)
  assert.equal(drag.move({ clientX: 110, clientY: 100 }), true)
  assert.equal(drag.end({ clientX: 110, clientY: 100 }), true)
  assert.equal(graph.changedCalls, 1)
})

test('invalid buttons, coordinates, positions, and non-mutable selections are rejected at start', () => {
  for (const event of [
    point(100, 100, { button: 1 }),
    point(100, 100, { button: 2 }),
    point(Number.NaN, 100),
    point(100, Number.POSITIVE_INFINITY),
    { button: 0 },
  ]) {
    const { graph, drag } = setup()
    assert.equal(drag.start(event), false)
    assert.equal(graph.rememberCalls, 0)
  }
  for (const nodes of [
    [node('a', 10, 20)],
    [node('a', 10, 20), node('b', 30, 40, false)],
    [node('a', Number.NaN, 20), node('b', 30, 40)],
    [node('a', 10, 20), node('b', 30, Number.POSITIVE_INFINITY)],
    [{ ...node('a', 10, 20), protected: true }, node('b', 30, 40)],
  ]) {
    const { graph, drag } = setup({ nodes })
    assert.equal(drag.start(point()), false)
    assert.equal(graph.rememberCalls, 0)
    assert.equal(graph.changedCalls, 0)
  }
})

test('invalid move coordinates do not poison an otherwise active drag', () => {
  const { graph, drag } = setup()
  drag.start(point())
  assert.equal(drag.move(point(Number.NaN, 120)), false)
  assert.equal(drag.move({ pointerId: 11 }), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(drag.move(point(110, 105)), true)
  assert.deepEqual(positions(graph), [
    { x: 20, y: 25 },
    { x: -20, y: 45 },
    { x: 600, y: 800 },
  ])
})

test('scope snapshots compare their values, so an equivalent new object remains safe', () => {
  const { graph, drag, scope, setScope } = setup()
  drag.start(point())
  setScope({ ...scope })
  assert.equal(drag.move(point(110, 100)), true)
  assert.equal(drag.end(), true)
  assert.equal(graph.changedCalls, 1)
})

test('in-place scope mutation aborts without writing the newly active canvas revision', () => {
  for (const field of ['projectId', 'token', 'userId']) {
    const { graph, drag, scope } = setup()
    drag.start(point())
    drag.move(point(110, 100))
    const beforeSwitch = positions(graph)
    scope[field] = `${scope[field]}-changed`
    assert.equal(drag.move(point(130, 100)), false)
    assert.deepEqual(positions(graph), beforeSwitch)
    assert.equal(drag.end(), false)
    assert.equal(drag.cancel(), false)
    assert.equal(graph.rememberCalls, 1)
    assert.equal(graph.changedCalls, 0)
  }
})

test('a changed scope before the first move never records history', () => {
  const { graph, drag, setScope } = setup()
  drag.start(point())
  setScope({ projectId: 'project-b', token: 'session-a', userId: 'user-a' })
  assert.equal(drag.move(point(110, 100)), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('replacing a selected node with the same id aborts without mutating its replacement', () => {
  const { graph, drag } = setup()
  drag.start(point())
  drag.move(point(110, 100))
  const original = graph.nodes[0]
  const replacement = node('a', 500, 600)
  graph.nodes[0] = replacement
  assert.equal(drag.move(point(140, 100)), false)
  assert.deepEqual(replacement.position, { x: 500, y: 600 })
  assert.deepEqual(original.position, { x: 20, y: 20 })
  assert.deepEqual(graph.nodes[1].position, { x: -20, y: 40 })
  assert.equal(drag.end(), false)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 0)
})

test('changing selection commits the previous move but never moves the new selection', () => {
  const { graph, drag } = setup()
  drag.start(point())
  drag.move(point(110, 100))
  graph.nodes[0].selected = false
  graph.nodes[2].selected = true
  const beforeChange = positions(graph)
  assert.equal(drag.move(point(150, 140)), false)
  assert.deepEqual(positions(graph), beforeChange)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
  assert.equal(drag.end(), false)
})

test('adding another selected node cancels continuation without including that node in the drag', () => {
  const { graph, drag } = setup()
  drag.start(point())
  graph.nodes[2].selected = true
  assert.equal(drag.move(point(120, 120)), false)
  assert.deepEqual(positions(graph), [
    { x: 10, y: 20 },
    { x: -30, y: 40 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('a newly protected selected node stops continuation and retains the previous undoable move', () => {
  const { graph, drag } = setup()
  drag.start(point())
  drag.move(point(110, 100))
  const moved = positions(graph)
  graph.nodes[1].protected = true
  assert.equal(drag.move(point(150, 120)), false)
  assert.deepEqual(positions(graph), moved)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
  graph.undo()
  assert.deepEqual(positions(graph), [
    { x: 10, y: 20 },
    { x: -30, y: 40 },
    { x: 600, y: 800 },
  ])
})

test('keyboard arrows move only selected nodes by five world pixels with one undo step', () => {
  const expected = {
    ArrowLeft: { x: -5, y: 0 },
    ArrowRight: { x: 5, y: 0 },
    ArrowUp: { x: 0, y: -5 },
    ArrowDown: { x: 0, y: 5 },
  }
  for (const [key, delta] of Object.entries(expected)) {
    const { graph } = setup({ zoom: 0.25 })
    assert.equal(moveSelectedByKey(graph, key, {}), true)
    assert.deepEqual(positions(graph), [
      { x: 10 + delta.x, y: 20 + delta.y },
      { x: -30 + delta.x, y: 40 + delta.y },
      { x: 600, y: 800 },
    ])
    assert.equal(graph.rememberCalls, 1)
    assert.equal(graph.changedCalls, 1)
    graph.undo()
    assert.deepEqual(positions(graph), [
      { x: 10, y: 20 },
      { x: -30, y: 40 },
      { x: 600, y: 800 },
    ])
  }
})

test('shift-arrow uses twenty world pixels independently of the canvas zoom', () => {
  const { graph } = setup({ zoom: 3 })
  assert.equal(moveSelectedByKey(graph, 'ArrowRight', { shiftKey: true }), true)
  assert.deepEqual(positions(graph), [
    { x: 30, y: 20 },
    { x: -10, y: 40 },
    { x: 600, y: 800 },
  ])
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.changedCalls, 1)
})

test('keyboard movement rejects unknown keys, fewer than two nodes, protected or invalid positions', () => {
  const { graph } = setup()
  assert.equal(moveSelectedByKey(graph, 'Enter', {}), false)
  assert.equal(moveSelectedByKey(graph, 'a', {}), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
  for (const nodes of [
    [node('a', 10, 20)],
    [node('a', 10, 20), node('b', 30, 40, false)],
    [{ ...node('a', 10, 20), protected: true }, node('b', 30, 40)],
    [node('a', Number.NaN, 20), node('b', 30, 40)],
    [node('a', 10, 20), node('b', 30, Number.POSITIVE_INFINITY)],
  ]) {
    const { graph: invalid } = setup({ nodes })
    assert.equal(moveSelectedByKey(invalid, 'ArrowRight', {}), false)
    assert.equal(invalid.rememberCalls, 0)
    assert.equal(invalid.changedCalls, 0)
  }
})
