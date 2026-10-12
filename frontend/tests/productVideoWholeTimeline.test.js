import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  setShotMotion,
  buildVideoRequest,
} from '../src/utils/productVideo.js'
import {
  wholeTimeline,
  updateWholeTimeline,
  moveWholeBoundary,
  wholeTimelineIssue,
  wholeStatePrompt,
  selectProductionMode,
} from '../src/utils/productVideoWholeTimeline.js'
import {
  buildWholeVideoReview,
  currentWholeVideoReview,
  wholeVideoReviewIssue,
} from '../src/utils/productVideoContinuityReview.js'

const id = '00000000-0000-4000-8000-000000000001'
function fixture(seconds = 15) {
  const workflow = newProductVideo(),
    middle = seconds === 30 ? 10 : 5
  const shot = newShot({
    title: 'Whole movie',
    productionMode: seconds === 30 ? 'single_video_30' : 'single_video',
    duration: seconds,
    motion: `0-${middle} 秒：Pull right.\n${middle}-${seconds} 秒：Inspect the closed product.\n全片连续性：Same product.`,
    timeline: [
      {
        start: 0,
        end: middle,
        action: 'Pull right',
        camera: 'Follow',
        transition: 'Match',
        startState: 'Open',
        endState: 'Closed',
        transitionType: 'opening',
      },
      {
        start: middle,
        end: seconds,
        action: 'Inspect',
        camera: 'Closer',
        transition: 'Ending',
        startState: 'Closed',
        endState: 'Closed',
        transitionType: 'match_cut',
      },
    ],
  })
  shot.id = 'whole'
  shot.images = [{ id: 'image', url: 'https://assets.example/image.png' }]
  shot.imageId = shot.approvedImageId = 'image'
  shot.videos = [
    { id: 'v1', status: 'completed', url: 'https://assets.example/whole.mp4', duration: seconds },
  ]
  shot.videoId = 'v1'
  shot.kept = true
  workflow.shots = [shot]
  return { workflow, shot }
}

