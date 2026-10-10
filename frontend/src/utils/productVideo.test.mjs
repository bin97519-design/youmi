import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  productVideoLibrary,
  newProductVideoTask,
  productVideoTaskState,
  queryProductVideoTasks,
  planningTimeoutMs,
  planningErrorMessage,
  normalizePromptLineBreaks,
  normalizeVideoPrompt,
  applyPlanningState,
  isPlanRunning,
  buildImageRequest,
  buildPlanRequest,
  buildVideoRequest,
  ANMIAO_VIDEO_MODEL,
  ANMIAO_VIDEO_RESOLUTIONS,
  ANMIAO20_FAST_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  ANMIAO25_VIDEO_RESOLUTIONS,
  HAILUO_H3_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  VIDEO_MODELS,
  WHOLE_VIDEO_30_MODELS,
  generationDuration,
  buildCompositionRequest,
  canGenerateVideo,
  pickImage,
  removeReference,
  removeImage,
  removeVideo,
  selectedVideo,
  taskState,
  videoGenerationNotices,
  videoGenerationStatus,
  compositionFingerprint,
} from './productVideo.js'

function fixture() {
  const data = newProductVideo()
  data.references = [{ id: 'product', url: 'https://assets.example/product.png' }]
  const shot = newShot({ imagePrompt: '产品全景', motion: '缓慢推进', duration: 4 })
  shot.referenceIds = ['product']
  data.shots.push(shot)
  return { data, shot }
}

test('planning model persists per task and reaches every mode without changing media models', () => {
  const { data, shot } = fixture()
  const originalImageModel = data.imageModel
  const originalVideoModel = data.videoModel
  assert.equal(buildPlanRequest(data, 4).planningModel, 'default')
  data.planningModel = 'gem-3.8-flash'
  for (const mode of ['storyboard', 'single_video', 'single_video_30']) {
    data.productionMode = mode
    assert.equal(buildPlanRequest(data, 4).planningModel, 'gem-3.8-flash')
    assert.equal(buildPlanRequest(data, 1, shot).planningModel, 'gem-3.8-flash')
  }
  data.planningSource = 'reference'
  data.referenceVideo = {
    url: 'https://assets.example/reference.mp4',
    duration: 12,
    frames: [{ url: 'https://assets.example/frame.jpg', time: 1 }],
    suggestedShotCount: 2,
  }
  assert.equal(buildPlanRequest(data, 4).planningModel, 'gem-3.8-flash')
  assert.equal(JSON.parse(JSON.stringify(data)).planningModel, 'gem-3.8-flash')
  assert.equal(newProductVideoTask().planningModel, 'default')
  assert.equal(data.imageModel, originalImageModel)
  assert.equal(data.videoModel, originalVideoModel)
  delete data.planningModel
  assert.equal(buildPlanRequest(data, 4).planningModel, 'default')
})

test('retired H3 Max is blocked without deleting old videos or selecting a replacement', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = 'minimax-h3-max'
  shot.videos = [{ id: 'old', url: 'https://assets.example/old.mp4', status: 'completed' }]
  shot.videoId = 'old'
  const before = JSON.stringify(data)
  assert.throws(() => buildVideoRequest(data, shot, 'retired'), /已移除/)
  assert.equal(JSON.stringify(data), before)
  assert.equal(selectedVideo(shot).url, 'https://assets.example/old.mp4')
  shot.productionMode = 'single_video'
  assert.throws(() => buildVideoRequest(data, shot, 'retired'), /已移除/)
  assert.equal(
    VIDEO_MODELS.some((option) => option.value === data.videoModel),
    false,
  )
  assert.equal(
    WHOLE_VIDEO_30_MODELS.some((option) => option.value === data.videoModel),
    false,
  )
  data.videoModel = MINIMAX_VIDEO_MODEL
  assert.equal(buildVideoRequest(data, shot, 'h3-standard').resolution, '768p')
})

test('H3 uses confirmed first frame with independent resolution and cannot make a 30-second shot', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = MINIMAX_VIDEO_MODEL
  data.videoDurationSeconds = 5
  for (const option of MINIMAX_VIDEO_RESOLUTIONS) {
    data.minimaxResolution = option.value
    const request = buildVideoRequest(data, shot, 'h3')
    assert.equal(request.model, MINIMAX_VIDEO_MODEL)
    assert.equal(request.resolution, option.value)
    assert.equal(request.durationSeconds, 5)
    assert.equal(request.first_frame_url, shot.images[0].url)
    assert.equal(Object.hasOwn(request, 'generate_audio'), false)
  }
  data.videoDurationSeconds = 30
  assert.throws(() => buildVideoRequest(data, shot, 'h3'), /4 至 15/)
  shot.productionMode = 'single_video'
  assert.equal(buildVideoRequest(data, shot, 'h3').durationSeconds, 15)
  assert.equal(
    WHOLE_VIDEO_30_MODELS.some((option) => option.value === MINIMAX_VIDEO_MODEL),
    false,
  )
  data.minimaxResolution = '720p'
  assert.throws(() => buildVideoRequest(data, shot, 'h3'), /768P/)
})

test('Hailuo H3首尾帧 uses adaptive ratio and Mini H3 resolutions', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = HAILUO_H3_VIDEO_MODEL
  data.videoDurationSeconds = 5
  for (const option of MINIMAX_VIDEO_RESOLUTIONS) {
    data.minimaxResolution = option.value
    const request = buildVideoRequest(data, shot, 'hailuo-h3')
    assert.equal(request.model, HAILUO_H3_VIDEO_MODEL)
    assert.equal(request.ratio, 'adaptive')
    assert.equal(request.resolution, option.value)
    assert.equal(request.durationSeconds, 5)
    assert.equal(request.first_frame_url, shot.images[0].url)
    assert.equal(Object.hasOwn(request, 'generate_audio'), false)
  }
})

