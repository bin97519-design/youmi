import { nodeSize } from '../config/nodeGeometry.js'
import { captureVideoFrame, downloadOriginalVideo } from './videoMediaTools.js'

// Only explicit user actions enter here. Captures never reuse a task key or
// submit a model request, and a late media read cannot land in another project.
export function createVideoNodeActions({
  graph,
  getScope,
  capture = captureVideoFrame,
  download = downloadOriginalVideo,
  onBusy = () => {},
}) {
  let operation = null
  let disposed = false
  const stale = () => new DOMException('视频操作已取消', 'AbortError')

  async function run(nodeId, work) {
    if (disposed) throw stale()
    if (operation) throw new Error('正在读取视频，请稍候再操作')
    const transient = typeof nodeId === 'object' && nodeId !== null
    const node = transient ? nodeId : graph.nodes.find((item) => item.id === nodeId)
    if (!node || node.data?.kind !== 'video' || !node.data.assetUrl)
      throw new Error('请选择有成品视频的节点')
    const snapshot = JSON.parse(JSON.stringify(node))
    const controller = new AbortController()
    const scope = getScope()
    operation = controller
    onBusy(true)
    const isCurrent = () => {
      const current = transient ? node : graph.nodes.find((item) => item.id === nodeId)
      return (
        !disposed &&
        !controller.signal.aborted &&
        scope === getScope() &&
        current?.data.kind === 'video' &&
        current.data.assetUrl === snapshot.data.assetUrl
      )
    }
    try {
      return await work(snapshot, controller.signal, () => {
        if (!isCurrent()) throw stale()
      })
    } finally {
      if (operation === controller) {
        operation = null
        onBusy(false)
      }
    }
  }

  function frame(nodeId, { time = 0, position = 'current', addToCanvas = false } = {}) {
    return run(nodeId, async (node, signal, assertCurrent) => {
      const duration = Number(node.data.mediaDuration)
      const requestedTime =
        position === 'first'
          ? 0
          : position === 'last' && duration > 0
            ? Math.max(0, duration - 0.04)
            : Number(time)
      if (!Number.isFinite(requestedTime) || requestedTime < 0)
        throw new Error('截帧时间无效，请等待视频加载完成')
      if (position === 'last' && !(duration > 0)) throw new Error('尚未读取视频时长，无法定位尾帧')
      const result = await capture(node.data.assetUrl, requestedTime, {
        signal,
        filename: `${node.data.title || '视频'}-${position}-${requestedTime.toFixed(2)}s`,
      })
      assertCurrent()
      const label = { current: '当前帧', first: '首帧', last: '尾帧' }[position] || '当前帧'
      const data = {
        kind: 'image',
        title: `${node.data.title || '视频'}-${label}-${result.time.toFixed(2)}s.png`,
        assetUrl: result.dataUrl,
        mediaWidth: result.width,
        mediaHeight: result.height,
        sourceVideoNodeId: node.id,
        sourceVideoTime: result.time,
        mediaOrigin: 'upload',
        runState: 'idle',
        artifactStatus: 'ready',
      }
      if (addToCanvas) {
        const sourceSize = nodeSize('video', node.data)
        const imageSize = nodeSize('image', data)
        graph.addImageAssets([data], {
          x: node.position.x + sourceSize.width + 72 + imageSize.width / 2,
          y: node.position.y + imageSize.height / 2,
        })
      }
      return { ...result, sourceNode: { id: `${node.id}-frame`, data } }
    })
  }

  function downloadVideo(nodeId) {
    return run(nodeId, async (node, signal, assertCurrent) => {
      const result = await download(node.data.assetUrl, {
        signal,
        filename: node.data.title || 'video',
        save: false,
      })
      assertCurrent()
      return result
    })
  }

  function cancel() {
    operation?.abort()
  }
  return {
    frame,
    download: downloadVideo,
    cancel,
    dispose() {
      disposed = true
      cancel()
    },
  }
}
