// Real composer and CSS, isolated in-memory draft. No provider/model requests,
// persistence, task submissions, uploads, credentials or production project edits.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useCanvasV3TaskStore } from '../../src/features/canvas-v3/stores/tasks'
import { useUserStore } from '../../src/stores/user'
import '../../src/features/canvas-v3/canvas-v3.css'

const integration = new URLSearchParams(location.search).has('integration')
const submitted = ref(null)
const route = {
  value: 'model-api-key:isolated-omni-reference',
  model: 'kling-v3-omni-cankao',
  label: '隔离参考生线路',
}
const reply = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })
window.fetch = async (url, options = {}) => {
  const path = String(url)
  if (integration && path.endsWith('/api/video-tasks/canvas-models')) return reply([route])
  if (integration && path.endsWith('/api/video-tasks') && options.method === 'POST') {
    submitted.value = JSON.parse(options.body)
    return reply({ taskId: 'kling-omni:key:901:123456', status: 'queued', consumedMi: 0 })
  }
  if (integration && path.endsWith('/api/video-tasks/kling-omni%3Akey%3A901%3A123456'))
    return reply({ status: 'processing', progress: 45, stage: '本地模拟：处理中' })
  if (integration && path.endsWith('/api/image-tasks/canvas-models'))
    return reply({ mappingConfigured: true, options: [] })
  throw new Error('隔离视觉验收禁止真实接口请求')
}

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    graph.hydrate({
      projectId: integration ? 'isolated-omni-integration' : '',
      nodes: [
        {
          id: 'isolated-kling-menu',
          type: 'generator',
          position: { x: 0, y: 0 },
          data: {
            kind: 'video',
            title: '视频节点',
            model: 'Kling 3.0',
            mode: integration ? '参考生' : '视频参考',
            prompt: integration ? '人物在海边漫步，镜头缓慢跟随' : '',
            params: integration
              ? { mode: 'pro', duration: '10', aspect_ratio: '16:9' }
              : {
                  refer_type: 'feature',
                  mode: 'std',
                  duration: '5',
                  aspect_ratio: '16:9',
                  keep_original_sound: 'yes',
                },
            switches: {},
            runState: 'idle',
          },
        },
      ],
      edges: [],
    })
    const tasks = useCanvasV3TaskStore()
    if (integration) {
      // In-memory login stub only. Every fetch is intercepted above; no token,
      // server, credential, persistence or paid provider is used by this fixture.
      const user = useUserStore()
      user.isAuthenticated = true
      user.requireLogin = () => true
      user.authHeaders = () => ({})
      tasks.attach(graph.projectId)
      tasks.runImage = () => {
        throw new Error('隔离验收禁止图片提交')
      }
    } else {
      tasks.loadVideoModels = async () => []
      tasks.runImage = tasks.runVideo = () => {
        throw new Error('隔离视觉验收禁止提交任务')
      }
    }
    return () =>
      h('section', { class: 'cv3-workspace kling-fixture-workspace' }, [
        h(NodeComposer, { node: graph.nodes[0], position: { x: 44, y: 62 } }),
        h(
          'p',
          { class: 'kling-fixture-note' },
          integration
            ? '本地模拟验收 · 真实提交/轮询代码 · 不连接上游、不扣费'
            : '隔离验收 · 真实组件 · 不提交任务、不修改项目',
        ),
        submitted.value
          ? h(
              'pre',
              { style: 'position:absolute;left:44px;top:410px;color:#bbb;font:12px/1.6 monospace' },
              JSON.stringify(submitted.value, null, 2),
            )
          : null,
      ])
  },
})
  .use(createPinia())
  .mount('#app')
