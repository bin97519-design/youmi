// Isolated acceptance fixture: real UI and native locally recorded media only.
// It neither restores a user account nor attaches persistence/task polling.
import { computed, createApp, h, onBeforeUnmount, ref } from 'vue'
import { createPinia } from 'pinia'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import GeneratorNode from '../../src/features/canvas-v3/components/GeneratorNode.vue'
import VideoActionToolbar from '../../src/features/canvas-v3/components/VideoActionToolbar.vue'
import VideoContextMenu from '../../src/features/canvas-v3/components/VideoContextMenu.vue'
import VideoPreviewDialog from '../../src/features/canvas-v3/components/VideoPreviewDialog.vue'
import VideoSaveAssetDialog from '../../src/features/canvas-v3/components/VideoSaveAssetDialog.vue'
import VideoActionStatusDialog from '../../src/features/canvas-v3/components/VideoActionStatusDialog.vue'
import { useCanvasV3GraphStore } from '../../src/features/canvas-v3/stores/graph'
import { useUserStore } from '../../src/stores/user'
import { createVideoNodeActions } from '../../src/features/canvas-v3/sync/videoNodeActions.js'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '../../src/features/canvas-v3/canvas-v3.css'

window.fetch = async () => {
  throw new Error('隔离交互验收禁止网络接口请求')
}

// MediaRecorder's live WebM omits Duration. Add the actual elapsed recording
// duration to its Info element so a new decoder can seek and capture frames.
function readVint(bytes, offset, isId = false) {
  let length = 1
  while (length <= 8 && !(bytes[offset] & (1 << (8 - length)))) length += 1
  if (length > 8 || offset + length > bytes.length) throw new Error('本地 WebM 容器无效')
  let value = isId ? bytes[offset] : bytes[offset] & ((1 << (8 - length)) - 1)
  let unknown = !isId && value === (1 << (8 - length)) - 1
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index]
    unknown &&= bytes[offset + index] === 255
  }
  return { length, value, unknown }
}
function encodeSize(value, minimum = 1) {
  let length = minimum
  while (value >= 2 ** (7 * length) - 1) length += 1
  const bytes = new Uint8Array(length)
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = value % 256
    value = Math.floor(value / 256)
  }
  bytes[0] |= 1 << (8 - length)
  return bytes
}
async function seekableRecording(blob, durationMs) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let segment
  for (let offset = 0; offset < bytes.length; ) {
    const id = readVint(bytes, offset, true)
    const size = readVint(bytes, offset + id.length)
    const payload = offset + id.length + size.length
    if (id.value === 0x18538067) {
      segment = { offset, id, size, payload }
      break
    }
    offset = payload + size.value
  }
  if (!segment) throw new Error('没有找到本地 WebM 视频段')
  for (let offset = segment.payload; offset < bytes.length; ) {
    const id = readVint(bytes, offset, true)
    const size = readVint(bytes, offset + id.length)
    const payload = offset + id.length + size.length
    if (id.value === 0x1549a966) {
      const duration = new Uint8Array(11)
      duration.set([0x44, 0x89, 0x88])
      new DataView(duration.buffer).setFloat64(3, durationMs, false)
      const newSize = encodeSize(size.value + duration.length, size.length)
      const info = [
        bytes.slice(offset, offset + id.length),
        newSize,
        bytes.slice(payload, payload + size.value),
        duration,
      ]
      const delta = newSize.length - size.length + duration.length
      const segmentSize = segment.size.unknown
        ? bytes.slice(segment.offset + segment.id.length, segment.payload)
        : encodeSize(segment.size.value + delta, segment.size.length)
      return new Blob(
        [
          bytes.slice(0, segment.offset + segment.id.length),
          segmentSize,
          bytes.slice(segment.payload, offset),
          ...info,
          bytes.slice(payload + size.value),
        ],
        { type: 'video/webm' },
      )
    }
    if (size.unknown) break
    offset = payload + size.value
  }
  throw new Error('没有找到本地 WebM 视频信息')
}

