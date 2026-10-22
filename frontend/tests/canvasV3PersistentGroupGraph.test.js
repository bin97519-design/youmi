import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  createNodeClipboard,
  parseNodeClipboard,
  serializeNodeClipboard,
} from '../src/features/canvas-v3/config/nodeClipboard.js'
import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_GROUP_PADDING,
  normalizedGroupColor,
} from '../src/features/canvas-v3/config/groupAppearance.js'

let server, useGraph
before(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ useCanvasV3GraphStore: useGraph } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  ))
})
after(async () => server?.close())

const copy = (value) => JSON.parse(JSON.stringify(value))
function node(id, data = {}, selected = true) {
  return {
    id,
    type: 'generator',
    position: { x: id === 'a' ? 10 : 800, y: 20 },
    selected,
    data: {
      kind: 'image',
      title: id,
      assetUrl: `https://assets.example/${id}.png`,
      groupId: 'group-existing',
      groupName: 'Group 1',
      groupType: 'normal',
      runState: 'idle',
      ...data,
    },
  }
}
function fixture(nodes = [node('a'), node('b')]) {
  setActivePinia(createPinia())
  const graph = useGraph()
  graph.hydrate({ projectId: 'group-qa', nodes, edges: [] })
  return graph
}

test('group appearance has a safe gray fallback without changing legacy selectedGroup shape', () => {
  const graph = fixture()
  assert.deepEqual(graph.selectedGroup, {
    id: 'group-existing',
    name: 'Group 1',
    type: 'normal',
  })
  assert.deepEqual(graph.selectedGroupAppearance, {
    color: DEFAULT_GROUP_COLOR,
    padding: DEFAULT_GROUP_PADDING,
  })
  assert.equal(normalizedGroupColor('url(https://evil.invalid)'), DEFAULT_GROUP_COLOR)
  assert.equal(normalizedGroupColor('#AABBCC'), '#aabbcc')
  graph.nodes[1].selected = false
  assert.equal(graph.selectedGroupAppearance, null)
})

for (const [method, value, key, expected] of [
  ['renameSelectedGroup', '  商品参考组  ', 'groupName', '商品参考组'],
  ['setSelectedGroupColor', '#A85DDB', 'groupColor', '#a85ddb'],
  ['convertSelectedGroup', 'storyboard', 'groupType', 'storyboard'],
  [
    'setSelectedGroupPadding',
    { top: 100, right: 200, bottom: 300, left: 400 },
    'groupPadding',
    { top: 100, right: 200, bottom: 300, left: 400 },
  ],
]) {
  test(`${method} edits all members atomically, keeps group identity and positions, and undoes once`, () => {
    const graph = fixture([node('a'), node('b'), node('outside', { groupId: 'other' }, false)])
    const original = copy(graph.nodes)
    assert.equal(graph[method](value), true)
    assert.equal(graph.revision, 1)
    for (const member of graph.selectedNodes) {
      assert.deepEqual(member.data[key], expected)
      assert.equal(member.data.groupId, 'group-existing')
      assert.deepEqual(member.position, original.find((old) => old.id === member.id).position)
    }
    assert.deepEqual(graph.nodes[2], original[2])
    assert.equal(graph.undo(), true)
    assert.deepEqual(graph.nodes, original)
    assert.equal(graph.canUndo, false)
    assert.equal(graph.redo(), true)
    assert.deepEqual(graph.nodes[0].data[key], expected)
  })

  test(`${method} refuses partial selections, mixed groups and protected tasks`, () => {
    for (const nodes of [
      [node('a'), node('b', {}, false)],
      [node('a'), node('b', { groupId: 'other' })],
      [node('a', { runState: 'running' }), node('b')],
      [node('a', { generation: { persistPending: true } }), node('b')],
      [node('a', { generation: { unresolvedTaskIds: ['paid-task'] } }), node('b')],
    ]) {
      const graph = fixture(nodes)
      const original = copy(graph.nodes)
      assert.equal(graph[method](value), false)
      for (const [index, member] of graph.nodes.entries()) {
        assert.deepEqual(member.data[key], original[index].data[key])
        assert.equal(member.data.groupId, original[index].data.groupId)
        assert.deepEqual(member.position, original[index].position)
      }
      assert.equal(graph.canUndo, false)
    }
  })
}

