// Real composer and task store; every fetch is mocked, with no credentials,
// uploads, persistence, production project edits or upstream generation.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useCanvasV3TaskStore } from '../../src/features/canvas-v3/stores/tasks'
import { useUserStore } from '../../src/stores/user'
import { WANXIANG_MODEL } from '../../src/features/canvas-v3/config/wanxiangParameters.js'
import '../../src/features/canvas-v3/canvas-v3.css'

const submitted = ref(null)
const queryCount = ref(0)
const route = {
  value: 'model-api-key:isolated-wanxiang',
  model: WANXIANG_MODEL,
  label: '隔离万相线路',
}
const reply = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })
window.fetch = async (url, options = {}) => {
  const path = String(url)
  if (path.endsWith('/api/video-tasks/canvas-models')) return reply([route])
  if (path.endsWith('/api/image-tasks/canvas-models'))
    return reply({ mappingConfigured: true, options: [] })
  if (path.endsWith('/api/video-tasks') && options.method === 'POST') {
    submitted.value = JSON.parse(options.body)
    return reply({ taskId: 'wanxiang30:key:901:123456', status: 'queued', consumedMi: 0 })
  }
  if (path.endsWith('/api/video-tasks/wanxiang30%3Akey%3A901%3A123456')) {
    queryCount.value += 1
    return reply({
      status: 'completed',
      progress: 100,
      stage: '本地模拟：已完成',
      videoUrls: ['https://example.com/isolated-output.mp4'],
    })
  }
  throw new Error('隔离验收禁止真实接口请求')
}

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    graph.hydrate({
      projectId: 'isolated-wanxiang-integration',
      nodes: [
        {
          id: 'isolated-wanxiang-node',
          type: 'generator',
          position: { x: 0, y: 0 },
          data: {
            kind: 'video',
            title: '万相视频',
            model: '万相 3.0',
            prompt: '雨后的城市街道，镜头缓慢跟随行人，带自然环境音',
            params: {},
            switches: {},
            runState: 'idle',
          },
        },
      ],
      edges: [],
    })
    const user = useUserStore()
    user.isAuthenticated = true
    user.requireLogin = () => true
    user.authHeaders = () => ({})
    const tasks = useCanvasV3TaskStore()
    tasks.attach(graph.projectId)
    return () =>
      h('section', { class: 'cv3-workspace wanxiang-fixture-workspace' }, [
        h(NodeComposer, { node: graph.nodes[0], position: { x: 44, y: 62 } }),
        h(
          'p',
          { class: 'wanxiang-fixture-note' },
          `隔离联调 · 不保存、不连接上游、不扣费 · ${graph.nodes[0].data.runState} · 查询 ${queryCount.value} 次`,
        ),
        submitted.value
          ? h(
              'pre',
              { class: 'wanxiang-fixture-request', 'aria-label': '模拟提交参数' },
              JSON.stringify(submitted.value, null, 2),
            )
          : null,
      ])
  },
})
  .use(createPinia())
  .mount('#app')
