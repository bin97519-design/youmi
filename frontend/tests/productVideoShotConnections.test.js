import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  buildImageRequest,
  buildVideoRequest,
  buildPlanRequest,
  buildCompositionRequest,
} from '../src/utils/productVideo.js'
import {
  adjacentProductVideoShots,
  shotConnection,
  previousShotTailSource,
  usableShotConnectionFrame,
  validateShotConnectionVideo,
  shotMotionHandoffPrompt,
} from '../src/utils/productVideoShotConnections.js'

function fixture() {
  const workflow = newProductVideo()
  workflow.continuity.enabled = false
  workflow.brief = '同一房间中拉合纱帘，再触摸布料，最后拉回全景。'
  workflow.references = [{ id: 'product', url: 'https://media.example/product.png' }]
  workflow.shots = [
    newShot({
      title: '拉合纱帘',
      imagePrompt: '窗帘打开，女士站在右侧',
      motion: '将纱帘拉合',
      connection: {
        type: 'opening',
        startState: '纱帘打开，右手握帘',
        endState: '纱帘闭合，右手仍握住边缘',
        transition: '进入客厅',
      },
    }),
    newShot({
      title: '触摸布料',
      imagePrompt: '同一只右手接触闭合纱帘',
      motion: '顺着帘边轻抚',
      connection: {
        type: 'match_cut',
        startState: '纱帘闭合，右手仍握住边缘',
        endState: '右手放下，纱帘保持闭合',
        transition: '在同一动作阶段切入特写',
      },
    }),
    newShot({
      title: '全景收尾',
      imagePrompt: '纱帘闭合，右手放下',
      motion: '缓慢拉远',
      connection: {
        type: 'match_cut',
        startState: '右手放下，纱帘保持闭合',
        endState: '稳定全景',
        transition: '从手部特写匹配切到全景',
      },
    }),
  ]
  for (const [index, shot] of workflow.shots.entries()) {
    shot.id = `shot-${index}`
    shot.referenceIds = ['product']
    shot.images = [
      {
        id: `image-${index}`,
        url: `https://media.example/first-${index}.jpg`,
        status: 'completed',
      },
    ]
    shot.imageId = shot.approvedImageId = `image-${index}`
    shot.videos = [
      {
        id: `video-${index}`,
        url: `https://media.example/video-${index}.mp4`,
        duration: 15,
        status: 'completed',
      },
    ]
    shot.videoId = `video-${index}`
    shot.kept = true
  }
  return workflow
}

test('image and video execution receive adjacent states without forcing an identical camera', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  for (const request of [
    buildImageRequest(workflow, shot, 'image'),
    buildVideoRequest(workflow, shot, 'video'),
  ]) {
    assert.match(request.prompt, /上一镜「拉合纱帘」结束：纱帘闭合，右手仍握住边缘/)
    assert.doesNotMatch(request.prompt, /上一镜动作与运镜：将纱帘拉合/)
    assert.match(request.prompt, /本镜开始状态：纱帘闭合，右手仍握住边缘/)
    assert.match(request.prompt, /本镜在成片第 4 秒的结束状态：右手放下，纱帘保持闭合/)
    assert.match(request.prompt, /下一镜「全景收尾」起点：右手放下，纱帘保持闭合/)
    assert.doesNotMatch(request.prompt, /下一镜动作与运镜：缓慢拉远/)
    assert.match(request.prompt, /邻镜仅提供接点，不重演前镜或提前执行下一镜/)
    assert.match(request.prompt, /可换机位和景别/)
    assert.match(request.prompt, /不能重置动作/)
  }
  assert.deepEqual(buildVideoRequest(workflow, shot, 'video').image_urls, [shot.images[0].url])
})

test('image start preserves an ongoing contact rather than resetting every shot before the action', () => {
  const workflow = fixture(), shot = workflow.shots[1]
  const prompt = buildImageRequest(workflow, shot, 'image').prompt
  assert.match(prompt, /本镜开始状态：纱帘闭合，右手仍握住边缘/)
  assert.match(prompt, /切入瞬间的起始姿势与手部接触状态/)
  assert.match(prompt, /已经握住、接触或拉动商品时保留动作进度，不退回接触前/)
  assert.doesNotMatch(prompt, /手部与商品接触前的起始姿势/)
})

test('neighbor execution scripts do not leak into the current video, even without structured states', () => {
  const workflow = fixture(), shot = workflow.shots[1]
  workflow.shots[0].motion = 'PREVIOUS_OPERATION_DO_NOT_REPEAT'
  workflow.shots[0].connection.endState = ''
  workflow.shots[2].motion = 'NEXT_OPERATION_DO_NOT_PERFORM'
  workflow.shots[2].connection.startState = ''
  workflow.shots[2].imagePrompt = 'NEXT_FRAME_DO_NOT_RENDER'
  const prompt = buildVideoRequest(workflow, shot, 'video').prompt
  assert.doesNotMatch(prompt, /PREVIOUS_OPERATION|NEXT_OPERATION|NEXT_FRAME/)
  assert.ok(prompt.includes(shot.motion))
  assert.match(prompt, /首帧与已确认的实际动作衔接优先于旧稿起点，不回退或重演/)
})

