import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import { useCanvasV3GraphStore } from './graph'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { uploadBase64ImageDirect } from '../../../utils/ossUpload'
import {
  createImageTaskClient,
  imageTaskRequest,
  imageTaskResult,
  imageTaskBatchResult,
  imageTaskQueryFailure,
  imageModelOptions,
} from '../sync/imageTaskClient'
import { IMAGE_TASK_ACTIVE_STATES, IMAGE_TASK_POLLABLE_STATES } from '../config/imageTaskState'
import { imageModelParams } from '../config/imageModelParameters.js'
import {
  createVideoTaskClient,
  videoTaskRequest,
  videoTaskResult,
} from '../sync/videoTaskClient.js'
import {
  isSeedance25Model,
  isMinimaxH3Model,
  isSeedance20AnciModel,
} from '../config/videoModelParameters.js'
import { deriveVideoInputMode } from '../config/videoInputMode.js'
import { isKling30Model, klingVideoMode } from '../config/klingVideoModes.js'
import { isKlingOmniApiModel } from '../config/klingOmniIdentity.js'
import { resolveKlingOmniRoute } from '../config/klingOmniRoutes.js'
import { isWanxiangModel } from '../config/wanxiangParameters.js'
import { assertWanxiangRequestReady, resolveWanxiangRoute } from '../sync/wanxiangTaskRequest.js'
import {
  imageGenerationTarget,
  imageReferences,
  preserveLegacyImageTask,
} from '../sync/imageGenerationTarget'

