// Real shell, real VueFlow gestures, ephemeral storage, no paid tasks or cloud writes.
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import CanvasV3Shell from '../../src/features/canvas-v3/components/CanvasV3Shell.vue'
import { useCanvasStore, makeCanvasDocument } from '../../src/stores/canvas'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useUserStore } from '../../src/stores/user'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '../../src/features/canvas-v3/canvas-v3.css'
const faceImage = '/canvas-v3/characters/assets/003-character-sheet.webp'
const previewImages = [
  faceImage,
  '/canvas-v3/characters/assets/003-expression-grid.webp',
  '/canvas-v3/characters/assets/003-full-body.webp',
]
const fixtureOptions = new URLSearchParams(location.search)
async function makeLocalVideo() {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d')
  const stream = canvas.captureStream(10)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks = []
  const finished = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = reject
    recorder.onstop = () => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }))
    }
  })
  let frame = 0
  const draw = () => {
    context.fillStyle = '#273b4c'
    context.fillRect(0, 0, 320, 180)
    context.fillStyle = '#325b56'
    context.fillRect(320, 0, 320, 180)
    context.fillStyle = '#5d465e'
    context.fillRect(0, 180, 320, 180)
    context.fillStyle = '#655b3b'
    context.fillRect(320, 180, 320, 180)
    context.fillStyle = '#eaeaea'
    context.font = '24px sans-serif'
    context.fillText('LOCAL VIDEO · SELECTION QA', 30, 55)
    context.fillText(String(frame++), 30, 95)
  }
  draw()
  recorder.start()
  const animation = setInterval(draw, 100)
  setTimeout(() => {
    clearInterval(animation)
    recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
  }, 600)
  return finished
}
const localVideo = await makeLocalVideo()

const memory = new Map()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
})
window.fetch = async (url, options = {}) => {
  const path = String(url)
  if ((options.method || 'GET') !== 'GET') throw new Error('隔离验收禁止真实写入或生成')
  if (path.endsWith('/canvas-models')) return Response.json({ code: 0, data: { options: [] } })
  if (path.includes('/conversations?')) return Response.json({ code: 0, data: [] })
  throw new Error('隔离验收禁止真实接口：' + path)
}
const pinia = createPinia()
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
})
const app = createApp({
  setup() {
    useUserStore().$patch({ isAuthenticated: true, token: 'isolated-only', profile: { id: -1 } })
    const canvas = useCanvasStore()
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: 'isolated-selection', nodes: [], edges: [] })
    for (const [index, x, y, kind] of [
      [1, 420, 230, 'image'],
      [2, 800, 230, 'image'],
      [3, 420, 530, 'image'],
      [4, 800, 530, 'video'],
    ]) {
      const node = graph.addNode(kind, { x, y })
      graph.updateNodeData(node.id, {
        title: kind === 'video' ? '视频素材' : `图片素材 ${index}`,
        prompt:
          kind === 'video' && fixtureOptions.has('pending')
            ? '隔离验收：仅打开执行确认，不提交'
            : '',
        assetUrl:
          kind === 'image'
            ? new URL(previewImages[index - 1], location.href).href
            : fixtureOptions.has('pending')
              ? ''
              : localVideo,
        posterUrl: new URL(faceImage, location.href).href,
        mediaOrigin: 'upload',
        mediaWidth: kind === 'image' ? 800 : 1280,
        mediaHeight: kind === 'image' ? 800 : 720,
        runState: 'idle',
        artifactStatus: 'ready',
      })
    }
    graph.nodes.forEach((node, index) => {
      node.selected = false
      node.position = { x: index % 2 === 0 ? 420 : 1120, y: index < 2 ? 230 : 680 }
    })
    if (fixtureOptions.has('group-demo')) {
      graph.nodes.forEach((node) => {
        node.selected = node.data.kind === 'image'
      })
      graph.groupSelected('Group 1')
      graph.nodes.forEach((node, index) => {
        node.position =
          index < 3 ? { x: index === 0 ? 1120 : 1299.5, y: 224 + index * 398 } : { x: 250, y: 420 }
      })
    }
    const doc = makeCanvasDocument('isolated-selection')
    doc.payload.chatConfig.canvasV3 = { initialized: true }
    doc.payload.view = fixtureOptions.has('group-demo')
      ? { scale: 0.31, offset: { x: 143, y: 202 } }
      : { scale: 0.55, offset: { x: 80, y: 40 } }
    doc.payload.layers = graph.nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      type: `v3-${node.data.kind}`,
      v3Data: { ...node.data, nodeType: node.type },
    }))
    canvas.ensureDocument = () => doc
    canvas.markOpened = () => {}
    canvas.updateDocument = (_id, update) => update(doc)
    canvas.flushNow = async () => true
    return () => [
      h(CanvasV3Shell, { projectId: doc.id }),
      h(
        'output',
        {
          id: 'selection-qa-state',
          style:
            'position:fixed;top:48px;left:16px;color:#aaa;font:12px/1.6 sans-serif;pointer-events:none;z-index:100',
        },
        `隔离验收 · 不保存、不扣费 · 已选 ${graph.selectedNodes.length} 项 · 撤销 ${graph.canUndo} · ${graph.selectedNodes.map((node) => `${node.data.title}:${Math.round(node.position.x)},${Math.round(node.position.y)}`).join(' / ')}`,
      ),
    ]
  },
})
app.use(pinia).use(router)
await router.isReady()
app.mount('#app')