test('confirmed actual tail state takes precedence over an outdated planned ending', () => {
  const workflow = fixture(), shot = workflow.shots[1]
  const source = previousShotTailSource(workflow, shot)
  workflow.shots[0].connection.endState = 'STALE_PLANNED_END'
  shot.motionObservation = {
    sourceKey: source.sourceKey, targetMotion: shot.motion, confirmed: true, status: 'completed',
    results: [{ previousState: 'ACTUAL_HAND_STILL_PULLING', motion: 'Continue moving right' }],
  }
  const prompt = buildVideoRequest(workflow, shot, 'video').prompt
  assert.match(prompt, /上一镜「拉合纱帘」结束：ACTUAL_HAND_STILL_PULLING/)
  assert.doesNotMatch(prompt, /STALE_PLANNED_END/)
})

test('captions stay out of generation prompts and are included only in composition', () => {
  const workflow = fixture(), shot = workflow.shots[1]
  shot.caption = '让日光柔和地落下来'
  for (const request of [buildImageRequest(workflow, shot, 'image'), buildVideoRequest(workflow, shot, 'video')])
    assert.ok(!request.prompt.includes(shot.caption))
  assert.equal(buildCompositionRequest(workflow).clips[1].caption, shot.caption)
})

test('interior shots cut on planned motion rather than holding and restarting each shot', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  shot.motion = '沿着帘边轻抚，动作完成后自然停留。'
  const request = buildVideoRequest(workflow, shot, 'video')
  assert.ok(request.prompt.includes(shot.motion))
  assert.match(request.prompt, /切入即承接前镜的动作阶段、屏幕运动方向和速度，不重新起步/)
  assert.match(request.prompt, /在成片第4秒从已规划的动作或运镜中接出，不提前停稳/)
  assert.match(request.prompt, /旧稿的停留只保留明确叙事需要/)
  assert.match(request.prompt, /不添加无依据的商品运动/)
  assert.match(request.prompt, /不做幻灯片式图片溶解或静态缩放/)
  assert.equal(request.prompt.split('动作完成后自然停留').length - 1, 1)
})

test('opening starts immediately, only the final shot receives a settling instruction', () => {
  const workflow = fixture()
  const opening = buildVideoRequest(workflow, workflow.shots[0], 'opening').prompt
  assert.match(opening, /从第0秒执行已规划的动作或运镜，不先定格展示首帧/)
  assert.match(opening, /不提前停稳/)
  assert.doesNotMatch(opening, /切入即承接前镜|末镜可按策划减速停稳/)
  const final = buildVideoRequest(workflow, workflow.shots[2], 'final').prompt
  assert.match(final, /末镜可按策划减速停稳，完成收尾/)
  assert.doesNotMatch(final, /不提前停稳|动作完成后自然停留/)
})

test('time and scene changes do not force the previous camera movement into a new setup', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  for (const type of ['time_cut', 'scene_cut']) {
    shot.connection.type = type
    const prompt = shotMotionHandoffPrompt(workflow, shot)
    assert.match(prompt, /从第0秒执行已规划的动作或运镜/)
    assert.doesNotMatch(prompt, /切入即承接前镜/)
  }
})

test('reference-based shots preserve intentional pauses and their actual transitions', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  for (const referenceBy of ['workflow', 'shot']) {
    workflow.planningSource = referenceBy === 'workflow' ? 'reference' : 'creative'
    shot.referenceRange = referenceBy === 'shot' ? { start: 4, end: 8 } : null
    const prompt = buildVideoRequest(workflow, shot, 'reference').prompt
    assert.match(prompt, /遵循参考视频原有的动作、运镜与叙事停顿/)
    assert.doesNotMatch(prompt, /旧稿的停留只保留|不提前停稳|切入即承接前镜/)
    if (referenceBy === 'shot') {
      assert.match(prompt, /复现本段的动作阶段和原有转场，不补整套操作或人为停留/)
      assert.doesNotMatch(prompt, /完成全部动作与转场，之后自然停留/)
    }
  }
})

test('single-shot refinement retains structured connections and marks its ordered context', () => {
  const workflow = fixture(),
    request = buildPlanRequest(workflow, 1, workflow.shots[1])
  assert.deepEqual(request.currentShot.connection, workflow.shots[1].connection)
  assert.deepEqual(
    request.contextShots.map((shot) => shot.current),
    [false, true, false],
  )
  assert.deepEqual(request.contextShots[0].connection, workflow.shots[0].connection)
})