test('per-second Seedance model uses explicit 4-15 seconds without changing existing video models', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = ANMIAO_VIDEO_MODEL
  data.videoDurationSeconds = 6
  assert.equal(generationDuration(shot, data), 6)
  for (const option of ANMIAO_VIDEO_RESOLUTIONS) {
    data.videoResolution = option.value
    const request = buildVideoRequest(data, shot, `per-second-${option.value}`)
    assert.equal(request.model, ANMIAO_VIDEO_MODEL)
    assert.equal(request.durationSeconds, 6)
    assert.equal(request.resolution, option.value)
    assert.equal(Object.hasOwn(request, 'generate_audio'), false)
  }
  data.videoResolution = '2k'
  assert.throws(() => buildVideoRequest(data, shot, 'wrong-resolution'), /画质需选择/)
  data.videoResolution = '720p'
  data.videoDurationSeconds = 3
  assert.throws(() => buildVideoRequest(data, shot, 'too-short'), /4 至 15/)
  shot.productionMode = 'single_video'
  assert.equal(buildVideoRequest(data, shot, 'whole-15').durationSeconds, 15)
  shot.productionMode = 'single_video_30'
  assert.equal(buildVideoRequest(data, shot, 'whole-30').model, 'ya-sd25-30s')
  data.videoModel = 'seedance-2.0-fast-0826-720p'
  shot.productionMode = 'storyboard'
  assert.equal(buildVideoRequest(data, shot, 'legacy').durationSeconds, 15)
})

test('Seedance 2.0 fast model is sent as a configured per-second model with 480p/720p only', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = ANMIAO20_FAST_VIDEO_MODEL
  data.videoResolution = '720p'
  data.videoDurationSeconds = 5

  const request = buildVideoRequest(data, shot, 'fast')

  assert.equal(request.model, ANMIAO20_FAST_VIDEO_MODEL)
  assert.equal(request.durationSeconds, 5)
  assert.equal(request.resolution, '720p')
  assert.equal(Object.hasOwn(request, 'generate_audio'), false)
  data.videoResolution = '1080p'
  assert.throws(() => buildVideoRequest(data, shot, 'fast-invalid-resolution'), /快速版.*480p.*720p/)
})

test('Seedance 2.5 adds 4-30 second storyboard clips and an optional whole-30 model', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  data.videoModel = ANMIAO25_VIDEO_MODEL
  data.videoDurationSeconds = 30
  data.ratio = '9:16'
  for (const option of ANMIAO25_VIDEO_RESOLUTIONS) {
    data.videoResolution = option.value
    const request = buildVideoRequest(data, shot, `seedance25-${option.value}`)
    assert.equal(request.model, ANMIAO25_VIDEO_MODEL)
    assert.equal(request.durationSeconds, 30)
    assert.equal(request.resolution, option.value)
    assert.equal(request.ratio, 'adaptive')
    assert.equal(Object.hasOwn(request, 'generate_audio'), false)
  }
  data.videoResolution = '4k'
  assert.throws(() => buildVideoRequest(data, shot, 'unsupported-4k'), /1080p/)
  data.videoResolution = '720p'
  data.videoDurationSeconds = 31
  assert.throws(() => buildVideoRequest(data, shot, 'too-long'), /4 至 30/)

  shot.productionMode = 'single_video_30'
  assert.equal(buildVideoRequest(data, shot, 'old-whole-30').model, 'ya-sd25-30s')
  data.wholeVideo30Model = ANMIAO25_VIDEO_MODEL
  data.wholeVideo30Resolution = '1080p'
  const whole = buildVideoRequest(data, shot, 'new-whole-30')
  assert.equal(whole.model, ANMIAO25_VIDEO_MODEL)
  assert.equal(whole.durationSeconds, 30)
  assert.equal(whole.resolution, '1080p')
  assert.equal(whole.ratio, 'adaptive')
  data.wholeVideo30Resolution = '4k'
  assert.throws(() => buildVideoRequest(data, shot, 'wrong-whole-resolution'), /1080p/)
})

test('audio is opt-in, reaches planning and generation, and source audio affects export fingerprints', () => {
  for (const mode of ['storyboard', 'single_video', 'single_video_30']) {
    const { data, shot } = fixture()
    data.productionMode = shot.productionMode = mode
    shot.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
    shot.imageId = shot.approvedImageId = 'image'
    shot.videos = [{ id: 'video', url: 'https://assets.example/result.mp4', duration: 15 }]
    shot.videoId = 'video'
    shot.kept = true
    const original = buildVideoRequest(data, shot, 'id')
    const fingerprint = compositionFingerprint(data)
    assert.equal(original.generate_audio, mode === 'single_video_30' ? undefined : false)
    if (mode === 'single_video_30') assert.equal(Object.hasOwn(original, 'generate_audio'), false)
    assert.equal(buildPlanRequest(data, 1).generateAudio, undefined)
    assert.equal(buildCompositionRequest(data).keepOriginalAudio, undefined)
    data.generateAudio = true
    assert.equal(buildPlanRequest(data, 1).generateAudio, true)
    assert.equal(buildPlanRequest(data, 1, shot).generateAudio, true)
    const audible = buildVideoRequest(data, shot, 'id')
    assert.equal(audible.generate_audio, mode === 'single_video_30' ? undefined : true)
    if (mode === 'single_video_30') assert.equal(Object.hasOwn(audible, 'generate_audio'), false)
    assert.match(audible.prompt, /声音要求.*同步/)
    assert.equal(audible.model, original.model)
    assert.equal(audible.durationSeconds, original.durationSeconds)
    assert.equal(audible.resolution, original.resolution)
    assert.equal(compositionFingerprint(data), fingerprint)
    data.keepOriginalAudio = true
    assert.equal(buildCompositionRequest(data).keepOriginalAudio, true)
    assert.notEqual(compositionFingerprint(data), fingerprint)
    data.keepOriginalAudio = false
    assert.equal(compositionFingerprint(data), fingerprint)
    delete data.generateAudio
    assert.equal(
      buildVideoRequest(data, shot, 'id').generate_audio,
      mode === 'single_video_30' ? undefined : false,
    )
  }
})