test('invalid group edits fail without graph changes or history', () => {
  const graph = fixture()
  const original = copy(graph.nodes)
  for (const name of ['', '   ', 'x'.repeat(101), {}, 'hello\nworld', 'bad\u007f'])
    assert.throws(() => graph.renameSelectedGroup(name), /名称/)
  for (const color of ['', 'red', '#abc', '#000000;opacity:0', {}, '#xyzxyz'])
    assert.throws(() => graph.setSelectedGroupColor(color), /颜色/)
  for (const padding of [
    null,
    {},
    { top: 0, right: 20, bottom: 20, left: 20 },
    { top: Infinity, right: 20, bottom: 20, left: 20 },
    { top: 20, right: 20, bottom: 20, left: 20, extra: 1 },
  ])
    assert.throws(() => graph.setSelectedGroupPadding(padding), /边距/)
  assert.throws(() => graph.convertSelectedGroup('render-video'), /类型/)
  assert.deepEqual(graph.nodes, original)
  assert.equal(graph.revision, 0)
  assert.equal(graph.canUndo, false)
})

test('same-value group edits do not create empty undo entries', () => {
  const graph = fixture([
    node('a', { groupColor: DEFAULT_GROUP_COLOR, groupPadding: DEFAULT_GROUP_PADDING }),
    node('b', { groupColor: DEFAULT_GROUP_COLOR, groupPadding: DEFAULT_GROUP_PADDING }),
  ])
  assert.equal(graph.renameSelectedGroup('Group 1'), false)
  assert.equal(graph.convertSelectedGroup('normal'), false)
  assert.equal(graph.setSelectedGroupColor(DEFAULT_GROUP_COLOR.toUpperCase()), false)
  assert.equal(graph.setSelectedGroupPadding({ left: 80, bottom: 80, right: 80, top: 80 }), false)
  assert.equal(graph.revision, 0)
  assert.equal(graph.canUndo, false)
})

test('conversion keeps customized name/color and reversible type without regenerating group identity', () => {
  const graph = fixture([
    node('a', { groupColor: '#225544' }),
    node('b', { groupColor: '#225544' }),
  ])
  assert.equal(graph.convertSelectedGroup('storyboard'), true)
  assert.deepEqual(graph.selectedGroup, {
    id: 'group-existing',
    name: 'Group 1',
    type: 'storyboard',
  })
  assert.deepEqual(graph.selectedGroupAppearance, {
    color: '#225544',
    padding: DEFAULT_GROUP_PADDING,
  })
  assert.equal(graph.convertSelectedGroup('normal'), true)
  assert.equal(graph.selectedGroup.id, 'group-existing')
  assert.equal(graph.selectedGroup.name, 'Group 1')
  assert.equal(graph.selectedGroupAppearance.color, '#225544')
})

test('new groups store safe default color and ungroup removes all appearance metadata', () => {
  const graph = fixture([
    node('a', { groupColor: '#225544' }),
    node('b', { groupColor: '#225544' }),
  ])
  assert.equal(graph.groupSelected('新组'), true)
  assert.equal(graph.selectedGroupAppearance.color, DEFAULT_GROUP_COLOR)
  assert.equal(graph.nodes[0].data.groupColor, DEFAULT_GROUP_COLOR)
  assert.equal(graph.ungroupSelected(), true)
  for (const member of graph.nodes)
    for (const key of ['groupId', 'groupName', 'groupType', 'groupColor', 'groupPadding'])
      assert.equal(Object.hasOwn(member.data, key), false)
})

