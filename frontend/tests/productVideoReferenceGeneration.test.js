import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  buildVideoRequest,
  buildPlanRequest,
  canGenerateVideo,
  usesWholeReferenceImages,
  wholeVideoReferenceInputs,
  wholeReferenceGenerationIssue,
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
} from '../src/utils/productVideo.js'
import {
  setContinuityReference,
  setContinuitySetting,
} from '../src/utils/productVideoContinuity.js'
import {
  productVideoBatchCandidates,
  productVideoBatchConfiguration,
} from '../src/utils/productVideoBatch.js'

function fixture() {
  const workflow = newProductVideo()
  workflow.productionMode = 'single_video'
  workflow.videoModel = MINIMAX_VIDEO_MODEL
  workflow.references = Array.from({ length: 5 }, (_, index) => ({
    id: `ref-${index}`,
    name: `参考图${index + 1}`,
    url: `https://assets.example/original-${index + 1}.png`,
  }))
  const shot = newShot({
    productionMode: 'single_video',
    duration: 15,
    timelineCount: 3,
    motion:
      '0-3 秒：女生走向窗边，握住窗帘内沿。\n3-11 秒：手沿轨道顺滑拉拢窗帘，室内逐步变暗。\n11-15 秒：镜头下移展示窗帘垂地边缘，环境安静。',
  })
  shot.referenceIds = workflow.references.map((item) => item.id)
  workflow.shots = [shot]
  return { workflow, shot }
}

test('whole videos use all selected original references by default without generating or approving a first frame', () => {
  const { workflow, shot } = fixture()
  const original = JSON.stringify(workflow)
  assert.equal(usesWholeReferenceImages(workflow, shot), true)
  assert.equal(canGenerateVideo(shot, workflow), true)
  const request = buildVideoRequest(workflow, shot, 'direct-request')
  assert.deepEqual(
    request.image_urls,
    workflow.references.map((item) => item.url),
  )
  assert.equal(request.first_frame_url, undefined)
  assert.equal(request.last_frame_url, undefined)
  assert.equal(request.durationSeconds, 15)
  assert.equal(request.model, MINIMAX_VIDEO_MODEL)
  assert.equal(request.ratio, '3:4')
  assert.equal(request.resolution, '768p')
  assert.ok(request.prompt.includes(shot.motion))
  assert.match(request.prompt, /图5：视频参考图/)
  assert.doesNotMatch(request.prompt, /已确认首帧|以提供的首帧图片/)
  assert.equal(JSON.stringify(workflow), original)
})

test('existing first-frame versions and tail selections are preserved but do not replace selected references', () => {
  const { workflow, shot } = fixture()
  shot.images = [
    { id: 'old-frame', url: 'https://assets.example/old-generated.png', status: 'completed' },
  ]
  shot.imageId = 'old-frame'
  shot.lastFrameImageId = workflow.references[4].id
  shot.videos = [{ id: 'old-video', url: 'https://assets.example/old.mp4', status: 'completed' }]
  const original = JSON.stringify(workflow)
  const request = buildVideoRequest(workflow, shot, 'new-version')
  assert.deepEqual(
    request.image_urls,
    workflow.references.map((item) => item.url),
  )
  assert.doesNotMatch(JSON.stringify(request), /old-generated/)
  assert.equal(request.last_frame_url, undefined)
  assert.equal(JSON.stringify(workflow), original)
  shot.videoInputMode = 'first_frame'
  assert.throws(() => buildVideoRequest(workflow, shot, 'first-frame'), /先确认/)
  shot.approvedImageId = 'old-frame'
  const framed = buildVideoRequest(workflow, shot, 'first-frame')
  assert.equal(framed.first_frame_url, shot.images[0].url)
  assert.equal(framed.last_frame_url, workflow.references[4].url)
})

test('image numbering matches planning and includes explicit person, scene and main product references', () => {
  const { workflow, shot } = fixture()
  setContinuitySetting(workflow, 'enabled', true, shot)
  for (const role of ['person', 'scene', 'product'])
    setContinuityReference(
      workflow,
      role,
      { url: `https://assets.example/${role}-original.png` },
      shot,
    )
  const inputs = wholeVideoReferenceInputs(workflow, shot)
  assert.deepEqual(inputs.urls, buildPlanRequest(workflow, 1, shot).images)
  assert.match(inputs.instruction, /图1：商品主参考/)
  assert.match(inputs.instruction, /人物参考/)
  assert.match(inputs.instruction, /场景参考/)
  const request = buildVideoRequest(workflow, shot, 'roles')
  assert.deepEqual(request.image_urls, inputs.urls)
  assert.equal(request.image_urls.length, 8)
  shot.referenceIds = [workflow.references[2].id]
  assert.deepEqual(buildVideoRequest(workflow, shot, 'selection').image_urls, [
    'https://assets.example/product-original.png',
    workflow.references[2].url,
    'https://assets.example/scene-original.png',
    'https://assets.example/person-original.png',
  ])
})

