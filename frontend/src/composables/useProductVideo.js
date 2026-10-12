import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasStore } from '../stores/canvas'
import { useUserStore } from '../stores/user'
import { apiPath } from '../utils/apiBase'
import { productVideoAssetSize, readProductVideoMediaSize } from '../utils/productVideoMedia'
import { continuityReferenceImages } from '../utils/productVideoContinuity'
import { generationConnectionMetadata, shotConnection, adjacentProductVideoShots,
  previousShotTailSource, usableShotConnectionFrame, usableMotionObservation } from '../utils/productVideoShotConnections'
import { buildContinuityReview, buildWholeVideoReview, wholeVideoReviewIssue, currentContinuityReview, currentManualContinuityApproval, continuityReviewIssue, reviewRunning, motionObservationRequired } from '../utils/productVideoContinuityReview'
import { batchVideoState, productVideoBatchConfiguration } from '../utils/productVideoBatch'
import { extractReferenceVideoFrame } from '../utils/referenceVideo'
import { uploadFileDirect } from '../utils/ossUpload'
import {
  buildCompositionRequest,
  buildImageRequest,
  buildPlanRequest,
  buildVideoRequest,
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  mappedImageModelOption,
  mappedVideoModelOption,
  wholeVideoModelOptions,
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
  executionDuration,
  planningErrorMessage,
  taskState,
  imageSubmissionRejected,
  canGenerateVideo,
  pickImage,
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
  const capabilitiesLoading = ref(false)
  const capabilitiesError = ref('')
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
  const wholeVideo15ModelOptions = computed(() => wholeVideoModelOptions(videoModelOptions.value, 15))
  const wholeVideo30ModelOptions = computed(() => wholeVideoModelOptions(videoModelOptions.value, 30))
  function availableImageModelOption(model) {
    return mappedImageModelOption(model, imageModelOptions.value) || imageModelOptions.value[0]
  }
  function availableVideoModelOption(model, options = videoModelOptions.value) {
    return mappedVideoModelOption(
      model,
      options,
      capabilities.value?.hailuoH3Video,
    ) || options[0]
  }
  const selectedImageModelOption = computed(() =>
    availableImageModelOption(workflow.value.imageModel),
  )
  const selectedImageModelValue = computed(
    () => selectedImageModelOption.value?.value || workflow.value.imageModel,
  )
  const effectiveImageModel = computed(
    () => selectedImageModelOption.value?.model || workflow.value.imageModel,
  )
  const imageModelIsMapped = computed(() => Boolean(selectedImageModelOption.value))
  const selectedVideoModelOption = computed(() =>
    availableVideoModelOption(workflow.value.videoModel),
  )
  const effectiveVideoModel = computed(
    () => selectedVideoModelOption.value?.value || workflow.value.videoModel,
  )
  const videoModelIsMapped = computed(() => Boolean(selectedVideoModelOption.value))
  const effectiveWholeVideo15Model = computed(() =>
    availableVideoModelOption(workflow.value.videoModel, wholeVideo15ModelOptions.value)?.value || '',
  )
  const effectiveWholeVideo30Model = computed(() =>
    availableVideoModelOption(workflow.value.wholeVideo30Model, wholeVideo30ModelOptions.value)?.value || '',
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
    return { docId: canvasId.value, taskId: activeTaskId.value, userId: user.profile?.id }
  }
  function isCurrent(context) {
    return context.docId === canvasId.value && context.taskId === activeTaskId.value &&
      (context.userId == null || String(context.userId) === String(user.profile?.id))
  }
  function getTask(context = captureTask()) {
    if (context.userId != null && String(context.userId) !== String(user.profile?.id)) return null
    const doc = canvas.documents.find((item) => item.id === context.docId)
    return productVideoLibrary(doc?.payload?.productVideo).tasks.find(
      (task) => task.id === context.taskId,
    )
  }
  function createTask() {
    const task = newProductVideoTask(`新任务 ${tasks.value.length + 1}`)
    task.smoothAudio = capabilities.value?.audioSmoothing === true
    task.imageModel = availableImageModelOption(task.imageModel)?.value || ''
    task.videoModel = availableVideoModelOption(task.videoModel)?.value || ''
    task.wholeVideo30Model =
      availableVideoModelOption(task.wholeVideo30Model, wholeVideo30ModelOptions.value)?.value || ''
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
    if (error.value && error.value === capabilitiesError.value) error.value = ''
    capabilitiesLoading.value = true
    capabilitiesError.value = ''
    try {
      capabilities.value = await request('/api/product-videos/capabilities')
      if (imageModelOptions.value.length) {
        for (const task of tasks.value.filter((item) => !item.imageModel))
          change(
            (data) => { data.imageModel = imageModelOptions.value[0].value },
            { docId: canvasId.value, taskId: task.id },
            false,
          )
      }
      if (videoModelOptions.value.length) {
        for (const task of tasks.value.filter((item) => !item.videoModel))
          change(
            (data) => { data.videoModel = videoModelOptions.value[0].value },
            { docId: canvasId.value, taskId: task.id },
            false,
          )
      }
      if (wholeVideo30ModelOptions.value.length) {
        for (const task of tasks.value.filter((item) => !item.wholeVideo30Model))
          change(
            (data) => { data.wholeVideo30Model = wholeVideo30ModelOptions.value[0].value },
            { docId: canvasId.value, taskId: task.id },
            false,
          )
      }
      void recoverUnknownImageSubmissions()
    } catch (e) {
      capabilitiesError.value = `模型列表加载失败：${e.message}`
      error.value = capabilitiesError.value
    } finally {
      capabilitiesLoading.value = false
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

  async function generate(shotId, kind, context = captureTask(), batchId = '') {
    const task = getTask(context)
    const shot = task?.shots.find((item) => item.id === shotId)
    if (batchId && (task?.batchVideoJob?.id !== batchId || !['running', 'waiting_confirmation'].includes(task.batchVideoJob.status))) return
    if (
      !shot ||
      shot[kind === 'image' ? 'images' : 'videos'].some((item) =>
        ['submitting', 'processing', 'unknown'].includes(item.status),
      )
    )
      return
    const itemId = uid(),
      field = kind === 'image' ? 'images' : 'videos'
    let payload
    try {
      const imageOption = availableImageModelOption(task.imageModel)
      const whole30 = shot.productionMode === 'single_video_30'
      const option = availableVideoModelOption(
        whole30 ? task.wholeVideo30Model : task.videoModel,
        whole30 ? wholeVideo30ModelOptions.value
          : shot.productionMode === 'single_video' ? wholeVideo15ModelOptions.value : videoModelOptions.value,
      )
      if (kind === 'video' && !option)
        throw new Error(whole30 ? '当前没有支持 30 秒整片的可用视频模型' : '当前没有可用的视频模型，请刷新模型列表')
      if (kind === 'image' && !imageOption)
        throw new Error('当前没有可用的图片模型，请刷新模型列表')
      if (kind === 'video' && capabilities.value?.continuityReview && motionObservationRequired(task, shot) && !usableMotionObservation(task, shot))
        throw new Error('请先分析并确认上一镜实际动作，再生成动作接力视频')
      payload =
        kind === 'image'
          ? buildImageRequest({ ...task, imageModel: imageOption.value }, shot, itemId)
          : buildVideoRequest({
              ...task,
              ...(whole30 ? { wholeVideo30Model: option.value } : { videoModel: option.value }),
            }, shot, itemId)
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
      if (batchId) change(data => {
        if (data.batchVideoJob?.id === batchId) Object.assign(data.batchVideoJob, { status: 'paused', stage: '生成条件已改变', error: e.message })
      }, context)
      return
    }
    error.value = ''
    shotChange(
      shotId,
      (current) => {
        if (kind === 'video' && !isWholeVideo(current.productionMode) && !current.referenceRange)
          current.scriptDuration = executionDuration(current, task)
        current[field].push({
          id: itemId,
          status: 'submitting',
          url: '',
          progress: null,
          request: payload,
          ...(kind === 'video' ? { submissionTracked: capabilities.value?.videoSubmissionRecovery === true } : {}),
          ...(batchId ? { batchId } : {}),
          sourceImageId: kind === 'video' ? current.imageId : '',
          ...generationConnectionMetadata(task, current, kind),
          ratio: task.ratio,
          createdAt: Date.now(),
        })
      },
      context,
    )
    try {
      await canvas.flushNow(context.docId)
      if (batchId && (getTask(context)?.batchVideoJob?.id !== batchId || getTask(context)?.batchVideoJob?.status === 'cancelled')) {
        shotChange(shotId, current => Object.assign(current[field].find(item => item.id === itemId),
          { status: 'failed', error: '批量已停止，此视频未提交' }), context)
        return
      }
      if (batchId && batchConfig(getTask(context), getTask(context).batchVideoJob.shotIds) !== getTask(context).batchVideoJob.config) {
        shotChange(shotId, current => Object.assign(current[field].find(item => item.id === itemId),
          { status: 'failed', error: '批量设置已改变，此视频未提交' }), context)
        change(data => Object.assign(data.batchVideoJob, { status: 'paused', stage: '模型或脚本已改变' }), context)
        return
      }
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
        (kind === 'image' && imageSubmissionRejected(e)) ||
        (kind === 'video' &&
          (payload.model === WHOLE_VIDEO_30_MODEL || isPerSecondVideoModel(payload.model)) &&
          [400, 401, 403, 429].includes(e.status))
      shotChange(
        shotId,
        (current) =>
          Object.assign(
            current[field].find((item) => item.id === itemId),
            {
              status: rejected ? 'failed' : 'unknown',
              submissionErrorMessage: e.message,
              error: rejected ? e.message : `${e.message}。请先核对生成记录，避免重复提交计费。`,
            },
          ),
        context,
      )
      if (isCurrent(context)) error.value = e.message
      if (kind === 'video' && !rejected) void recoverVideoSubmission(context, shotId, itemId)
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
              duration: kind === 'video' ? mediaSize?.duration || Number(entry.request?.durationSeconds) || 15 : undefined,
              ...(kind === 'video' ? { requestedDuration: Number(entry.request?.durationSeconds) || 15 } : {}),
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

  const reviewJob = (task, shotId, kind = 'handoff') => shotId ? task?.shots.find(shot => shot.id === shotId)?.[kind === 'timeline' ? 'wholeReview' : 'motionObservation'] : task?.continuityReview
  function changeReview(context, shotId, fn, kind = 'handoff') {
    const field = kind === 'timeline' ? 'wholeReview' : 'motionObservation'
    if (shotId) shotChange(shotId, shot => { if (shot[field]) fn(shot[field]) }, context, false)
    else change(task => { if (task.continuityReview) fn(task.continuityReview) }, context, false)
  }
  async function pollReview(context, entry, shotId = '', kind = 'handoff') {
    const key = `review:${operationKey(context)}:${entry.id}`
    if (pending.has(key)) return
    pending.add(key)
    try {
      const result = await request(`/api/product-videos/continuity-reviews/${entry.id}`)
      const previous = reviewJob(getTask(context), shotId, kind)
      if (isCurrent(context) && previous?.submissionErrorMessage && error.value === previous.submissionErrorMessage
        && ['queued', 'processing', 'completed'].includes(result.status)) error.value = ''
      changeReview(context, shotId, job => { if (job.id === entry.id) Object.assign(job, result, { pollError: '', error: result.error || '' }) }, kind)
    } catch (e) {
      changeReview(context, shotId, job => {
        if (job.id !== entry.id) return
        job.pollError = e.status === 404 ? '检查尚未找到，请核对原提交' : e.message
        if (e.status === 404) job.status = 'unknown'
      }, kind)
    } finally { pending.delete(key) }
  }
  async function startContinuityReview(shotId = '', kind = 'handoff') {
    const context = captureTask(), task = getTask(context)
    const shot = shotId ? task?.shots.find(item => item.id === shotId) : null
    if (!task || shotId && !shot || !capabilities.value?.continuityReview || kind === 'timeline' && !capabilities.value?.wholeTimelineReview) return
    const existing = reviewJob(task, shotId, kind)
    if (reviewRunning(existing)) return
    let entry, posted = false, submitKey = ''
    const key = `review:${operationKey(context)}:${existing?.status === 'unknown' ? existing.id : 'new'}`
    if (pending.has(key)) return
    pending.add(key)
    if (isCurrent(context)) error.value = ''
    try {
      if (existing?.status === 'unknown' && existing.snapshot) entry = copy(existing)
      else {
        const id = globalThis.crypto?.randomUUID?.()
        if (!id) throw new Error('当前浏览器无法创建安全的检查编号')
        const snapshot = kind === 'timeline' ? buildWholeVideoReview(task, id, shot) : buildContinuityReview(task, id, shot)
        entry = { id, status: 'submitting', progress: 0, stage: '提交检查', results: [], issues: [], acknowledged: [],
          wholeAcknowledged: false, confirmed: false, sourceKey: snapshot.sourceKey, fingerprint: snapshot.fingerprint,
          targetMotion: shot?.motion || '', snapshot: snapshot.request }
      }
      submitKey = `review:${operationKey(context)}:${entry.id}`
      pending.add(submitKey)
      if (shotId) shotChange(shotId, item => {
        const field = kind === 'timeline' ? 'wholeReview' : 'motionObservation'
        if (item[field] && item[field].id !== entry.id) {
          item[`${field}History`] ||= []
          item[`${field}History`].push(item[field])
        }
        item[field] = entry
        if (kind === 'timeline' && item.wholeManualApproval) {
          item.wholeManualApprovalHistory ||= []
          item.wholeManualApprovalHistory.push(item.wholeManualApproval); item.wholeManualApproval = null
        }
      }, context)
      else change(data => {
        if (data.continuityReview && data.continuityReview.id !== entry.id) {
          data.continuityReviewHistory ||= []
          data.continuityReviewHistory.push(data.continuityReview)
        }
        data.continuityReview = entry
        data.compositionEditing = true
        if (data.manualContinuityApproval) {
          data.manualContinuityApprovalHistory ||= []
          data.manualContinuityApprovalHistory.push(data.manualContinuityApproval)
          data.manualContinuityApproval = null
        }
      }, context)
      await canvas.flushNow(context.docId)
      if (reviewJob(getTask(context), shotId, kind)?.id !== entry.id) return
      posted = true
      const result = await request('/api/product-videos/continuity-reviews', entry.snapshot)
      changeReview(context, shotId, job => { if (job.id === entry.id) Object.assign(job, result, { error: '', pollError: '' }) }, kind)
    } catch (e) {
      if (entry) changeReview(context, shotId, job => {
        if (job.id !== entry.id) return
        job.status = posted && ![400, 401, 403, 409].includes(e.status) ? 'unknown' : 'failed'
        job.error = e.message
        if (posted) job.submissionErrorMessage = e.message
      }, kind)
      if (isCurrent(context)) error.value = e.message
    } finally { pending.delete(key); if (submitKey) pending.delete(submitKey) }
    if (posted && entry && reviewJob(getTask(context), shotId, kind)?.status === 'unknown') void pollReview(context, entry, shotId, kind)
  }
  async function cancelContinuityReview(shotId = '', kind = 'handoff') {
    const context = captureTask(), entry = reviewJob(getTask(context), shotId, kind)
    if (!entry?.id || !reviewRunning(entry)) return
    try {
      const result = await request(`/api/product-videos/continuity-reviews/${entry.id}/cancel`, {})
      changeReview(context, shotId, job => { if (job.id === entry.id) Object.assign(job, result) }, kind)
    } catch (e) { if (isCurrent(context)) error.value = `未能停止检查：${e.message}` }
  }

  async function poll() {
    if (disposed) return
    for (const task of tasks.value) {
      const context = { docId: canvasId.value, taskId: task.id, userId: user.profile?.id }
      if (task.continuityReview?.id && reviewRunning(task.continuityReview)) void pollReview(context, copy(task.continuityReview))
      if (task.planJob?.id && (isPlanRunning(task.planJob) || task.planJob.status === 'unknown'))
        void pollPlan(context, copy(task.planJob))
      for (const shot of task.shots) {
        if (shot.wholeReview?.id && reviewRunning(shot.wholeReview)) void pollReview(context, copy(shot.wholeReview), shot.id, 'timeline')
        if (shot.motionObservation?.id && reviewRunning(shot.motionObservation)) void pollReview(context, copy(shot.motionObservation), shot.id)
        for (const kind of ['image', 'video']) {
          for (const entry of shot[kind === 'image' ? 'images' : 'videos']) {
            if (entry.taskId && entry.status === 'processing')
              void pollEntry(context, shot.id, kind, copy(entry))
            else if (kind === 'video' && entry.status === 'unknown' && !entry.taskId)
              void recoverVideoSubmission(context, shot.id, entry.id)
          }
        }
      }
      const entry = task.composition
      if (entry?.id && ['queued', 'processing'].includes(entry.status))
        void pollComposition(context, copy(entry))
      if (task.batchVideoJob && ['running', 'waiting_confirmation', 'waiting_submission'].includes(task.batchVideoJob.status))
        void pumpBatch(context)
    }
  }

  function batchConfig(task, ids) {
    return productVideoBatchConfiguration({ ...task,
      videoModel: availableVideoModelOption(task.videoModel)?.value || '',
      wholeVideo30Model: availableVideoModelOption(task.wholeVideo30Model, wholeVideo30ModelOptions.value)?.value || '',
    }, ids)
  }
  function startBatchGeneration(ids, expectedConfig, context = captureTask()) {
    const task = getTask(context)
    if (!task || !capabilities.value?.videoSubmissionRecovery) return
    if (['running', 'waiting_confirmation', 'waiting_submission'].includes(task.batchVideoJob?.status)) return
    if (batchConfig(task, ids) !== expectedConfig) { error.value = '批量设置已改变，请重新确认生成'; return }
    change(data => { data.batchVideoJob = { id: uid(), shotIds: ids, config: expectedConfig, status: 'running', stage: '等待生成', error: '' } }, context)
    void pumpBatch(context)
  }
  function cancelBatch(context = captureTask()) {
    change(data => { if (data.batchVideoJob) Object.assign(data.batchVideoJob,
      { status: 'cancelled', stage: '后续提交已停止', error: '' }) }, context)
  }
  async function prepareBatchConnection(context, shotId, batchId) {
    const task = getTask(context), shot = task?.shots.find(item => item.id === shotId)
    const source = previousShotTailSource(task, shot)
    if (!source) return false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000)
    try {
      const frame = await extractReferenceVideoFrame(source.url, source.time, { signal: controller.signal })
      const url = await uploadFileDirect(frame.file, { dir: 'product-video/shot-connections', signal: controller.signal })
      const current = getTask(context), target = current?.shots.find(item => item.id === shotId)
      if (disposed || !target || current.batchVideoJob?.id !== batchId || current.batchVideoJob.status === 'cancelled'
        || previousShotTailSource(current, target)?.sourceKey !== source.sourceKey) return false
      shotChange(shotId, item => {
        item.connectionFrame = { ...source, url, sourceUrl: source.url, time: frame.time }
        const image = { id: uid(), url, status: 'completed', source: 'shot-connection', sourceConnectionKey: source.sourceKey }
        item.images.push(image)
        pickImage(item, image.id)
      }, context)
      return true
    } finally { clearTimeout(timeout) }
  }
  async function pumpBatch(context) {
    if (disposed || capabilitiesLoading.value || !capabilities.value?.videoSubmissionRecovery) return
    const task = getTask(context), job = task?.batchVideoJob
    if (!job || !['running', 'waiting_confirmation', 'waiting_submission'].includes(job.status)) return
    const key = `batch:${operationKey(context)}`
    if (pending.has(key)) return
    pending.add(key)
    const update = (patch) => change(data => {
      if (data.batchVideoJob?.id === job.id) Object.assign(data.batchVideoJob, patch)
    }, context, false)
    try {
      if (batchConfig(task, job.shotIds) !== job.config) { update({ status: 'paused', stage: '模型或脚本已改变', error: '' }); return }
      const shots = job.shotIds.map(id => task.shots.find(item => item.id === id))
      if (shots.some(shot => !shot)) { update({ status: 'paused', stage: '分镜已移除' }); return }
      if (shots.some(shot => batchVideoState(shot, job.id) === 'unknown')) {
        update({ status: 'waiting_submission', stage: '正在核对提交结果' }); return
      }
      if (shots.some(shot => batchVideoState(shot, job.id) === 'failed')) {
        update({ status: 'failed', stage: '部分视频生成失败', error: '已完成素材保留，重试前请重新确认费用' }); return
      }
      if (shots.every(shot => batchVideoState(shot, job.id) === 'completed')) {
        update({ status: 'completed', stage: '批量生成已完成', error: '' }); return
      }
      const inFlight = task.shots.reduce((count, shot) => count + shot.videos.filter(
        entry => ['submitting', 'processing'].includes(entry.status)).length, 0)
      let slots = Math.max(0, 2 - inFlight)
      const submissions = []
      let waiting = ''
      for (const shot of shots) {
        if (!slots || getTask(context)?.batchVideoJob?.id !== job.id || getTask(context)?.batchVideoJob?.status === 'cancelled') break
        if (batchVideoState(shot, job.id) !== 'ready') continue
        if (shotConnection(task, shot).type === 'continue' && !isWholeVideo(shot.productionMode)) {
          const previous = adjacentProductVideoShots(task, shot).previous
          if (!previous || !previousShotTailSource(task, shot)) { waiting = '等待前镜完成'; continue }
          const frame = usableShotConnectionFrame(task, shot)
          const image = shot.images.find(item => item.id === shot.imageId)
          if (!frame || image?.sourceConnectionKey !== frame.sourceKey) {
            update({ stage: `正在提取「${shot.title}」衔接帧` })
            if (!await prepareBatchConnection(context, shot.id, job.id)) { waiting = '前镜已改变，等待更新'; continue }
          }
        }
        if (!canGenerateVideo(shot)) { waiting = `「${shot.title}」待确认首帧`; continue }
        if (capabilities.value?.continuityReview && motionObservationRequired(task, shot) && !usableMotionObservation(task, shot)) {
          waiting = `「${shot.title}」待确认实际动作`; continue
        }
        const live = getTask(context)
        if (live?.batchVideoJob?.id !== job.id || live.batchVideoJob.status === 'cancelled') break
        if (batchConfig(live, job.shotIds) !== job.config) { update({ status: 'paused', stage: '模型或脚本已改变' }); break }
        slots--
        submissions.push(generate(shot.id, 'video', context, job.id))
      }
      if (getTask(context)?.batchVideoJob?.id === job.id && !['cancelled', 'paused'].includes(getTask(context)?.batchVideoJob?.status))
        update({ status: waiting.includes('待确认') ? 'waiting_confirmation' : 'running', stage: waiting || '视频生成中' })
      await Promise.all(submissions)
    } catch (e) {
      if (getTask(context)?.batchVideoJob?.status !== 'cancelled')
        update({ status: 'failed', stage: '批量生成已暂停', error: e.message })
    }
    finally { pending.delete(key) }
  }

  async function recoverVideoSubmission(context, shotId, itemId) {
    const entry = getTask(context)?.shots.find((shot) => shot.id === shotId)?.videos.find((item) => item.id === itemId)
    if (!entry || entry.status !== 'unknown' || entry.taskId || !entry.request?.client_task_id) return
    const key = `recover-video:${operationKey(context)}:${itemId}`
    if (pending.has(key)) return
    pending.add(key)
    try {
      const result = await request(`/api/video-tasks/by-client-task-id?client_task_id=${encodeURIComponent(entry.request.client_task_id)}`)
      if (result?.taskId && isCurrent(context) && error.value === entry.submissionErrorMessage) error.value = ''
      shotChange(shotId, (shot) => {
        const item = shot.videos.find((value) => value.id === itemId)
        if (!item || item.status !== 'unknown' || item.taskId) return
        if (result?.taskId) Object.assign(item, { taskId: result.taskId, status: 'processing', error: '', pollError: '' })
        else if (result?.status === 'failed') Object.assign(item, { status: 'failed', error: result.error || '提交被拒绝，未创建视频任务' })
        else item.pollError = result?.exists === false
          ? '尚未查到提交记录，请核对生成记录；重试会使用原请求编号'
          : '正在确认原任务，不会重复提交'
      }, context, false)
      void canvas.flushNow(context.docId)
    } catch (error) {
      shotChange(shotId, (shot) => {
        const item = shot.videos.find((value) => value.id === itemId)
        if (item?.status === 'unknown') item.pollError = `提交查询中断：${error.message}`
      }, context, false)
    } finally { pending.delete(key) }
  }

  async function retryVideoSubmission(shotId, itemId, context = captureTask()) {
    if (!capabilities.value?.videoSubmissionRecovery) return
    const entry = getTask(context)?.shots.find((shot) => shot.id === shotId)?.videos.find((item) => item.id === itemId)
    if (!entry?.submissionTracked || entry.status !== 'unknown' || entry.taskId || !entry.request?.client_task_id) return
    const key = `recover-video:${operationKey(context)}:${itemId}`
    if (pending.has(key)) return
    pending.add(key)
    try {
      const result = await request('/api/video-tasks', entry.request)
      const taskId = result?.taskId || result?.task_id
      if (!taskId) throw new Error('任务编号仍未确认')
      if (isCurrent(context) && error.value === entry.submissionErrorMessage) error.value = ''
      shotChange(shotId, (shot) => {
        const item = shot.videos.find((value) => value.id === itemId)
        if (item) Object.assign(item, { taskId, status: 'processing', error: '', pollError: '' })
      }, context)
      void canvas.flushNow(context.docId)
      void poll()
    } catch (e) { if (isCurrent(context)) error.value = e.message }
    finally { pending.delete(key) }
  }

  async function recoverUnknownImageSubmissions() {
    const staleAfterMs = 60_000
    for (const task of tasks.value) {
      const context = { docId: canvasId.value, taskId: task.id, userId: user.profile?.id }
      for (const shot of task.shots) {
        const unresolved = shot.images.filter(
          (item) =>
            item.status === 'unknown' &&
            !item.taskId &&
            (/^请求失败（502）/.test(item.error || '') ||
              imageSubmissionRejected({ status: 503, message: item.error })),
        )
        for (const entry of unresolved) {
          const clientTaskId = entry.request?.client_task_id || entry.id
          const key = `recover:${operationKey(context)}:${entry.id}`
          if (pending.has(key)) continue
          pending.add(key)
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
            if (imageSubmissionRejected({ status: 503, message: entry.error })) {
              if (result?.exists !== false) continue
              shotChange(
                shot.id,
                (current) => {
                  const item = current.images.find((candidate) => candidate.id === entry.id)
                  if (!item || item.status !== 'unknown' || item.taskId) return
                  item.status = 'failed'
                  item.error = '凭证中心主密钥未配置'
                },
                context,
              )
              void canvas.flushNow(context.docId)
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
          } finally {
            pending.delete(key)
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
      for (const shot of workflow.value.shots.filter(item => item.kept)) {
        const issue = wholeVideoReviewIssue(workflow.value, shot, capabilities.value?.wholeTimelineReview === true)
        if (issue) throw new Error(issue)
      }
      const reviewIssue = continuityReviewIssue(workflow.value, capabilities.value?.continuityReview === true)
      if (reviewIssue) throw new Error(reviewIssue)
      if (payload.smoothAudio && !capabilities.value?.audioSmoothing) delete payload.smoothAudio
      if (payload.resolution && !capabilities.value?.compositionResolutions?.includes(payload.resolution))
        throw new Error('当前合成服务尚未支持所选导出画质，请刷新模型列表')
      if (payload.keepOriginalAudio && !capabilities.value?.synchronizedAudio)
        throw new Error('当前合成服务尚未支持保留原声，请更新后端后重新打开工作区')
      if (
        payload.clips.some((clip) => clip.timingMode === 'speed') &&
        !capabilities.value?.clipSpeed
      )
        throw new Error('当前合成服务尚未支持整段加速，请更新后端服务后重新打开工作区')
      const fingerprint = compositionFingerprint(workflow.value)
      if (capabilities.value?.continuityReview && !currentManualContinuityApproval(workflow.value) && currentContinuityReview(workflow.value))
        payload.continuityReviewId = workflow.value.continuityReview.id
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
      const context = { docId: canvasId.value, taskId: task.id, userId: user.profile?.id }
      if (task.continuityReview?.id && task.continuityReview.status === 'unknown') void pollReview(context, copy(task.continuityReview))
      for (const shot of task.shots) if (shot.motionObservation?.id && shot.motionObservation.status === 'unknown')
        void pollReview(context, copy(shot.motionObservation), shot.id)
      for (const shot of task.shots) if (shot.wholeReview?.id && ['unknown', 'submitting'].includes(shot.wholeReview.status)) {
        if (shot.wholeReview.status === 'submitting') shotChange(shot.id, item => { item.wholeReview.status = 'unknown' }, context, false)
        void pollReview(context, copy(shot.wholeReview), shot.id, 'timeline')
      }
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
    capabilitiesLoading,
    capabilitiesError,
    planningModelOptions,
    imageModelOptions,
    selectedImageModelValue,
    effectiveImageModel,
    imageModelIsMapped,
    videoModelOptions,
    wholeVideo15ModelOptions,
    wholeVideo30ModelOptions,
    effectiveWholeVideo15Model,
    effectiveWholeVideo30Model,
    effectiveVideoModel,
    videoModelIsMapped,
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
    retryVideoSubmission,
    batchConfig,
    startBatchGeneration,
    cancelBatch,
    startContinuityReview,
    cancelContinuityReview,
    compose,
  }
}
