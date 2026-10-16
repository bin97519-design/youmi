// Local-only delayed API fixture. It does not restore/save credentials, persist
// canvases, upload images or forward any fetch to a real generation endpoint.
import { createApp, h, markRaw, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import GeneratorNode from '../../src/features/canvas-v3/components/GeneratorNode.vue'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useCanvasV3TaskStore } from '../../src/features/canvas-v3/stores/tasks'
import { useUserStore } from '../../src/stores/user'
import { imageGridPreset } from '../../src/features/canvas-v3/config/imageGridTemplates'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '../../src/features/canvas-v3/canvas-v3.css'

const postCount = ref(0)
let finishModels
let finishSubmit
const respond = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })
window.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/canvas-models'))
    return new Promise((resolve) => {
      finishModels = () =>
        resolve(
          respond({
            mappingConfigured: true,
            options: [{ value: 'banana2', label: 'Banana 2（模拟）' }],
          }),
        )
    })
  if (String(url).endsWith('/image-tasks') && options.method === 'POST') {
    postCount.value += 1
    return new Promise((resolve) => {
      finishSubmit = () =>
        resolve(respond({ tasks: [{ taskId: 'fixture-only-no-provider-task' }] }))
    })
  }
  if (String(url).includes('fixture-only-no-provider-task'))
    return respond({ status: 'running', progress: null, imageUrls: [] })
  throw new Error('隔离测试禁止真实接口请求')
}

createApp({
  setup() {
    const user = useUserStore()
    user.isAuthenticated = true
    user.token = 'fixture-only-not-a-real-credential'
    const graph = useCanvasV3GraphStore()
    graph.hydrate({ projectId: 'isolated-feedback-fixture', nodes: [], edges: [] })
    const added = graph.addNode('image', {
      x: (window.innerWidth / 2 - (624 * 0.65) / 2) / 0.65,
      y: 160 / 0.65,
    })
    graph.updateNodeData(added.id, { ...imageGridPreset('story-twenty-five'), model: 'banana2' })
    const tasks = useCanvasV3TaskStore()
    tasks.attach(graph.projectId)
    const feedbackMs = ref(null)
    let clickedAt
    watch(
      () => graph.nodes.find((item) => item.id === added.id)?.data.runState,
      (state) => {
        if (
          state === 'preparing' &&
          clickedAt != null &&
          document.querySelector('.cv3-generate-button:disabled .cv3-loading-spinner')
        )
          feedbackMs.value = Math.round((performance.now() - clickedAt) * 10) / 10
      },
      { flush: 'post' },
    )
    return () =>
      h(
        'section',
        {
          class: 'cv3-workspace',
          onClickCapture: (event) => {
            if (
              event.target.closest('button[aria-label="生成"]') &&
              !event.target.closest('button').disabled
            )
              clickedAt = performance.now()
          },
        },
        [
          h(
            VueFlow,
            {
              id: 'feedback-fixture-flow',
              nodes: graph.nodes,
              edges: graph.edges,
              'onUpdate:nodes': (nodes) => {
                graph.nodes = nodes
              },
              'onUpdate:edges': (edges) => {
                graph.edges = edges
              },
              nodeTypes: { generator: markRaw(GeneratorNode) },
              defaultViewport: { x: 0, y: 0, zoom: 0.65 },
              nodesDraggable: false,
              panOnDrag: false,
              zoomOnScroll: false,
              zoomOnDoubleClick: false,
            },
            () => h(Background, { gap: 16, size: 0.6, patternColor: '#4a4a4a' }),
          ),
          h(
            'header',
            {
              style: {
                position: 'absolute',
                top: '18px',
                left: '20px',
                right: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                zIndex: 50,
                fontSize: '12px',
                color: '#aaa',
              },
            },
            [
              h('span', '慢请求隔离测试 · 不连接真实生成服务、不扣费'),
              h('button', { onClick: () => finishModels?.() }, '模拟完成模型检查'),
              h('button', { onClick: () => finishSubmit?.() }, '模拟提交成功'),
            ],
          ),
          h(
            'p',
            {
              role: 'status',
              style: {
                position: 'absolute',
                top: '60px',
                left: '20px',
                color: '#aaa',
                fontSize: '12px',
              },
            },
            `模拟生成请求数：${postCount.value}；首次按钮反馈：${feedbackMs.value == null ? '等待点击' : feedbackMs.value + ' ms'}`,
          ),
          h(NodeComposer, {
            node: graph.nodes.find((item) => item.id === added.id),
            position: { x: Math.max(16, window.innerWidth / 2 - 330), y: 410 },
          }),
        ],
      )
  },
})
  .use(createPinia())
  .mount('#app')