test('prompt newlines decode escaped LF and CRLF without decoding unrelated escapes or URLs', () => {
  const raw = String.raw`起始衔接：停留。\n主体动作：轻压。\r\n运镜路径：推进。\\n节奏与结束：停留。`
  const expected = '起始衔接：停留。\n主体动作：轻压。\n运镜路径：推进。\n节奏与结束：停留。'
  assert.equal(normalizePromptLineBreaks(raw), expected)
  assert.equal(normalizePromptLineBreaks(expected), expected)
  assert.equal(normalizePromptLineBreaks('首行\r\n\r\n末行\r'), '首行\n\n末行\n')
  assert.equal(
    normalizePromptLineBreaks(String.raw`https://example.com/new/n.jpg?a=1\t2`),
    String.raw`https://example.com/new/n.jpg?a=1\t2`,
  )
  assert.equal(normalizePromptLineBreaks(null), '')
  const shot = newShot({ imagePrompt: raw, motion: raw })
  assert.equal(shot.imagePrompt, expected)
  assert.equal(shot.motion, expected)
})

test('whole-video prompts remove duplicate time labels while retaining distinct internal action timings', () => {
  const shot = newShot({ productionMode: 'single_video_30' })
  const raw =
    '0-4 秒：0-4秒，推近。\\n4-8 秒：4.0至8.0秒：4-8秒，手抚布面。\n8-12 秒：9-10秒，轻抚。\n全片连续性：保持商品。'
  const expected =
    '0-4 秒：推近。\n4-8 秒：手抚布面。\n8-12 秒：9-10秒，轻抚。\n全片连续性：保持商品。'
  assert.equal(normalizeVideoPrompt(shot, raw), expected)
  assert.equal(normalizeVideoPrompt(shot, expected), expected)
  assert.equal(
    normalizeVideoPrompt({ productionMode: 'storyboard' }, raw),
    normalizePromptLineBreaks(raw),
  )
  const { data, shot: ready } = fixture()
  ready.productionMode = 'single_video_30'
  ready.motion = raw
  ready.images = [{ id: 'image', url: 'https://assets.example/frame.png' }]
  ready.imageId = ready.approvedImageId = 'image'
  assert.equal(buildPlanRequest(data, 1, ready).currentShot.motion, expected)
  const request = buildVideoRequest(data, ready, 'whole-video')
  assert.ok(request.prompt.includes(expected))
  assert.match(request.prompt, /不锁定首帧构图/)
  assert.equal(ready.motion, raw, 'Viewing and submitting do not rewrite the saved draft')
})

test('deleting a selected first frame selects another version and requires confirmation without deleting videos', () => {
  const { data, shot } = fixture()
  shot.images = [
    { id: 'older', url: 'https://assets.example/frame.png', status: 'completed' },
    { id: 'current', url: 'https://assets.example/frame.png', status: 'completed' },
    { id: 'pending', status: 'processing', taskId: 'pending-task' },
  ]
  shot.imageId = shot.approvedImageId = 'current'
  shot.videos = [{ id: 'video', sourceImageId: 'current', url: 'https://assets.example/video.mp4' }]
  shot.videoId = 'video'
  shot.kept = true
  shot.start = 1
  const videos = JSON.stringify(shot.videos),
    refs = JSON.stringify(data.references)
  removeImage(shot, 'current')
  assert.deepEqual(
    shot.images.map((item) => item.id),
    ['older', 'pending'],
  )
  assert.equal(shot.imageId, 'older')
  assert.equal(shot.approvedImageId, '')
  assert.equal(canGenerateVideo(shot), false)
  assert.equal(JSON.stringify(shot.videos), videos)
  assert.equal(JSON.stringify(data.references), refs)
  assert.equal(shot.videoId, 'video')
  assert.equal(shot.kept, true)
  assert.equal(shot.start, 1)
  removeImage(shot, 'older')
  assert.equal(shot.imageId, '')
  assert.equal(shot.images.length, 1)
  assert.equal(data.shots.length, 1)
})

test('deleting an unselected first frame preserves current approval and cannot remove in-flight versions', () => {
  const { shot } = fixture()
  shot.images = [
    { id: 'older', url: 'older.png' },
    { id: 'current', url: 'current.png', status: 'completed' },
    { id: 'pending', url: 'pending.png', status: 'processing' },
    { id: 'submitting', url: 'submitting.png', status: 'submitting' },
  ]
  shot.imageId = shot.approvedImageId = 'current'
  removeImage(shot, 'older')
  assert.equal(shot.imageId, 'current')
  assert.equal(shot.approvedImageId, 'current')
  const before = JSON.stringify(shot)
  for (const id of ['pending', 'submitting', 'missing']) removeImage(shot, id)
  assert.equal(JSON.stringify(shot), before)
  removeImage(shot, 'current')
  assert.equal(shot.imageId, '')
  assert.equal(shot.approvedImageId, '')
})

test('historical prompts are normalized in image, video and refinement requests without mutating the draft', () => {
  const { data, shot } = fixture()
  shot.imagePrompt = String.raw`主体：商品。\n场景：卧室。`
  shot.motion = String.raw`起始：停留。\n主体动作：轻压。`
  shot.images = [{ id: 'frame', url: 'https://assets.example/frame.png', status: 'completed' }]
  shot.imageId = shot.approvedImageId = 'frame'
  const before = JSON.stringify(shot)
  assert.ok(buildImageRequest(data, shot, 'request').prompt.includes('主体：商品。\n场景：卧室。'))
  assert.ok(
    buildVideoRequest(data, shot, 'request').prompt.includes('起始：停留。\n主体动作：轻压。'),
  )
  const refinement = buildPlanRequest(data, 1, shot)
  assert.equal(refinement.currentShot.imagePrompt, '主体：商品。\n场景：卧室。')
  assert.equal(refinement.currentShot.motion, '起始：停留。\n主体动作：轻压。')
  assert.equal(JSON.stringify(shot), before)
})