test('clipboard roundtrip preserves safe color, remaps copied group identity, drops singleton colors', () => {
  const graph = fixture([
    node('a', { groupColor: '#AABBCC' }),
    node('b', { groupColor: '#AABBCC' }),
  ])
  const snapshot = createNodeClipboard(graph.nodes, [])
  const safe = parseNodeClipboard(serializeNodeClipboard(snapshot))
  assert.equal(safe.nodes[0].data.groupColor, '#aabbcc')
  graph.pasteNodeClipboard(safe)
  assert.notEqual(graph.selectedGroup.id, 'group-existing')
  assert.equal(graph.selectedGroupAppearance.color, '#aabbcc')
  const singleton = createNodeClipboard([graph.nodes[0]], [])
  assert.equal(singleton.nodes[0].data.groupColor, undefined)
  assert.equal(singleton.nodes[0].data.groupId, undefined)
  assert.throws(() => createNodeClipboard([node('a', { groupColor: 'red' }), node('b')]), /颜色/)
})

test('padding metadata is independent per member, persists and roundtrips through clipboard safely', () => {
  const graph = fixture()
  const padding = { top: 100, right: 110, bottom: 120, left: 130 }
  assert.equal(graph.setSelectedGroupPadding(padding), true)
  padding.left = 999
  assert.equal(graph.nodes[0].data.groupPadding.left, 130)
  assert.notEqual(graph.nodes[0].data.groupPadding, graph.nodes[1].data.groupPadding)
  const saved = copy(graph.nodes)
  graph.hydrate({ projectId: 'restored', nodes: saved, edges: [] })
  assert.deepEqual(graph.selectedGroupAppearance.padding, {
    top: 100,
    right: 110,
    bottom: 120,
    left: 130,
  })
  const safe = parseNodeClipboard(serializeNodeClipboard(createNodeClipboard(graph.nodes, [])))
  assert.deepEqual(safe.nodes[0].data.groupPadding, graph.selectedGroupAppearance.padding)
  assert.equal(createNodeClipboard([graph.nodes[0]], []).nodes[0].data.groupPadding, undefined)
  const accessor = { top: 80, right: 80, bottom: 80 }
  let called = false
  Object.defineProperty(accessor, 'left', {
    enumerable: true,
    get() {
      called = true
      throw new Error('no')
    },
  })
  assert.throws(
    () => createNodeClipboard([node('a', { groupPadding: accessor }), node('b')]),
    /边距/,
  )
  assert.equal(called, false)
})

test('group plus creates a real downstream node and member references in one reversible edit', () => {
  const graph = fixture([
    node('a'),
    node('b', { kind: 'video' }),
    node('c', { kind: 'audio' }),
    node('d', { kind: 'text', prompt: '剧本内容' }),
    node('e', { kind: 'script' }),
    node('outside', { groupId: 'other' }, false),
  ])
  const original = copy(graph.nodes)
  const next = graph.createGroupConnectedNode('video', { x: 2000, y: 100 }, 'group-existing')
  assert.ok(next)
  assert.equal(next.data.kind, 'video')
  assert.equal(next.data.groupId, undefined)
  assert.equal(next.data.runState, 'idle')
  assert.equal(graph.revision, 1)
  assert.deepEqual(
    graph.selectedNodes.map((member) => member.id),
    [next.id],
  )
  assert.equal(graph.edges.length, 4)
  assert.deepEqual(
    graph.edges.map((edge) => edge.source),
    ['a', 'b', 'c', 'd'],
  )
  assert.ok(
    graph.edges.every((edge) => edge.target === next.id && edge.data.semantic === 'dependency'),
  )
  assert.equal(graph.undo(), true)
  assert.deepEqual(graph.nodes, original)
  assert.deepEqual(graph.edges, [])
  assert.equal(graph.canUndo, false)
})

