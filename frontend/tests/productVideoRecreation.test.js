import test from 'node:test'
import assert from 'node:assert/strict'
import { newProductVideo, newShot, buildPlanRequest, buildImageRequest, buildVideoRequest,
  ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL } from '../src/utils/productVideo.js'
import { setContinuityReference, setContinuitySetting, continuityReferenceImages } from '../src/utils/productVideoContinuity.js'
import { recreationMaterialIssue, referenceGenerationIssue } from '../src/utils/productVideoRecreation.js'
import { productVideoBatchConfiguration } from '../src/utils/productVideoBatch.js'

function fixture() {
  const workflow = newProductVideo()
  Object.assign(workflow, { planningSource: 'reference', productionMode: 'single_video',
    videoModel: ANMIAO25_VIDEO_MODEL, brief: '窗帘，替换商品与人物',
    referenceVideo: { url: 'https://assets.example/original.mp4', duration: 12,
      frames: [{ url: 'https://assets.example/source-frame.jpg', time: .1 }], suggestedShotCount: 1 },
    references: [{ id: 'product', url: 'https://assets.example/product-original.png' }],
  })
  const shot = newShot({ productionMode: 'single_video', timelineCount: 1,
    imagePrompt: '新人物在新卧室拉窗帘', motion: '0-15 秒：侧后中景，女子平稳拉拢窗帘，布面连续形成褶皱后停下。',
    timeline: [{ start: 0, end: 15, action: '拉窗帘', camera: '侧后中景', transition: '收尾' }] })
  shot.images = [{ id: 'approved', url: 'https://assets.example/approved-original.png', status: 'completed' }]
  shot.imageId = shot.approvedImageId = 'approved'
  shot.videoInputMode = 'first_frame'
  shot.referenceIds = ['product']
  workflow.shots = [shot]
  return { workflow, shot }
}

test('person and scene references reach planning and image generation with separate product roles', () => {
  const { workflow, shot } = fixture()
  setContinuitySetting(workflow, 'personMode', 'reference')
  setContinuitySetting(workflow, 'sceneMode', 'custom')
  setContinuityReference(workflow, 'person', { url: 'https://assets.example/new-person.png' })
  setContinuityReference(workflow, 'scene', { url: 'https://assets.example/new-room.png' })
  const plan = buildPlanRequest(workflow, 1, null, { imageEvidenceRoles: true })
  assert.deepEqual(plan.images, [workflow.references[0].url,
    'https://assets.example/new-person.png', 'https://assets.example/new-room.png'])
  assert.deepEqual(plan.imageRoles.map(item => item.role), ['product', 'person', 'scene'])
  assert.equal(plan.brief, workflow.brief)
  assert.match(plan.continuity, /人物：替换为人物参考图/)
  assert.match(plan.continuity, /场景：使用新的场景参考图/)
  const image = buildImageRequest(workflow, shot, 'image-check')
  assert.deepEqual(image.image_urls, plan.images)
  assert.match(image.prompt, /不从原视频|不得从原视频/)
  assert.match(image.prompt, /只生成当前来源镜头或整片的开场画面/)
  assert.doesNotMatch(image.prompt, /本图将作为全片基准候选/)
  workflow.referenceRecreation.generationMode = 'video'
  shot.approvedImageId = shot.imageId
  assert.deepEqual(buildVideoRequest(workflow, shot, 'role-reference-video').image_urls,
    [shot.images[0].url, ...plan.images])
})

test('video reference generation forwards the original video and images without conflicting strict-frame parameters', () => {
  const { workflow, shot } = fixture()
  workflow.referenceRecreation.generationMode = 'video'
  const request = buildVideoRequest(workflow, shot, 'video-check')
  assert.deepEqual(request.reference_videos, [{ url: workflow.referenceVideo.url, durationSeconds: 12 }])
  assert.deepEqual(request.image_urls, [shot.images[0].url, workflow.references[0].url])
  assert.equal(request.first_frame_url, undefined)
  assert.equal(request.last_frame_url, undefined)
  assert.equal(request.ratio, '3:4')
  assert.equal(request.client_task_id, 'video-check')
  assert.match(request.prompt, /重新设计人物外观/)
  assert.match(request.prompt, /原参考视频用于动作、运镜/)
  assert.match(request.prompt, /不克隆原片人物声线/)
})