test('planning checkpoints survive reload and retry without duplicates or lost edits', () => {
  let data = newProductVideoTask('策划')
  data.planJob = { id: 'job-1', status: 'queued', referenceIds: ['ref'], appliedCount: 0 }
  const first = { title: '使用场景', imagePrompt: '有人物的起始状态', motion: '自然使用' }
  const second = { title: '材质细节', imagePrompt: '纯商品', motion: '细节运镜' }
  const state = {
    id: 'job-1',
    status: 'processing',
    count: 4,
    stage: '镜头 3-4',
    updatedAt: 1,
    result: { shots: [first, second], summary: { analysis: '识图结论', concept: '整体递进' } },
  }
  applyPlanningState(data, state)
  assert.equal(data.shots.length, 2)
  assert.equal(productVideoTaskState(data), 'planning')
  data.shots[0].imagePrompt = '用户改过的提示词'
  data.shots.splice(1, 1)
  data = JSON.parse(JSON.stringify(data))
  applyPlanningState(data, { ...state, status: 'failed', error: '最后一批超时', updatedAt: 2 })
  assert.equal(data.shots.length, 1)
  assert.equal(data.shots[0].imagePrompt, '用户改过的提示词')
  assert.equal(productVideoTaskState(data), 'failed')
  const completed = {
    ...state,
    status: 'completed',
    updatedAt: 3,
    result: { ...state.result, shots: [first, second, first, second] },
  }
  applyPlanningState(data, completed)
  applyPlanningState(data, completed)
  assert.equal(data.shots.length, 3)
  assert.equal(data.planJob.appliedCount, 4)
  assert.deepEqual(data.shots[2].referenceIds, ['ref'])
  assert.equal(data.lastPlanSummary.analysis, '识图结论')
  applyPlanningState(data, state)
  assert.equal(data.planJob.status, 'completed')
  assert.equal(isPlanRunning(data.planJob), false)
  applyPlanningState(data, { ...completed, id: 'other-task', updatedAt: 99 })
  assert.equal(data.planJob.id, 'job-1')
})

test('planning never silently drops saved shots when the workspace is full', () => {
  const data = newProductVideoTask()
  data.shots = Array.from({ length: 8 }, () => newShot())
  data.planJob = { id: 'job', referenceIds: [], appliedCount: 0 }
  assert.throws(
    () =>
      applyPlanningState(data, { id: 'job', status: 'completed', result: { shots: [newShot()] } }),
    /后台保存/,
  )
  assert.equal(data.planJob.appliedCount, 0)
  assert.equal(data.shots.length, 8)
})

test('legacy workflow becomes one history task without losing references, approvals or versions', () => {
  const { data, shot } = fixture()
  data.brief = '绿色窗帘'
  shot.approvedImageId = 'frame'
  shot.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
  shot.videos = [{ id: 'clip', taskId: 'remote', status: 'processing' }]
  const before = JSON.stringify(data)
  const library = productVideoLibrary(data)
  assert.equal(library.tasks.length, 1)
  assert.equal(library.tasks[0].title, '绿色窗帘')
  assert.deepEqual(library.tasks[0].shots, data.shots)
  assert.equal(library.tasks[0].shots[0].approvedImageId, 'frame')
  assert.equal(JSON.stringify(data), before)
  assert.equal(productVideoLibrary(library), library)
  assert.equal(productVideoLibrary(data).tasks[0].id, library.tasks[0].id)
  assert.deepEqual(productVideoLibrary(null).tasks, [])
  assert.deepEqual(productVideoLibrary(newProductVideo()).tasks, [])
})

test('new video tasks have independent IDs and editable data', () => {
  const first = newProductVideoTask('任务 A'),
    second = newProductVideoTask('任务 B')
  assert.notEqual(first.id, second.id)
  first.references.push({ id: 'ref', url: 'first.png' })
  first.shots.push(newShot())
  assert.deepEqual(second.references, [])
  assert.deepEqual(second.shots, [])
  assert.equal(newProductVideoTask('   ').title, '未命名任务')
})

test('reference-video planning sends ordered keyframes without mixing them into product images', () => {
  const { data } = fixture()
  data.planningSource = 'reference'
  data.referenceVideo = {
    url: 'https://assets.example/reference.mp4',
    name: '竞品视频.mp4',
    duration: 12.5,
    width: 1080,
    height: 1920,
    audioSummary: '声音连续，4秒有节奏峰值。',
    suggestedShotCount: 2,
    frames: [
      { id: 'frame-1', url: 'https://assets.example/reference-1.jpg', time: 0.1 },
      { id: 'frame-2', url: 'https://assets.example/reference-2.jpg', time: 5.2 },
    ],
  }
  const request = buildPlanRequest(data, 3)
  assert.deepEqual(request.images, ['https://assets.example/product.png'])
  assert.deepEqual(request.referenceVideo.frames, [
    { url: 'https://assets.example/reference-1.jpg', time: 0.1 },
    { url: 'https://assets.example/reference-2.jpg', time: 5.2 },
  ])
  assert.equal(request.referenceVideo.url, 'https://assets.example/reference.mp4')
  assert.equal(request.referenceVideo.duration, 12.5)
  assert.equal(request.count, 2)
  data.productionMode = 'single_video_30'
  data.timelineCount = 7
  const wholeRequest = buildPlanRequest(data, 7)
  assert.equal(wholeRequest.count, 1)
  assert.equal(wholeRequest.timelineCount, 2)
  assert.equal(buildPlanRequest(data, 1, data.shots[0]).referenceVideo, undefined)
  data.planningSource = 'creative'
  assert.equal(buildPlanRequest(data, 3).referenceVideo, undefined)
})

