import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configureMainVideo2Task,
  buildMainVideo2Request,
  MAIN_VIDEO_2_STORAGE,
} from '../src/utils/productVideo2.js'
import {
  newProductVideoTask,
  newShot,
  buildPlanRequest,
  buildVideoRequest,
  productVideoShotLimit,
  applyPlanningState,
  ANMIAO25_VIDEO_MODEL,
  ANMIAO_VIDEO_MODEL,
  ANMIAO20_FAST_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  WHOLE_VIDEO_30_MODEL,
  supportsVideoAudioToggle,
} from '../src/utils/productVideo.js'

function fixture() {
  const task = configureMainVideo2Task(
    newProductVideoTask('新视频2'),
    [{ value: 'gem-3-pro' }],
    [{ value: ANMIAO25_VIDEO_MODEL }],
  )
  task.references = [{ id: 'original', url: 'https://assets.example/product-original.png' }]
  task.video2.productName = '日式窗帘'
  task.video2.sellingPoints = '遮光、自然垂坠'
  return task
}
test('main video 2 has a separate library and profile without changing the original task defaults', () => {
  const original = newProductVideoTask()
  const snapshot = JSON.stringify(original)
  const task = fixture()
  assert.equal(MAIN_VIDEO_2_STORAGE, 'productVideo2')
  assert.equal(task.planner, 'main_video_2')
  assert.equal(task.planningModel, 'gem-3-pro')
  assert.equal(task.productStudy, undefined)
  assert.equal(task.productionMode, 'single_video')
  assert.equal(JSON.stringify(original), snapshot)
  assert.equal(original.planner, undefined)
  assert.equal(productVideoShotLimit(task), Infinity)
})
test('the complete initial facts and original images reach the new planner without old timeline or shot-count constraints', () => {
  const task = fixture()
  task.brief = '自然生活事件，不要硬广'
  task.video2.firstFrame = { url: 'https://assets.example/first-original.png' }
  const payload = buildPlanRequest(task, 8)
  assert.equal(payload.productionMode, 'main_video_2')
  assert.equal(payload.count, 1)
  assert.equal(payload.timelineCount, undefined)
  assert.deepEqual(payload.images, [task.references[0].url, task.video2.firstFrame.url])
  const input = JSON.parse(payload.brief)
  assert.equal(input.productName, task.video2.productName)
  assert.equal(input.sellingPoints, task.video2.sellingPoints)
  assert.equal(input.requirements, task.brief)
  assert.equal(input.firstFrameUrl, task.video2.firstFrame.url)
})
test('reference videos create 30-second source units without reusing the old frame-sampling analysis', () => {
  for (const [duration, count] of [
    [15, 1],
    [30, 1],
    [31, 2],
    [60, 2],
    [91, 4],
  ]) {
    const task = fixture()
    task.referenceVideo = {
      url: 'https://assets.example/original.mp4',
      duration,
      frames: [{ url: 'https://assets.example/poster.jpg', time: 0 }],
    }
    const payload = buildMainVideo2Request(task)
    assert.equal(payload.count, count)
    assert.deepEqual(payload.referenceVideo.frames, [])
    assert.equal(payload.referenceVideo.url, task.referenceVideo.url)
    assert.equal(payload.referenceVideo.duration, duration)
    assert.ok(!payload.images.includes(task.referenceVideo.frames[0].url))
  }
})
test('changing a version preserves product facts, all images and the complete previous script', () => {
  const task = fixture()
  const previous = '完整脚本内容。'.repeat(2000) + '最后一段口播也要保留'
  task.shots = [newShot({ productionMode: 'single_video', motion: previous })]
  task.video2.revision = '换一个卧室场景，其余不变'
  task.video2.planningIntent = 'revise'
  const restored = JSON.parse(JSON.stringify(task))
  const payload = buildMainVideo2Request(restored)
  const input = JSON.parse(payload.brief)
  assert.equal(input.previousScript, previous)
  assert.equal(input.planningIntent, 'revise')
  assert.equal(input.revision, task.video2.revision)
  assert.equal(input.productName, task.video2.productName)
  assert.deepEqual(
    payload.images,
    task.references.map((item) => item.url),
  )
  assert.equal(input.allowReferenceStructureChanges, false)
  assert.equal(input.allowAudioChanges, false)
})
test('replanning keeps the original facts and images without feeding the old five-shot template back', () => {
  const task = fixture()
  task.shots = [newShot({ productionMode: 'single_video', motion: '旧的五个镜头脚本' })]
  task.video2.revision = '之前留下的局部修改意见'
  task.video2.planningIntent = 'plan'
  const payload = buildMainVideo2Request(task),
    input = JSON.parse(payload.brief)
  assert.equal(input.planningIntent, 'plan')
  assert.equal(input.previousScript, '')
  assert.deepEqual(input.previousScripts, [])
  assert.deepEqual(input.previousCreative, [])
  assert.equal(input.revision, '')
  assert.equal(input.sellingPoints, task.video2.sellingPoints)
  assert.deepEqual(
    payload.images,
    task.references.map((item) => item.url),
  )
})
test('a new creative version compares prior opening and ending ideas without reusing numbered shots', () => {
  const task = fixture()
  task.video2.planningIntent = 'variant'
  task.shots = [
    newShot({
      productionMode: 'single_video',
      motion:
        '分镜设计：\n分镜1（0秒-2秒）：旧的生活开场。\n分镜2（2秒-5秒）：旧的第二镜。\n分镜3（5秒-9秒）：旧的第三镜。\n分镜4（9秒-12秒）：旧的第四镜。\n分镜5（12秒-15秒）：旧的收尾。\n口播设计：\n口播1（对应分镜1-分镜5，时间：0秒-15秒）：旧的口播方向。',
    }),
  ]
  const payload = buildMainVideo2Request(task),
    input = JSON.parse(payload.brief)
  assert.equal(input.previousScript, '')
  assert.deepEqual(input.previousScripts, [])
  assert.equal(input.previousCreative[0].opening, '旧的生活开场。')
  assert.equal(input.previousCreative[0].ending, '旧的收尾。')
  assert.equal(input.previousCreative[0].voice, '旧的口播方向。')
  assert.ok(!JSON.stringify(input.previousCreative).includes('分镜5'))
  assert.deepEqual(
    payload.images,
    task.references.map((item) => item.url),
  )
})
test('plain scripts survive asynchronous checkpoints exactly and generate directly with original references', () => {
  const task = fixture(),
    raw =
      '根据以下分镜描述生成：图1【日式窗帘】【情景种草】真实短视频，不生成任何字幕\n分镜设计：\n分镜1：完整画面。\n口播设计：\n无口播。'
  task.planJob = {
    id: 'video2-job',
    appliedCount: 0,
    referenceIds: ['original'],
    request: buildMainVideo2Request(task),
  }
  applyPlanningState(task, {
    id: 'video2-job',
    status: 'completed',
    updatedAt: 10,
    count: 1,
    result: {
      shots: [{ title: '完整脚本', productionMode: 'single_video', motion: raw, duration: 15 }],
    },
  })
  assert.equal(task.shots[0].motion, raw)
  assert.equal(task.shots[0].images.length, 0)
  task.videoModel = MINIMAX_VIDEO_MODEL
  const generation = buildVideoRequest(task, task.shots[0], 'video2-direct')
  assert.deepEqual(generation.image_urls, [task.references[0].url])
  assert.ok(generation.prompt.includes(raw))
  assert.equal(generation.first_frame_url, undefined)
  task.video2.firstFrame = { url: 'https://assets.example/opening-original.png' }
  const withOpening = buildVideoRequest(task, task.shots[0], 'video2-opening')
  assert.deepEqual(withOpening.image_urls, [task.references[0].url, task.video2.firstFrame.url])
  assert.match(withOpening.prompt, /用户可选首帧参考/)
  assert.ok(!withOpening.prompt.includes('全片共 4 个分镜'))
  task.shots[0].motion = raw.replace(
    '分镜1：完整画面。',
    Array.from({ length: 10 }, (_, index) => `分镜${index + 1}：生活事件与连续动态。`).join('\n'),
  )
  const tenShots = buildVideoRequest(task, task.shots[0], 'video2-ten-shots')
  assert.match(tenShots.prompt, /全片共 10 个分镜/)
})

