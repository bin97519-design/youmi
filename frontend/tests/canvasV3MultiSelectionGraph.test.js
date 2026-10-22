import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { CANVAS_SELECTION_LAYOUTS, canvasSelectionLayout } from '../src/utils/canvasSelection.js'
import {
  createNodeClipboard,
  parseNodeClipboard,
  serializeNodeClipboard,
} from '../src/features/canvas-v3/config/nodeClipboard.js'

let server, useGraph, nodeSize
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
  ;({ nodeSize } = await server.ssrLoadModule('/src/features/canvas-v3/config/nodeGeometry.js'))
})
after(async () => server?.close())

const clone = (value) => JSON.parse(JSON.stringify(value))
function node(id, kind = 'image', selected = true, position = { x: 0, y: 0 }, data = {}) {
  return {
    id,
    type: 'generator',
    selected,
    position,
    data: {
      kind,
      title: id,
      model: 'model-api-key:4',
      prompt: '保留产品结构',
      params: { ratio: '16:9' },
      assetUrl: `https://assets.example/${id}.${kind === 'video' ? 'mp4' : 'png'}`,
      runState: 'idle',
      artifactStatus: 'ready',
      ...data,
    },
  }
}
function edge(id, source, target, selected = false) {
  return {
    id,
    source,
    target,
    selected,
    type: 'default',
    sourceHandle: 'output',
    targetHandle: 'input',
  }
}
function fixture(nodes, edges = []) {
  setActivePinia(createPinia())
  const graph = useGraph()
  graph.hydrate({ projectId: 'multi-selection-fixture', nodes, edges })
  return graph
}
const trio = () => [
  node('a', 'image', true, { x: 25, y: 50 }, { mediaWidth: 200, mediaHeight: 100 }),
  node('b', 'video', true, { x: 700, y: 460 }, { mediaWidth: 100, mediaHeight: 200 }),
  node('c', 'text', true, { x: 1300, y: 160 }),
  node('outside', 'image', false, { x: 8000, y: -1400 }),
]

test('selection mutation is available only for at least two nodes, with no parallel selection state', () => {
  const graph = fixture([node('a'), node('b', 'video', false)])
  assert.equal(graph.selectionMutable, false)
  assert.equal(graph.activeNode.id, 'a')
  graph.nodes[1].selected = true
  assert.equal(graph.selectionMutable, true)
  assert.equal(graph.activeNode, null)
  assert.equal(graph.selectedGroup, null)
  assert.equal(graph.undoStack, undefined)
})

test('all eleven layouts change only the selected world positions and commit one undo step', () => {
  assert.equal(CANVAS_SELECTION_LAYOUTS.length, 11)
  for (const layout of CANVAS_SELECTION_LAYOUTS) {
    const graph = fixture(trio(), [edge('inside', 'a', 'b'), edge('outside', 'outside', 'a')])
    const original = clone(graph.nodes)
    const originalEdges = clone(graph.edges)
    const expected = canvasSelectionLayout(
      graph.selectedNodes.map((item) => ({
        id: item.id,
        x: item.position.x,
        y: item.position.y,
        ...nodeSize(item.data.kind, item.data),
      })),
      layout.key,
    )
    assert.equal(graph.arrangeSelected(layout.key), true, layout.key)
    assert.equal(graph.revision, 1)
    assert.equal(graph.canUndo, true)
    assert.equal(graph.canRedo, false)
    for (const item of graph.selectedNodes) {
      assert.deepEqual(item.position, expected.get(item.id))
      assert.deepEqual(item.data, original.find((value) => value.id === item.id).data)
      assert.equal(Object.hasOwn(item, 'parentNode'), false)
    }
    assert.deepEqual(graph.nodes.at(-1), original.at(-1))
    assert.deepEqual(graph.edges, originalEdges)
    assert.equal(graph.undo(), true)
    assert.deepEqual(graph.nodes, original)
    assert.equal(graph.canUndo, false, 'there is no duplicate history entry')
    assert.equal(graph.redo(), true)
    assert.deepEqual(graph.nodes[0].position, expected.get('a'))
  }
})

test('unknown layouts, insufficient selections and two-node distributions make no history changes', () => {
  const graph = fixture([node('a'), node('b', 'video')])
  for (const mode of ['missing', 'distribute-x', 'distribute-y'])
    assert.equal(graph.arrangeSelected(mode), false)
  graph.nodes[1].selected = false
  assert.equal(graph.arrangeSelected('horizontal'), false)
  assert.equal(graph.groupSelected(), false)
  assert.equal(graph.ungroupSelected(), false)
  assert.equal(graph.canUndo, false)
  assert.equal(graph.revision, 0)
})