test('video task search, status filtering and pagination clamp empty or outdated pages', () => {
  const tasks = Array.from({ length: 23 }, (_, i) => ({
    ...newProductVideoTask(`任务 ${i + 1}`),
    id: String(i),
    updatedAt: i,
    brief: i < 12 ? '窗帘' : '床垫',
  }))
  const result = queryProductVideoTasks(tasks, { page: 2 })
  assert.equal(result.total, 23)
  assert.equal(result.pages, 3)
  assert.equal(result.items.length, 10)
  assert.equal(result.items[0].title, '任务 13')
  assert.equal(queryProductVideoTasks(tasks, { page: 3 }).items.length, 3)
  assert.equal(queryProductVideoTasks(tasks, { page: 99 }).page, 3)
  assert.equal(queryProductVideoTasks(tasks, { keyword: '窗帘', page: 2 }).items.length, 2)
  assert.equal(
    queryProductVideoTasks(tasks, { status: 'planning', activity: { 0: 'plan' } }).items[0].id,
    '0',
  )
  assert.equal(queryProductVideoTasks(tasks, { keyword: '没有的任务' }).page, 1)
  assert.equal(queryProductVideoTasks(tasks, { pageSize: 20 }).items.length, 20)
  assert.equal(tasks[0].id, '0')
})

test('task status ignores failed older versions once a replacement succeeds', () => {
  const task = newProductVideoTask()
  const shot = newShot()
  task.shots.push(shot)
  shot.videos.push({ id: 'failed', status: 'failed' })
  assert.equal(productVideoTaskState(task), 'failed')
  shot.videos.push({ id: 'good', status: 'completed', url: 'clip.mp4' })
  assert.equal(productVideoTaskState(task), 'editing')
  assert.equal(productVideoTaskState(task, 'plan'), 'planning')
  shot.videoId = 'good'
  shot.kept = true
  task.composition = { status: 'completed', fingerprint: compositionFingerprint(task) }
  assert.equal(productVideoTaskState(task), 'completed')
  task.ratio = '9:16'
  assert.equal(productVideoTaskState(task), 'editing')
})

test('planning waits for the outline and every two-shot batch with a transport margin', () => {
  assert.equal(planningTimeoutMs(1, 180), 420000)
  assert.equal(planningTimeoutMs(2, 180), 420000)
  assert.equal(planningTimeoutMs(3, 180), 600000)
  assert.equal(planningTimeoutMs('4', 180), 600000)
  assert.equal(planningTimeoutMs(8, 180), 960000)
  assert.equal(planningTimeoutMs(4), 960000)
  assert.equal(planningTimeoutMs(8, 9999), 1560000)
  assert.equal(planningTimeoutMs(8, null), 1560000)
  assert.equal(planningTimeoutMs(8, 1), 210000)
})

test('planning timeout messages remain readable and preserve backend phase details', () => {
  assert.match(
    planningErrorMessage(new DOMException('signal timed out', 'TimeoutError')),
    /原有分镜和素材未改动/,
  )
  assert.match(planningErrorMessage(new Error('request timed out')), /分镜策划等待超时/)
  const detailed = '分镜策划超时（镜头 3-4 提示词展开，等待上限 180 秒）'
  assert.equal(planningErrorMessage(new Error(detailed)), detailed)
})

test('image request contains only explicitly selected references and PNG', () => {
  const { data, shot } = fixture()
  data.references.push({ id: 'unused', url: 'https://assets.example/unused.png' })
  const request = buildImageRequest(data, shot, 'unique')
  assert.deepEqual(request.image_urls, ['https://assets.example/product.png'])
  assert.equal(request.output_format, 'png')
  assert.equal(request.client_task_id, 'unique')
  assert.match(request.prompt, /人物.*起始姿势/)
  assert.match(request.prompt, /商品自带的品牌标识/)
  assert.doesNotMatch(request.prompt, /不添加文字/)
  assert.equal(data.talentMode, undefined)
  shot.referenceIds = []
  assert.throws(() => buildImageRequest(data, shot, 'other'), /参考图/)
})

test('appearance constraints use the correct image, preserve existing patterns, and leave saved drafts unchanged', () => {
  for (const mode of ['storyboard', 'single_video', 'single_video_30']) {
    const { data, shot } = fixture()
    shot.productionMode = mode
    shot.imagePrompt = '保留产品已有的花纹，暖光场景'
    shot.motion = '移动镜头，从亮处走到暗处，展示已有纹理'
    shot.images = [{ id: 'frame', url: 'https://assets.example/approved.png' }]
    shot.imageId = shot.approvedImageId = 'frame'
    const original = JSON.stringify(data)
    const image = buildImageRequest(data, shot, 'image-id')
    const video = buildVideoRequest(data, shot, 'video-id')
    assert.match(image.prompt, /以所选商品参考图中商品的实际底色/)
    assert.match(video.prompt, /以已确认首帧中商品的实际底色/)
    for (const request of [image, video]) {
      assert.match(request.prompt, /文字色名或风格冲突时以图为准/)
      assert.match(request.prompt, /不改底色、不偏灰偏褐/)
      assert.match(request.prompt, /禁止新增原图没有的斑驳、印花、粗织纹/)
      assert.match(request.prompt, /不得抹除原有图案/)
      assert.match(request.prompt, /看不清的细节不臆造/)
    }
    assert.ok(video.prompt.indexOf('商品外观约束') < video.prompt.indexOf(shot.motion))
    assert.deepEqual(image.image_urls, ['https://assets.example/product.png'])
    assert.deepEqual(video.image_urls, ['https://assets.example/approved.png'])
    assert.equal(video.first_frame_url, 'https://assets.example/approved.png')
    assert.equal(JSON.stringify(data), original)
    assert.equal(buildVideoRequest(data, shot, 'video-id').prompt, video.prompt)
  }
})

test('full-length motion remains intact with appearance rules and room for the existing backend reference prefix', () => {
  for (const mode of ['storyboard', 'single_video', 'single_video_30']) {
    for (const count of [1, 4, 8])
      for (const audio of [false, true]) {
        const { data, shot } = fixture()
        data.generateAudio = audio
        shot.productionMode = mode
        shot.timelineCount = count
        shot.motion = '画'.repeat(1795) + '最后镜头。'
        shot.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
        shot.imageId = shot.approvedImageId = 'frame'
        const request = buildVideoRequest(data, shot, 'video-id')
        assert.ok(request.prompt.includes(shot.motion))
        assert.ok(
          request.prompt.length <= 2400,
          `Prompt length ${request.prompt.length} must reserve backend prefix space`,
        )
        assert.match(request.prompt, /商品外观约束/)
        if (audio) assert.match(request.prompt, /声音要求/)
      }
  }
})