test('script-only mode retains strict first-frame generation and does not silently attach source video', () => {
  const { workflow, shot } = fixture()
  const request = buildVideoRequest(workflow, shot, 'script-check')
  assert.equal(request.first_frame_url, shot.images[0].url)
  assert.equal(request.reference_videos, undefined)
  assert.equal(request.ratio, 'adaptive')
  assert.match(request.prompt, /第 0 秒画面/)
})

test('authorized source sound design remains an explicit choice instead of forcing new audio', () => {
  const { workflow, shot } = fixture()
  workflow.referenceRecreation.audioMode = 'source'
  const request = buildVideoRequest(workflow, shot, 'authorized-sound')
  assert.match(request.prompt, /已授权原片声音设计/)
  assert.doesNotMatch(request.prompt, /声音：重新策划台词/)
  assert.match(request.prompt, /不能声称已直接复用原音轨/)
})

test('unsupported model, long sources and multi-shot requests stop instead of dropping the reference video', () => {
  const { workflow, shot } = fixture()
  workflow.referenceRecreation.generationMode = 'video'
  workflow.videoModel = MINIMAX_VIDEO_MODEL
  assert.throws(() => buildVideoRequest(workflow, shot, 'unsupported'), /不支持参考视频/)
  workflow.videoModel = ANMIAO25_VIDEO_MODEL
  workflow.referenceVideo.duration = 60
  assert.throws(() => buildVideoRequest(workflow, shot, 'long'), /2 至 30 秒/)
  workflow.referenceVideo.duration = 12
  shot.productionMode = 'storyboard'
  assert.match(referenceGenerationIssue(workflow, workflow.videoModel, shot), /用于整片制作/)
  workflow.referenceRecreation.generationMode = 'script'
  assert.equal(referenceGenerationIssue(workflow, MINIMAX_VIDEO_MODEL, shot), '')
})

test('changing identities clears image approval but preserves every existing image and video', () => {
  const { workflow, shot } = fixture()
  shot.videos = [{ id: 'finished', url: 'https://assets.example/finished.mp4' }]
  const images = shot.images, videos = shot.videos
  setContinuitySetting(workflow, 'personMode', 'reference')
  assert.equal(shot.approvedImageId, '')
  assert.equal(shot.images, images)
  assert.equal(shot.videos, videos)
  assert.match(recreationMaterialIssue(workflow), /人物参考图/)
  assert.throws(() => buildPlanRequest(workflow, 1), /人物参考图/)
  assert.throws(() => buildImageRequest(workflow, shot, 'missing-person'), /人物参考图/)
  setContinuityReference(workflow, 'person', { url: 'https://assets.example/person.png' })
  assert.equal(recreationMaterialIssue(workflow), '')
  setContinuitySetting(workflow, 'personMode', 'new')
  assert.equal(continuityReferenceImages(workflow).length, 0)
})

test('reference uploads remain in their original settings if creative mode is selected during upload', () => {
  const { workflow } = fixture()
  const creative = workflow.continuity
  workflow.planningSource = 'creative'
  setContinuityReference(workflow, 'person', { url: 'https://assets.example/person.png' },
    { planningSource: 'reference', productionMode: 'single_video' })
  assert.equal(workflow.referenceRecreation.images.person.url, 'https://assets.example/person.png')
  assert.equal(workflow.continuity, creative)
  assert.equal(workflow.wholeContinuity, undefined)
})

test('batch confirmation becomes stale when the source video or reference generation mode changes', () => {
  const { workflow, shot } = fixture()
  const original = productVideoBatchConfiguration(workflow, [shot.id])
  workflow.referenceRecreation.generationMode = 'video'
  assert.notEqual(productVideoBatchConfiguration(workflow, [shot.id]), original)
  workflow.referenceRecreation.generationMode = 'script'
  workflow.referenceVideo.url = 'https://assets.example/replaced.mp4'
  assert.notEqual(productVideoBatchConfiguration(workflow, [shot.id]), original)
})
