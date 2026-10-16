import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

test('the edge flow keeps the normalized eight-layer LibTV light recipe', async () => {
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/EdgeFlowSegments.vue', import.meta.url),
    'utf8',
  )
  assert.equal(source.match(/pathLength="300"/g)?.length, 8)
  assert.match(source, /stroke-dasharray="36 64"/)
  assert.match(source, /stroke-dasharray="0 30 6 64"/)
  assert.match(source, /stroke-width="12"/)
  assert.match(source, /stroke-opacity="0\.6"/)
})

test('the hover scissors removes only its edge and undo restores it', async (t) => {
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
  graph.hydrate({ projectId: 'edge-cut-test', nodes: [], edges: [] })
  const source = graph.addNode('image')
  const first = graph.addNode('image')
  const second = graph.addNode('image')
  graph.connect({
    source: source.id,
    target: first.id,
    sourceHandle: 'output',
    targetHandle: 'input',
  })
  graph.connect({
    source: source.id,
    target: second.id,
    sourceHandle: 'output',
    targetHandle: 'input',
  })
  assert.ok(graph.edges.every((edge) => edge.type === 'default'))
  assert.ok(graph.edges.every((edge) => edge.markerEnd === undefined))
  const [removed, retained] = graph.edges
  graph.removeEdge(removed.id)
  assert.equal(graph.nodes.length, 3)
  assert.deepEqual(
    graph.edges.map((edge) => edge.id),
    [retained.id],
  )
  graph.undo()
  assert.equal(graph.nodes.length, 3)
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.id)), new Set([removed.id, retained.id]))
})
