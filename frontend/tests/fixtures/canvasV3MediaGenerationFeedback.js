// Only mounts real rendering components with in-memory synthetic states.
// No project persistence, credentials, uploads, task submission or polling.
import { createApp, h, markRaw } from 'vue'
import { createPinia } from 'pinia'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import GeneratorNode from '../../src/features/canvas-v3/components/GeneratorNode.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '../../src/features/canvas-v3/canvas-v3.css'

window.fetch = async () => {
  throw new Error('隔离视觉验收禁止真实接口请求')
}

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    graph.hydrate({
      // An unattached, blank project permits local cancel/resume rendering only;
      // the task store cannot schedule network polling without a project ID.
      projectId: '',
      nodes: ['image', 'video'].map((kind, index) => ({
        id: `fixture-${kind}`,
        type: 'generator',
        position: { x: index * 704, y: 0 },
        data: {
          kind,
          title: kind === 'image' ? '图片节点 · 现有效果' : '视频节点 · 同款效果',
          runState: 'running',
          progress: 37,
          generation: {
            clientTaskId: 'same-visual-comparison-seed',
            taskIds: ['fixture-no-provider-task'],
          },
        },
      })),
      edges: [],
    })
    const setState = (runState) => {
      for (const node of graph.nodes)
        graph.updateNodeData(node.id, { runState, progress: runState === 'running' ? 37 : null })
    }
    return () =>
      h('section', { class: 'cv3-workspace' }, [
        h(
          VueFlow,
          {
            id: 'isolated-media-generation-feedback-flow',
            nodes: graph.nodes,
            edges: [],
            'onUpdate:nodes': (nodes) => {
              graph.nodes = nodes
            },
            nodeTypes: { generator: markRaw(GeneratorNode) },
            defaultViewport: {
              x: 40,
              y: 250,
              zoom: Math.min(0.8, (window.innerWidth - 80) / 1328),
            },
            nodesDraggable: false,
            nodesConnectable: false,
            panOnDrag: false,
            zoomOnScroll: false,
            zoomOnDoubleClick: false,
          },
          () => h(Background, { gap: 16, size: 0.6, patternColor: '#4a4a4a' }),
        ),
        h('header', { class: 'feedback-fixture-tools' }, [
          h('h1', '图片与视频 · 生成中节点效果对照'),
          h('p', '左：现有图片节点　右：视频节点。真实组件、模拟状态，不提交任务、不扣费。'),
          ...[
            ['preparing', '准备中'],
            ['submitting', '提交中'],
            ['queued', '排队中'],
            ['running', '生成中'],
            ['paused', '停止等待'],
          ].map(([state, label]) => h('button', { onClick: () => setState(state) }, label)),
        ]),
      ])
  },
})
  .use(createPinia())
  .mount('#app')
