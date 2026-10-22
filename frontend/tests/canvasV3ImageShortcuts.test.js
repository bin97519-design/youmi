import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  IMAGE_SHORTCUT_COLUMNS,
  imageShortcutPatch,
} from '../src/features/canvas-v3/config/imageShortcuts.js'
import { REFERENCE_SHORTCUT_ICONS } from '../src/features/canvas-v3/config/referenceShortcutIcons.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'
import { nodePopupPlacement } from '../src/features/canvas-v3/config/popupPlacement.js'

const items = IMAGE_SHORTCUT_COLUMNS.flat().flatMap((group) => group.items)
test('shortcut picker matches all four live categories, fifteen entries and exact local SVGs', () => {
  assert.deepEqual(
    IMAGE_SHORTCUT_COLUMNS.map((column) => column.map((group) => group.label)),
    [
      ['分镜叙事', '质感调节'],
      ['空间与机位', '设定图'],
    ],
  )
  assert.deepEqual(
    items.map((item) => item.label),
    [
      '调度故事板',
      '故事板',
      '25宫格连贯分镜',
      '剧情推演四宫格',
      '画面推演 - 3秒后',
      '画面推演 - 5秒前',
      '人像质感调节',
      '电影级光影校正',
      '720全景',
      '多机位九宫格',
      '角色脸部三视图',
      '角色设定图',
      '角色三视图',
      '场景设定图',
      '产品设定图',
    ],
  )
  assert.equal(new Set(items.map((item) => item.id)).size, 15)
  assert.equal(items.filter((item) => item.isNew).length, 3)
  for (const item of items) {
    assert.ok(item.description)
    assert.match(REFERENCE_SHORTCUT_ICONS[item.icon].body, /^<path /)
    assert.doesNotMatch(REFERENCE_SHORTCUT_ICONS[item.icon].body, /<script|onload|https?:/)
  }
})

test('removing a module only removes its instructions and preserves user input and reference', () => {
  const data = {
    kind: 'image',
    model: 'banana-2.1',
    prompt: '保留暖色灯光',
    params: { ratio: '2:1', quality: '标准画质', resolution: '2K', count: '1张' },
    editTemplate: { id: 'panorama-720', sourceNodeId: 'source' },
  }
  const patch = imageShortcutPatch(data, null)
  assert.deepEqual(patch, { editTemplate: null })
  const request = imageTaskRequest(
    { data: { ...data, ...patch } },
    [{ data: { kind: 'image', assetUrl: 'https://example.test/reference.png' } }],
    'fixture-no-submit',
  )
  assert.equal(request.prompt, '保留暖色灯光')
  assert.deepEqual(request.image_urls, ['https://example.test/reference.png'])
  assert.equal(request.model, 'banana-2.1')
  assert.equal(data.editTemplate.id, 'panorama-720')
  assert.equal(imageShortcutPatch({ ...data, editTemplate: null }, null), null)
})

test('every replacement uses its own prompt, keeps supplementary text, never creates a paid batch', () => {
  const data = {
    kind: 'image',
    model: 'banana-2.1',
    prompt: '保留暖色灯光',
    params: { ratio: '3:4', resolution: '4K', count: '4张' },
    editTemplate: { id: 'obsolete', sourceNodeId: 'source', instructions: '旧模块自定义提示词' },
  }
  for (const item of items) {
    const patch = imageShortcutPatch(data, item.id)
    assert.equal(patch.editTemplate.id, item.id)
    assert.equal(patch.editTemplate.sourceNodeId, 'source')
    assert.equal(patch.editTemplate.instructions, undefined)
    assert.equal(patch.prompt, undefined)
    const request = imageTaskRequest({ data: { ...data, ...patch } }, [], 'fixture-no-submit')
    assert.ok(request.prompt.startsWith(item.prompt))
    assert.ok(request.prompt.endsWith('\n\n保留暖色灯光'))
    assert.ok(!request.prompt.includes('旧模块自定义提示词'))
    assert.equal(request.n, 1)
    if (item.id === 'panorama-720') {
      // The selected Banana model must never receive the preset's unsupported 2:1.
      assert.equal(request.size, '16:9')
      assert.equal(
        imageTaskRequest({ data: { ...data, ...patch, model: 'tt-image-2.5' } }, [], 'tt-panorama')
          .size,
        '2:1',
      )
      assert.equal(request.resolution, '2K')
    }
  }
  assert.equal(imageShortcutPatch(data, 'unknown'), null)
  const customized = { editTemplate: { id: 'panorama-720', instructions: '用户自定义' } }
  assert.equal(imageShortcutPatch(customized, 'panorama-720'), null)
})

test('replacing and removing shortcuts can both be undone without changing the graph or task', async () => {
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
    graph.hydrate({ projectId: 'shortcut-test', nodes: [], edges: [] })
    const source = graph.addNode('image', { x: 0, y: 0 })
    graph.updateNodeData(source.id, { assetUrl: 'https://example.test/reference.png' })
    const { imageEditPreset } = await server.ssrLoadModule(
      '/src/features/canvas-v3/config/imageEditPresets.js',
    )
    const node = graph.createImageVariation(source.id, imageEditPreset('panorama-720'))
    graph.updateNodeData(node.id, {
      prompt: '用户补充要求',
      generation: { taskIds: ['original-task'] },
    })
    for (const id of ['story-four', null]) {
      graph.remember()
      graph.updateNodeData(node.id, imageShortcutPatch(graph.activeNode.data, id))
      assert.equal(graph.nodes.length, 2)
      assert.equal(graph.edges.length, 1)
      assert.equal(graph.activeNode.data.prompt, '用户补充要求')
      assert.deepEqual(graph.activeNode.data.generation.taskIds, ['original-task'])
      assert.equal(graph.activeNode.data.editTemplate?.id ?? null, id)
      graph.undo()
      assert.equal(graph.activeNode.data.editTemplate.id, 'panorama-720')
      graph.redo()
      assert.equal(graph.activeNode.data.editTemplate?.id ?? null, id)
      graph.undo()
    }
  } finally {
    await server.close()
  }
})

test('full-size picker is above the chip and short viewports constrain it to a scrollable area', () => {
  const placement = nodePopupPlacement(
    { left: 280, top: 590, bottom: 614 },
    { width: 1066, height: 762 },
    { width: 524, height: 540 },
  )
  assert.equal(placement.left, 280)
  assert.equal(placement.top, 46)
  assert.equal(placement.height, 540)
  const small = nodePopupPlacement(
    { left: 290, top: 300, bottom: 324 },
    { width: 360, height: 600 },
    { width: 524, height: 1000 },
  )
  assert.equal(small.width, 344)
  assert.ok(small.top >= 8)
  assert.ok(small.top + small.height <= 592)
})