const ACTIVE = new Set(IMAGE_TASK_ACTIVE_STATES)
const POLLABLE = new Set(IMAGE_TASK_POLLABLE_STATES)
export const useCanvasV3TaskStore = defineStore('canvas-v3-tasks', () => {
  const graph = useCanvasV3GraphStore()
  const user = useUserStore()
  const imageModels = ref([])
  const videoModels = ref([])
  const videoModelError = ref('')
  const modelError = ref('')
  const tasks = ref({})
  const activeTasks = computed(() =>
    Object.values(tasks.value).filter((task) => ACTIVE.has(task.state)),
  )
  const client = createImageTaskClient({ path: apiPath, headers: () => user.authHeaders() })
  const videoClient = createVideoTaskClient({ path: apiPath, headers: () => user.authHeaders() })
  const submissions = new Map()
  let modelRequest
  let videoModelRequest
  let project = ''
  let beforeImageSubmit = null
  let timer
  let polling = false
  const find = (id) => graph.nodes.find((node) => node.id === id)
  function patch(id, data, expectedProject = project) {
    if (expectedProject !== graph.projectId) return
    graph.updateNodeData(id, data)
  }
  async function loadModels(force = false) {
    if (modelRequest && !force) return modelRequest
    modelRequest = (async () => {
      try {
        const catalog = await client.models()
        let options =
          catalog.options || (catalog.models || []).map((value) => ({ value, label: value }))
        if (!options.length && !catalog.mappingConfigured) {
          const status = await client.status()
          if (status.configured)
            options = [...new Set([status.defaultModel, ...(status.configuredModels || [])])]
              .filter(Boolean)
              .map((value) => ({ value, label: value }))
        }
        imageModels.value = imageModelOptions(options)
        modelError.value = options.length ? '' : '当前项目尚未配置图片生成模型'
      } catch (error) {
        modelError.value = error.message
      }
      return imageModels.value
    })()
    return modelRequest
  }
  async function loadVideoModels(force = false) {
    if (videoModelRequest && !force) return videoModelRequest
    videoModelRequest = (async () => {
      try {
        const catalog = await videoClient.models()
        const options = Array.isArray(catalog) ? catalog : catalog.options || []
        videoModels.value = options.filter(
          (option) =>
            isSeedance25Model(option) ||
            isMinimaxH3Model(option) ||
            isSeedance20AnciModel(option) ||
            isWanxiangModel(option) ||
            isKlingOmniApiModel(option),
        )
        videoModelError.value = videoModels.value.length
          ? ''
          : '请先在模型管理中配置视频模型并绑定画布视频功能'
      } catch (error) {
        videoModelError.value = error.message
      }
      return videoModels.value
    })()
    return videoModelRequest
  }
  const transport = (node) => (node.data.kind === 'video' ? videoClient : client)
  function schedule() {
    clearTimeout(timer)
    if (
      project &&
      graph.nodes.some(
        (node) =>
          node.data.runState !== 'preparing' &&
          (POLLABLE.has(node.data.runState) || node.data.generation?.persistPending) &&
          node.data.generation?.taskIds?.length,
      )
    )
      timer = setTimeout(
        poll,
        graph.nodes.some((node) => node.data.kind === 'image' && POLLABLE.has(node.data.runState))
          ? 2500
          : 5000,
      )
  }
  async function poll() {
    if (polling || !project) return
    const scope = project
    polling = true
    try {
      for (const node of [...graph.nodes]) preserveLegacyImageTask(graph, node.id)
      const nodes = graph.nodes.filter(
        (node) =>
          node.data.runState !== 'preparing' &&
          (POLLABLE.has(node.data.runState) || node.data.generation?.persistPending) &&
          node.data.generation?.taskIds?.length,
      )
      await Promise.allSettled(
        nodes.map(async (node) => {
          const generationId = node.data.generation.clientTaskId
          try {
            const results = await Promise.all(
              node.data.generation.taskIds.map(async (id) => {
                const previous = node.data.generation.taskResults?.[id]
                if (
                  (previous?.state === 'succeeded' && !previous.persistPending) ||
                  (previous?.state === 'unavailable' && !previous.retryable)
                )
                  return previous
                try {
                  const payload = await transport(node).get(id)
                  return {
                    ...(node.data.kind === 'video'
                      ? videoTaskResult(payload)
                      : imageTaskResult(payload)),
                    taskId: id,
                  }
                } catch (error) {
                  return imageTaskQueryFailure(error, id)
                }
              }),
            )
            const current = find(node.id)
            if (
              scope !== project ||
              !current ||
              current.data.runState === 'preparing' ||
              current.data.generation?.clientTaskId !== generationId
            )
              return
            const batch = imageTaskBatchResult(results, current.data.progress)
            if (current.data.kind === 'video' && !batch.queryMessage)
              batch.queryMessage = results.find((result) => result.stage)?.stage || ''
            const { urls, progress } = batch
            const generation = {
              ...current.data.generation,
              results: urls,
              taskResults: Object.fromEntries(results.map((result) => [result.taskId, result])),
              unresolvedTaskIds: batch.unresolvedTaskIds,
              queryPending: batch.unresolvedTaskIds.length > 0,
              persistPending: batch.persistPending,
            }
            if (batch.state === 'succeeded') {
              const candidates = [
                ...(current.data.kind === 'video' &&
                current.data.assetUrl &&
                !current.data.candidates?.some((item) => item.url === current.data.assetUrl)
                  ? [{ url: current.data.assetUrl, createdAt: Date.now() }]
                  : []),
                ...(current.data.candidates || []).filter(
                  (item) => item.generationId !== generationId,
                ),
                ...urls.map((url) => ({
                  url,
                  generationId,
                  taskIds: generation.taskIds,
                  prompt: generation.prompt,
                  model: generation.model,
                  createdAt: Date.now(),
                })),
              ]
              patch(
                node.id,
                {
                  generation,
                  runState: 'succeeded',
                  progress: 100,
                  assetUrl: urls[0],
                  candidates,
                  artifactStatus: 'ready',
                  statusText: batch.queryMessage,
                  error: batch.error,
                },
                scope,
              )
            } else if (batch.state === 'blocked') {
              patch(
                node.id,
                {
                  generation,
                  runState: 'uncertain',
                  statusText: batch.queryMessage,
                  error: '',
                },
                scope,
              )
            } else if (batch.state === 'failed') {
              patch(
                node.id,
                {
                  generation,
                  runState: 'failed',
                  error: batch.error || '生成失败，请调整参数后重试',
                },
                scope,
              )
            } else if (current.data.runState !== 'paused') {
              patch(
                node.id,
                {
                  generation,
                  runState: results.every((result) => result.state === 'queued')
                    ? 'queued'
                    : 'running',
                  progress,
                  statusText: batch.queryMessage,
                  ...(urls.length ? { assetUrl: urls[0] } : {}),
                },
                scope,
              )
            } else {
              patch(node.id, { generation, progress }, scope)
            }
          } catch (error) {
            const current = find(node.id)
            if (
              scope !== project ||
              !current ||
              current.data.runState === 'preparing' ||
              current.data.runState === 'paused' ||
              current.data.generation?.clientTaskId !== generationId
            )
              return
            patch(
              node.id,
              {
                runState: 'uncertain',
                statusText: '任务结果处理异常，已保留原任务编号，请继续查询，不要重复生成。',
                generation: { ...current.data.generation, queryPending: true },
              },
              scope,
            )
            console.error('[CanvasV3] image task result processing failed', error)
          }
        }),
      )
    } finally {
      polling = false
      schedule()
    }
  }
  async function resume(nodeId) {
    const node = find(nodeId)
    if (!node?.data.generation) return
    const scope = project
    const generation = node.data.generation
    if (!generation.taskIds?.length) {
      try {
        const result = await transport(node).resolve(generation.clientTaskId)
        if (node.data.kind === 'video' && result.exists && result.status === 'failed') {
          patch(
            nodeId,
            {
              runState: 'failed',
              error: result.error || '视频提交已被拒绝，未创建生成任务',
              statusText: '',
            },
            scope,
          )
          return
        }
        const taskIds = (result.tasks || [])
          .map((task) => task.taskId || task.task_id)
          .filter(Boolean)
        const taskId = result.taskId || result.task_id
        if (!taskIds.length && taskId) taskIds.push(taskId)
        if (!result.exists || !taskIds.length) {
          patch(
            nodeId,
            { statusText: '原任务结果尚未确认，请稍后继续查询；不会重新提交或重复扣费。' },
            scope,
          )
          return
        }
        patch(nodeId, { generation: { ...generation, taskIds } }, scope)
      } catch (error) {
        patch(nodeId, { statusText: error.message }, scope)
        return
      }
    }
    const latestGeneration = find(nodeId)?.data.generation || generation
    patch(
      nodeId,
      {
        runState: 'running',
        statusText: '',
        error: '',
        generation: {
          ...latestGeneration,
          taskResults: Object.fromEntries(
            Object.entries(latestGeneration.taskResults || {}).filter(
              ([, result]) => !result.queryIssue,
            ),
          ),
        },
      },
      scope,
    )
    schedule()
  }
  function runImage(nodeId, onTarget, options = {}) {
    const source = find(nodeId)
    if (!source || source.data.kind !== 'image') return
    if (!user.requireLogin()) {
      patch(nodeId, { error: '请先登录有米账号后生成图片' })
      return
    }
    const recovered = preserveLegacyImageTask(graph, nodeId)
    const target = recovered.id !== nodeId ? recovered : imageGenerationTarget(graph, nodeId)
    if (!target) return
    const pending = runImageTarget(target.id, options)
    if (target.id !== nodeId) onTarget?.(target)
    return pending
  }
  async function runVideo(nodeId) {
    const node = find(nodeId)
    if (
      !node ||
      node.data.kind !== 'video' ||
      submissions.has(nodeId) ||
      ACTIVE.has(node.data.runState)
    )
      return
    if (
      (['paused', 'uncertain'].includes(node.data.runState) ||
        node.data.generation?.unresolvedTaskIds?.length) &&
      node.data.generation
    ) {
      await resume(nodeId)
      return
    }
    if (!user.requireLogin()) {
      patch(nodeId, { error: '请先登录有米账号后生成视频' })
      return
    }
    const scope = project
    const operation = {
      scope,
      phase: 'preparing',
      createAttempted: false,
      controller: new AbortController(),
    }
    submissions.set(nodeId, operation)
    const isCurrent = () =>
      submissions.get(nodeId) === operation &&
      !operation.controller.signal.aborted &&
      scope === project &&
      scope === graph.projectId &&
      Boolean(find(nodeId))
    try {
      const references = imageReferences(node, graph.nodes, graph.edges).map((reference) => ({
        ...reference,
        data: {
          ...reference.data,
          generation: reference.data.generation
            ? { ...reference.data.generation, params: { ...reference.data.generation.params } }
            : undefined,
        },
      }))
      const requestNode = {
        data: {
          ...node.data,
          params: { ...node.data.params },
          switches: { ...node.data.switches },
        },
      }
      const clientTaskId = crypto.randomUUID()
      patch(
        nodeId,
        {
          runState: 'preparing',
          progress: null,
          error: '',
          statusText: '正在准备视频任务，检查模型配置…',
        },
        scope,
      )
      await nextTick()
      if (!isCurrent()) return
      await loadVideoModels()
      if (!isCurrent()) return
      let option = videoModels.value.find((item) => item.value === requestNode.data.model)
      const omni =
        isKling30Model(requestNode.data.model) ||
        isKlingOmniApiModel(option || requestNode.data.model)
      const wanxiang = isWanxiangModel(option || requestNode.data.model)
      if (wanxiang) {
        option = resolveWanxiangRoute(requestNode.data.model, videoModels.value)
      } else if (omni) {
        requestNode.data.mode = klingVideoMode(requestNode.data.mode).label
        option = resolveKlingOmniRoute(
          requestNode.data.model,
          requestNode.data.mode,
          videoModels.value,
        )
      } else if (!option) {
        const family = isSeedance25Model(requestNode.data.model)
          ? isSeedance25Model
          : isMinimaxH3Model(requestNode.data.model)
            ? isMinimaxH3Model
            : isSeedance20AnciModel(requestNode.data.model)
              ? isSeedance20AnciModel
              : null
        const choices = family ? videoModels.value.filter(family) : []
        if (choices.length > 1) throw new Error('该模型配置了多条线路，请在模型列表中明确选择一条')
        option = choices[0]
      }
      if (!option)
        throw new Error(videoModelError.value || '所选视频模型未接入当前画布，请检查模型配置')
      requestNode.data.model = option.value
      const request = videoTaskRequest(requestNode, references, clientTaskId, option)
      const inputMode = wanxiang
        ? { mode: '全能参考', id: 'omni' }
        : omni
          ? { mode: requestNode.data.mode, id: requestNode.data.mode }
          : deriveVideoInputMode(option, references)
      const imageSlots = [
        ...request.reference_image_urls.map((url, index) => ({
          url,
          set: (value) => {
            request.reference_image_urls[index] = value
            if (wanxiang) request.wanxiang_params.image_url[index] = value
          },
        })),
        ...['first_frame_url', 'last_frame_url']
          .filter((key) => request[key])
          .map((key) => ({
            url: request[key],
            set: (value) => {
              request[key] = value
            },
          })),
      ]
      for (const slot of imageSlots) {
        if (!slot.url.startsWith('data:')) continue
        patch(nodeId, { statusText: '正在上传视频参考图片…' }, scope)
        await nextTick()
        if (!isCurrent()) return
        const uploaded = await uploadBase64ImageDirect(slot.url, {
          dir: 'youmi-canvas/uploads',
          signal: operation.controller.signal,
        })
        if (!isCurrent()) return
        const url = typeof uploaded === 'string' ? uploaded : uploaded.url
        if (!url) throw new Error('参考图上传未返回地址')
        slot.set(url)
      }
      if (wanxiang) assertWanxiangRequestReady(request)
      if (!isCurrent()) return
      operation.phase = 'submitting'
      patch(
        nodeId,
        {
          runState: 'submitting',
          statusText: '正在提交视频任务…',
          error: '',
          generation: {
            kind: 'video',
            clientTaskId,
            taskIds: [],
            prompt: request.prompt,
            model: request.model,
            mode: inputMode.mode,
            inputMode: inputMode.id,
            parameterProfile: request.parameter_profile,
            params: wanxiang
              ? { ...request.wanxiang_params }
              : omni
                ? { ...request.omni_params }
                : {
                    ratio: request.ratio === 'adaptive' ? 'Auto' : request.ratio,
                    resolution: request.resolution.toUpperCase(),
                    duration: request.durationSeconds,
                    ...(request.version ? { version: request.version } : {}),
                  },
            inputs: {
              firstFrameUrl: request.first_frame_url || '',
              lastFrameUrl: request.last_frame_url || '',
              referenceImageUrls: [...request.reference_image_urls],
              referenceVideos: request.reference_videos.map((item) => ({ ...item })),
              referenceAudios: [...request.reference_audios],
              ...(wanxiang
                ? {
                    referenceAudioMedia: request.reference_audio_media.map((item) => ({ ...item })),
                  }
                : {}),
            },
            startedAt: Date.now(),
          },
        },
        scope,
      )
      try {
        await nextTick()
        if (!isCurrent()) return
        if (
          beforeImageSubmit &&
          (await beforeImageSubmit({ nodeId, clientTaskId, kind: 'video' })) === false
        )
          throw new Error('无法安全保存视频任务标识，本次尚未提交生成任务')
        if (!isCurrent()) return
        operation.createAttempted = true
        const response = await videoClient.create(request)
        if (!isCurrent()) return
        const taskId = response.taskId || response.task_id
        if (typeof taskId !== 'string' || !taskId) {
          const error = new Error('视频已提交但尚未取得任务编号，请继续查询原任务')
          error.deliveryUnknown = true
          throw error
        }
        const current = find(nodeId)
        patch(
          nodeId,
          {
            runState: current?.data.runState === 'paused' ? 'paused' : 'queued',
            statusText:
              current?.data.runState === 'paused'
                ? current.data.statusText
                : '视频任务已提交，排队中…',
            consumedMi: response.consumedMi,
            generation: { ...current?.data.generation, taskIds: [taskId] },
          },
          scope,
        )
        schedule()
      } catch (error) {
        if (!isCurrent()) return
        patch(
          nodeId,
          {
            runState: error.deliveryUnknown ? 'uncertain' : 'failed',
            error: error.deliveryUnknown ? '' : error.message,
            statusText: error.deliveryUnknown
              ? '视频提交结果尚未确认，请继续查询原任务，避免重复扣费。'
              : '',
            ...(!operation.createAttempted ? { generation: undefined } : {}),
          },
          scope,
        )
      }
    } catch (error) {
      if (isCurrent())
        patch(
          nodeId,
          { runState: 'failed', progress: null, statusText: '', error: error.message },
          scope,
        )
    } finally {
      if (submissions.get(nodeId) === operation) submissions.delete(nodeId)
    }
  }
  async function runImageTarget(nodeId, options = {}) {
    const node = find(nodeId)
    if (
      !node ||
      node.data.kind !== 'image' ||
      submissions.has(nodeId) ||
      ACTIVE.has(node.data.runState)
    )
      return
    if (
      (['paused', 'uncertain'].includes(node.data.runState) ||
        node.data.generation?.unresolvedTaskIds?.length) &&
      node.data.generation
    ) {
      await resume(nodeId)
      return
    }
    if (!user.requireLogin()) {
      patch(nodeId, { error: '请先登录有米账号后生成图片' })
      return
    }
    const scope = project
    const operation = {
      scope,
      phase: 'preparing',
      createAttempted: false,
      controller: new AbortController(),
    }
    submissions.set(nodeId, operation)
    const isCurrent = () =>
      submissions.get(nodeId) === operation &&
      !operation.controller.signal.aborted &&
      scope === project &&
      scope === graph.projectId &&
      Boolean(find(nodeId))
    try {
      const references = imageReferences(node, graph.nodes, graph.edges, { strict: true }).map(
        (reference) => ({ ...reference, data: { ...reference.data } }),
      )
      const clientTaskId = options.clientTaskId || crypto.randomUUID()
      const params = { ...node.data.params }
      const requestNode = { data: { ...node.data, switches: { ...node.data.switches }, params } }
      let request = imageTaskRequest(requestNode, references, clientTaskId)
      // Feedback and duplicate-submit protection precede ALL asynchronous work.
      // Preparation is not a submitted task, so never poll previous task IDs.
      patch(
        nodeId,
        {
          runState: 'preparing',
          progress: null,
          error: '',
          statusText: '正在准备生成任务，检查模型配置…',
        },
        scope,
      )
      await nextTick()
      if (!isCurrent()) return
      await loadModels()
      if (!isCurrent()) return
      const modelOption = imageModels.value.find((option) => option.value === request.model)
      if (!modelOption)
        throw new Error(
          modelError.value || '请选择当前项目已接入的模型；LibTV 的专有模型不能直接调用。',
        )
      // Resolve version from the same configured route that will receive the request.
      // Use the captured prompt/params so edits during preparation cannot change this task.
      request = imageTaskRequest(requestNode, references, clientTaskId, modelOption)
      const effectiveParams = imageModelParams(modelOption, params)
      if (request.custom_size) effectiveParams.customSize = request.custom_size
      Object.keys(params).forEach((key) => delete params[key])
      Object.assign(params, effectiveParams)
      const localImageCount = request.image_urls.filter((url) => url.startsWith('data:')).length
      let uploadingIndex = 0
      for (let i = 0; i < request.image_urls.length; i++) {
        if (request.image_urls[i].startsWith('data:')) {
          uploadingIndex += 1
          const message = `正在上传参考图（${uploadingIndex}/${localImageCount}）`
          patch(nodeId, { statusText: message + '…' }, scope)
          await nextTick()
          if (!isCurrent()) return
          const uploaded = await uploadBase64ImageDirect(request.image_urls[i], {
            dir: 'youmi-canvas/uploads',
            signal: operation.controller.signal,
            onProgress: ({ percent }) => {
              if (isCurrent()) patch(nodeId, { statusText: `${message} ${percent}%…` }, scope)
            },
          })
          if (!isCurrent()) return
          const url = typeof uploaded === 'string' ? uploaded : uploaded.url
          if (!url) throw new Error('参考图上传未返回地址')
          request.image_urls[i] = url
        }
      }
      if (!isCurrent()) return
      operation.phase = 'submitting'
      patch(
        nodeId,
        {
          runState: 'submitting',
          progress: null,
          error: '',
          statusText: '正在提交生成任务…',
          generation: {
            clientTaskId,
            taskIds: [],
            prompt: request.prompt,
            model: request.model,
            params,
            startedAt: Date.now(),
          },
        },
        scope,
      )
      try {
        await nextTick()
        if (!isCurrent()) return
        if (beforeImageSubmit) {
          const persisted = await beforeImageSubmit({ nodeId, clientTaskId })
          if (persisted === false)
            throw new Error('无法安全保存任务标识，请检查网络后重试；本次尚未提交生成任务')
        }
        if (!isCurrent()) return
        // The saved key protects a possibly dispatched request after a reload. Only this
        // live operation can prove that persistence failed before create was attempted.
        // Once this boundary is crossed, retain the key even if the response is unknown.
        operation.createAttempted = true
        options.onSubmitStart?.({ nodeId, clientTaskId })
        const response = await client.create(request)
        if (!isCurrent()) return
        const taskIds = (response.tasks || [])
          .map((task) => task.taskId || task.task_id)
          .filter(Boolean)
        if (!taskIds.length) {
          const error = new Error('任务已提交，但尚未取得任务编号，请继续查询原任务')
          error.deliveryUnknown = true
          throw error
        }
        const current = find(nodeId)
        patch(
          nodeId,
          {
            runState: current?.data.runState === 'paused' ? 'paused' : 'queued',
            statusText:
              current?.data.runState === 'paused' ? current.data.statusText : '任务已提交，排队中…',
            consumedMi: response.consumedMi,
            generation: { ...current?.data.generation, taskIds },
          },
          scope,
        )
        schedule()
      } catch (error) {
        if (!isCurrent()) return
        patch(
          nodeId,
          {
            runState: error.deliveryUnknown ? 'uncertain' : 'failed',
            error: error.deliveryUnknown ? '' : error.message,
            statusText: error.deliveryUnknown
              ? '提交结果尚未确认，请继续查询原任务，避免重复扣费。'
              : '',
            // A failed pre-submit save is not a paid request. Do not let its provisional
            // key permanently lock Director confirmation or query a task that never ran.
            ...(!operation.createAttempted ? { generation: undefined } : {}),
          },
          scope,
        )
      }
    } catch (error) {
      if (isCurrent())
        patch(
          nodeId,
          { runState: 'failed', progress: null, statusText: '', error: error.message },
          scope,
        )
    } finally {
      // Cancellation may already have replaced this preparation with a new one.
      if (submissions.get(nodeId) === operation) submissions.delete(nodeId)
    }
  }
  function stopWaiting(nodeId) {
    const node = find(nodeId)
    if (!node || !ACTIVE.has(node.data.runState)) return
    if (node.data.runState === 'preparing') {
      const operation = submissions.get(nodeId)
      if (operation?.phase === 'preparing') {
        operation.controller.abort()
        submissions.delete(nodeId)
      }
      patch(nodeId, {
        runState: 'idle',
        progress: null,
        statusText: '已取消准备，未提交生成任务。',
      })
      return
    }
    patch(nodeId, {
      runState: 'paused',
      statusText: '已停止页面等待；后台任务可能继续执行，费用按原任务结算。可继续查询获取结果。',
    })
    schedule()
  }
  function attach(projectId, options = {}) {
    project = projectId
    beforeImageSubmit =
      typeof options.beforeImageSubmit === 'function' ? options.beforeImageSubmit : null
    for (const node of [...graph.nodes]) preserveLegacyImageTask(graph, node.id)
    for (const node of graph.nodes)
      if (node.data.runState === 'preparing')
        patch(node.id, {
          runState: 'idle',
          statusText: '上次准备已中断，任务尚未提交，可重新生成。',
          error: '',
        })
      else if (node.data.runState === 'submitting' && !node.data.generation?.taskIds?.length)
        patch(node.id, { runState: 'uncertain', statusText: '正在恢复任务，请继续查询原任务' })
    schedule()
    void loadModels()
  }
  function detach(projectId) {
    if (project === projectId) {
      for (const [nodeId, operation] of submissions)
        if (operation.scope === projectId && operation.phase === 'preparing') {
          operation.controller.abort()
          submissions.delete(nodeId)
        }
      project = ''
      beforeImageSubmit = null
      clearTimeout(timer)
    }
  }
  function upsert(task) {
    if (task?.id) tasks.value[task.id] = { ...tasks.value[task.id], ...task }
  }
  function remove(taskId) {
    delete tasks.value[taskId]
  }
  return {
    tasks,
    activeTasks,
    imageModels,
    videoModels,
    videoModelError,
    modelError,
    loadModels,
    loadVideoModels,
    runImage,
    runVideo,
    resume,
    stopWaiting,
    attach,
    detach,
    upsert,
    remove,
  }
})