test('planning ignores historical casting controls and refinement includes surrounding shot context', () => {
  const { data, shot } = fixture()
  data.talentMode = 'person'
  shot.purpose = '让观众看清表面纹理'
  shot.design = '纯商品特写，柔和侧光掠过表面，再接整体镜头'
  const other = newShot({
    title: '使用场景',
    purpose: '建立人与商品的使用关系',
    design: '自然使用，不遮挡商品',
    concept: '先细节再场景',
  })
  data.shots.push(other)
  data.references.push({ id: 'unused', url: 'https://assets.example/unused.png' })
  const full = buildPlanRequest(data, 4)
  assert.equal(full.count, 4)
  assert.equal(full.currentShot, null)
  assert.equal('talentMode' in full, false)
  const refine = buildPlanRequest(data, 4, shot)
  assert.equal(refine.count, 1)
  assert.deepEqual(refine.images, ['https://assets.example/product.png'])
  assert.equal(refine.currentShot.purpose, shot.purpose)
  assert.equal(refine.contextShots[1].concept, '先细节再场景')
  assert.equal('talentMode' in refine, false)
})

test('video creation is gated by approval and uses the exact selected frame', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
  shot.imageId = 'frame'
  assert.equal(canGenerateVideo(shot), false)
  assert.throws(() => buildVideoRequest(data, shot, 'video'), /确认/)
  shot.approvedImageId = 'frame'
  const body = buildVideoRequest(data, shot, 'video')
  assert.deepEqual(body.image_urls, ['https://assets.example/frame.png'])
  assert.equal(body.first_frame_url, 'https://assets.example/frame.png')
  assert.equal(body.durationSeconds, 15)
  assert.equal(body.resolution, '720p')
  assert.equal(body.generate_audio, false)
  assert.match(body.prompt, /第 0 秒画面/)
  assert.match(body.prompt, /不要凭空增加人物/)
  shot.images.push({ id: 'frame2', url: 'https://assets.example/new.png' })
  pickImage(shot, 'frame2')
  assert.equal(canGenerateVideo(shot), false)
})

test('whole-video planning is explicit, creates one full clip and survives checkpoints without changing old shots', () => {
  const { data, shot } = fixture()
  data.productionMode = 'single_video'
  const request = buildPlanRequest(data, 7)
  assert.equal(request.count, 1)
  assert.equal(request.productionMode, 'single_video')
  assert.deepEqual(request.images, ['https://assets.example/product.png'])
  assert.equal(buildPlanRequest(data, 7, shot).productionMode, undefined)
  const original = JSON.stringify(shot)
  const timeline = [
    { start: 0, end: 4, action: '开场', camera: '中景', transition: '转细节' },
    { start: 4, end: 11, action: '展示', camera: '近景', transition: '转全景' },
    { start: 11, end: 15, action: '收尾', camera: '全景', transition: '结束' },
  ]
  data.planJob = { id: 'whole', request, appliedCount: 0, referenceIds: ['product'] }
  applyPlanningState(data, {
    id: 'whole',
    updatedAt: 1,
    count: 1,
    status: 'completed',
    result: {
      shots: [
        {
          title: '整片',
          imagePrompt: '第0秒首帧',
          motion: '0-4 秒：开场\n4-11 秒：展示\n11-15 秒：收尾',
          duration: 15,
          productionMode: 'single_video',
          timeline,
        },
      ],
    },
  })
  assert.equal(JSON.stringify(shot), original)
  assert.equal(data.shots.length, 2)
  const full = data.shots[1]
  assert.equal(full.duration, 15)
  assert.deepEqual(full.timeline, timeline)
  assert.equal(full.productionMode, 'single_video')
  data.productionMode = 'storyboard'
  assert.equal(buildPlanRequest(data, 4, full).productionMode, 'single_video')
  full.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
  full.imageId = full.approvedImageId = 'frame'
  const body = buildVideoRequest(data, full, 'one-video')
  assert.equal(body.durationSeconds, 15)
  assert.deepEqual(body.image_urls, ['https://assets.example/frame.png'])
  assert.match(body.prompt, /整片时间轴/)
  assert.match(body.prompt, /11-15 秒：收尾/)
  assert.doesNotMatch(body.prompt, /单个连续镜头，不换场/)
  assert.doesNotMatch(body.prompt, /动作完成后自然停留/)
  const restored = productVideoLibrary(
    JSON.parse(JSON.stringify({ version: 2, tasks: [{ ...data, id: 'whole-task' }] })),
  )
  assert.deepEqual(restored.tasks[0].shots[1].timeline, timeline)
})

test('removing a reference removes its per-shot binding without deleting generated versions', () => {
  const { data, shot } = fixture()
  shot.images.push({ id: 'old', url: 'https://assets.example/old.png' })
  removeReference(data, 'product')
  assert.deepEqual(shot.referenceIds, [])
  assert.equal(shot.images.length, 1)
})