test('logical grouping persists metadata, preserves every world coordinate and supports full-group selection', () => {
  const graph = fixture(trio(), [edge('inside', 'a', 'b', true)])
  graph.nodes[2].selected = false
  const before = clone(graph.nodes)
  assert.equal(graph.groupSelected('我的素材组'), true)
  const groupId = graph.nodes[0].data.groupId
  assert.ok(groupId.startsWith('group-'))
  assert.deepEqual(graph.selectedGroup, { id: groupId, name: '我的素材组', type: 'normal' })
  for (const item of graph.nodes) {
    assert.deepEqual(item.position, before.find((value) => value.id === item.id).position)
    assert.equal(Object.hasOwn(item, 'parentNode'), false)
  }
  graph.nodes[0].selected = false
  graph.nodes[3].selected = true
  assert.equal(graph.selectedGroup, null)
  assert.equal(graph.selectGroup('b'), true)
  assert.deepEqual(
    graph.selectedNodes.map((item) => item.id),
    ['a', 'b'],
  )
  assert.equal(graph.edges[0].selected, false)
  assert.equal(graph.selectGroup('missing'), false)
  assert.equal(graph.selectGroup('outside'), false)
  assert.equal(graph.revision, 1, 'selecting a group is not a graph edit')
  const saved = clone(graph.nodes)
  graph.hydrate({ projectId: 'restored', nodes: saved, edges: clone(graph.edges) })
  assert.equal(graph.nodes[0].data.groupId, groupId)
  assert.equal(graph.nodes[1].data.groupName, '我的素材组')
  assert.equal(graph.selectGroup('a'), true)
})

test('group names are generated without collisions, validated, and ungroup is a single undoable edit', () => {
  const graph = fixture([
    node('a'),
    node('b'),
    node(
      'other',
      'image',
      false,
      { x: 9, y: 8 },
      {
        groupId: 'unrelated',
        groupName: '分组 1',
      },
    ),
  ])
  assert.throws(() => graph.groupSelected({ name: 'invalid' }), /名称/)
  assert.throws(() => graph.groupSelected('x'.repeat(101)), /名称/)
  assert.equal(graph.groupSelected(), true)
  assert.equal(graph.selectedGroup.name, '分组 2')
  const grouped = clone(graph.nodes)
  assert.equal(graph.ungroupSelected(), true)
  assert.equal(graph.selectedGroup, null)
  assert.equal(graph.nodes[0].data.groupId, undefined)
  assert.equal(graph.nodes[1].data.groupName, undefined)
  assert.equal(graph.nodes[1].data.groupType, undefined)
  assert.deepEqual(graph.nodes[2], grouped[2])
  assert.equal(graph.undo(), true)
  assert.deepEqual(graph.nodes, grouped)
  assert.equal(graph.undo(), true)
  assert.equal(graph.nodes[0].data.groupId, undefined)
  assert.equal(graph.canUndo, false)
})

test('regrouping cleans only affected singletons without changing unrelated groups or positions', () => {
  const graph = fixture([
    node('a', 'image', true, { x: 10, y: 20 }, { groupId: 'old', groupName: '旧组' }),
    node('b', 'video', true, { x: 90, y: 120 }),
    node(
      'old-singleton',
      'image',
      false,
      { x: 400, y: 500 },
      { groupId: 'old', groupName: '旧组' },
    ),
    node(
      'unrelated',
      'image',
      false,
      { x: 800, y: 900 },
      { groupId: 'unrelated', groupName: '不变' },
    ),
  ])
  const before = clone(graph.nodes)
  assert.equal(graph.groupSelected('新组'), true)
  assert.equal(graph.nodes[2].data.groupId, undefined)
  assert.equal(graph.nodes[2].data.groupName, undefined)
  assert.deepEqual(graph.nodes[3], before[3])
  for (const item of graph.nodes)
    assert.deepEqual(item.position, before.find((value) => value.id === item.id).position)
  assert.equal(graph.undo(), true)
  assert.deepEqual(graph.nodes, before)
  assert.equal(graph.canUndo, false)
})

test('storyboard groups are metadata only, copy safely to a fresh group and ungroup completely', () => {
  const graph = fixture([
    node('a', 'image', true, { x: 20, y: 30 }),
    node('b', 'video', true, { x: 700, y: 60 }),
    node('outside', 'video', false, { x: 9000, y: 20 }, { groupId: 'legacy-without-name' }),
  ])
  const originalPositions = graph.nodes.map((item) => clone(item.position))
  const outsider = clone(graph.nodes[2])
  assert.throws(() => graph.groupSelected(undefined, 'cloud-composition'), /类型/)
  assert.equal(graph.groupSelected(undefined, 'storyboard'), true)
  assert.equal(graph.selectedGroup.name, '分镜组 1')
  assert.equal(graph.selectedGroup.type, 'storyboard')
  assert.deepEqual(graph.nodes[2], outsider)
  for (const [index, item] of graph.nodes.entries()) {
    assert.deepEqual(item.position, originalPositions[index])
    assert.equal(item.data.generation, undefined)
    assert.equal(item.data.runState, 'idle')
  }
  const originalGroup = graph.selectedGroup.id
  assert.equal(graph.duplicateSelected(), true)
  assert.notEqual(graph.selectedGroup.id, originalGroup)
  assert.equal(graph.selectedGroup.type, 'storyboard')
  const copies = graph.selectedNodes
  assert.equal(graph.ungroupSelected(), true)
  for (const item of copies) {
    assert.equal(item.data.groupId, undefined)
    assert.equal(item.data.groupName, undefined)
    assert.equal(item.data.groupType, undefined)
  }
  assert.equal(graph.nodes[0].data.groupType, 'storyboard')
})

