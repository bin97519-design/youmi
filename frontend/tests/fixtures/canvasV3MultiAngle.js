// Isolated, in-memory canvas; all task calls are mocks and cannot reach a provider.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { useUserStore } from '../../src/stores/user'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useCanvasV3TaskStore } from '../../src/features/canvas-v3/stores/tasks'
import MultiAngleEditor from '../../src/features/canvas-v3/components/MultiAngleEditor.vue'
import ImageActionToolbar from '../../src/features/canvas-v3/components/ImageActionToolbar.vue'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import faceImage from './face-reference.png'
import '../../src/features/canvas-v3/canvas-v3.css'

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    useUserStore().$patch({
      isAuthenticated: true,
      token: 'isolated-fixture-only',
      profile: { id: -1 },
    })
    const open = ref(true),
      target = ref(null),
      posts = ref(0),
      size = ref({ width: innerWidth, height: innerHeight })
    addEventListener('resize', () => {
      size.value = { width: innerWidth, height: innerHeight }
    })
    window.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/canvas-models'))
        return Response.json({
          code: 0,
          data: {
            mappingConfigured: true,
            options: [{ value: 'banana-2.1', label: 'banana-2.1（隔离模拟）' }],
          },
        })
      if (String(url).endsWith('/api/image-tasks') && options.method === 'POST') {
        posts.value++
        return Response.json({ code: 0, data: { tasks: [{ taskId: 'isolated-angle-task' }] } })
      }
      if (String(url).includes('/api/image-tasks/isolated-angle-task'))
        return Response.json({ code: 0, data: { status: 'completed', imageUrls: [faceImage] } })
      throw new Error('隔离测试禁止真实接口：' + url)
    }
    // The task client captures fetch at construction; install mocks FIRST.
    const tasks = useCanvasV3TaskStore()
    graph.hydrate({ projectId: 'isolated-multi-angle', nodes: [], edges: [] })
    const source = graph.addNode('image')
    graph.updateNodeData(source.id, {
      title: '参考图（隔离测试）',
      assetUrl: faceImage,
      model: 'banana-2.1',
      params: { resolution: '2K' },
    })
    tasks.attach(graph.projectId)
    const edit = (node) => {
      target.value = node.data.editTemplate?.id === 'multi-angle' ? node : null
      open.value = true
    }
    return () => {
      const photoHeight = Math.max(80, Math.min(300, size.value.height - 540))
      const anchor = { centerX: size.value.width / 2, bottom: 76 + photoHeight }
      return h(
        'section',
        {
          class: 'cv3-workspace',
          style: {
            backgroundImage: 'radial-gradient(#444 .6px, transparent .6px)',
            backgroundSize: '16px 16px',
          },
        },
        [
          h(
            'div',
            {
              style: {
                position: 'absolute',
                top: '10px',
                left: '16px',
                color: '#999',
                fontSize: '12px',
              },
            },
            [
              h('span', '隔离交互测试 · 不保存用户画布 · 全部任务接口为模拟'),
              h(
                'button',
                { onClick: () => edit(source), style: { marginLeft: '12px' } },
                '重新打开多角度',
              ),
              h(
                'output',
                { id: 'angle-test-state' },
                `节点 ${graph.nodes.length} · 模拟提交 ${posts.value} 次`,
              ),
            ],
          ),
          h('img', {
            src: faceImage,
            alt: '多角度参考图',
            style: {
              position: 'absolute',
              top: '76px',
              left: '50%',
              transform: 'translateX(-50%)',
              height: photoHeight + 'px',
              maxWidth: '90vw',
              borderRadius: '10px',
            },
          }),
          open.value
            ? h(MultiAngleEditor, {
                node: source,
                target: target.value,
                anchor,
                viewport: size.value,
                onClose: () => {
                  open.value = false
                },
                onCreated: (node) => {
                  target.value = node
                },
              })
            : h(ImageActionToolbar, { node: graph.activeNode, top: 42, onAngles: edit }),
          !open.value && graph.activeNode?.data.editTemplate
            ? h(NodeComposer, {
                node: graph.activeNode,
                position: {
                  x: Math.max(16, size.value.width / 2 - 330),
                  y: Math.max(400, size.value.height - 280),
                },
                onAngles: edit,
              })
            : null,
        ],
      )
    }
  },
})
  .use(createPinia())
  .mount('#app')
