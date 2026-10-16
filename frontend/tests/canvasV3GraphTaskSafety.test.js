import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

test('destructive graph actions preserve every non-terminal paid image task state', async (t) => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(() => server.close())
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )

  for (const runState of ['preparing', 'submitting', 'queued', 'running', 'paused', 'uncertain']) {
    setActivePinia(createPinia())
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: `guard-${runState}`, nodes: [], edges: [] })
    const protectedNode = graph.addNode('image')
    const removableNode = graph.addNode('text')
    graph.updateNodeData(protectedNode.id, {
      runState,
      generation: { clientTaskId: `stable-${runState}`, taskIds: [] },
    })
    protectedNode.selected = true
    removableNode.selected = true

    assert.equal(graph.removeSelected(), true)
    assert.ok(graph.nodes.some((node) => node.id === protectedNode.id))
    assert.ok(!graph.nodes.some((node) => node.id === removableNode.id))
    assert.equal(protectedNode.data.generation.clientTaskId, `stable-${runState}`)
    assert.match(protectedNode.data.statusText, /暂不能删除/)

    protectedNode.selected = true
    assert.equal(graph.duplicateSelected(), false)
    assert.equal(graph.nodes.length, 1)
    assert.equal(protectedNode.data.generation.clientTaskId, `stable-${runState}`)

    assert.equal(graph.undo(), false)
    assert.equal(graph.redo(), false)
    assert.equal(graph.clearGraph(), false)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].id, protectedNode.id)
    assert.equal(graph.nodes[0].data.generation.clientTaskId, `stable-${runState}`)
  }
})

test('pending persistence and query metadata protect a node even after its run state changes', async (t) => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(() => server.close())
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )

  for (const generationPatch of [
    { persistPending: true },
    { queryPending: true },
    { unresolvedTaskIds: ['provider-task'] },
  ]) {
    setActivePinia(createPinia())
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: 'guard-pending-metadata', nodes: [], edges: [] })
    const node = graph.addNode('image')
    graph.updateNodeData(node.id, {
      runState: 'succeeded',
      generation: {
        clientTaskId: 'stable-pending-key',
        taskIds: ['provider-task'],
        ...generationPatch,
      },
    })

    assert.equal(graph.removeSelected(), false)
    assert.equal(graph.clearGraph(), false)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0].data.generation.clientTaskId, 'stable-pending-key')
  }
})

test('terminal image nodes remain removable', async (t) => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(() => server.close())
  const { useCanvasV3GraphStore } = await server.ssrLoadModule(
    '/src/features/canvas-v3/stores/graph.js',
  )
  setActivePinia(createPinia())
  const graph = useCanvasV3GraphStore()
  graph.hydrate({ projectId: 'guard-terminal', nodes: [], edges: [] })
  const node = graph.addNode('image')
  graph.updateNodeData(node.id, { runState: 'succeeded' })

  assert.equal(graph.removeSelected(), true)
  assert.equal(graph.nodes.length, 0)
})
