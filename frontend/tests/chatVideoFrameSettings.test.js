import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
} from '../src/utils/productVideo.js'
import {
  SEEDANCE_FIRST_LAST_MODE,
  isVideoFrameMode,
  videoFrameModeValue,
  videoReferenceModeForRequest,
  videoRatioForRequest,
  videoReferenceLimit,
  videoReferencePayload,
} from '../src/utils/chatVideoSettings.js'

const frames = ['https://assets.test/first.png', 'https://assets.test/last.png']

test('sidebar mode choices map to provider-specific first/last or generic reference roles', () => {
  for (const model of [
    ANMIAO_VIDEO_MODEL,
    ANMIAO25_VIDEO_MODEL,
    'seedance-2.0-guanfang-anmiao',
    'seedance-2.5-guanfang-anmiao',
    MINIMAX_VIDEO_MODEL,
  ]) {
    const mode = videoReferenceModeForRequest(model, 'shouweizhen')
    assert.equal(mode, videoFrameModeValue(model))
    assert.deepEqual(videoReferencePayload(model, mode, frames), {
      first_frame_url: frames[0], last_frame_url: frames[1],
    })
    assert.equal(videoReferenceModeForRequest(model, mode), mode)
    const referenceMode = videoReferenceModeForRequest(model, 'cankaosheng')
    assert.equal(referenceMode, 'cankaosheng')
    assert.deepEqual(videoReferencePayload(model, referenceMode, frames), { image_urls: frames })
  }
  const legacy = 'seedance-2.0-fast-0826-720p'
  assert.equal(videoReferenceModeForRequest(legacy, 'shouweizhen'), 'cankaosheng')
  assert.deepEqual(videoReferencePayload(legacy, videoReferenceModeForRequest(legacy, 'shouweizhen'), frames), {
    image_urls: frames,
  })
})

for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL, MINIMAX_VIDEO_MODEL]) {
  test(`${model} submits explicit first/last frames without generic references`, () => {
    const mode = videoFrameModeValue(model)
    assert.equal(isVideoFrameMode(model, mode), true)
    assert.equal(videoReferenceLimit(model, mode), 2)
    assert.deepEqual(videoReferencePayload(model, mode, frames), {
      first_frame_url: frames[0],
      last_frame_url: frames[1],
    })
    assert.throws(
      () => videoReferencePayload(model, mode, [...frames, 'https://assets.test/extra.png']),
      /上限/,
    )
    assert.equal(videoReferencePayload(model, mode, frames.slice(0, 1)).last_frame_url, undefined)
  })
}

test('SD2.5 enforces adaptive ratio for both one-frame and first/last-frame requests', () => {
  assert.equal(
    videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 1, '9:16', SEEDANCE_FIRST_LAST_MODE),
    'adaptive',
  )
  assert.equal(
    videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 2, '9:16', SEEDANCE_FIRST_LAST_MODE),
    'adaptive',
  )
  assert.equal(
    videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 0, '9:16', SEEDANCE_FIRST_LAST_MODE),
    '9:16',
  )
  assert.equal(videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 2, '9:16', 'cankaosheng'), '9:16')
  assert.equal(
    videoRatioForRequest(ANMIAO_VIDEO_MODEL, 2, '9:16', SEEDANCE_FIRST_LAST_MODE),
    '9:16',
  )
})

test('legacy Seedance requests still use reference images and retain their limits', () => {
  for (const [model, limit] of [
    [ANMIAO_VIDEO_MODEL, 9],
    [ANMIAO25_VIDEO_MODEL, 30],
  ]) {
    assert.equal(videoReferenceLimit(model, 'shouweizhen'), limit)
    assert.deepEqual(videoReferencePayload(model, 'shouweizhen', frames), { image_urls: frames })
    assert.deepEqual(videoReferencePayload(model, 'cankaosheng', frames), { image_urls: frames })
  }
  assert.equal(videoReferenceLimit('seedance-2.0-fast-0826-720p', 'shouweizhen'), 15)
})