test('long motion keeps its full text while adjacent states fit the provider prompt budget', () => {
  for (const audio of [false, true]) {
    const workflow = fixture(),
      shot = workflow.shots[1]
    workflow.generateAudio = audio
    workflow.lastPlanSummary = { concept: '故事'.repeat(500) }
    shot.motion = '画'.repeat(1795) + '最后镜头。'
    workflow.shots[0].connection.endState = '前镜末态'.repeat(50)
    shot.connection.startState = '本镜起点'.repeat(50)
    shot.connection.endState = '本镜终点'.repeat(50)
    shot.connection.transition = '切入特写'.repeat(50)
    workflow.shots[2].connection.startState = '下一镜起'.repeat(50)
    const request = buildVideoRequest(workflow, shot, 'long-video')
    assert.ok(request.prompt.includes(shot.motion))
    assert.ok(request.prompt.length <= 2400)
    for (const label of ['上一镜末：', '本镜起：', '本镜末(4秒)：', '下一镜起：', '转场：'])
      assert.ok(request.prompt.includes(label))
    assert.match(request.prompt, /商品外观约束/)
    assert.match(request.prompt, /屏幕运动方向和速度，不重新起步/)
    assert.match(request.prompt, /不提前停稳/)
    if (audio) assert.match(request.prompt, /声音要求/)
  }
})

test('tail extraction uses the actual composition cut, and speed mode uses the full source end', () => {
  const workflow = fixture(),
    previous = workflow.shots[0],
    shot = workflow.shots[1]
  previous.start = 2
  previous.duration = 4
  assert.equal(previousShotTailSource(workflow, shot).time, 5.96)
  previous.timingMode = 'speed'
  assert.equal(previousShotTailSource(workflow, shot).time, 14.96)
  previous.videos[0].status = 'processing'
  assert.equal(previousShotTailSource(workflow, shot), null)
})

test('continuation requires an approved actual predecessor frame, not an independently generated start', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  shot.connection.type = 'continue'
  assert.throws(() => buildVideoRequest(workflow, shot, 'video'), /重新提取/)
  const source = previousShotTailSource(workflow, shot)
  shot.connectionFrame = { ...source, url: 'https://media.example/connection.jpg' }
  shot.images[0] = {
    ...shot.images[0],
    url: shot.connectionFrame.url,
    sourceConnectionKey: source.sourceKey,
  }
  validateShotConnectionVideo(workflow, shot)
  assert.equal(buildVideoRequest(workflow, shot, 'video').first_frame_url, shot.connectionFrame.url)
  assert.match(buildVideoRequest(workflow, shot, 'video').prompt, /当前首帧来自上一镜成片结束位置/)
  assert.match(buildVideoRequest(workflow, shot, 'video').prompt, /屏幕运动方向和速度，不重新起步/)
  workflow.shots[0].duration = 5
  assert.equal(usableShotConnectionFrame(workflow, shot), null)
  assert.throws(() => buildVideoRequest(workflow, shot, 'video'), /重新提取/)
  assert.throws(() => buildImageRequest(workflow, shot, 'image'), /裁剪范围已改变/)
})

test('matching-cut images include a real tail reference without replacing their own start frame', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  const source = previousShotTailSource(workflow, shot)
  shot.connectionFrame = { ...source, url: 'https://media.example/match.jpg' }
  assert.deepEqual(buildImageRequest(workflow, shot, 'image').image_urls, [
    workflow.references[0].url,
    shot.connectionFrame.url,
  ])
  assert.match(buildImageRequest(workflow, shot, 'image').prompt, /图2是上一镜成片结束时的真实画面/)
  assert.equal(buildVideoRequest(workflow, shot, 'video').first_frame_url, shot.images[0].url)
})

test('composition rejects stale continuation versions or omission of the predecessor', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  shot.connection.type = 'continue'
  const source = previousShotTailSource(workflow, shot)
  shot.videos[0].sourceConnectionKey = source.sourceKey
  assert.equal(buildCompositionRequest(workflow).clips.length, 3)
  workflow.shots[0].kept = false
  assert.throws(() => buildCompositionRequest(workflow), /动作接力/)
  workflow.shots[0].kept = true
  workflow.shots[0].videoId = ''
  assert.throws(() => validateShotConnectionVideo(workflow, shot), /先完成上一镜/)
})

test('whole-video mode and legacy shots remain compatible, while reordering invalidates tail ownership', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  shot.connectionFrame = {
    ...previousShotTailSource(workflow, shot),
    url: 'https://media.example/tail.jpg',
  }
  workflow.shots.reverse()
  assert.equal(usableShotConnectionFrame(workflow, shot), null)
  shot.productionMode = 'single_video'
  assert.equal(adjacentProductVideoShots(workflow, shot).previous, null)
  assert.doesNotMatch(buildVideoRequest(workflow, shot, 'video').prompt, /上一镜「/)
  assert.doesNotMatch(buildVideoRequest(workflow, shot, 'video').prompt, /镜间节奏：|运动衔接：/)
  assert.equal(buildImageRequest(workflow, shot, 'image').image_urls.length, 1)
  delete shot.connection
  assert.equal(shotConnection(workflow, shot).type, 'opening')
})