test('group plus validates current complete group, node kinds, location and all task states before editing', () => {
  for (const [kind, position, groupId] of [
    ['bad-kind', { x: 1000, y: 1 }, 'group-existing'],
    ['constructor', { x: 1000, y: 1 }, 'group-existing'],
    ['image', { x: NaN, y: 1 }, 'group-existing'],
    ['image', { x: 1000, y: Infinity }, 'group-existing'],
    ['image', null, 'group-existing'],
    ['image', { x: 1000, y: 1 }, 'missing-group'],
  ]) {
    const graph = fixture()
    assert.equal(graph.createGroupConnectedNode(kind, position, groupId), false)
    assert.equal(graph.revision, 0)
    assert.equal(graph.canUndo, false)
  }
  for (const task of [
    { runState: 'preparing' },
    { runState: 'submitting' },
    { runState: 'queued' },
    { runState: 'running' },
    { runState: 'paused' },
    { runState: 'uncertain' },
    { generation: { persistPending: true } },
    { generation: { queryPending: true } },
    { generation: { unresolvedTaskIds: ['in-flight'] } },
  ]) {
    const graph = fixture([node('a', { kind: 'audio', ...task }), node('b')])
    assert.equal(
      graph.createGroupConnectedNode('image', { x: 1000, y: 100 }, 'group-existing'),
      false,
    )
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 0)
    assert.equal(graph.canUndo, false)
  }
  for (const members of [
    [node('a'), node('b', {}, false)],
    [node('a')],
    [node('a', { kind: 'script' }), node('b', { kind: 'reference' })],
  ]) {
    const graph = fixture(members)
    assert.equal(
      graph.createGroupConnectedNode('image', { x: 1000, y: 100 }, 'group-existing'),
      false,
    )
    assert.equal(graph.canUndo, false)
    assert.equal(graph.edges.length, 0)
  }
})

test('explicit rename commits the source group after another group is selected, without selecting or renaming it', () => {
  const graph = fixture([
    node('a1', { groupId: 'group-a', groupName: 'A' }, false),
    node('a2', { groupId: 'group-a', groupName: 'A' }, false),
    node('b1', { groupId: 'group-b', groupName: 'B' }),
    node('b2', { groupId: 'group-b', groupName: 'B' }),
  ])
  const before = copy(graph.nodes)
  assert.equal(graph.renameGroup('group-a', ' A的最新名字 '), true)
  assert.equal(graph.nodes[0].data.groupName, 'A的最新名字')
  assert.equal(graph.nodes[1].data.groupName, 'A的最新名字')
  assert.deepEqual(graph.nodes.slice(2), before.slice(2))
  assert.deepEqual(
    graph.selectedNodes.map((member) => member.id),
    ['b1', 'b2'],
  )
  assert.deepEqual(graph.selectedGroup, { id: 'group-b', name: 'B', type: 'normal' })
  assert.equal(graph.revision, 1)
  assert.equal(graph.undo(), true)
  assert.deepEqual(graph.nodes, before)
  assert.equal(graph.canUndo, false)
})

test('explicit rename refuses active source group and missing/singleton groups without modifying another selection', () => {
  const graph = fixture([
    node('a1', { groupId: 'group-a', groupName: 'A', runState: 'running' }, false),
    node('a2', { groupId: 'group-a', groupName: 'A' }, false),
    node('b1', { groupId: 'group-b', groupName: 'B' }),
    node('b2', { groupId: 'group-b', groupName: 'B' }),
    node('singleton', { groupId: 'one', groupName: 'One' }, false),
  ])
  const selected = copy(graph.selectedNodes)
  for (const groupId of ['group-a', 'missing', 'one', null, '']) {
    assert.equal(graph.renameGroup(groupId, '不能误改B'), false)
    assert.equal(graph.nodes[0].data.groupName, 'A')
    assert.equal(graph.nodes[1].data.groupName, 'A')
    assert.deepEqual(graph.selectedNodes, selected)
    assert.equal(graph.canUndo, false)
  }
  assert.throws(() => graph.renameGroup('group-b', 'x\ninvalid'), /名称/)
  assert.deepEqual(graph.selectedNodes, selected)
})
