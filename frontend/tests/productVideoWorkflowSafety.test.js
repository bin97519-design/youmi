import test from 'node:test'
import assert from 'node:assert/strict'
import { newProductVideo, newShot, buildVideoRequest, buildCompositionRequest, setShotMotion,
  ANMIAO25_VIDEO_MODEL } from '../src/utils/productVideo.js'
import { previousShotTailSource, validateShotConnectionVideo, generationConnectionMetadata,
  shotBoundaryPreview } from '../src/utils/productVideoShotConnections.js'
import { productVideoBatchCandidates, productVideoBatchConfiguration, batchVideoState } from '../src/utils/productVideoBatch.js'

function fixture() {
  const workflow = newProductVideo()
  workflow.videoModel = ANMIAO25_VIDEO_MODEL
  workflow.continuity.enabled = false
  const first = newShot({ motion: '本镜时长：4秒，持续移动', duration: 4 })
  const next = newShot({ motion: '本镜时长：6秒，持续移动', duration: 6,
    connection: { type: 'match_cut', startState: '延续动作', endState: '切到特写', transition: '动作中切出' } })
  for (const shot of [first, next]) {
    shot.images = [{ id: 'image', url: `https://assets.example/${shot.id}.png` }]
    shot.imageId = shot.approvedImageId = 'image'
    shot.videos = [{ id: 'video', url: `https://assets.example/${shot.id}.mp4`, duration: shot.duration, status: 'completed' }]
    shot.videoId = 'video'
    shot.kept = true
  }
  workflow.shots = [first, next]
  return { workflow, first, next }
}

test('matching-cut dependencies survive generation and block stale exports', () => {
  const { workflow, first, next } = fixture()
  const source = previousShotTailSource(workflow, next)
  next.connectionFrame = { ...source, url: 'https://assets.example/tail.png' }
  Object.assign(next.images[0], generationConnectionMetadata(workflow, next, 'image'))
  Object.assign(next.videos[0], generationConnectionMetadata(workflow, next, 'video'))
  assert.doesNotThrow(() => buildCompositionRequest(workflow))
  first.start = .5
  first.duration = 3
  assert.throws(() => validateShotConnectionVideo(workflow, next), /上一镜.*改变/)
  assert.throws(() => buildCompositionRequest(workflow), /衔接参考已过期/)
  first.start = 0
  first.duration = 4
  assert.doesNotThrow(() => buildCompositionRequest(workflow))
})

test('connection ownership only follows the selected frame actually consumed by a video', () => {
  const { workflow, next } = fixture()
  const source = previousShotTailSource(workflow, next)
  next.connectionFrame = { ...source, url: 'https://assets.example/tail.png' }
  assert.deepEqual(generationConnectionMetadata(workflow, next, 'video'), {})
  next.images[0].request = { image_urls: [next.connectionFrame.url] }
  assert.equal(generationConnectionMetadata(workflow, next, 'video').sourceConnectionKey, source.sourceKey)
})

test('trim duration does not rewrite script timing or create conflicting execution prompts', () => {
  const { workflow, next } = fixture()
  next.duration = 4
  const payload = buildVideoRequest(workflow, next, 'test-only')
  assert.equal(payload.durationSeconds, 6)
  assert.match(payload.prompt, /成片第 6 秒的结束状态/)
  assert.doesNotMatch(payload.prompt, /成片第 4 秒的结束状态/)
  setShotMotion(next, '本镜时长：5秒，连续推进')
  assert.equal(next.scriptDuration, 5)
  assert.equal(next.duration, 4)
  assert.equal(buildVideoRequest(workflow, next, 'test-only').durationSeconds, 5)
})

test('export resolution is explicit and invalidates the export fingerprint payload', () => {
  const { workflow } = fixture()
  assert.equal(buildCompositionRequest(workflow).resolution, '1080p')
  workflow.exportResolution = '4K'
  assert.equal(buildCompositionRequest(workflow).resolution, '4K')
  delete workflow.exportResolution
  assert.equal(buildCompositionRequest(workflow).resolution, undefined)
})

test('boundary preview reflects actual trims and source-speed retiming', () => {
  const { workflow, first, next } = fixture()
  first.start = 1
  first.duration = 2
  next.start = 2
  next.duration = 3
  let clips = shotBoundaryPreview(workflow, next)
  assert.equal(clips[0].start, 2.5)
  assert.equal(clips[0].end, 3)
  assert.equal(clips[1].start, 2)
  assert.equal(clips[1].end, 2.5)
  first.timingMode = 'speed'
  first.duration = 2
  clips = shotBoundaryPreview(workflow, next)
  assert.equal(clips[0].playbackRate, 2)
  assert.equal(clips[0].start, 3)
  assert.equal(clips[0].end, 4)
})

test('batch candidates queue dependent relays without submitting unapproved independent shots', () => {
  const { workflow, first, next } = fixture()
  for (const shot of [first, next]) { shot.videos = []; shot.videoId = ''; shot.kept = false }
  next.connection.type = 'continue'
  next.approvedImageId = ''
  assert.deepEqual(productVideoBatchCandidates(workflow).map(shot => shot.id), [first.id, next.id])
  next.connection.type = 'match_cut'
  assert.deepEqual(productVideoBatchCandidates(workflow).map(shot => shot.id), [first.id])
  first.videos = [{ status: 'unknown' }]
  assert.deepEqual(productVideoBatchCandidates(workflow), [])
})

test('batch configuration excludes approvals but detects model and script changes', () => {
  const { workflow, first, next } = fixture()
  next.connection.type = 'continue'
  const ids = [first.id, next.id], original = productVideoBatchConfiguration(workflow, ids)
  next.approvedImageId = ''
  assert.equal(productVideoBatchConfiguration(workflow, ids), original)
  next.motion += ' changed'
  assert.notEqual(productVideoBatchConfiguration(workflow, ids), original)
  next.motion = '本镜时长：6秒，持续移动'
  workflow.videoModel = 'another-model'
  assert.notEqual(productVideoBatchConfiguration(workflow, ids), original)
})

test('independent first-frame changes and reordered neighbors pause an accepted batch configuration', () => {
  const { workflow, first, next } = fixture()
  const ids = [first.id, next.id], original = productVideoBatchConfiguration(workflow, ids)
  next.imageId = 'another-image'
  assert.notEqual(productVideoBatchConfiguration(workflow, ids), original)
  next.imageId = 'image'
  workflow.shots.reverse()
  assert.notEqual(productVideoBatchConfiguration(workflow, ids), original)
})

test('batch state does not treat uncertain or failed submissions as completed assets', () => {
  const { next } = fixture()
  next.videos.push({ batchId: 'batch', status: 'unknown' })
  assert.equal(batchVideoState(next, 'batch'), 'unknown')
  next.videos.at(-1).status = 'processing'
  assert.equal(batchVideoState(next, 'batch'), 'processing')
  next.videos.at(-1).status = 'failed'
  assert.equal(batchVideoState(next, 'batch'), 'failed')
  next.videos.at(-1).status = 'completed'
  assert.equal(batchVideoState(next, 'batch'), 'completed')
})
