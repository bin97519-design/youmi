import { onBeforeUnmount, shallowReactive, watch } from 'vue'
import { apiPath } from '../utils/apiBase'
import { uploadFileDirect } from '../utils/ossUpload'
import { inspectReferenceVideoFile } from '../utils/referenceVideo'
import { layerName } from '../stores/canvas'

export function useVideoReversePrompt(options) {
  const {
    canvas,
    canvasId,
    planningModel,
    requireLogin,
    authHeaders,
    placeNode,
    connectNodes,
    focusNode,
    pushUndo,
    notify,
  } = options
  const active = shallowReactive(new Map())
  let uploadedVideo = null
  let disposed = false
  const documentFor = (id) => canvas.documents.find((item) => item.id === id)
  const keyFor = (id, layerId) => `${id}:${layerId}`
  const resultFor = (source) =>
    documentFor(canvasId())
      ?.payload.layers.toReversed()
      .find(
        (layer) =>
          layer.type === 'text' &&
          layer.videoReversePrompt?.sourceLayerId === source.id &&
          layer.videoReversePrompt.sourceUrl === source.url,
      )
  const isBusy = (source) =>
    [...active.values()].some(
      (job) =>
        job.canvasId === canvasId() && job.sourceId === source.id && job.sourceUrl === source.url,
    )

  function rememberUpload(layerId, url, file) {
    uploadedVideo = { canvasId: canvasId(), layerId, url, file }
  }

  function patch(id, layerId, attemptId, metadata, text) {
    const layer = documentFor(id)?.payload.layers.find((item) => item.id === layerId)
    if (!layer || layer.videoReversePrompt?.attemptId !== attemptId) return false
    canvas.updateDocument(id, (draft) => {
      const target = draft.payload.layers.find((item) => item.id === layerId)
      target.videoReversePrompt = { ...target.videoReversePrompt, ...metadata }
      if (text !== undefined) target.text = text
      return draft
    })
    return true
  }

  function createNode(source) {
    const id = canvasId()
    const layerId = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    pushUndo()
    canvas.updateDocument(id, (draft) => {
      const width = Math.max(280, Math.min(560, Number(options.nodeWidth?.()) || 560)),
        height = 360
      draft.payload.layers.push({
        id: layerId,
        name: `${source.name || '视频'} · 反推提示词`,
        type: 'text',
        text: '',
        fontSize: 14,
        fontWeight: 400,
        align: 'left',
        width,
        height,
        ...placeNode(source, width, height),
        zIndex: Math.max(0, ...draft.payload.layers.map((layer) => layer.zIndex || 0)) + 1,
        visible: true,
        locked: false,
        videoReversePrompt: {
          sourceLayerId: source.id,
          sourceUrl: source.url,
          sourceName: source.name || layerName(0),
          planningModel: planningModel(),
          status: 'ready',
          progress: 0,
          error: '',
        },
      })
      return draft
    })
    connectNodes([source.id], layerId)
    void focusNode(layerId)
    return documentFor(id)?.payload.layers.find((layer) => layer.id === layerId)
  }

  async function run(node) {
    const id = canvasId(),
      layerId = node.id,
      key = keyFor(id, layerId)
    if (active.has(key) || node.locked) return
    const metadata = { ...node.videoReversePrompt, planningModel: planningModel() }
    const controller = new AbortController()
    const attemptId =
      globalThis.crypto?.randomUUID?.() ||
      `reverse-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const job = {
      canvasId: id,
      layerId,
      sourceId: metadata.sourceLayerId,
      sourceUrl: metadata.sourceUrl,
      attemptId,
      controller,
    }
    active.set(key, job)
    patch(id, layerId, metadata.attemptId, {
      attemptId,
      status: 'pending',
      stage: '正在读取视频画面',
      progress: 2,
      error: '',
      planningModel: metadata.planningModel,
    })
    void canvas.flushNow(id)
    const timeout = setTimeout(
      () => controller.abort(new Error('视频反推等待超时，请稍后重试')),
      480000,
    )
    const checkpoint = () => {
      controller.signal.throwIfAborted()
      if (
        !documentFor(id)?.payload.layers.some(
          (layer) => layer.id === layerId && layer.videoReversePrompt?.attemptId === attemptId,
        )
      )
        throw new Error('结果节点已删除')
    }
    try {
      let referenceVideo = metadata.referenceVideo
      let shotCount = metadata.shotCount
      if (!referenceVideo) {
        const file =
          uploadedVideo?.canvasId === id &&
          uploadedVideo.layerId === metadata.sourceLayerId &&
          uploadedVideo.url === metadata.sourceUrl
            ? uploadedVideo.file
            : metadata.sourceUrl
        const inspection = await inspectReferenceVideoFile(file, 8, {
          compact: true,
          signal: controller.signal,
          onDownloadProgress: (progress) => {
            if (
              !patch(id, layerId, attemptId, {
                stage: `正在读取源视频 ${progress}%`,
                progress: 2 + Math.round(progress * 0.14),
              })
            )
              controller.abort(new Error('结果节点已删除'))
          },
          onProgress: (progress) => {
            if (
              !patch(id, layerId, attemptId, {
                stage: '正在提取视频关键帧',
                progress: 16 + Math.round(progress * 0.4),
              })
            )
              controller.abort(new Error('结果节点已删除'))
          },
        })
        checkpoint()
        const frames = []
        for (const frame of inspection.frames) {
          checkpoint()
          patch(id, layerId, attemptId, {
            stage: `正在上传关键帧 ${frames.length + 1}/${inspection.frames.length}`,
            progress: 58 + Math.round((frames.length / inspection.frames.length) * 20),
          })
          const url = await uploadFileDirect(frame.file, {
            dir: 'canvas/video-prompt-frames',
            signal: controller.signal,
          })
          frames.push({ url, time: frame.time })
        }
        checkpoint()
        referenceVideo = {
          url: metadata.sourceUrl,
          name: metadata.sourceName.slice(0, 200),
          duration: inspection.duration,
          width: inspection.width,
          height: inspection.height,
          audioSummary: inspection.audioSummary,
          frames,
        }
        shotCount = Math.max(1, Math.min(8, inspection.suggestedShotCount || 1))
        patch(id, layerId, attemptId, { referenceVideo, shotCount })
      }
      checkpoint()
      patch(id, layerId, attemptId, { stage: '正在反推画面、动作和运镜', progress: 82 })
      const response = await fetch(apiPath('/api/product-videos/reverse-prompt'), {
        method: 'POST',
        signal: controller.signal,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceVideo, shotCount, planningModel: metadata.planningModel }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.code !== 0) {
        throw new Error(
          response.status === 404
            ? '当前后端尚未加载画布视频反推，请更新服务后重试'
            : result?.message || `视频反推失败（${response.status}）`,
        )
      }
      checkpoint()
      const text = String(result.data?.promptText || '').trim()
      if (!text) throw new Error('反推结果为空，请重试')
      patch(
        id,
        layerId,
        attemptId,
        {
          status: 'completed',
          stage: '反推完成',
          progress: 100,
          error: '',
          model: result.data.model,
          completedAt: new Date().toISOString(),
        },
        text,
      )
    } catch (error) {
      patch(id, layerId, attemptId, {
        status: 'failed',
        stage: '反推未完成',
        progress: 0,
        error: disposed
          ? '上次请求已中断，请稍后重试'
          : error instanceof TypeError && /fetch|network/i.test(error.message)
            ? '网络连接已中断，未自动重复提交，请稍后重试'
            : error?.message || '视频反推失败，请重试',
      })
    } finally {
      clearTimeout(timeout)
      active.delete(key)
      void canvas.flushNow(id)
    }
  }

  async function reverse(source) {
    if (!source?.url || !requireLogin()) return
    const existing = resultFor(source)
    if (existing) {
      void focusNode(existing.id)
      if (existing.videoReversePrompt.status === 'completed' || isBusy(source)) return
      if (!existing.text?.trim()) return run(existing)
    }
    const node = createNode(source)
    if (node) await run(node)
  }

  async function retry(node) {
    if (!requireLogin() || node.locked || active.has(keyFor(canvasId(), node.id))) return
    const source = documentFor(canvasId())?.payload.layers.find(
      (layer) =>
        layer.id === node.videoReversePrompt?.sourceLayerId &&
        layer.url === node.videoReversePrompt.sourceUrl,
    )
    if (!source) return notify('源视频已替换或删除，请从当前视频重新反推')
    if (node.text?.trim()) return run(createNode(source))
    return run(node)
  }

  watch(
    () =>
      documentFor(canvasId())
        ?.payload.layers.map(
          (layer) =>
            `${layer.id}:${layer.videoReversePrompt?.status}:${layer.videoReversePrompt?.attemptId}`,
        )
        .join('|'),
    () => {
      for (const job of active.values()) {
        if (!documentFor(job.canvasId)?.payload.layers.some((layer) => layer.id === job.layerId)) {
          job.controller.abort(new Error('结果节点已删除'))
        }
      }
      for (const node of documentFor(canvasId())?.payload.layers || []) {
        if (
          node.videoReversePrompt?.status !== 'pending' ||
          active.has(keyFor(canvasId(), node.id))
        )
          continue
        patch(canvasId(), node.id, node.videoReversePrompt.attemptId, {
          status: 'failed',
          stage: '反推未完成',
          progress: 0,
          error: '上次请求已中断，未自动重复提交；可稍后重试',
        })
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    disposed = true
    uploadedVideo = null
    for (const job of active.values()) {
      patch(job.canvasId, job.layerId, job.attemptId, {
        status: 'failed',
        stage: '反推未完成',
        progress: 0,
        error: '上次请求已中断，请稍后重试',
      })
      job.controller.abort()
    }
  })

  return { reverse, retry, isBusy, rememberUpload }
}
