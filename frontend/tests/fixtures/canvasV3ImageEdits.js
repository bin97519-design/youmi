// Development-only fixtures: no persistence, no real recognition or generation calls.
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { useUserStore } from '../../src/stores/user'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import ImageActionToolbar from '../../src/features/canvas-v3/components/ImageActionToolbar.vue'
import NodeComposer from '../../src/features/canvas-v3/components/NodeComposer.vue'
import PortraitEmotionPanel from '../../src/features/canvas-v3/components/PortraitEmotionPanel.vue'
import PanoramaViewer from '../../src/features/canvas-v3/components/PanoramaViewer.vue'
import { emotionAt } from '../../src/features/canvas-v3/config/portraitEmotion'
import { imageEditPreset } from '../../src/features/canvas-v3/config/imageEditPresets'
import faceImage from './face-reference.png'
import panorama from './panorama-fixture.svg'
import '../../src/features/canvas-v3/canvas-v3.css'

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    useUserStore().$patch({
      isAuthenticated: true,
      token: 'isolated-fixture-only',
      profile: { id: -1 },
    })
    const emotion = ref(null),
      preview = ref(false),
      gallery = ref(false),
      mode = ref('faces'),
      calls = ref(0)
    let source
    let release
    const reset = () => {
      emotion.value = null
      preview.value = false
      gallery.value = false
      graph.hydrate({ projectId: 'isolated-image-edits', nodes: [], edges: [] })
      source = graph.addNode('image', { x: 0, y: 0 })
      graph.updateNodeData(source.id, {
        title: '参考图（隔离测试）',
        assetUrl: faceImage,
        model: 'banana-2.1',
      })
    }
    window.fetch = async (url) => {
      if (String(url).endsWith('/api/image/detect-faces')) {
        calls.value++
        if (mode.value === 'hold')
          await new Promise((resolve) => {
            release = resolve
          })
        if (mode.value === 'error')
          return new Response(JSON.stringify({ code: 503, message: '模拟识别服务不可用' }), {
            status: 503,
          })
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              faces:
                mode.value === 'empty' ? [] : [{ id: 'face-1', box: [0.46, 0.39, 0.612, 0.607] }],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error('隔离测试禁止真实API请求：' + url)
    }
    reset()
    const control = (label, click) =>
      h('button', { onClick: click, style: { marginRight: '8px' } }, label)
    return () =>
      h(
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
              class: 'cv3-image-edit-fixture-controls',
              style: {
                position: 'absolute',
                top: '12px',
                left: '18px',
                color: '#aaa',
                fontSize: '12px',
                zIndex: 100,
              },
            },
            [
              h('p', '隔离交互测试 · 模拟面部检测 · 不保存用户画布 · 不会提交收费生成'),
              control('重置测试', reset),
              control('模拟无面部', () => {
                mode.value = 'empty'
                reset()
              }),
              control('模拟识别失败', () => {
                mode.value = 'error'
                reset()
              }),
              control('模拟识别等待', () => {
                mode.value = 'hold'
                reset()
              }),
              control('释放识别结果', () => release?.()),
              control('正常识别', () => {
                mode.value = 'faces'
                reset()
              }),
              control('预览测试全景', () => {
                preview.value = true
              }),
              control('灰模资源核对', () => {
                reset()
                gallery.value = true
              }),
              control('720快捷模块', () => {
                reset()
                graph.createImageVariation(source.id, imageEditPreset('panorama-720'))
              }),
              control('撤销', () => graph.undo()),
              control('重做', () => graph.redo()),
              h('span', `识别调用 ${calls.value} 次`),
            ],
          ),
          h('img', {
            src: faceImage,
            alt: '参考图',
            style: {
              position: 'absolute',
              left: 'calc(50% - 130px)',
              top: '100px',
              width: '260px',
              height: '232px',
              objectFit: 'contain',
            },
          }),
          !emotion.value && !preview.value && !gallery.value && graph.activeNode?.id === source.id
            ? h(ImageActionToolbar, {
                node: graph.activeNode,
                top: 340,
                onEmotion: (n) => {
                  emotion.value = n
                },
              })
            : null,
          !emotion.value && !preview.value && !gallery.value && graph.activeNode
            ? h(NodeComposer, {
                key: graph.activeNode.id,
                node: graph.activeNode,
                position: {
                  x: Math.max(16, innerWidth / 2 - 330),
                  y: graph.activeNode.data.editTemplate ? Math.max(110, innerHeight - 280) : 410,
                },
                onEmotion: () => {
                  emotion.value = graph.nodes.find((n) => n.id === source.id)
                },
              })
            : null,
          emotion.value
            ? h(PortraitEmotionPanel, {
                node: emotion.value,
                onClose: () => {
                  emotion.value = null
                },
              })
            : null,
          preview.value
            ? h('div', { class: 'cv3-image-lightbox' }, [
                control('关闭测试预览', () => {
                  preview.value = false
                }),
                h(PanoramaViewer, { src: panorama }),
              ])
            : null,
          gallery.value
            ? h(
                'div',
                {
                  role: 'region',
                  'aria-label': '灰模资源核对',
                  style: {
                    position: 'fixed',
                    inset: '100px 20px 20px',
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: '10px',
                    background: '#181818',
                    color: '#eee',
                  },
                },
                Array.from({ length: 25 }, (_, i) => {
                  const mood = emotionAt(10 + (i % 5) * 20, 10 + Math.floor(i / 5) * 20)
                  return h('figure', { style: { margin: 0 } }, [
                    h('img', {
                      src: mood.preview,
                      alt: '灰模：' + mood.label,
                      referrerpolicy: 'no-referrer',
                      style: { width: '100%' },
                    }),
                    h('figcaption', mood.label),
                  ])
                }),
              )
            : null,
        ],
      )
  },
})
  .use(createPinia())
  .mount('#app')
