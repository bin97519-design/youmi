import test from 'node:test'
import assert from 'node:assert/strict'
import { createGroupFrameResize } from '../src/features/canvas-v3/sync/groupFrameResize.js'
import { DEFAULT_GROUP_PADDING } from '../src/features/canvas-v3/config/groupAppearance.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const point = (x = 100, y = 100, extra = {}) => ({
  button: 0,
  pointerId: 11,
  clientX: x,
  clientY: y,
  ...extra,
})
function setup({ zoom = 1, padding } = {}) {
  const graph = {
    nodes: ['a', 'b', 'outside'].map((id, index) => ({
      id,
      selected: index < 2,
      position: { x: 100 + index * 800, y: 200 },
      data: {
        kind: index === 1 ? 'video' : 'image',
        groupId: index < 2 ? 'group-one' : 'group-other',
        groupType: 'normal',
        mediaWidth: 800,
        mediaHeight: 600,
        params: { ratio: '4:3' },
        ...(padding ? { groupPadding: { ...padding } } : {}),
      },
    })),
    edges: [{ source: 'outside', target: 'a' }],
    history: [],
    rememberCalls: 0,
    changedCalls: 0,
    get selectedNodes() {
      return this.nodes.filter((node) => node.selected)
    },
    get selectedGroup() {
      const members = this.selectedNodes
      const groupId = members[0]?.data.groupId
      return members.length >= 2 &&
        members.every((node) => node.data.groupId === groupId) &&
        this.nodes.filter((node) => node.data.groupId === groupId).length === members.length
        ? { id: groupId, type: members[0].data.groupType }
        : null
    },
    get selectionMutable() {
      return this.selectedNodes.length >= 2 && !this.selectedNodes.some((node) => node.protected)
    },
    remember() {
      this.rememberCalls++
      this.history.push(clone(this.nodes))
    },
    markChanged() {
      this.changedCalls++
    },
    undo() {
      this.nodes = this.history.pop()
    },
  }
  let scope = { projectId: 'one', token: 'session', userId: 'u1' }
  let currentZoom = zoom
  const resize = createGroupFrameResize({
    graph,
    getScope: () => scope,
    getZoom: () => currentZoom,
  })
  return {
    graph,
    resize,
    setScope: (value) => {
      scope = value
    },
    get scope() {
      return scope
    },
    setZoom: (value) => {
      currentZoom = value
    },
  }
}

