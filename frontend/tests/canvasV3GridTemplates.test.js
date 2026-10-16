import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  IMAGE_GRID_TEMPLATES,
  imageGridPreset,
} from '../src/features/canvas-v3/config/imageGridTemplates.js'
import { imageGridMenuPlacement } from '../src/features/canvas-v3/config/popupPlacement.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

test('grid hover-menu matches all eleven live reference entries in order', () => {
  assert.deepEqual(
    IMAGE_GRID_TEMPLATES.map((item) => item.label),
    [
      '多机位九宫格',
      '剧情推演四宫格',
      '角色脸部三视图',
      '角色设定图',
      '场景设定图',
      '产品设定图',
      '25宫格连贯分镜',
      '电影级光影校正',
      '角色三视图',
      '画面推演 - 3秒后',
      '画面推演 - 5秒前',
    ],
  )
  assert.equal(new Set(IMAGE_GRID_TEMPLATES.map((item) => item.prompt)).size, 11)
  assert.equal(imageGridPreset('unknown'), null)
  const preset = imageGridPreset('multi-camera')
  preset.params.count = '4张'
  assert.equal(imageGridPreset('multi-camera').params.count, '1张')
})

test('hover menu is centered on its trigger and clears the toolbar below', () => {
  const result = imageGridMenuPlacement(
    { left: 569, right: 660, top: 300, bottom: 350 },
    { width: 1240, height: 880 },
  )
  assert.deepEqual(result, {
    direction: 'below',
    left: 474.5,
    top: 354,
    width: 280,
    maxHeight: 360,
  })
})

test('hover menu flips above a low toolbar and remains scrollable on small screens', () => {
  const result = imageGridMenuPlacement(
    { left: 290, right: 350, top: 330, bottom: 380 },
    { width: 360, height: 400 },
  )
  assert.equal(result.direction, 'above')
  assert.equal(result.bottom, 74)
  assert.equal(result.maxHeight, 318)
  assert.equal(result.left, 72)
  assert.ok(result.left + result.width <= 352)
})

test('every grid template creates an editable, linked, undoable single-image task without submission', async () => {
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
    graph.hydrate({ projectId: 'grid-template-test', nodes: [], edges: [] })
    const source = graph.addNode('image', { x: 0, y: 0 })
    graph.updateNodeData(source.id, {
      model: 'banana-2.1',
      assetUrl: 'https://example.test/reference.png',
      params: { ratio: '3:4', resolution: '4K', count: '2张' },
      generation: { taskIds: ['old-task-do-not-copy'] },
      runState: 'succeeded',
    })
    for (const template of IMAGE_GRID_TEMPLATES) {
      const node = graph.createImageVariation(source.id, imageGridPreset(template.id))
      assert.equal(node.data.title, template.label)
      assert.equal(node.data.prompt, '')
      assert.equal(node.data.runState, 'idle')
      assert.equal(node.data.generation, undefined)
      assert.equal(node.data.assetUrl, undefined)
      assert.equal(node.data.editTemplate.sourceNodeId, source.id)
      assert.equal(graph.activeNode.id, node.id)
      assert.ok(graph.edges.some((edge) => edge.source === source.id && edge.target === node.id))
      const request = imageTaskRequest(node, [source], 'test-no-submit')
      assert.equal(request.n, 1)
      assert.equal(request.model, 'banana-2.1')
      assert.equal(request.resolution, '4K')
      assert.deepEqual(request.image_urls, ['https://example.test/reference.png'])
      assert.equal(request.prompt, template.prompt)
      graph.updateNodeData(node.id, { prompt: '保持原图的暖色调' })
      assert.equal(
        imageTaskRequest(node, [source], 'test-no-submit').prompt,
        template.prompt + '\n\n保持原图的暖色调',
      )
      graph.updateNodeData(node.id, {
        editTemplate: { ...node.data.editTemplate, instructions: '自定义模板' },
      })
      assert.equal(
        imageTaskRequest(node, [source], 'test-no-submit').prompt,
        '自定义模板\n\n保持原图的暖色调',
      )
      if (template.id === 'cinematic-light') assert.equal(request.size, '3:4')
      graph.undo()
      assert.equal(graph.nodes.length, 1)
      assert.equal(graph.edges.length, 0)
      graph.redo()
      assert.equal(graph.nodes.length, 2)
      graph.undo()
    }
    assert.equal(graph.nodes[0].data.params.count, '2张')
    assert.equal(graph.createImageVariation('missing-node', imageGridPreset('multi-camera')), null)
  } finally {
    await server.close()
  }
})
