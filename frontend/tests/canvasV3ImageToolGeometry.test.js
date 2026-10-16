import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  gridCropRects,
  imageBoxRect,
  normalizedImageBox,
} from '../src/features/canvas-v3/config/imageToolGeometry.js'

test('non-divisible grids partition all original pixels with no gaps or overlaps', () => {
  for (const [width, height, rows, columns] of [
    [1039, 931, 3, 3],
    [1281, 721, 5, 5],
    [7, 11, 2, 3],
  ]) {
    const cells = gridCropRects(width, height, rows, columns)
    assert.equal(cells.length, rows * columns)
    assert.equal(
      cells.reduce((sum, cell) => sum + cell.width * cell.height, 0),
      width * height,
    )
    for (const cell of cells) {
      assert.ok(cell.width > 0 && cell.height > 0)
      if (cell.column < columns - 1) assert.equal(cell.x + cell.width, cells[cell.index + 1].x)
      if (cell.row < rows - 1) assert.equal(cell.y + cell.height, cells[cell.index + columns].y)
    }
    assert.equal(cells.at(-1).x + cells.at(-1).width, width)
    assert.equal(cells.at(-1).y + cells.at(-1).height, height)
  }
})

test('selection is stable, deduplicated and never silently expands an empty selection', () => {
  assert.deepEqual(
    gridCropRects(90, 60, 2, 3, [5, 0, 5]).map((r) => r.index),
    [0, 5],
  )
  assert.deepEqual(gridCropRects(90, 60, 2, 3, []), [])
  assert.throws(() => gridCropRects(90, 60, 2, 3, [6]), /有效/)
  assert.throws(() => gridCropRects(90, 60, 0, 3), /行列/)
  assert.throws(() => gridCropRects(2, 2, 3, 3), /行列/)
  assert.throws(() => gridCropRects(9000, 9000, 3, 3), /过大/)
})

test('element boxes clamp at image edges but invalid boxes never become whole-image selections', () => {
  assert.deepEqual(normalizedImageBox([-1, 0.2, 2, 0.8]), [0, 0.2, 1, 0.8])
  assert.equal(normalizedImageBox([0.8, 0.2, 0.4, 0.5]), null)
  assert.equal(normalizedImageBox([NaN, 0, 1, 1]), null)
  assert.deepEqual(imageBoxRect([0.1, 0.2, 0.4, 0.5], 101, 99), {
    x: 10,
    y: 19,
    width: 31,
    height: 31,
  })
  assert.throws(() => imageBoxRect([0, 0, 0, 0], 100, 100), /框选/)
})

test('real crop outputs return as one atomic, undoable batch without fake generation tasks', async () => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    const { useCanvasV3GraphStore } = await server.ssrLoadModule(
      '/src/features/canvas-v3/stores/graph.js',
    )
    setActivePinia(createPinia())
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: 'crop-test', nodes: [], edges: [] })
    const source = graph.addNode('image', { x: 0, y: 0 })
    graph.updateNodeData(source.id, {
      assetUrl: 'data:image/png;base64,source',
      generation: { taskIds: ['do-not-copy'] },
    })
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      url: `data:image/png;base64,fixture-${i}`,
      width: 33,
      height: 30,
      region: { index: i },
    }))
    const results = graph.createImageOutputs(source.id, outputs, '宫格切分')
    assert.equal(results.length, 9)
    assert.equal(graph.nodes.length, 10)
    assert.equal(graph.edges.length, 9)
    assert.equal(graph.activeNode.id, results[0].id)
    assert.ok(
      results.every(
        (n) =>
          n.data.assetUrl && n.data.generation === undefined && n.data.runState === 'succeeded',
      ),
    )
    graph.undo()
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.edges.length, 0)
    graph.redo()
    assert.equal(graph.nodes.length, 10)
    const count = graph.nodes.length
    assert.throws(
      () => graph.createImageOutputs(source.id, [outputs[0], { url: '', width: 0, height: 1 }]),
      /无效/,
    )
    assert.equal(graph.nodes.length, count)
  } finally {
    await server.close()
  }
})