test('internal shot counts are independent of video count and refinement retains the original count', () => {
  for (const productionMode of ['single_video', 'single_video_30']) {
    const { data, shot: old } = fixture()
    data.productionMode = productionMode
    for (const timelineCount of [1, 4, 8]) {
      data.timelineCount = timelineCount
      const request = buildPlanRequest(data, 7)
      assert.equal(request.count, 1)
      assert.equal(request.timelineCount, timelineCount)
      assert.equal(buildPlanRequest(data, 1, old).timelineCount, undefined)
      const full = newShot({ productionMode, timelineCount })
      data.timelineCount = timelineCount === 1 ? 8 : 1
      assert.equal(buildPlanRequest(data, 1, full).timelineCount, timelineCount)
      full.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
      full.imageId = full.approvedImageId = 'frame'
      const video = buildVideoRequest(data, full, 'count-test')
      assert.ok(
        video.prompt.includes(
          timelineCount === 1 ? '全片只用一个连续镜头' : `全片共 ${timelineCount} 个分镜`,
        ),
      )
    }
    for (const invalid of [0, -1, 9, 1.5, NaN, Infinity, '']) {
      data.timelineCount = invalid
      assert.throws(() => buildPlanRequest(data, 1), /1 至 8/)
    }
    delete data.timelineCount
    assert.equal(buildPlanRequest(data, 1).timelineCount, 4)
    const historical = { ...old, productionMode, timeline: [{}, {}, {}] }
    assert.equal(buildPlanRequest(data, 1, historical).timelineCount, 3)
  }
})

test('30-second whole video uses its own model and full export duration without changing 15-second shots', () => {
  const { data, shot: old } = fixture()
  const oldJson = JSON.stringify(old)
  const originalModel = data.videoModel
  data.productionMode = 'single_video_30'
  assert.equal(buildPlanRequest(data, 7).count, 1)
  assert.equal(buildPlanRequest(data, 7).productionMode, 'single_video_30')
  assert.equal(buildPlanRequest(data, 7, old).productionMode, undefined)
  const whole = newShot({
    productionMode: 'single_video_30',
    duration: 30,
    motion: '0-10 秒开场\n10-25 秒展示\n25-30 秒收尾',
  })
  whole.imageId = whole.approvedImageId = 'first'
  whole.images = [{ id: 'first', url: 'https://assets.example/first.png' }]
  data.shots.push(whole)
  data.productionMode = 'storyboard'
  const body = buildVideoRequest(data, whole, 'thirty-test')
  assert.equal(body.model, 'ya-sd25-30s')
  assert.equal(body.resolution, '720p')
  assert.equal(body.durationSeconds, 30)
  assert.equal(body.first_frame_url, whole.images[0].url)
  assert.deepEqual(body.image_urls, [whole.images[0].url])
  assert.match(body.prompt, /完整的 30 秒/)
  assert.doesNotMatch(body.prompt, /15 秒/)
  assert.equal(buildPlanRequest(data, 1, whole).productionMode, 'single_video_30')
  assert.equal(data.videoModel, originalModel)
  assert.equal(JSON.stringify(old), oldJson)
  whole.kept = true
  whole.videoId = 'result'
  whole.videos = [{ id: 'result', url: 'https://assets.example/whole.mp4', duration: 30 }]
  assert.equal(buildCompositionRequest(data).clips[0].duration, 30)
  whole.timingMode = 'speed'
  whole.duration = 4
  assert.equal(buildCompositionRequest(data).clips[0].timingMode, 'speed')
  assert.equal(buildCompositionRequest(data).clips[0].duration, 4)
  old.imageId = old.approvedImageId = 'old-image'
  old.images = [{ id: 'old-image', url: 'https://assets.example/old.png' }]
  assert.equal(buildVideoRequest(data, old, 'old-test').durationSeconds, 15)
  assert.equal(buildVideoRequest(data, old, 'old-test').model, originalModel)
})

test('composition includes only kept clips in shot order, and validates trim bounds', () => {
  const { data, shot } = fixture()
  shot.videos = [{ id: 'v1', url: 'https://assets.example/1.mp4', duration: 15 }]
  shot.videoId = 'v1'
  shot.kept = true
  const other = newShot()
  data.shots.push(other)
  assert.equal(buildCompositionRequest(data).clips.length, 1)
  const before = compositionFingerprint(data)
  shot.caption = '真实商品'
  assert.notEqual(compositionFingerprint(data), before)
  shot.start = 14
  shot.duration = 4
  assert.throws(() => buildCompositionRequest(data), /裁剪/)
  shot.start = NaN
  assert.throws(() => buildCompositionRequest(data), /裁剪/)
  shot.kept = false
  assert.throws(() => buildCompositionRequest(data), /保留/)
})

test('whole-clip speed preserves the source, ignores trim offset and changes the composition fingerprint', () => {
  const { data, shot } = fixture()
  shot.videos = [{ id: 'v1', url: 'https://assets.example/1.mp4', duration: 15 }]
  shot.videoId = 'v1'
  shot.kept = true
  shot.start = 5
  shot.duration = 4
  delete shot.timingMode
  const legacy = compositionFingerprint(data)
  shot.timingMode = 'trim'
  assert.equal(compositionFingerprint(data), legacy)
  shot.timingMode = 'speed'
  const accelerated = buildCompositionRequest(data).clips[0]
  assert.deepEqual(accelerated, {
    url: shot.videos[0].url,
    start: 0,
    duration: 4,
    caption: '',
    timingMode: 'speed',
  })
  assert.equal(shot.start, 5)
  assert.equal(shot.videos[0].duration, 15)
  assert.notEqual(compositionFingerprint(data), legacy)
  shot.duration = 6
  assert.equal(buildCompositionRequest(data).clips[0].duration, 6)
  shot.duration = 4
  shot.timingMode = 'trim'
  assert.equal(compositionFingerprint(data), legacy)
})

test('speed mode validates target duration and can be mixed with trimmed shots', () => {
  const { data, shot } = fixture()
  shot.videos = [{ id: 'v1', url: 'https://assets.example/1.mp4', duration: 3 }]
  shot.videoId = 'v1'
  shot.kept = true
  shot.timingMode = 'speed'
  for (const duration of [0, -1, 0.4, 4, 16, NaN, Infinity]) {
    shot.duration = duration
    assert.throws(() => buildCompositionRequest(data), /目标时长/)
  }
  shot.duration = 1
  const other = newShot()
  Object.assign(other, {
    kept: true,
    videoId: 'v2',
    start: 1,
    duration: 2,
    videos: [{ id: 'v2', url: 'https://assets.example/2.mp4', duration: 15 }],
  })
  data.shots.push(other)
  const clips = buildCompositionRequest(data).clips
  assert.deepEqual(
    clips.map((clip) => [clip.start, clip.duration, clip.timingMode]),
    [
      [0, 1, 'speed'],
      [1, 2, undefined],
    ],
  )
  shot.timingMode = 'unknown'
  assert.throws(() => buildCompositionRequest(data), /处理方式/)
})