async function recordTestVideo() {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d')
  if (!context || !canvas.captureStream || !window.MediaRecorder)
    throw new Error('当前浏览器不支持本地测试视频录制')
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  )
  if (!mimeType) throw new Error('当前浏览器不支持 WebM 测试视频')
  let animation
  const started = performance.now()
  const draw = () => {
    for (const [x, y, color] of [
      [0, 0, '#3562b8'],
      [320, 0, '#268b87'],
      [0, 180, '#9b4e79'],
      [320, 180, '#b77d37'],
    ]) {
      context.fillStyle = color
      context.fillRect(x, y, 320, 180)
    }
    const seconds = (performance.now() - started) / 1000
    context.fillStyle = '#ffffff'
    context.font = 'bold 30px system-ui'
    context.fillText('LOCAL VIDEO · 640 × 360', 30, 58)
    context.font = '24px monospace'
    context.fillText(`${seconds.toFixed(2)} s`, 30, 108)
    context.beginPath()
    context.arc(50 + ((seconds * 170) % 540), 260, 24, 0, Math.PI * 2)
    context.fill()
    animation = requestAnimationFrame(draw)
  }
  draw()
  const poster = canvas.toDataURL('image/png')
  const stream = canvas.captureStream(12)
  try {
    const recorded = await new Promise((resolve, reject) => {
      const chunks = []
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1200000 })
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => reject(new Error('本地录制失败'))
      recorder.onstop = () =>
        resolve({
          blob: new Blob(chunks, { type: mimeType }),
          durationMs: performance.now() - started,
        })
      recorder.start()
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
      }, 1700)
    })
    return { blob: await seekableRecording(recorded.blob, recorded.durationMs), poster }
  } finally {
    cancelAnimationFrame(animation)
    stream.getTracks().forEach((track) => track.stop())
  }
}

