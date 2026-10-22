import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import {
  ANGLE_PRESETS,
  anglePreset,
  changeCamera,
  angleInstructions,
  multiAnglePreset,
  normalizeCamera,
  anglePanelPlacement,
} from '../src/features/canvas-v3/config/multiAngle.js'
import {
  createAngleMotion,
  angleScene,
  shortestOrbitDelta,
} from '../src/features/canvas-v3/config/angleMotion.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'
import { canvasGestures } from '../src/features/canvas-v3/config/canvasGestures.js'

test('all seven recorded camera presets match their stable numeric states and prompt switches', () => {
  assert.deepEqual(
    ANGLE_PRESETS.map((p) => [p.label, p.horizontal, p.vertical, p.distance]),
    [
      ['自定义', 0, 0, 5],
      ['鱼眼视角', 0, 30, 10],
      ['倾斜视角', 45, -30, 5],
      ['正面俯拍', 0, 60, 5],
      ['正面仰拍', 0, -30, 5],
      ['全景俯拍', 45, 30, 0],
      ['背面视角', 180, 0, 5],
    ],
  )
  assert.equal(anglePreset('fisheye').promptEnabled, true)
  assert.match(anglePreset('fisheye').prompt, /鱼眼畸变/)
  assert.equal(anglePreset('dutch').prompt, 'dutch angle, tilted frame')
  assert.deepEqual(anglePreset('custom'), normalizeCamera())
  assert.equal(anglePreset('invalid'), null)
})
test('manual changes switch to custom without losing optional prompt; disabled prompts do not leak into requests', () => {
  const camera = changeCamera(anglePreset('fisheye'), { horizontal: 225 })
  assert.equal(camera.presetId, 'custom')
  assert.match(camera.prompt, /鱼眼/)
  const prompt = angleInstructions({ ...camera, promptEnabled: false })
  assert.doesNotMatch(prompt, /鱼眼畸变/)
  assert.match(prompt, /225°/)
  assert.match(prompt, /左后方/)
  assert.match(angleInstructions(anglePreset('back')), /180°.*背面/)
  assert.equal(normalizeCamera({ horizontal: -45, vertical: 500, distance: NaN }).horizontal, 315)
  assert.equal(changeCamera(anglePreset('custom'), { horizontal: 360 }).horizontal, 360)
  assert.equal(normalizeCamera({ vertical: 500 }).vertical, 90)
  assert.equal(normalizeCamera({ distance: NaN }).distance, 5)
})
test('angle task carries the original reference, deterministic camera instructions, one image and configured model', () => {
  const node = {
    data: {
      ...multiAnglePreset(anglePreset('dutch')),
      model: 'banana-2.1',
      params: { resolution: '2K', ratio: 'Auto', count: '1张' },
    },
  }
  const source = { data: { kind: 'image', assetUrl: 'https://example.test/original.png' } }
  const request = imageTaskRequest(node, [source], 'angle-idempotency-test')
  assert.deepEqual(request.image_urls, [source.data.assetUrl])
  assert.equal(request.n, 1)
  // Auto is not a vendor enum for Banana 2.1; use the same supported default shown in the UI.
  assert.equal(request.size, '16:9')
  assert.equal(request.model, 'banana-2.1')
  assert.equal(request.client_task_id, 'angle-idempotency-test')
  assert.match(request.prompt, /45°/)
  assert.match(request.prompt, /-30°/)
  assert.match(request.prompt, /dutch angle/)
  assert.match(request.prompt, /三维空间视角/)
})
test('space preview keeps one interruptible RAF, wraps the short way and follows drag without animation lag', () => {
  let nextId = 0,
    renders = 0,
    last
  const pending = new Map()
  const motion = createAngleMotion({
    initial: anglePreset('custom'),
    render: (v) => {
      last = v
      renders++
    },
    requestFrame: (callback) => {
      pending.set(++nextId, callback)
      return nextId
    },
    cancelFrame: (id) => pending.delete(id),
    reducedMotion: () => false,
  })
  const frame = (time) => {
    const [id, callback] = pending.entries().next().value
    pending.delete(id)
    callback(time)
  }
  motion.to(anglePreset('back'))
  frame(0)
  const before = last.horizontal
  motion.to(anglePreset('dutch'))
  assert.equal(pending.size, 1)
  assert.equal(last.horizontal, before)
  frame(16)
  assert.ok(Number.isFinite(last.horizontal))
  motion.to({ horizontal: 135.5, vertical: -12.5, distance: 4 }, true)
  assert.equal(pending.size, 0)
  assert.equal(last.vertical, -12.5)
  assert.ok(Math.abs(shortestOrbitDelta(350, 10) - 20) < 1e-6)
  assert.ok(Math.abs(shortestOrbitDelta(10, 350) + 20) < 1e-6)
  motion.to(anglePreset('custom'))
  motion.dispose()
  assert.equal(pending.size, 0)
  const count = renders
  motion.to(anglePreset('back'))
  assert.equal(renders, count)
})
test('reduced motion is immediate and sphere geometry changes continuously rather than swapping bitmap slides', () => {
  let rendered
  const motion = createAngleMotion({
    initial: anglePreset('custom'),
    render: (v) => {
      rendered = v
    },
    requestFrame: () => {
      throw new Error('no animation when reduced')
    },
    cancelFrame: () => {},
    reducedMotion: () => true,
  })
  motion.to(anglePreset('back'))
  assert.equal(Math.abs(rendered.horizontal), 180)
  const a = angleScene({ horizontal: 45, vertical: 30, distance: 5 })
  const b = angleScene({ horizontal: 45.01, vertical: 30.01, distance: 5.01 })
  assert.equal(a.lines.length, 23)
  assert.equal(
    a.lines.some((p) => /NaN|Infinity/.test(p)),
    false,
  )
  assert.ok(Math.abs(a.camera.x - b.camera.x) < 0.1)
  assert.ok(Math.abs(a.camera.y - b.camera.y) < 0.1)
  assert.ok(a.photoSize < angleScene(anglePreset('fisheye')).photoSize)
  motion.dispose()
})
test('editor stays inside short viewports and right-button panning is never enabled', () => {
  for (const viewport of [
    { width: 1228, height: 892 },
    { width: 390, height: 650 },
  ]) {
    const p = anglePanelPlacement({ centerX: 2000, bottom: 900 }, viewport)
    assert.ok(p.left >= 16 && p.left + p.width <= viewport.width - 16)
    assert.ok(p.top + Math.min(386, p.maxHeight) <= viewport.height - 72)
  }
  for (const tool of ['select', 'hand'])
    for (const held of [false, true]) assert.ok(!canvasGestures(tool, held).panOnDrag.includes(2))
  assert.deepEqual(canvasGestures('select', false), {
    hand: false,
    panOnDrag: [1],
    selectionOnDrag: true,
    nodesDraggable: true,
  })
  assert.deepEqual(canvasGestures('select', true), {
    hand: true,
    panOnDrag: [0, 1],
    selectionOnDrag: false,
    nodesDraggable: false,
  })
  assert.equal(canvasGestures('select', false).hand, false)
})
test('angle outputs preserve the source, are undoable, restore saved camera and reject unresolved-task resubmission', async () => {
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
    const { createMultiAngleOutput } = await server.ssrLoadModule(
      '/src/features/canvas-v3/sync/multiAngleCommand.js',
    )
    setActivePinia(createPinia())
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: 'angle-test', nodes: [], edges: [] })
    const source = graph.addNode('image')
    graph.updateNodeData(source.id, {
      assetUrl: 'https://example.test/source.png',
      model: 'banana-2.1',
      generation: { taskIds: ['source-task-never-copy'] },
    })
    const before = JSON.stringify(source.data)
    const output = createMultiAngleOutput(graph, source.id, anglePreset('fisheye'), {
      model: 'banana-2.1',
    })
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 1)
    assert.ok(!output.data.assetUrl)
    assert.equal(output.data.generation, undefined)
    assert.equal(JSON.stringify(source.data), before)
    assert.equal(output.data.editTemplate.camera.distance, 10)
    graph.undo()
    assert.equal(graph.nodes.length, 1)
    graph.redo()
    assert.equal(graph.nodes[1].data.editTemplate.camera.presetId, 'fisheye')
    const target = graph.nodes[1]
    graph.updateNodeData(target.id, { prompt: '保留额外的手写要求' })
    createMultiAngleOutput(graph, source.id, anglePreset('back'), {
      model: 'banana-2.1',
      targetId: target.id,
    })
    assert.equal(target.data.prompt, '保留额外的手写要求')
    assert.equal(target.data.editTemplate.camera.horizontal, 180)
    graph.updateNodeData(target.id, { runState: 'uncertain' })
    assert.throws(
      () =>
        createMultiAngleOutput(graph, source.id, anglePreset('back'), {
          model: 'banana-2.1',
          targetId: target.id,
        }),
      /原任务/,
    )
    assert.equal(graph.nodes.length, 2)
    assert.throws(
      () =>
        createMultiAngleOutput(graph, 'missing', anglePreset('custom'), { model: 'banana-2.1' }),
      /参考图片/,
    )
  } finally {
    await server.close()
  }
})
