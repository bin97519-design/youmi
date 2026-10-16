// Mount the real shell with ephemeral storage and no network access.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import CanvasV3Shell from '../../src/features/canvas-v3/components/CanvasV3Shell.vue'
import { useCanvasStore, makeCanvasDocument } from '../../src/stores/canvas'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useUserStore } from '../../src/stores/user'
import faceImage from './face-reference.png'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '../../src/features/canvas-v3/canvas-v3.css'

const memory = new Map()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
})
window.fetch = async (url) => {
  if (String(url).endsWith('/canvas-models'))
    return Response.json({
      code: 0,
      data: { options: [{ value: 'banana-2.1', label: '模拟模型' }] },
    })
  throw new Error('隔离测试禁止真实接口：' + url)
}
const pinia = createPinia()
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
})
const app = createApp({
  setup() {
    useUserStore().$patch({ isAuthenticated: true, token: 'fixture-only', profile: { id: -1 } })
    const canvas = useCanvasStore()
    const graph = useCanvasV3GraphStore()
    const showControls = ref(true)
    graph.hydrate({ projectId: 'isolated-gestures', nodes: [], edges: [] })
    const source = graph.addNode('image', { x: 200, y: 180 })
    graph.updateNodeData(source.id, {
      assetUrl: faceImage,
      title: '隔离测试参考图',
      model: 'banana-2.1',
    })
    const doc = makeCanvasDocument('isolated-gestures')
    doc.payload.chatConfig.canvasV3 = { initialized: true }
    doc.payload.view = { scale: 0.65, offset: { x: 40, y: 30 } }
    doc.payload.layers = graph.nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      type: 'v3-image',
      v3Data: { ...node.data, nodeType: node.type },
    }))
    canvas.ensureDocument = () => doc
    canvas.markOpened = () => {}
    canvas.updateDocument = (_id, update) => update(doc)
    canvas.flushNow = async () => true
    return () => [
      h(CanvasV3Shell, { projectId: doc.id }),
      showControls.value &&
        h(
          'div',
          {
            style: {
              position: 'fixed',
              bottom: '72px',
              right: '16px',
              display: 'flex',
              gap: '8px',
              zIndex: 9999,
            },
          },
          [
            h(
              'button',
              {
                onClick: () => {
                  showControls.value = false
                },
              },
              '隐藏测试控件',
            ),
            h(
              'button',
              {
                onClick: () =>
                  window.dispatchEvent(
                    new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true }),
                  ),
              },
              '模拟按住 Space',
            ),
            h(
              'button',
              {
                onClick: () =>
                  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })),
              },
              '模拟松开 Space',
            ),
            h('button', { onClick: () => window.dispatchEvent(new Event('blur')) }, '模拟窗口失焦'),
            h(
              'button',
              {
                onClick: () => {
                  const pane = document.querySelector('.vue-flow__pane')
                  const init = {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    button: 2,
                    buttons: 2,
                    clientX: 850,
                    clientY: 430,
                  }
                  pane.dispatchEvent(new MouseEvent('mousedown', init))
                  window.dispatchEvent(
                    new MouseEvent('mousemove', { ...init, clientX: 950, clientY: 490 }),
                  )
                  window.dispatchEvent(
                    new MouseEvent('mouseup', { ...init, buttons: 0, clientX: 950, clientY: 490 }),
                  )
                },
              },
              '模拟右键拖动',
            ),
          ],
        ),
      h(
        'output',
        {
          id: 'gesture-test-state',
          style: {
            position: 'fixed',
            top: '50px',
            left: '16px',
            color: '#aaa',
            fontSize: '12px',
            pointerEvents: 'none',
          },
        },
        `隔离测试 · 不保存 · 视图 ${Math.round(graph.viewport.x)},${Math.round(graph.viewport.y)} · 节点 ${Math.round(graph.nodes[0]?.position.x)},${Math.round(graph.nodes[0]?.position.y)}`,
      ),
    ]
  },
})
app.use(pinia).use(router)
await router.isReady()
app.mount('#app')
