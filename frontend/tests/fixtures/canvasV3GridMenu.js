// Development-only fixture. No canvas persistence, task attachment or API POSTs.
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import ImageActionToolbar from '../../src/features/canvas-v3/components/ImageActionToolbar.vue'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import productImage from '../../src/assets/icons/product-mover.png'
import '../../src/features/canvas-v3/canvas-v3.css'

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    let source
    function reset() {
      graph.hydrate({ projectId: 'isolated-grid-menu-test', nodes: [], edges: [] })
      source = graph.addNode('image', { x: 100, y: 120 })
      graph.updateNodeData(source.id, { title: '测试参考图', assetUrl: productImage })
    }
    reset()
    return () =>
      h('div', { style: { width: '100%', height: '100%' } }, [
        h(
          'section',
          {
            class: 'cv3-workspace',
            style: {
              backgroundImage: 'radial-gradient(#444 0.6px, transparent 0.6px)',
              backgroundSize: '16px 16px',
            },
          },
          [
            h(
              'p',
              {
                style: {
                  position: 'absolute',
                  top: '10px',
                  left: '18px',
                  color: '#888',
                  fontSize: '12px',
                },
              },
              '隔离交互测试 · 不保存到用户画布，不自动提交任务',
            ),
            h(
              'button',
              {
                'aria-label': '恢复测试画布',
                onClick: reset,
                style: { position: 'absolute', top: '18px', right: '18px' },
              },
              '恢复测试画布',
            ),
            h('img', {
              src: productImage,
              alt: '测试参考图',
              style: {
                position: 'absolute',
                left: 'calc(50% - 90px)',
                top: '110px',
                width: '180px',
                height: '180px',
                objectFit: 'contain',
              },
            }),
            graph.activeNode?.id === source.id
              ? h(ImageActionToolbar, { node: graph.activeNode, top: 310 })
              : null,
            graph.activeNode
              ? h(NodeComposer, {
                  key: graph.activeNode.id,
                  node: graph.activeNode,
                  position: { x: Math.max(16, window.innerWidth / 2 - 330), y: 390 },
                })
              : null,
          ],
        ),
      ])
  },
})
  .use(createPinia())
  .mount('#app')
