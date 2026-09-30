import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceVideoSegments } from './referenceVideo.js'
import {
  newProductVideo,
  newShot,
  buildPlanRequest,
  applyPlanningState,
  buildCompositionRequest,
  generationDuration,
  productVideoShotLimit,
  MINIMAX_VIDEO_MODEL,
  removeVideo,
} from './productVideo.js'

function fixture() {
  const data = newProductVideo()
  data.brief = 'Reference reproduction'
  data.planningSource = 'reference'
  data.planningModel = 'gem-3.8-flash'
  const segments = Array.from({ length: 14 }, (_, i) => ({ start: i * 7.5, end: (i + 1) * 7.5 }))
  data.referenceVideo = {
    url: 'https://assets.example/source.mp4',
    duration: 105,
    segments,
    suggestedShotCount: segments.length,
    frames: segments.flatMap(({ start, end }) =>
      [start + 0.03, (start + end) / 2, end - 0.04].map((time) => ({
        url: `https://assets.example/${time}.jpg`,
        time,
      })),
    ),
  }
  return data
}

test('highlights retain the entire source evidence but request one 30-second plan', () => {
  const data = fixture()
  data.referenceStrategy = 'highlights'
  data.productionMode = 'single_video_30'
  data.timelineCount = 4
  const original = JSON.stringify(data.referenceVideo)
  const request = buildPlanRequest(data, 14)
  assert.equal(request.count, 1)
  assert.equal(request.timelineCount, 4)
  assert.equal(request.productionMode, 'single_video_30')
  assert.equal(request.referenceVideo.strategy, 'highlights')
  assert.equal(request.referenceVideo.duration, 105)
  assert.equal(request.referenceVideo.frames.length, 42)
  assert.equal(request.referenceVideo.segments.at(-1).end, 105)
  assert.equal(JSON.stringify(data.referenceVideo), original)
  assert.equal(productVideoShotLimit(data), 8)
  data.productionMode = 'storyboard'
  assert.throws(() => buildPlanRequest(data, 4), /精华压缩/)
  data.productionMode = 'single_video_30'
  data.referenceVideo.duration = 25
  assert.throws(() => buildPlanRequest(data, 4), /精华压缩/)
})

test('highlight results do not acquire full-length segment timing and remain exportable after switching modes', () => {
  const data = fixture()
  data.referenceStrategy = 'highlights'
  data.productionMode = 'single_video_30'
  const request = buildPlanRequest(data, 1)
  data.planJob = { id: 'highlight-plan', request, referenceIds: [] }
  const state = {
    id: 'highlight-plan',
    status: 'completed',
    updatedAt: 1,
    count: 1,
    result: {
      shots: [
        {
          title: 'Highlights',
          productionMode: 'single_video_30',
          duration: 30,
          timeline: [{ start: 0, end: 30 }],
        },
      ],
    },
  }
  applyPlanningState(data, state)
  applyPlanningState(data, state)
  assert.equal(data.shots.length, 1)
  const shot = data.shots[0]
  assert.equal(shot.referenceStrategy, 'highlights')
  assert.equal(shot.referenceRange, undefined)
  assert.equal(generationDuration(shot, data), 30)
  Object.assign(shot, {
    kept: true,
    videoId: 'v',
    videos: [{ id: 'v', url: 'https://assets.example/highlights.mp4', duration: 30 }],
  })
  assert.equal(buildCompositionRequest(data).clips[0].duration, 30)
  data.referenceStrategy = 'faithful'
  data.productionMode = 'storyboard'
  assert.equal(buildCompositionRequest(data).clips[0].duration, 30)
  const refined = buildPlanRequest(data, 1, shot)
  assert.equal(refined.referenceVideo, undefined)
  assert.equal(refined.productionMode, 'single_video_30')
  assert.equal(refined.currentShot.duration, 30)
})