test('15 and 30 seconds remember independent preferred shot counts without changing existing shots', () => {
  const { workflow, shot } = fixture()
  selectProductionMode(workflow, 'single_video')
  assert.equal(workflow.timelineCount, 4)
  workflow.timelineCount = 3
  selectProductionMode(workflow, 'single_video_30')
  assert.equal(workflow.timelineCount, 6)
  workflow.timelineCount = 1
  selectProductionMode(workflow, 'single_video')
  assert.equal(workflow.timelineCount, 3)
  selectProductionMode(workflow, 'single_video_30')
  assert.equal(workflow.timelineCount, 1)
  assert.equal(shot.duration, 15)
})
test('moving a boundary updates adjacent time labels atomically without changing video or other descriptions', () => {
  const { shot } = fixture(),
    media = JSON.stringify(shot.videos)
  moveWholeBoundary(shot, 0, 6)
  assert.equal(shot.timeline[0].end, 6)
  assert.equal(shot.timeline[1].start, 6)
  assert.match(shot.motion, /^0-6 秒：Pull right\.\n6-15 秒：Inspect/)
  assert.equal(wholeTimelineIssue(shot), '')
  assert.equal(JSON.stringify(shot.videos), media)
  const before = JSON.stringify(shot)
  assert.throws(() => moveWholeBoundary(shot, 0, 14.5), /时间无效/)
  assert.equal(JSON.stringify(shot), before)
})
test('editing valid prompt ranges synchronizes structured timing, retaining unchanged states only', () => {
  const { shot } = fixture()
  setShotMotion(shot, '0-5 秒：Pull right.\n5-15 秒：New action.\n全片连续性：Same product.')
  assert.equal(shot.timeline[0].endState, 'Closed')
  assert.equal(shot.timeline[1].startState, '')
  assert.equal(shot.timeline[1].description, 'New action.')
  assert.equal(shot.timelineCount, 2)
  assert.equal(wholeTimelineIssue(shot), '')
})
test('incomplete, overlapping and conflicting edits remain visible but are rejected before video submission', () => {
  for (const text of [
    '0-5 秒：Pull.',
    '0-8 秒：Pull.\n5-15 秒：Inspect.',
    '0-5 秒：Pull.\n6-15 秒：Inspect.',
  ]) {
    const { workflow, shot } = fixture(),
      before = JSON.stringify(shot.timeline)
    setShotMotion(shot, text)
    assert.equal(shot.motion, text)
    assert.equal(JSON.stringify(shot.timeline), before)
    assert.ok(wholeTimelineIssue(shot))
    assert.throws(() => buildVideoRequest(workflow, shot, 'request'))
  }
})
test('state ledger and transition type reach generation; full original execution text is preserved', () => {
  const { workflow, shot } = fixture(30)
  workflow.wholeVideo30Model = 'ya-sd25-30s'
  const request = buildVideoRequest(workflow, shot, 'request')
  assert.match(request.prompt, /Open → Closed/)
  assert.match(request.prompt, /景别匹配/)
  assert.match(request.prompt, /Inspect the closed product/)
  assert.equal(request.durationSeconds, 30)
  assert.match(wholeStatePrompt(shot), /0-10秒/)
})
test('one whole video gets its own complete section review, separate from multi-clip boundary checks', () => {
  const { workflow, shot } = fixture(30),
    snapshot = buildWholeVideoReview(workflow, id, shot)
  assert.equal(snapshot.request.kind, 'timeline')
  assert.equal(snapshot.request.clips.length, 1)
  assert.equal(snapshot.request.clips[0].duration, 30)
  assert.equal(snapshot.request.timeline.length, 2)
  assert.match(wholeVideoReviewIssue(workflow, shot), /待检查/)
  shot.wholeReview = {
    id,
    fingerprint: snapshot.fingerprint,
    status: 'completed',
    results: [
      { index: 0, status: 'pass' },
      { index: 1, status: 'attention', issues: ['Repeated action'] },
    ],
    issues: [],
  }
  assert.equal(currentWholeVideoReview(workflow, shot), true)
  assert.match(wholeVideoReviewIssue(workflow, shot), /问题待确认/)
  shot.wholeReview.acknowledged = [1]
  assert.equal(wholeVideoReviewIssue(workflow, shot), '')
  shot.wholeReview.issues = ['Missing ending']
  assert.match(wholeVideoReviewIssue(workflow, shot), /结构问题/)
})

test('a short source cannot be manually approved as a complete 30-second movie', () => {
  const { workflow, shot } = fixture(30)
  shot.videos[0].duration = 15
  assert.throws(() => buildWholeVideoReview(workflow, id, shot), /实际视频时长不足/)
  assert.match(wholeVideoReviewIssue(workflow, shot), /待检查/)
})
test('manual approval is explicit, and versions, states and period edits invalidate old whole reviews', () => {
  for (const mutate of [
    (shot) => {
      shot.videoId = 'new'
      shot.videos.push({ ...shot.videos[0], id: 'new' })
    },
    (shot) => moveWholeBoundary(shot, 0, 6),
    (shot) => {
      shot.timeline[0].endState = 'Different'
    },
  ]) {
    const { workflow, shot } = fixture(),
      snapshot = buildWholeVideoReview(workflow, id, shot)
    shot.wholeManualApproval = { id, fingerprint: snapshot.fingerprint, confirmedAt: 1 }
    assert.equal(wholeVideoReviewIssue(workflow, shot), '')
    mutate(shot)
    assert.match(wholeVideoReviewIssue(workflow, shot), /待检查/)
  }
})
test('overlong timeline edits are atomic, legacy descriptions are readable without overwriting saved data', () => {
  const { shot } = fixture(),
    before = JSON.stringify(shot),
    beats = wholeTimeline(shot)
  beats[0].description = 'a'.repeat(1800)
  assert.throws(() => updateWholeTimeline(shot, beats), /超过 1800/)
  assert.equal(JSON.stringify(shot), before)
  assert.equal(wholeTimeline(shot)[0].description, 'Pull right.')
  assert.equal(JSON.stringify(shot), before)
})
