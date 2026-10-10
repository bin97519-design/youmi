import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useUserStore } from '../stores/user'
import { apiPath } from '../utils/apiBase'
import { productVideoAssetSize, readProductVideoMediaSize } from '../utils/productVideoMedia'
import { continuityReferenceImages } from '../utils/productVideoContinuity'
import {
  buildCompositionRequest,
  buildImageRequest,
  buildPlanRequest,
  buildVideoRequest,
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  isPerSecondVideoModel,
  WHOLE_VIDEO_30_MODEL,
  compositionFingerprint,
  copy,
  newProductVideo,
  newProductVideoTask,
  productVideoLibrary,
  productVideoShotLimit,
  newShot,
  applyPlanningState,
  isPlanRunning,
  isWholeVideo,
  generationDuration,
  planningErrorMessage,
  taskState,
  uid,
} from '../utils/productVideo'

export function useProductVideo(canvasId, activeTaskId) {
  const canvas = useCanvasStore(),
    user = useUserStore()
  const fallback = newProductVideo()
  const tasks = computed(
    () => productVideoLibrary(canvas.ensureDocument(canvasId.value).payload.productVideo).tasks,
  )
  const workflow = computed(
    () => tasks.value.find((task) => task.id === activeTaskId.value) || fallback,
  )
  const error = ref(''),
    notice = ref('')
  const operations = ref({})
  const operationKey = (context) => `${context.docId}:${context.taskId}`
  const planning = computed(
    () =>
      operations.value[operationKey(captureTask())] === 'plan' ||
      isPlanRunning(workflow.value.planJob),
  )
  const composing = computed(() => operations.value[operationKey(captureTask())] === 'compose')
  const taskActivity = computed(() =>
    Object.fromEntries(
      tasks.value.map((task) => [task.id, operations.value[`${canvasId.value}:${task.id}`]]),
    ),
  )
  const capabilities = ref(null)
  const planningModelRecords = computed(() =>
    capabilities.value?.planningModels?.length
      ? capabilities.value.planningModels
      : [{ value: 'default', label: '默认策划模型', configured: null }],
  )
  const planningModelOptions = computed(() =>
    planningModelRecords.value.map((option) => ({
      ...option,
      label: option.configured === false ? `${option.label} · 未配置密钥` : option.label,
    })),
  )
  const imageModelOptions = computed(() =>
    (capabilities.value?.imageModels || []).map((option) => ({
      ...option,
      model: option.value,
      value: option.label || option.value,
      label: option.label || option.value,
    })),
  )
  const videoModelOptions = computed(() =>
    (capabilities.value?.videoModels || []).map((option) => ({
      ...option,
      label: option.label || option.value,
    })),
  )
  const planningModelUnavailable = computed(
    () =>
      !planningModelRecords.value.some(
        (option) =>
          option.value === (workflow.value.planningModel || 'default') &&
          option.configured !== false,
      ),
  )
  const pending = new Set()
  let disposed = false,
    timer

  function captureTask() {
    return { docId: canvasId.value, taskId: activeTaskId.value }
  }
  function isCurrent(context) {
    return context.docId === canvasId.value && context.taskId === activeTaskId.value
  }
  function getTask(context = captureTask()) {
    const doc = canvas.documents.find((item) => item.id === context.docId)
    return productVideoLibrary(doc?.payload?.productVideo).tasks.find(
      (task) => task.id === context.taskId,
    )
  }
  function createTask() {
    const task = newProductVideoTask(`新任务 ${tasks.value.length + 1}`)
    canvas.updateDocument(canvasId.value, (doc) => {
      doc.payload.productVideo = productVideoLibrary(doc.payload.productVideo)
      doc.payload.productVideo.tasks.unshift(task)
      return doc
    })
    return task.id
  }
  function change(fn, context = captureTask(), touch = true) {
    if (!getTask(context)) return
    canvas.updateDocument(context.docId, (doc) => {
      doc.payload.productVideo = productVideoLibrary(doc.payload.productVideo)
      const task = doc.payload.productVideo.tasks.find((item) => item.id === context.taskId)
      if (!task) return doc
      fn(task, doc)
      if (touch) task.updatedAt = Date.now()
      return doc
    })
  }
  function shotChange(id, fn, context = captureTask(), touch = true) {
    change(
      (data, doc) => {
        const shot = data.shots.find((item) => item.id === id)
        if (shot) fn(shot, doc)
      },
      context,
      touch,
    )
  }
  async function request(path, body, timeoutMs = 180000) {
    const response = await fetch(apiPath(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...user.authHeaders() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.code) {
      const error = new Error(result.message || `请求失败（${response.status}）`)
      error.status = response.status
      throw error
    }
    return result.data
  }
  async function loadCapabilities() {
    try {
      capabilities.value = await request('/api/product-videos/capabilities')
    } catch (e) {
      error.value = e.message
    }
  }
  function selectPlanningModel(model) {
    const previous = workflow.value.planningModel || 'default'
    if (previous === model) return
    change((data) => {
      data.planningModel = model
    })
    recordModelSelection('product-video-planning', previous, model)
  }
  function selectImageModel(model) {
    const previous = workflow.value.imageModel
    if (previous === model) return
    change((data) => {
      data.imageModel = model
    })
    recordModelSelection('product-video-image', previous, model)
  }
  function selectVideoModel(model) {
    const previous = workflow.value.videoModel
    if (previous === model) return
    change((data) => {
      data.videoModel = model
    })
    recordModelSelection('product-video-video', previous, model)
  }
  function recordModelSelection(featureCode, previous, model) {
    const record = (value, selected) => {
      if (!value || value === 'default') return
      void request('/api/ai/model-selection-events', {
        feature_code: featureCode,
        model: value,
        selected,
      }).catch((e) => console.warn('[product-video] 模型选择埋点上报失败', e?.message || e))
    }
    record(model, true)
    record(previous, false)
  }
  function videoUsesReportedCost(model) {
    if (model === HAILUO_H3_VIDEO_MODEL ||
        (model === MINIMAX_VIDEO_MODEL && capabilities.value?.hailuoH3Video === true)) return true
    const provider = String(videoModelOptions.value.find((option) => option.value === model)?.provider || '')
      .trim()
      .toLowerCase()
    return ['lk888', 'youmi888', 'lingke', 'model-api', '灵科ai', '灵科 ai']
      .some((prefix) => provider.startsWith(prefix))
  }
  function addShot(plan) {
    if (planning.value) return
    change((data) => {
      if (data.shots.length >= productVideoShotLimit(data))
        throw new Error(`最多添加 ${productVideoShotLimit(data)} 个分镜`)
      const shot = newShot(
        plan ||
          (isWholeVideo(data.productionMode)
            ? {
                productionMode: data.productionMode,
                ...(data.planningSource === 'reference' && data.referenceStrategy === 'highlights'
                  ? { referenceStrategy: 'highlights' }
                  : {}),
                timelineCount: data.timelineCount ?? 4,
                duration: generationDuration(data),
                title: '整片视频',
                motion: '',
              }
            : {}),
      )
      shot.referenceIds = data.references.map((item) => item.id)
      data.shots.push(shot)
    })
  }
  async function plan(count) {
    if (planning.value || workflow.value.planJob?.status === 'unknown') return
    const context = captureTask()
    operations.value[operationKey(context)] = 'plan'
    error.value = ''
    const snapshot = copy(workflow.value)
    try {
      const payload = buildPlanRequest(snapshot, count)
      if (
        isWholeVideo(payload.productionMode) &&
        snapshot.planningSource !== 'reference' &&
        !capabilities.value?.wholeVideoOptionalContinuity
      )
        throw new Error('当前服务尚未支持整片可选固定设定，请更新后端后重新打开工作区')
      if (payload.continuity && !capabilities.value?.fixedContinuity)
        throw new Error('当前服务尚未支持全片固定设定，请更新后端后重新打开工作区')
      if (continuityReferenceImages(snapshot).length && !capabilities.value?.fixedContinuityImages)
        throw new Error('当前服务尚未支持固定参考图，请更新后端后重新打开工作区')
      if (planningModelUnavailable.value)
        throw new Error('所选策划模型不可用，请检查密钥配置或重新选择')
      if (payload.productionMode === 'single_video' && !capabilities.value?.singleVideoPlan)
        throw new Error('当前策划服务尚未支持整片一次生成，请更新后端后重新打开工作区')
      if (payload.productionMode === 'single_video_30' && !capabilities.value?.singleVideo30)
        throw new Error('当前服务尚未支持 30 秒整片，请更新后端后重新打开工作区')
      if (payload.timelineCount != null && !capabilities.value?.wholeVideoShotCount)
        throw new Error('当前服务尚未支持整片分镜数量，请更新后端后重新打开工作区')
      if (payload.generateAudio && !capabilities.value?.synchronizedAudio)
        throw new Error('当前服务尚未支持音画同步，请更新后端后重新打开工作区')
      if (payload.referenceVideo && !capabilities.value?.referenceVideoReverse)
        throw new Error('当前服务尚未支持参考视频反推，请更新后端后重新打开工作区')
      if (payload.referenceVideo?.segments && !capabilities.value?.longReferenceVideo)
        throw new Error('当前服务尚未支持长参考视频，请更新后端后重新打开工作区')
      if (
        payload.referenceVideo?.strategy === 'highlights' &&
        !capabilities.value?.referenceVideoHighlights
      )
        throw new Error('当前服务尚未支持精华 30 秒，请更新后端后重新打开工作区')
      if (snapshot.shots.length + payload.count > productVideoShotLimit(snapshot))
        throw new Error(`分镜总数不能超过 ${productVideoShotLimit(snapshot)} 个`)
      const id = uid()
      change((data) => {
        data.planJob = {
          id,
          request: payload,
          status: 'submitting',
          stage: '正在提交策划',
          referenceIds: snapshot.references.map((item) => item.id),
          appliedCount: 0,
          count: payload.count,
        }
      }, context)
      void canvas.flushNow(context.docId)
      const result = await request(
        '/api/product-videos/plan-tasks',
        { id, request: payload },
        30000,
      )
      change((data) => applyPlanningState(data, result), context)
      void poll()
    } catch (e) {
      change((data) => {
        if (data.planJob?.status === 'submitting')
          Object.assign(data.planJob, {
            status: 'unknown',
            stage: '正在确认提交结果',
            pollError: e.message,
          })
      }, context)
      if (isCurrent(context)) error.value = planningErrorMessage(e)
    } finally {
      delete operations.value[operationKey(context)]
    }
  }

  async function pollPlan(context, entry) {
    const key = `plan:${operationKey(context)}:${entry.id}`
    if (pending.has(key)) return
    pending.add(key)
    try {
      const state = await request(
        `/api/product-videos/plan-tasks/${encodeURIComponent(entry.id)}`,
        undefined,
        30000,
      )
      if (disposed) return
      const current = getTask(context)?.planJob
      if (!current || current.id !== entry.id) return
      if (
        current.updatedAt === state.updatedAt &&
        current.status === state.status &&
        !current.pollError
      )
        return
      change((data) => applyPlanningState(data, state), context, false)
    } catch (e) {
      if (!disposed)
        change(
          (data) => {
            if (data.planJob?.id === entry.id)
              Object.assign(data.planJob, {
                pollError: `进度查询中断：${e.message}`,
                ...(e.status === 404 ? { status: 'unknown' } : {}),
              })
          },
          context,
          false,
        )
    } finally {
      pending.delete(key)
    }
  }

  async function retryPlan() {
    const context = captureTask(),
      entry = copy(workflow.value.planJob)
    if (!entry || planning.value) return
    operations.value[operationKey(context)] = 'plan'
    error.value = ''
    try {
      let state
      try {
        state = await request(
          `/api/product-videos/plan-tasks/${encodeURIComponent(entry.id)}`,
          undefined,
          30000,
        )
      } catch (e) {
        if (e.status !== 404) throw e
        state = await request(
          '/api/product-videos/plan-tasks',
          { id: entry.id, request: entry.request },
          30000,
        )
      }
      if (state.status === 'failed')
        state = await request(
          `/api/product-videos/plan-tasks/${encodeURIComponent(entry.id)}/retry`,
          {},
          30000,
        )
      change((data) => applyPlanningState(data, state), context)
      void poll()
    } catch (e) {
      if (isCurrent(context)) error.value = planningErrorMessage(e)
    } finally {
      delete operations.value[operationKey(context)]
    }
  }

  function addAsset(doc, shot, item, kind, taskId) {
    if (doc.payload.layers.some((layer) => layer.id === `pv-${item.id}`)) return
    const right = Math.max(
      0,
      ...doc.payload.layers.map((layer) => Number(layer.x || 0) + Number(layer.width || 0)),
    )
    doc.payload.layers.push({
      id: `pv-${item.id}`,
      name: `${shot.title} · ${kind === 'image' ? '首帧' : '视频'}`,
      type: kind,
      url: item.url,
      ...productVideoAssetSize(item),
      x: right + 32,
      y: 0,
      zIndex: doc.payload.layers.length + 1,
      visible: true,
      locked: false,
      productVideoShotId: shot.id,
      productVideoTaskId: taskId,
      productVideoVersionId: item.id,
      status: 'completed',
    })
  }

  async function generate(shotId, kind, context = captureTask()) {
    const task = getTask(context)
    const shot = task?.shots.find((item) => item.id === shotId)
    if (
      !shot ||
      shot[kind === 'image' ? 'images' : 'videos'].some((item) =>
        ['submitting', 'processing'].includes(item.status),
      )
    )
      return
    const itemId = uid(),
      field = kind === 'image' ? 'images' : 'videos'
    let payload
    try {
      payload =
        kind === 'image'
          ? buildImageRequest(task, shot, itemId)
          : buildVideoRequest(task, shot, itemId)
      payload.feature_code = kind === 'image' ? 'product-video-image' : 'product-video-video'
      const costReportedByProvider = kind === 'video' && videoUsesReportedCost(payload.model)
      if (
        kind === 'video' &&
        payload.model === WHOLE_VIDEO_30_MODEL &&
        !capabilities.value?.singleVideo30
      )
        throw new Error('当前服务尚未支持 30 秒整片，请更新后端后重新打开工作区')
      if (
        kind === 'video' &&
        payload.model === ANMIAO_VIDEO_MODEL &&
        !costReportedByProvider && (!capabilities.value?.anmiaoVideo ||
          !capabilities.value?.anmiaoMiPerSecondByResolution?.[payload.resolution])
      )
        throw new Error('按秒视频所选画质尚未配置密钥和每秒米值单价')
      if (
        kind === 'video' &&
        payload.model === ANMIAO25_VIDEO_MODEL &&
        !costReportedByProvider && (!capabilities.value?.anmiao25Video ||
          !capabilities.value?.anmiao25MiPerSecondByResolution?.[payload.resolution])
      )
        throw new Error('SD2.5 所选画质尚未配置密钥和每秒米值单价')
      if (
        kind === 'video' &&
        payload.model === MINIMAX_VIDEO_MODEL &&
        !costReportedByProvider && (!capabilities.value?.minimaxVideo ||
          !capabilities.value?.minimaxMiPerSecondByResolution?.[payload.resolution])
      )
        throw new Error('MiniMax H3 所选画质尚未配置密钥和每秒米值单价')
      if (kind === 'video' && payload.generate_audio && !capabilities.value?.synchronizedAudio)
        throw new Error('当前服务尚未支持音画同步，请更新后端后重新打开工作区')
    } catch (e) {
      if (isCurrent(context)) error.value = e.message
      return
    }
    error.value = ''
    shotChange(
      shotId,
      (current) => {
        current[field].push({
          id: itemId,
          status: 'submitting',
          url: '',
          progress: null,
          request: payload,
          sourceImageId: kind === 'video' ? current.imageId : '',
          ratio: task.ratio,
          createdAt: Date.now(),
        })
      },
      context,
    )
    try {
      const result = await request(
        kind === 'image' ? '/api/image-tasks' : '/api/video-tasks',
        payload,
      )
      const taskId =
        kind === 'image'
          ? result?.tasks?.[0]?.taskId || result?.tasks?.[0]?.task_id
          : result?.taskId || result?.task_id
      if (!taskId) throw new Error('未返回任务编号，请检查任务记录后重试')
      shotChange(
        shotId,
        (current) =>
          Object.assign(
            current[field].find((item) => item.id === itemId),
            { taskId, status: 'processing' },
          ),
        context,
      )
      void canvas.flushNow(context.docId)
      void poll()
    } catch (e) {
      const rejected =
        kind === 'video' &&
        (payload.model === WHOLE_VIDEO_30_MODEL || isPerSecondVideoModel(payload.model)) &&
        [400, 401, 403, 409, 429, 503].includes(e.status)
      shotChange(
        shotId,
        (current) =>
          Object.assign(
            current[field].find((item) => item.id === itemId),
            {
              status: rejected ? 'failed' : 'unknown',
              error: rejected ? e.message : `${e.message}。请先核对生成记录，避免重复提交计费。`,
            },
          ),
        context,
      )
      if (isCurrent(context)) error.value = e.message
    }
  }

  async function pollEntry(context, shotId, kind, entry) {
    const key = `${operationKey(context)}:${entry.id}`
    if (pending.has(key)) return
    pending.add(key)
    const field = kind === 'image' ? 'images' : 'videos'
    try {
      const data = await request(
        `/api/${kind === 'image' ? 'image' : 'video'}-tasks/${encodeURIComponent(entry.taskId)}`,
      )
      const status = taskState(data.status)
      const url = (kind === 'image' ? data.imageUrls : data.videoUrls)?.[0]
      const mediaSize =
        status === 'completed' && url ? await readProductVideoMediaSize(url, kind) : null
      shotChange(
        shotId,
        (shot, doc) => {
          const item = shot[field].find((value) => value.id === entry.id)
          if (!item) return
          item.progress =
            data.progress == null || data.progress === '' ? null : Number(data.progress)
          item.providerStatus = data.status
          item.stage = data.stage || ''
          item.lastSyncedAt = Date.now()
          item.pollError = status === 'processing' ? data.error || '' : ''
          if (status === 'failed') {
            item.status = 'failed'
            item.error = data.error || '生成失败'
            return
          }
          if (status === 'completed' && url) {
            Object.assign(item, {
              status: 'completed',
              url,
              progress: 100,
              error: '',
              duration: kind === 'video' ? Number(entry.request?.durationSeconds) || 15 : undefined,
              ...(mediaSize ? { mediaWidth: mediaSize.width, mediaHeight: mediaSize.height } : {}),
            })
            if (kind === 'image') {
              shot.imageId = item.id
              shot.approvedImageId = ''
            } else {
              shot.videoId = item.id
              shot.kept = false
              shot.start = 0
            }
            addAsset(doc, shot, item, kind, context.taskId)
          } else if (status === 'completed' && !url) {
            item.status = 'failed'
            item.error = '任务完成，但没有返回素材地址'
          }
        },
        context,
        false,
      )
    } catch (e) {
      shotChange(
        shotId,
        (shot) => {
          const item = shot[field].find((value) => value.id === entry.id)
          if (item) item.pollError = `状态查询中断：${e.message}，将自动重试`
        },
        context,
        false,
      )
    } finally {
      pending.delete(key)
    }
  }

  async function pollComposition(context, entry) {
    const key = `${operationKey(context)}:${entry.id}`
    if (pending.has(key)) return
    pending.add(key)
    try {
      const result = await request(`/api/product-videos/compositions/${entry.id}`)
      const mediaSize =
        result.status === 'completed' && result.url
          ? await readProductVideoMediaSize(result.url, 'video')
          : null
      if (mediaSize)
        Object.assign(result, { mediaWidth: mediaSize.width, mediaHeight: mediaSize.height })
      change(
        (data, doc) => {
          if (data.composition?.id !== entry.id) return
          Object.assign(data.composition, result, { pollError: '' })
          if (result.status === 'completed')
            addAsset(
              doc,
              { id: 'composition', title: '主图视频成片' },
              { ...result, ratio: entry.ratio },
              'video',
              context.taskId,
            )
        },
        context,
        false,
      )
    } catch (e) {
      change(
        (data) => {
          if (data.composition?.id === entry.id) data.composition.pollError = e.message
        },
        context,
        false,
      )
    } finally {
      pending.delete(key)
    }
  }

  async function poll() {
    if (disposed) return
    for (const task of tasks.value) {
      const context = { docId: canvasId.value, taskId: task.id }
      if (task.planJob?.id && (isPlanRunning(task.planJob) || task.planJob.status === 'unknown'))
        void pollPlan(context, copy(task.planJob))
      for (const shot of task.shots) {
        for (const kind of ['image', 'video']) {
          for (const entry of shot[kind === 'image' ? 'images' : 'videos']) {
            if (entry.taskId && entry.status === 'processing')
              void pollEntry(context, shot.id, kind, copy(entry))
          }
        }
      }
      const entry = task.composition
      if (entry?.id && ['queued', 'processing'].includes(entry.status))
        void pollComposition(context, copy(entry))
    }
  }

  async function recoverUnknownImageSubmissions() {
    const staleAfterMs = 60_000
    for (const task of tasks.value) {
      const context = { docId: canvasId.value, taskId: task.id }
      for (const shot of task.shots) {
        const unresolved = shot.images.filter(
          (item) =>
            item.status === 'unknown' &&
            !item.taskId &&
            /^请求失败（502）/.test(item.error || ''),
        )
        for (const entry of unresolved) {
          const clientTaskId = entry.request?.client_task_id || entry.id
          try {
            const result = await request(
              `/api/image-tasks/by-client-task-id?client_task_id=${encodeURIComponent(clientTaskId)}`,
            )
            const taskId = result?.task_id || result?.taskId
            if (taskId) {
              shotChange(
                shot.id,
                (current) => {
                  const item = current.images.find((candidate) => candidate.id === entry.id)
                  if (!item) return
                  item.taskId = taskId
                  item.status = 'processing'
                  item.error = ''
                },
                context,
              )
              void canvas.flushNow(context.docId)
              void pollEntry(context, shot.id, 'image', { ...entry, taskId, status: 'processing' })
              continue
            }
            const createdAt = Number(entry.createdAt) || Date.parse(entry.createdAt) || 0
            if (Date.now() - createdAt < staleAfterMs) continue
            shotChange(
              shot.id,
              (current) => {
                current.images = current.images.filter((item) => item.id !== entry.id)
              },
              context,
            )
            void canvas.flushNow(context.docId)
          } catch {
            // Keep the uncertain entry visible if the task lookup itself cannot be completed.
          }
        }
      }
    }
  }

  async function compose() {
    if (composing.value || ['queued', 'processing'].includes(workflow.value.composition?.status))
      return
    const context = captureTask()
    operations.value[operationKey(context)] = 'compose'
    error.value = ''
    try {
      const payload = buildCompositionRequest(workflow.value)
      if (payload.keepOriginalAudio && !capabilities.value?.synchronizedAudio)
        throw new Error('当前合成服务尚未支持保留原声，请更新后端后重新打开工作区')
      if (
        payload.clips.some((clip) => clip.timingMode === 'speed') &&
        !capabilities.value?.clipSpeed
      )
        throw new Error('当前合成服务尚未支持整段加速，请更新后端服务后重新打开工作区')
      const fingerprint = compositionFingerprint(workflow.value)
      const result = await request('/api/product-videos/compositions', payload)
      change((data) => {
        data.composition = { ...result, fingerprint, ratio: payload.ratio }
      }, context)
    } catch (e) {
      if (isCurrent(context)) error.value = e.message
    } finally {
      delete operations.value[operationKey(context)]
    }
  }

  onMounted(() => {
    for (const task of tasks.value) {
      const interrupted = task.shots.some((shot) =>
        [...shot.images, ...shot.videos].some((item) => item.status === 'submitting'),
      )
      if (interrupted) {
        change(
          (data) =>
            data.shots.forEach((shot) =>
              [...shot.images, ...shot.videos].forEach((item) => {
                if (item.status !== 'submitting') return
                item.status = 'unknown'
                item.error = '提交结果未确认，请先核对生成记录，避免重复计费'
              }),
            ),
          { docId: canvasId.value, taskId: task.id },
        )
      }
    }
    void recoverUnknownImageSubmissions()
    void poll()
    timer = setInterval(poll, 5000)
  })
  onBeforeUnmount(() => {
    disposed = true
    clearInterval(timer)
  })
  return {
    workflow,
    tasks,
    taskActivity,
    captureTask,
    getTask,
    isCurrent,
    createTask,
    change,
    shotChange,
    error,
    notice,
    planning,
    composing,
    capabilities,
    planningModelOptions,
    imageModelOptions,
    videoModelOptions,
    planningModelUnavailable,
    selectPlanningModel,
    selectImageModel,
    selectVideoModel,
    request,
    loadCapabilities,
    addShot,
    plan,
    retryPlan,
    generate,
    compose,
  }
}