test('starting and ending without movement never mutates padding/history/revision', () => {
  const { graph, resize } = setup()
  const before = clone(graph.nodes)
  assert.equal(resize.start(point(), 'nw'), true)
  assert.equal(resize.active, true)
  assert.equal(resize.end(point()), false)
  assert.equal(resize.active, false)
  assert.deepEqual(graph.nodes, before)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('resize begins strictly after three screen pixels, including fractional diagonal coordinates', () => {
  const { graph, resize } = setup()
  resize.start(point(), 'se')
  assert.equal(resize.move(point(103, 100)), false)
  assert.equal(resize.move(point(101.8, 102.4)), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(resize.move(point(102.5, 102.5)), true)
  assert.equal(graph.rememberCalls, 1)
  assert.equal(graph.nodes[0].data.groupPadding.right, 82.5)
})

for (const zoom of [0.25, 0.5, 1, 2, 3]) {
  test(`resize converts screen delta to world padding at captured zoom ${zoom} only`, () => {
    const { graph, resize, setZoom } = setup({ zoom })
    const original = clone(graph.nodes)
    const edges = clone(graph.edges)
    resize.start(point(100, 100), 'se')
    setZoom(zoom * 2)
    assert.equal(resize.move(point(140, 120)), true)
    assert.deepEqual(graph.nodes[0].data.groupPadding, {
      top: 80,
      left: 80,
      right: 80 + 40 / zoom,
      bottom: 80 + 20 / zoom,
    })
    assert.deepEqual(graph.nodes[1].data.groupPadding, graph.nodes[0].data.groupPadding)
    assert.notEqual(graph.nodes[0].data.groupPadding, graph.nodes[1].data.groupPadding)
    for (const [index, member] of graph.nodes.entries()) {
      assert.deepEqual(member.position, original[index].position)
      assert.equal(member.data.mediaWidth, original[index].data.mediaWidth)
      assert.equal(member.data.mediaHeight, original[index].data.mediaHeight)
      assert.deepEqual(member.data.params, original[index].data.params)
    }
    assert.deepEqual(graph.nodes[2], original[2])
    assert.deepEqual(graph.edges, edges)
    assert.equal(resize.end(point(150, 130)), true)
    assert.equal(graph.rememberCalls, 1)
    assert.equal(graph.changedCalls, 1)
    assert.equal(graph.nodes[0].data.groupPadding.right, 80 + 50 / zoom)
    graph.undo()
    assert.deepEqual(graph.nodes, original)
  })
}

test('resize clamps padding at16 and does not create empty history when already at the same clamp', () => {
  const { graph, resize } = setup({ padding: { top: 16, left: 16, right: 80, bottom: 80 } })
  resize.start(point(), 'nw')
  assert.equal(resize.move(point(1000, 1000)), false)
  assert.equal(resize.end(point(1000, 1000)), false)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(graph.changedCalls, 0)
})

test('cancelling retains applied padding as one undoable edit, never applies cancelled future moves', () => {
  const { graph, resize } = setup()
  const original = clone(graph.nodes)
  resize.start(point(), 'ne')
  resize.move(point(130, 80))
  assert.equal(resize.cancel(), true)
  assert.equal(resize.active, false)
  assert.equal(graph.changedCalls, 1)
  assert.equal(resize.move(point(300, 300)), false)
  assert.deepEqual(graph.nodes[0].data.groupPadding, { top: 100, right: 110, bottom: 80, left: 80 })
  assert.equal(resize.cancel(), false)
  graph.undo()
  assert.deepEqual(graph.nodes, original)
})

test('non-left buttons, invalid points/corners/zooms, partial selections and protected groups refuse start', () => {
  for (const [event, corner] of [
    [point(100, 100, { button: 1 }), 'se'],
    [point(NaN, 100), 'se'],
    [point(), 'bad'],
  ]) {
    const { graph, resize } = setup()
    assert.equal(resize.start(event, corner), false)
    assert.equal(graph.rememberCalls, 0)
  }
  for (const zoom of [0, NaN, Infinity, -1]) {
    const { resize } = setup({ zoom })
    assert.equal(resize.start(point(), 'se'), false)
  }
  for (const modify of [
    (graph) => {
      graph.nodes[1].selected = false
    },
    (graph) => {
      graph.nodes[1].data.groupId = 'other'
    },
    (graph) => {
      graph.nodes[0].protected = true
    },
    (graph) => {
      graph.nodes[2].data.groupId = 'group-one'
    },
    (graph) => {
      graph.nodes[0].position.x = NaN
    },
  ]) {
    const { graph, resize } = setup()
    modify(graph)
    assert.equal(resize.start(point(), 'se'), false)
  }
})

test('wrong pointer cannot resize or terminate another pointer gesture', () => {
  const { graph, resize } = setup()
  resize.start(point(), 'se')
  assert.equal(resize.move(point(150, 150, { pointerId: 99 })), false)
  assert.equal(resize.end(point(150, 150, { pointerId: 99 })), false)
  assert.equal(resize.active, true)
  assert.equal(graph.rememberCalls, 0)
  assert.equal(resize.end(point(150, 150)), true)
})

test('project/account scope changes cannot write padding or revisions, including mutated-in-place scope', () => {
  for (const change of [
    (state) => state.setScope({ projectId: 'two', token: 'session', userId: 'u1' }),
    (state) => {
      state.scope.userId = 'u2'
    },
    (state) => {
      state.scope.token = 'new'
    },
  ]) {
    const state = setup()
    state.resize.start(point(), 'se')
    state.resize.move(point(120, 130))
    const padding = clone(state.graph.nodes[0].data.groupPadding)
    change(state)
    assert.equal(state.resize.move(point(150, 150)), false)
    assert.equal(state.resize.active, false)
    assert.deepEqual(state.graph.nodes[0].data.groupPadding, padding)
    assert.equal(state.graph.changedCalls, 0)
  }
})

test('same-ID rehydration cancels without modifying replacement objects or creating stale revisions', () => {
  const { graph, resize } = setup()
  resize.start(point(), 'se')
  resize.move(point(120, 130))
  graph.nodes = clone(graph.nodes)
  const replacement = clone(graph.nodes)
  assert.equal(resize.move(point(150, 150)), false)
  assert.deepEqual(graph.nodes, replacement)
  assert.equal(graph.changedCalls, 0)
})

test('selection/type/member movement/protection changes stop resize without further writes', () => {
  for (const modify of [
    (graph) => {
      graph.nodes[0].selected = false
    },
    (graph) => {
      graph.nodes[0].data.groupType = 'storyboard'
    },
    (graph) => {
      graph.nodes[0].position.x += 1
    },
    (graph) => {
      graph.nodes[0].protected = true
    },
    (graph) => {
      graph.nodes[2].data.groupId = 'group-one'
    },
  ]) {
    const { graph, resize } = setup()
    resize.start(point(), 'se')
    resize.move(point(120, 130))
    const padding = clone(graph.nodes[0].data.groupPadding)
    modify(graph)
    assert.equal(resize.move(point(150, 150)), false)
    assert.deepEqual(graph.nodes[0].data.groupPadding, padding)
    assert.equal(graph.changedCalls, 1)
    assert.equal(graph.rememberCalls, 1)
  }
})

test('subsequent gestures start from persisted padding, not the original default', () => {
  const { graph, resize } = setup()
  resize.start(point(), 'se')
  resize.end(point(120, 130))
  resize.start(point(), 'nw')
  resize.end(point(80, 90))
  assert.deepEqual(graph.nodes[0].data.groupPadding, {
    top: 90,
    right: 100,
    bottom: 110,
    left: 100,
  })
  assert.equal(graph.rememberCalls, 2)
  assert.equal(graph.changedCalls, 2)
  assert.deepEqual(DEFAULT_GROUP_PADDING, { top: 80, right: 80, bottom: 80, left: 80 })
})