test('long reference segments cover the entire 105 seconds with bounded generation durations', () => {
  const segments = referenceVideoSegments([], 105)
  assert.equal(segments.length, 7)
  assert.deepEqual(segments[0], { start: 0, end: 15 })
  assert.deepEqual(segments.at(-1), { start: 90, end: 105 })
  const samples = Array.from({ length: 235 }, (_, i) => ({
    time: i * 0.45,
    signature: new Uint8Array(16).fill(Math.floor(i / 10) % 2 ? 230 : 20),
  }))
  const cuts = referenceVideoSegments(samples, 105)
  assert.ok(cuts.length > 8 && cuts.length <= 48)
  assert.equal(cuts[0].start, 0)
  assert.equal(cuts.at(-1).end, 105)
  cuts.forEach((item, i) => {
    assert.ok(item.end - item.start <= 15 && item.end - item.start >= 0.5)
    if (i) assert.equal(item.start, cuts[i - 1].end)
  })
  assert.throws(() => referenceVideoSegments([], 121))
})

test('long planning persists 14 timed segments without duplicate checkpoints', () => {
  const data = fixture()
  const request = buildPlanRequest(data, 4)
  assert.equal(request.count, 14)
  assert.equal(request.planningModel, 'gem-3.8-flash')
  assert.equal(request.referenceVideo.frames.length, 42)
  assert.equal(productVideoShotLimit(data), 48)
  data.planJob = { id: 'long-plan', request, referenceIds: [] }
  const shots = request.referenceVideo.segments.map(({ start, end }) => ({
    title: `Shot ${start}`,
    duration: end - start,
  }))
  for (const count of [2, 2, 6, 14, 14]) {
    applyPlanningState(data, {
      id: 'long-plan',
      status: 'processing',
      count: 14,
      updatedAt: count,
      result: { shots: shots.slice(0, count) },
    })
    assert.equal(data.shots.length, count)
  }
  assert.deepEqual(
    data.shots.map((shot) => shot.referenceRange),
    request.referenceVideo.segments,
  )
  assert.equal(
    data.shots.reduce((sum, shot) => sum + shot.duration, 0),
    105,
  )
  data.productionMode = 'single_video_30'
  assert.throws(() => buildPlanRequest(data, 1), /长参考视频/)
  assert.equal(productVideoShotLimit(newProductVideo()), 8)
})

test('refinement only receives frames from the selected original time range', () => {
  const data = fixture()
  const shot = newShot({ duration: 7.5, referenceRange: { start: 30, end: 37.5 } })
  const request = buildPlanRequest(data, 1, shot)
  assert.equal(request.referenceVideo.duration, 7.5)
  assert.deepEqual(request.referenceVideo.segments, [{ start: 0, end: 7.5 }])
  assert.equal(request.referenceVideo.frames.length, 3)
  assert.ok(request.referenceVideo.frames.every((frame) => frame.time >= 0 && frame.time <= 7.5))
  assert.equal(request.count, 1)
  data.videoModel = MINIMAX_VIDEO_MODEL
  data.videoDurationSeconds = 4
  assert.equal(generationDuration(shot, data), 8)
  shot.duration = 15.000000000000004
  assert.equal(generationDuration(shot, data), 15)
})

test('full-length export rejects dropped reordered or shortened segments and retains timing on video removal', () => {
  const data = fixture()
  data.shots = data.referenceVideo.segments.map((range, index) => ({
    ...newShot({ duration: range.end - range.start, referenceRange: range }),
    kept: true,
    videoId: 'v',
    videos: [{ id: 'v', url: `https://assets.example/${index}.mp4`, duration: 8 }],
  }))
  assert.equal(
    buildCompositionRequest(data).clips.reduce((sum, clip) => sum + clip.duration, 0),
    105,
  )
  data.shots[0].kept = false
  assert.throws(() => buildCompositionRequest(data), /原片等长合成/)
  data.shots[0].kept = true
  data.shots.reverse()
  assert.throws(() => buildCompositionRequest(data), /原片等长合成/)
  data.shots.reverse()
  data.shots[0].duration = 4
  assert.throws(() => buildCompositionRequest(data), /原片等长合成/)
  data.shots[0].duration = 7.5
  data.shots[0].videos.unshift({
    id: 'short',
    url: 'https://assets.example/short.mp4',
    duration: 4,
  })
  removeVideo(data.shots[0], 'v')
  assert.equal(data.shots[0].duration, 7.5)
})