test('every active image/video state and pending persistence/query guard blocks whole new mutations', () => {
  const protectedData = [
    ...['preparing', 'submitting', 'queued', 'running', 'paused', 'uncertain'].map((runState) => ({
      runState,
    })),
    ...[
      { persistPending: true },
      { queryPending: true },
      { unresolvedTaskIds: ['original-task'] },
    ].map((generation) => ({ runState: 'succeeded', generation })),
  ]
  for (const kind of ['image', 'video'])
    for (const metadata of protectedData) {
      for (const action of ['arrangeSelected', 'groupSelected', 'ungroupSelected']) {
        const generation = {
          clientTaskId: 'stable-key',
          taskIds: ['original-task'],
          ...(metadata.generation || {}),
        }
        const graph = fixture(
          [
            node(
              'pending',
              kind,
              true,
              { x: 10, y: 20 },
              { ...metadata, generation, groupId: 'old', groupName: '原组' },
            ),
            node('ready', 'image', true, { x: 600, y: 200 }, { groupId: 'old', groupName: '原组' }),
          ],
          [edge('inside', 'pending', 'ready')],
        )
        const before = clone(graph.nodes)
        assert.equal(graph.selectionMutable, false)
        assert.equal(graph[action](action === 'arrangeSelected' ? 'vertical' : undefined), false)
        for (const item of graph.nodes) {
          const old = before.find((value) => value.id === item.id)
          assert.deepEqual(item.position, old.position)
          assert.equal(item.data.groupId, old.data.groupId)
          assert.equal(item.data.groupName, old.data.groupName)
        }
        assert.deepEqual(graph.nodes[0].data.generation, generation)
        assert.deepEqual(graph.nodes[1], before[1], 'no unprotected member is partially edited')
        assert.equal(graph.canUndo, false)
      }
    }
})

test('regroup rejects atomically if cleaning an unselected old singleton would alter a protected task', () => {
  const graph = fixture([
    node('a', 'image', true, { x: 0, y: 0 }, { groupId: 'old', groupName: '原组' }),
    node('b', 'image', true),
    node(
      'pending',
      'video',
      false,
      { x: 400, y: 500 },
      { groupId: 'old', groupName: '原组', runState: 'running' },
    ),
  ])
  assert.equal(graph.selectionMutable, true)
  assert.equal(graph.groupSelected('新组'), false)
  assert.equal(graph.nodes[0].data.groupId, 'old')
  assert.equal(graph.nodes[1].data.groupId, undefined)
  assert.equal(graph.nodes[2].data.groupId, 'old')
  assert.equal(graph.canUndo, false)
})

test('duplicate preserves old mixed-selection partial-copy semantics without copying paid ownership', () => {
  const graph = fixture([
    node(
      'pending',
      'video',
      true,
      { x: 0, y: 0 },
      { runState: 'running', generation: { clientTaskId: 'paid' } },
    ),
    node(
      'ready',
      'image',
      true,
      { x: 400, y: 50 },
      { runState: 'succeeded', generation: { clientTaskId: 'old-completed' } },
    ),
  ])
  assert.equal(graph.duplicateSelected(), true)
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.nodes.at(-1).data.title, 'ready 副本')
  assert.equal(graph.nodes.at(-1).data.generation, undefined)
  assert.equal(graph.nodes.at(-1).data.runState, 'idle')
  assert.equal(graph.nodes[0].data.generation.clientTaskId, 'paid')
  assert.match(graph.nodes[0].data.statusText, /不能复制/)
})

