import test from 'node:test'
import assert from 'node:assert/strict'
import { SEEDANCE_ANCI_MODEL as model, videoVersionPayload, seedanceAnciNotice } from '../src/utils/seedanceAnci.js'
import { videoDurationOptions, videoResolutionOptions, videoReferenceLimit, supportsVideoFrameMode,
  supportsVideoAudioToggle, videoAudioPayload, videoReferencePayload, videoRatioForRequest,
  videoReferenceVideosError, estimatedVideoMiCost } from '../src/utils/chatVideoSettings.js'
import { normalizeVideoNodeDraft } from '../src/utils/videoNodeDraft.js'
import { newProductVideo, newShot, buildVideoRequest, wholeVideoModelOptions } from '../src/utils/productVideo.js'
import { productVideoBatchConfiguration } from '../src/utils/productVideoBatch.js'
import { agentVideoContext } from '../src/utils/agentVideoContext.js'

test('per-video settings match the 720p reference-only contract without per-second estimates', () => {
  assert.deepEqual(videoDurationOptions(model), Array.from({ length: 12 }, (_, i) => i + 4))
  assert.deepEqual(videoResolutionOptions(model), ['720p'])
  assert.equal(videoReferenceLimit(model, 'first_last_frame'), 9)
  assert.equal(supportsVideoFrameMode(model), false)
  assert.equal(supportsVideoAudioToggle(model), false)
  assert.deepEqual(videoAudioPayload(model, false), {})
  assert.equal(videoRatioForRequest(model, 1, 'adaptive'), '3:4')
  assert.equal(videoRatioForRequest(model, 9, '4:3'), '4:3')
  assert.equal(estimatedVideoMiCost(model, '720p', 4), 0)
  assert.equal(estimatedVideoMiCost(model, '720p', 15), 0)
  assert.equal(estimatedVideoMiCost(model, '1080p', 15), null)
  assert.match(videoReferenceVideosError(model, 'cankaosheng', [{ url: 'https://a.example/a.mp4' }]), /不支持参考视频/)
  assert.deepEqual(wholeVideoModelOptions([{ value: model }], 30), [])
})

test('speed version survives saved drafts and generated-video context', () => {
  const draft = normalizeVideoNodeDraft({ config: { model, version: '标准', ratio: '21:9', resolution: '4k',
    duration: 15, generateAudio: false, referenceMode: 'first_last_frame' } })
  const restored = normalizeVideoNodeDraft(JSON.parse(JSON.stringify(draft)))
  assert.equal(restored.config.version, '标准')
  assert.equal(restored.config.referenceMode, 'cankaosheng')
  assert.equal(restored.config.resolution, '720p')
  assert.equal(restored.config.ratio, '3:4')
  assert.equal(restored.config.generateAudio, true)
  assert.equal(normalizeVideoNodeDraft({ config: { model } }).config.version, '快速')
  assert.deepEqual(videoVersionPayload(model, '标准'), { version: '标准' })
  assert.deepEqual(videoVersionPayload('other-model', '标准'), {})
  assert.equal(agentVideoContext({ videoUrl: 'https://a.example/a.mp4', videoRequest: { model, version: '标准' } }).video.version, '标准')
  assert.match(seedanceAnciNotice(model, '标准', 15), /约10秒/)
  assert.doesNotMatch(seedanceAnciNotice(model, '快速', 15), /约10秒/)
})

test('all nine original reference URLs are submitted in order without frame parameters', () => {
  const images = Array.from({ length: 9 }, (_, i) => `https://a.example/original-${i}.png`)
  assert.deepEqual(videoReferencePayload(model, 'first_last_frame', images), { image_urls: images })
  assert.deepEqual(videoReferencePayload(model, 'cankaosheng', []), { image_urls: [] })
  assert.throws(() => videoReferencePayload(model, 'cankaosheng', [...images, 'https://a.example/10.png']), /上限/)
})

test('product-video generation sends the selected speed, original reference and native audio', () => {
  const workflow = newProductVideo()
  workflow.videoModel = model
  workflow.videoVersion = '标准'
  workflow.generateAudio = false
  const shot = newShot({ motion: '展示商品', duration: 5 })
  shot.images = [{ id: 'image', status: 'completed', url: 'https://a.example/original.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  workflow.shots = [shot]
  const request = buildVideoRequest(workflow, shot, 'anci-test')
  assert.equal(request.model, model)
  assert.equal(request.version, '标准')
  assert.equal(request.durationSeconds, 5)
  assert.equal(request.resolution, '720p')
  assert.deepEqual(request.image_urls, ['https://a.example/original.png'])
  assert.equal(request.first_frame_url, undefined)
  assert.equal(request.generate_audio, undefined)
  assert.doesNotMatch(request.prompt, /不要生成音轨|仅生成静音/)
  const first = productVideoBatchConfiguration(workflow, [shot.id])
  workflow.videoVersion = '快速'
  assert.notEqual(productVideoBatchConfiguration(workflow, [shot.id]), first)
})
