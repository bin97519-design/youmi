// Isolated, deterministic UI acceptance: no real keys, persisted project,
// provider request, upload, generation or consumption.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useCanvasV3TaskStore } from '../../src/features/canvas-v3/stores/tasks'
import { useUserStore } from '../../src/stores/user'
import '../../src/features/canvas-v3/canvas-v3.css'

const active = ref(0)
const unavailable = ref(false)
const queryCount = ref(0)
const video = {
  value: 'model-api-key:isolated-pricing-wan',
  model: 'wan3.0-video-quannengcankao',
  label: '万相 3.0 全能',
}
const image = {
  value: 'model-api-key:isolated-pricing-banana',
  model: 'banana-2.1',
  label: 'banana-2.1',
}
const reply = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) })
window.fetch = async (url, options = {}) => {
  const path = String(url)
  if (path.endsWith('/api/video-tasks/canvas-models')) return reply([video])
  if (path.endsWith('/api/image-tasks/canvas-models'))
    return reply({ mappingConfigured: true, options: [image] })
  if (!path.endsWith('/api/canvas-pricing/estimate')) throw new Error('隔离验收禁止真实请求或生成')
  queryCount.value++
  const body = JSON.parse(options.body)
  if (unavailable.value)
    return reply({ available: false, message: '隔离模拟：渠道定价暂不可用，未提交生成任务' })
  const duration = body.params.duration === 'auto' ? 30 : Number(body.params.duration || 5)
  const sourceAmount =
    body.kind === 'image'
      ? 0.1895
      : 0.3795 *
        ({ '480P': 1, '720P': 2, '1080P': 4 }[body.params.resolution] || 1) *
        (body.params.version === 'prime' ? 1.5 : 1) *
        duration
  return reply({
    available: true,
    amount: (sourceAmount * 100).toFixed(2),
    unit: '米值',
    kind: body.params.duration === 'auto' ? 'precharge' : 'estimate',
    message:
      body.params.duration === 'auto'
        ? '智能时长按30秒预计预扣，最终按实际结算'
        : '隔离模拟定价，仅用于界面验收',
    platformUnit: '算力',
    conversionMultiplier: 100,
    sourceAmount: sourceAmount.toFixed(4),
    pricingUpdatedAt: Date.now(),
    expiresAt: Date.now() + 30000,
  })
}

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    graph.hydrate({
      projectId: 'isolated-pricing-acceptance',
      edges: [],
      nodes: [
        {
          id: 'pricing-video',
          type: 'generator',
          position: { x: 0, y: 0 },
          data: {
            kind: 'video',
            title: '视频',
            model: video.value,
            prompt: '雨后的城市街道，镜头缓慢跟随行人',
            params: {},
            switches: {},
            runState: 'idle',
          },
        },
        {
          id: 'pricing-image',
          type: 'generator',
          position: { x: 0, y: 0 },
          data: {
            kind: 'image',
            title: '图片',
            model: image.value,
            prompt: '雨后的城市街道',
            params: {},
            switches: {},
            runState: 'idle',
          },
        },
      ],
    })
    const user = useUserStore()
    user.isAuthenticated = true
    user.authHeaders = () => ({})
    const tasks = useCanvasV3TaskStore()
    tasks.attach(graph.projectId)
    return () =>
      h('section', { class: 'cv3-workspace pricing-fixture' }, [
        h('div', { class: 'pricing-fixture-tools' }, [
          h(
            'button',
            {
              onClick: () => {
                active.value = 0
              },
            },
            '视频报价',
          ),
          h(
            'button',
            {
              onClick: () => {
                active.value = 1
              },
            },
            '图片报价',
          ),
          h(
            'button',
            {
              onClick: () => {
                unavailable.value = !unavailable.value
                graph.nodes[active.value].data.params = {
                  ...graph.nodes[active.value].data.params,
                  ratio: graph.nodes[active.value].data.params.ratio === '1:1' ? '16:9' : '1:1',
                }
              },
            },
            '模拟报价失败/恢复',
          ),
        ]),
        h(NodeComposer, { node: graph.nodes[active.value], position: { x: 40, y: 300 } }),
        h(
          'p',
          { class: 'pricing-fixture-note' },
          `隔离验收 · 模拟定价 · 不保存、不连接上游、不扣费 · 报价查询 ${queryCount.value} 次`,
        ),
      ])
  },
})
  .use(createPinia())
  .mount('#app')