createApp({
  setup() {
    const graph = useCanvasV3GraphStore()
    graph.hydrate({
      projectId: '',
      nodes: [
        {
          id: 'fixture-local-video',
          type: 'generator',
          selected: true,
          position: { x: 0, y: 0 },
          data: {
            kind: 'video',
            title: '本地真实测试视频',
            runState: 'idle',
            artifactStatus: 'ready',
          },
        },
      ],
      edges: [],
    })
    const user = useUserStore()
    user.$patch({ isAuthenticated: false, token: '', profile: null })
    // Explicit fixture guards: never restore actual credentials or open login.
    user.restoreSession = () => {}
    user.requireLogin = () => {
      notice.value = '隔离验收：未登录，不保存、不上传'
      return false
    }
    const recording = ref(false)
    const busy = ref(false)
    const notice = ref('请先点击“生成本地测试视频”，录制约 1.7 秒后可验收。')
    const context = ref(null)
    const preview = ref(false)
    const dialog = ref('')
    const currentTime = ref(0)
    const captureCount = ref(0)
    const lastFrame = ref(null)
    const source = computed(() => graph.nodes.find((node) => node.id === 'fixture-local-video'))
    const selected = computed(() => source.value?.selected && !!source.value?.data.assetUrl)
    const imageCount = computed(
      () => graph.nodes.filter((node) => node.data.kind === 'image').length,
    )
    let objectUrl
    const actions = createVideoNodeActions({
      graph,
      getScope: () => 'isolated-local-video',
      onBusy: (value) => (busy.value = value),
    })
    function selectVideo() {
      for (const node of graph.nodes) node.selected = node.id === source.value?.id
    }
    async function generate() {
      if (recording.value) return
      recording.value = true
      notice.value = '正在浏览器本地录制测试视频…'
      actions.cancel()
      try {
        const result = await recordTestVideo()
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = URL.createObjectURL(result.blob)
        graph.updateNodeData(source.value.id, {
          assetUrl: objectUrl,
          posterUrl: result.poster,
          mediaWidth: 640,
          mediaHeight: 360,
          runState: 'succeeded',
          artifactStatus: 'ready',
        })
        selectVideo()
        notice.value = `本地 WebM 已录制（${result.blob.size} 字节），可播放、拖进度、截帧、右键或预览。`
      } catch (error) {
        notice.value = error.message
      } finally {
        recording.value = false
      }
    }
    async function snapshot(payload = {}) {
      try {
        const result = await actions.frame(source.value.id, {
          time: payload.time ?? currentTime.value,
          position: payload.position || 'current',
          addToCanvas: true,
        })
        captureCount.value += 1
        lastFrame.value = { width: result.width, height: result.height, time: result.time }
        notice.value = `截帧成功：真实 PNG ${result.width} × ${result.height}，${result.time.toFixed(2)} 秒，已加入画布。`
      } catch (error) {
        notice.value = error.message
      }
    }
    function dispatch(action, payload) {
      context.value = null
      if (action === 'snapshot') return snapshot(payload)
      if (action === 'expand') {
        preview.value = true
        return
      }
      if (
        action === 'download' ||
        action === 'copy-to-clipboard' ||
        action === 'copy-node' ||
        action === 'paste'
      ) {
        notice.value = '隔离验收不下载、不写系统剪贴板、不访问网络；截帧会真实加入此临时画布。'
        return
      }
      if (action === 'duplicate') {
        graph.duplicateSelected()
        return
      }
      if (action === 'delete') {
        graph.removeSelected()
        return
      }
      dialog.value = action
    }
    function openContext({ event, node }) {
      if (node.data.kind !== 'video' || !node.data.assetUrl) return
      event.preventDefault()
      event.stopPropagation()
      selectVideo()
      context.value = { x: event.clientX, y: event.clientY }
    }
    onBeforeUnmount(() => {
      actions.dispose()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    })
    return () =>
      h('section', { class: 'cv3-workspace' }, [
        h(
          VueFlow,
          {
            id: 'isolated-video-node-interactions',
            nodes: graph.nodes,
            edges: graph.edges,
            'onUpdate:nodes': (nodes) => {
              graph.nodes = nodes
            },
            'onUpdate:edges': (edges) => {
              graph.edges = edges
            },
            defaultViewport: {
              x: 40,
              y: 290,
              zoom: Math.min(0.78, (window.innerWidth - 80) / 1328),
            },
            nodesConnectable: false,
            panOnDrag: false,
            zoomOnScroll: false,
            zoomOnDoubleClick: false,
            onNodeContextMenu: openContext,
          },
          {
            default: () => h(Background, { gap: 16, size: 0.6, patternColor: '#4a4a4a' }),
            'node-generator': (props) =>
              h(GeneratorNode, {
                ...props,
                onVideoSnapshot: snapshot,
                onVideoExpand: () => {
                  preview.value = true
                },
                onVideoTime: ({ time }) => {
                  currentTime.value = time
                },
              }),
          },
        ),
        h('header', { class: 'video-interaction-fixture-tools' }, [
          h('h1', '视频节点 · 本地真实媒体交互验收'),
          h(
            'p',
            '真实组件 + 浏览器本地录制视频；不读取账号、不持久化用户画布、不访问接口、不扣费。',
          ),
          h(
            'button',
            { disabled: recording.value || busy.value, onClick: generate },
            recording.value ? '正在录制…' : '生成本地测试视频',
          ),
          h(
            'button',
            { disabled: !source.value?.data.assetUrl, onClick: selectVideo },
            '选择视频节点',
          ),
          h(
            'button',
            {
              disabled: !graph.canUndo || busy.value,
              onClick: () => {
                graph.undo()
                notice.value = '已撤销上一步画布操作'
              },
            },
            '撤销截图',
          ),
          h('p', { role: 'status', 'aria-live': 'polite' }, notice.value),
          h(
            'p',
            { 'data-fixture-media-status': true },
            `视频实际元数据：${source.value?.data.mediaWidth || '—'} × ${source.value?.data.mediaHeight || '—'}；时长 ${source.value?.data.mediaDuration?.toFixed(2) || '—'} 秒；播放位置 ${currentTime.value.toFixed(2)} 秒`,
          ),
          h(
            'p',
            { 'data-fixture-frame-status': true },
            `累计成功截帧 ${captureCount.value} 次；画布图片 ${imageCount.value} 张${lastFrame.value ? `；最近 PNG ${lastFrame.value.width} × ${lastFrame.value.height} @ ${lastFrame.value.time.toFixed(2)} 秒` : ''}`,
          ),
        ]),
        selected.value &&
          h(VideoActionToolbar, {
            left: window.innerWidth / 2,
            top: 222,
            busy: busy.value,
            onAction: dispatch,
          }),
        context.value &&
          h(VideoContextMenu, {
            position: context.value,
            rating: source.value?.data.rating || 0,
            canPaste: false,
            onClose: () => {
              context.value = null
            },
            onAction: dispatch,
            onRate: (rating) => graph.rateNode(source.value.id, rating),
          }),
        preview.value &&
          source.value?.data.assetUrl &&
          h(VideoPreviewDialog, {
            source: source.value.data.assetUrl,
            poster: source.value.data.posterUrl,
            title: source.value.data.title,
            currentTime: currentTime.value,
            busy: busy.value,
            onClose: () => {
              actions.cancel()
              preview.value = false
            },
            onSnapshot: snapshot,
            onTimeupdate: (time) => {
              currentTime.value = time
            },
            onDownload: () => dispatch('download'),
          }),
        dialog.value === 'save-asset' &&
          h(VideoSaveAssetDialog, {
            open: true,
            node: source.value,
            video: source.value?.data.assetUrl,
            name: source.value?.data.title,
            onClose: () => {
              dialog.value = ''
            },
          }),
        dialog.value &&
          dialog.value !== 'save-asset' &&
          h(VideoActionStatusDialog, {
            node: source.value,
            action: dialog.value,
            onClose: () => {
              dialog.value = ''
            },
          }),
      ])
  },
})
  .use(createPinia())
  .mount('#app')