test('content-driven shot timestamps reach video generation unchanged and still determine the actual shot count', () => {
  const task = fixture()
  const boundaries = [0, 1.8, 4.6, 7.8, 10, 12.5, 15]
  const raw =
    '根据以下分镜描述生成：图1【日式窗帘】【情景种草】真实短视频，不生成任何字幕\n分镜设计：\n' +
    boundaries
      .slice(1)
      .map(
        (end, index) =>
          `分镜${index + 1}（${boundaries[index]}秒-${end}秒）：参考图1，按生活动作与口播推进。`,
      )
      .join('\n') +
    '\n口播设计：\n无口播，保留环境音。'
  const shot = newShot({ productionMode: 'single_video', motion: raw, duration: 15 })
  shot.referenceIds = ['original']
  task.shots = [shot]
  task.videoModel = MINIMAX_VIDEO_MODEL
  const request = buildVideoRequest(task, shot, 'video2-content-times')
  assert.ok(request.prompt.includes(raw))
  assert.match(request.prompt, /全片共 6 个分镜/)
  assert.deepEqual(request.image_urls, [task.references[0].url])
  assert.equal(request.durationSeconds, 15)
})

test('main video 2 forwards the saved audio switch to Seedance for both 15- and 30-second generation', () => {
  for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO20_FAST_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL]) {
    for (const enabled of [true, false]) {
      const task = fixture()
      task.videoModel = task.wholeVideo30Model = model
      task.generateAudio = task.keepOriginalAudio = enabled
      const restored = JSON.parse(JSON.stringify(task))
      for (const mode of model === ANMIAO25_VIDEO_MODEL
        ? ['single_video', 'single_video_30']
        : ['single_video']) {
        const shot = newShot({
          productionMode: mode,
          motion: `分镜1（0秒-${mode === 'single_video_30' ? 30 : 15}秒）：拉拢窗帘。\n口播设计：温柔旁白，钢琴音乐。`,
        })
        shot.referenceIds = ['original']
        const request = buildVideoRequest(restored, shot, `audio-${model}-${enabled}-${mode}`)
        assert.equal(supportsVideoAudioToggle(model), true)
        assert.equal(request.generate_audio, enabled)
        assert.deepEqual(request.image_urls, [task.references[0].url])
        assert.match(request.prompt, enabled ? /生成与画面同步的音轨/ : /仅生成无声画面/)
        if (!enabled) assert.match(request.prompt, /脚本中的声音设计不执行/)
      }
    }
  }
})

test('models without an audio switch do not receive an unsupported parameter', () => {
  for (const model of [MINIMAX_VIDEO_MODEL, WHOLE_VIDEO_30_MODEL]) {
    assert.equal(supportsVideoAudioToggle(model), false)
  }
  const task = fixture()
  task.videoModel = MINIMAX_VIDEO_MODEL
  task.generateAudio = false
  const shot = newShot({ productionMode: 'single_video', motion: '商品镜头与声音设计' })
  shot.referenceIds = ['original']
  const request = buildVideoRequest(task, shot, 'native-audio')
  assert.equal(request.generate_audio, undefined)
  assert.ok(!request.prompt.includes('仅生成无声画面'))
})