test('duplicating complete groups remaps groups, nodes and internal edges in one undo step', () => {
  const graph = fixture(
    [
      node(
        'a',
        'image',
        true,
        { x: 20, y: 30 },
        {
          groupId: 'original',
          groupName: '原组',
          runState: 'succeeded',
          generation: { taskIds: ['old-task'] },
        },
      ),
      node(
        'b',
        'video',
        true,
        { x: 700, y: 60 },
        { groupId: 'original', groupName: '原组', sourceImageNodeId: 'a' },
      ),
      node('other', 'image', false),
    ],
    [edge('inside', 'a', 'b'), edge('external', 'other', 'a')],
  )
  const original = clone(graph.nodes)
  assert.equal(graph.duplicateSelected(), true)
  const copies = graph.selectedNodes
  assert.equal(copies.length, 2)
  const newGroup = copies[0].data.groupId
  assert.ok(newGroup && newGroup !== 'original')
  assert.equal(copies[1].data.groupId, newGroup)
  assert.equal(copies[0].data.groupName, '原组')
  assert.equal(copies[1].data.sourceImageNodeId, copies[0].id)
  assert.equal(copies[0].data.generation, undefined)
  for (let index = 0; index < 2; index++)
    assert.deepEqual(copies[index].position, {
      x: original[index].position.x + 44,
      y: original[index].position.y + 44,
    })
  assert.equal(graph.edges.length, 3)
  assert.equal(graph.edges[2].source, copies[0].id)
  assert.equal(graph.edges[2].target, copies[1].id)
  assert.equal(graph.nodes[0].data.groupId, 'original')
  assert.equal(graph.undo(), true)
  assert.deepEqual(graph.nodes, original)
  assert.equal(graph.edges.length, 2)
  assert.equal(graph.canUndo, false)
})

test('copy/paste multiple groups never joins original groups and singleton copied groups are dropped', () => {
  const source = [
    node('a', 'image', true, { x: 0, y: 0 }, { groupId: 'group-one', groupName: '一' }),
    node('b', 'video', true, { x: 10, y: 20 }, { groupId: 'group-one', groupName: '一' }),
    node('c', 'image', true, { x: 30, y: 40 }, { groupId: 'group-two', groupName: '二' }),
    node('d', 'video', true, { x: 50, y: 60 }, { groupId: 'group-two', groupName: '二' }),
  ]
  const snapshot = createNodeClipboard(source)
  assert.equal(
    parseNodeClipboard(serializeNodeClipboard(snapshot)).nodes[0].data.groupId,
    'group-one',
  )
  const graph = fixture(source)
  const first = graph.pasteNodeClipboard(snapshot, { x: 800, y: 900 })
  const second = graph.pasteNodeClipboard(snapshot, { x: 1800, y: 1900 })
  assert.equal(first[0].data.groupId, first[1].data.groupId)
  assert.equal(first[2].data.groupId, first[3].data.groupId)
  assert.notEqual(first[0].data.groupId, first[2].data.groupId)
  assert.notEqual(first[0].data.groupId, second[0].data.groupId)
  assert.notEqual(first[0].data.groupId, 'group-one')
  const singleton = createNodeClipboard([source[0]])
  assert.equal(singleton.nodes[0].data.groupId, undefined)
  assert.equal(singleton.nodes[0].data.groupName, undefined)
  assert.throws(
    () =>
      createNodeClipboard([
        node('bad', 'image', true, { x: 0, y: 0 }, { groupId: '__proto__', groupName: 'bad' }),
      ]),
    /标识/,
  )
  assert.throws(
    () =>
      createNodeClipboard([
        node(
          'bad',
          'image',
          true,
          { x: 0, y: 0 },
          { groupId: 'valid', groupName: { nested: true } },
        ),
      ]),
    /分组名称/,
  )
})

test('delete preserves protected task incident edges while unrelated selected objects keep old deletion semantics', () => {
  const graph = fixture(
    [
      node(
        'pending',
        'video',
        true,
        { x: 0, y: 0 },
        { runState: 'running', generation: { clientTaskId: 'paid' } },
      ),
      node('reference', 'image', false),
      node('free', 'image', true),
      node('outside', 'image', false),
    ],
    [edge('task-input', 'reference', 'pending', true), edge('free-edge', 'free', 'outside', true)],
  )
  assert.equal(graph.removeSelected(), true)
  assert.ok(graph.nodes.some((item) => item.id === 'pending'))
  assert.ok(graph.nodes.some((item) => item.id === 'reference'))
  assert.ok(!graph.nodes.some((item) => item.id === 'free'))
  assert.deepEqual(
    graph.edges.map((item) => item.id),
    ['task-input'],
  )
  assert.equal(graph.nodes[0].data.generation.clientTaskId, 'paid')
})

test('deleting a selected reference cannot indirectly remove an unselected active task dependency', () => {
  for (const direction of ['input', 'output']) {
    const graph = fixture(
      [
        node('reference', 'image', true),
        node(
          'pending',
          'video',
          false,
          { x: 20, y: 30 },
          { runState: 'succeeded', generation: { persistPending: true } },
        ),
      ],
      [
        direction === 'input'
          ? edge('guarded', 'reference', 'pending', true)
          : edge('guarded', 'pending', 'reference', true),
      ],
    )
    assert.equal(graph.removeSelected(), false)
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)
    assert.equal(graph.canUndo, false)
  }
})