test('references and first-frame modes use independent readiness rules and never drop images for an incompatible model', () => {
  const { workflow, shot } = fixture()
  shot.referenceIds = []
  assert.equal(canGenerateVideo(shot, workflow), false)
  assert.throws(() => buildVideoRequest(workflow, shot, 'empty'), /至少选择一张/)
  shot.referenceIds = workflow.references.map((item) => item.id)
  workflow.videoModel = HAILUO_H3_VIDEO_MODEL
  assert.match(wholeReferenceGenerationIssue(workflow, shot, workflow.videoModel), /只支持首尾帧/)
  assert.equal(canGenerateVideo(shot, workflow), false)
  assert.throws(() => buildVideoRequest(workflow, shot, 'unsupported'), /只支持首尾帧/)
  workflow.videoModel = MINIMAX_VIDEO_MODEL
  shot.productionMode = 'storyboard'
  assert.equal(usesWholeReferenceImages(workflow, shot), false)
  assert.equal(canGenerateVideo(shot, workflow), false)
})

test('Seedance multi-image generation sends every selected original with the chosen ratio and 15/30 second script', () => {
  for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL]) {
    const { workflow, shot } = fixture()
    workflow.videoModel = model
    const request = buildVideoRequest(workflow, shot, model)
    assert.deepEqual(
      request.image_urls,
      workflow.references.map((item) => item.url),
    )
    assert.equal(request.ratio, workflow.ratio)
    assert.equal(request.first_frame_url, undefined)
  }
  const { workflow, shot } = fixture()
  shot.productionMode = 'single_video_30'
  shot.motion = shot.motion.replace('11-15', '11-30')
  workflow.wholeVideo30Model = ANMIAO25_VIDEO_MODEL
  const request = buildVideoRequest(workflow, shot, 'whole30')
  assert.equal(request.durationSeconds, 30)
  assert.deepEqual(
    request.image_urls,
    workflow.references.map((item) => item.url),
  )
})

test('full scripts are not cut off when the reference instructions take the request beyond the old prompt cap', () => {
  const { workflow, shot } = fixture()
  const end = '最后收尾的台词与画面完整保留。'
  shot.motion = '镜头中的动作与光线变化。'.repeat(260) + end
  const request = buildVideoRequest(workflow, shot, 'full-script')
  assert.ok(request.prompt.length > 2400)
  assert.ok(request.prompt.includes(shot.motion))
  assert.ok(request.prompt.includes(end))
})

test('batch generation accepts whole videos without first frames and invalidates confirmation when selected images change', () => {
  const { workflow, shot } = fixture()
  assert.deepEqual(
    productVideoBatchCandidates(workflow).map((item) => item.id),
    [shot.id],
  )
  const config = productVideoBatchConfiguration(workflow, [shot.id])
  shot.referenceIds.pop()
  assert.notEqual(productVideoBatchConfiguration(workflow, [shot.id]), config)
  shot.referenceIds = workflow.references.map((item) => item.id)
  assert.equal(productVideoBatchConfiguration(workflow, [shot.id]), config)
  shot.videoInputMode = 'first_frame'
  assert.notEqual(productVideoBatchConfiguration(workflow, [shot.id]), config)
})

test('reference-video recreation can use the same image-only input step with a separately selected original video', () => {
  const { workflow, shot } = fixture()
  workflow.planningSource = 'reference'
  workflow.videoModel = ANMIAO25_VIDEO_MODEL
  workflow.referenceVideo = { url: 'https://assets.example/original.mp4', duration: 15 }
  const scriptOnly = buildVideoRequest(workflow, shot, 'script')
  assert.equal(scriptOnly.reference_videos, undefined)
  workflow.referenceRecreation.generationMode = 'video'
  const request = buildVideoRequest(workflow, shot, 'reference-video')
  assert.deepEqual(
    request.image_urls,
    workflow.references.map((item) => item.url),
  )
  assert.deepEqual(request.reference_videos, [
    { url: workflow.referenceVideo.url, durationSeconds: 15 },
  ])
  assert.equal(request.first_frame_url, undefined)
  assert.equal(request.ratio, workflow.ratio)
})