test('terminal failures never stay generating and persistence is not premature success', () => {
  for (const status of ['FAILED', 'error', 'canceled', 'expired', 'aborted'])
    assert.equal(taskState(status), 'failed')
  assert.equal(taskState('SUCCESS'), 'completed')
  assert.equal(taskState('persisting'), 'processing')
})

test('successful video hides superseded failures without deleting history or hiding new failures', () => {
  const first = { id: 'first', status: 'failed', error: '第一次失败' }
  const second = { id: 'second', status: 'failed', error: '第二次失败' }
  const success = { id: 'success', status: 'completed', url: 'https://assets.example/video.mp4' }
  const videos = [first, second, success]
  const before = JSON.stringify(videos)
  assert.deepEqual(videoGenerationNotices(), [])
  assert.deepEqual(videoGenerationNotices([first, second]), [first, second])
  assert.deepEqual(videoGenerationNotices(videos), [])
  assert.equal(JSON.stringify(videos), before)
  assert.deepEqual(videoGenerationNotices(JSON.parse(before)), [])
  const retry = { id: 'retry', status: 'processing', progress: 34 }
  assert.deepEqual(videoGenerationNotices([...videos, retry]), [retry])
  retry.status = 'failed'
  retry.error = '新一轮失败'
  assert.deepEqual(videoGenerationNotices([...videos, retry]), [retry])
  assert.deepEqual(videoGenerationNotices([...videos, retry, { ...success, id: 'uploaded' }]), [])
})

test('playable video does not hide unresolved submissions or active generation progress', () => {
  const success = { id: 'success', status: 'completed', url: 'https://assets.example/video.mp4' }
  for (const status of ['submitting', 'queued', 'processing', 'unknown']) {
    const ongoing = { id: 'ongoing', status }
    assert.deepEqual(videoGenerationNotices([ongoing, success]), [ongoing])
  }
  const failed = { id: 'failed', status: 'failed' }
  const saving = { id: 'saving', status: 'processing', providerStatus: 'persisting' }
  assert.deepEqual(videoGenerationNotices([failed, saving]), [failed, saving])
  assert.deepEqual(videoGenerationNotices([failed, success, saving]), [saving])
})

test('video progress shows provider values and keeps submission, persistence, and failure distinct', () => {
  assert.equal(videoGenerationStatus({ status: 'submitting', progress: 0 }), '正在提交到中转站')
  for (const progress of [0, 34, 98, 100])
    assert.equal(
      videoGenerationStatus({ status: 'processing', stage: '中转站生成中', progress }),
      `中转站生成中 ${progress}%`,
    )
  assert.equal(
    videoGenerationStatus({ status: 'processing', stage: '中转站排队中', progress: null }),
    '中转站排队中',
  )
  assert.equal(
    videoGenerationStatus({ status: 'processing', providerStatus: 'persisting', progress: 100 }),
    '正在保存视频',
  )
  assert.equal(
    videoGenerationStatus({ status: 'failed', progress: 0, error: '中转站生成失败' }),
    '中转站生成失败',
  )
  assert.equal(videoGenerationStatus({ status: 'unknown', progress: 0 }), '提交结果待确认')
  assert.equal(
    videoGenerationStatus({ status: 'processing', progress: 34, pollError: '查询暂时中断' }),
    '中转站生成中 34% · 查询暂时中断',
  )
  for (const progress of [null, undefined, '', NaN, -1, 101])
    assert.doesNotMatch(videoGenerationStatus({ status: 'processing', progress }), /%/)
})

test('deleting the selected video preserves the shot and other versions, resets selection and trim', () => {
  const { data, shot } = fixture()
  shot.images = [{ id: 'frame', url: 'https://assets.example/frame.png' }]
  shot.imageId = shot.approvedImageId = 'frame'
  shot.videos = [
    { id: 'older', url: 'https://assets.example/older.mp4', duration: 2 },
    { id: 'current', url: 'https://assets.example/current.mp4', duration: 15 },
    { id: 'pending', status: 'processing', taskId: 'running' },
  ]
  shot.videoId = 'current'
  shot.start = 3
  shot.kept = true
  const before = compositionFingerprint(data)
  removeVideo(shot, 'current')
  assert.equal(data.shots.length, 1)
  assert.deepEqual(
    shot.videos.map((item) => item.id),
    ['older', 'pending'],
  )
  assert.equal(selectedVideo(shot).id, 'older')
  assert.equal(shot.start, 0)
  assert.equal(shot.duration, 2)
  assert.equal(shot.kept, false)
  assert.equal(canGenerateVideo(shot), true)
  assert.notEqual(compositionFingerprint(data), before)
  removeVideo(shot, 'older')
  assert.equal(shot.videoId, '')
  assert.equal(selectedVideo(shot), undefined)
  assert.deepEqual(
    shot.videos.map((item) => item.id),
    ['pending'],
  )
})

test('removing another version leaves the selected video unchanged and cannot delete a running task', () => {
  const { shot } = fixture()
  shot.videos = [
    { id: 'older', url: 'https://assets.example/older.mp4' },
    { id: 'current', url: 'https://assets.example/current.mp4' },
    { id: 'pending', status: 'processing' },
  ]
  shot.videoId = 'current'
  shot.kept = true
  shot.start = 2
  removeVideo(shot, 'older')
  removeVideo(shot, 'missing')
  removeVideo(shot, 'pending')
  assert.deepEqual(
    shot.videos.map((item) => item.id),
    ['current', 'pending'],
  )
  assert.equal(shot.videoId, 'current')
  assert.equal(shot.kept, true)
  assert.equal(shot.start, 2)
})
