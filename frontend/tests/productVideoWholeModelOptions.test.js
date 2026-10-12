import test from 'node:test'
import assert from 'node:assert/strict'
import {
  wholeVideoModelOptions,
  ANMIAO_VIDEO_MODEL,
  ANMIAO20_FAST_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  WHOLE_VIDEO_30_MODEL,
  newProductVideo,
  newShot,
  buildVideoRequest,
} from '../src/utils/productVideo.js'

const mappedModels = [
  { value: ANMIAO_VIDEO_MODEL, label: 'seedance-2.0标准' },
  { value: ANMIAO20_FAST_VIDEO_MODEL, label: 'seedance-2.0快速' },
  { value: ANMIAO25_VIDEO_MODEL, label: 'seedance-2.5' },
  { value: MINIMAX_VIDEO_MODEL, label: 'MiniMax H3' },
]

test('15-second whole videos offer all currently mapped models, 30 seconds only offers supported models', () => {
  assert.deepEqual(wholeVideoModelOptions(mappedModels, 15), mappedModels)
  assert.deepEqual(wholeVideoModelOptions(mappedModels, 30), [mappedModels[2]])
  assert.deepEqual(wholeVideoModelOptions(mappedModels, 20), [])
  assert.deepEqual(wholeVideoModelOptions([], 15), [])
  assert.deepEqual(wholeVideoModelOptions([], 30), [])
})

test('whole-video selectors do not introduce static or retired models absent from mappings', () => {
  assert.ok(!wholeVideoModelOptions(mappedModels, 30).some(option => option.value === WHOLE_VIDEO_30_MODEL))
  const legacy = { value: WHOLE_VIDEO_30_MODEL, label: 'Mapped legacy 30s' }
  const alias = { value: 'seedance-2.5-guanfang-anmiao', label: 'Mapped SD2.5 alias' }
  const retired = { value: 'minimax-h3-max', label: 'Retired' }
  assert.deepEqual(wholeVideoModelOptions([legacy, alias, retired], 30), [legacy, alias])
  assert.deepEqual(wholeVideoModelOptions([legacy, alias, retired], 15), [alias])
})

function workflowWithWholeShots() {
  const workflow = newProductVideo()
  workflow.videoModel = MINIMAX_VIDEO_MODEL
  workflow.minimaxResolution = '768p'
  workflow.wholeVideo30Model = ANMIAO25_VIDEO_MODEL
  workflow.wholeVideo30Resolution = '1080p'
  workflow.shots = ['single_video', 'single_video_30'].map(productionMode => {
    const shot = newShot({ productionMode, motion: '按整片时间轴连续拍摄', duration: productionMode === 'single_video' ? 15 : 30 })
    shot.images = [{ id: 'image', url: 'https://media.example/frame.jpg', status: 'completed' }]
    shot.imageId = shot.approvedImageId = 'image'
    return shot
  })
  return workflow
}

test('whole-video requests retain independent selected model, duration and resolution for 15 and 30 seconds', () => {
  const workflow = workflowWithWholeShots()
  const request15 = buildVideoRequest(workflow, workflow.shots[0], 'whole-15')
  assert.equal(request15.model, MINIMAX_VIDEO_MODEL)
  assert.equal(request15.durationSeconds, 15)
  assert.equal(request15.resolution, '768p')
  const request30 = buildVideoRequest(workflow, workflow.shots[1], 'whole-30')
  assert.equal(request30.model, ANMIAO25_VIDEO_MODEL)
  assert.equal(request30.durationSeconds, 30)
  assert.equal(request30.resolution, '1080p')
  assert.equal(request30.ratio, 'adaptive')
  assert.equal(workflow.videoModel, MINIMAX_VIDEO_MODEL)
  assert.equal(workflow.wholeVideo30Model, ANMIAO25_VIDEO_MODEL)
})

test('supported mapped SD2.5 aliases retain 30-second limits and unsupported choices fail before submission', () => {
  const workflow = workflowWithWholeShots(), shot = workflow.shots[1]
  workflow.wholeVideo30Model = 'seedance-2.5-guanfang-anmiao'
  const request = buildVideoRequest(workflow, shot, 'alias')
  assert.equal(request.durationSeconds, 30)
  assert.equal(request.resolution, '1080p')
  assert.equal(request.ratio, 'adaptive')
  for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO20_FAST_VIDEO_MODEL, MINIMAX_VIDEO_MODEL]) {
    workflow.wholeVideo30Model = model
    assert.throws(() => buildVideoRequest(workflow, shot, 'unsupported'), /4 至 15/)
  }
})
