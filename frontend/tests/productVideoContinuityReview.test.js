import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newProductVideo,
  newShot,
  buildCompositionRequest,
  buildVideoRequest,
  buildPlanRequest,
} from '../src/utils/productVideo.js'
import {
  buildContinuityReview,
  currentContinuityReview,
  continuityReviewIssue,
  applyContinuityCut,
  currentManualContinuityApproval,
} from '../src/utils/productVideoContinuityReview.js'
import {
  previousShotTailSource,
  usableMotionObservation,
  shotConnectionPrompt,
  generationConnectionMetadata,
  adjacentProductVideoShots,
  shotMotionHandoffPrompt,
} from '../src/utils/productVideoShotConnections.js'

const id = '00000000-0000-4000-8000-000000000001'
function fixture() {
  const workflow = newProductVideo()
  workflow.continuity.enabled = false
  workflow.shots = Array.from({ length: 3 }, (_, index) => {
    const shot = newShot({
      title: `Shot ${index}`,
      motion: '本镜时长：4秒，向右持续移动',
      duration: 4,
      connection: {
        type: index ? 'match_cut' : 'opening',
        startState: 'Moving',
        endState: 'Still moving',
      },
    })
    shot.id = `shot-${index}`
    shot.images = [{ id: `image-${index}`, url: `https://assets.example/${index}.png` }]
    shot.imageId = shot.approvedImageId = `image-${index}`
    shot.videos = [
      {
        id: `video-${index}`,
        url: `https://assets.example/${index}.mp4`,
        duration: 6,
        status: 'completed',
      },
    ]
    shot.videoId = `video-${index}`
    shot.kept = true
    return shot
  })
  return workflow
}
function report(workflow, extra = {}) {
  const snapshot = buildContinuityReview(workflow, id)
  workflow.continuityReview = {
    ...snapshot,
    id,
    snapshot: snapshot.request,
    status: 'completed',
    acknowledged: [],
    issues: [],
    results: workflow.shots
      .filter((shot) => shot.kept)
      .slice(1)
      .map((shot, index) => ({
        index,
        previousId: snapshot.request.clips[index].shotId,
        currentId: shot.id,
        status: 'pass',
        confidence: 0.9,
        issues: [],
        previousState: 'Moving right',
        currentState: 'Same action',
        motion: 'Moving right',
        suggestedPreviousEnd: null,
        suggestedCurrentStart: null,
      })),
    ...extra,
  }
  return workflow.continuityReview
}

test('review follows retained edit order and excludes unretained clips', () => {
  const workflow = fixture()
  workflow.shots[1].kept = false
  const snapshot = buildContinuityReview(workflow, id)
  assert.deepEqual(
    snapshot.request.clips.map((clip) => clip.shotId),
    ['shot-0', 'shot-2'],
  )
  assert.equal(snapshot.request.clips[1].transition, 'match_cut')
  assert.equal(snapshot.request.clips.length, 2)
})

test('initial planning keeps unfinished shots, while final editing uses only the retained sequence', () => {
  const workflow = fixture()
  const last = workflow.shots[2]
  workflow.shots[1].kept = false
  assert.equal(adjacentProductVideoShots(workflow, last).previous.id, 'shot-1')
  assert.equal(buildPlanRequest(workflow, 1, last).contextShots.length, 3)
  workflow.compositionEditing = true
  assert.equal(adjacentProductVideoShots(workflow, last).previous.id, 'shot-0')
  assert.deepEqual(
    buildPlanRequest(workflow, 1, last).contextShots.map((item) => item.title),
    ['Shot 0', 'Shot 2'],
  )
  assert.equal(buildPlanRequest(workflow, 3).contextShots.length, 3)
  last.kept = false
  assert.match(shotMotionHandoffPrompt(workflow, workflow.shots[0]), /末镜可按策划减速停稳/)
})

test('refining a retained shot includes confirmed actual motion from its edited predecessor', () => {
  const workflow = fixture(),
    shot = workflow.shots[2]
  workflow.shots[1].kept = false
  workflow.compositionEditing = true
  const source = previousShotTailSource(workflow, shot)
  shot.motionObservation = {
    status: 'completed',
    confirmed: true,
    sourceKey: source.sourceKey,
    targetMotion: shot.motion,
    results: [{ previousState: 'Actual closed curtain', motion: 'Actual rightward movement' }],
  }
  const request = buildPlanRequest(workflow, 1, shot)
  assert.match(request.contextShots[0].design, /Actual closed curtain/)
  assert.match(request.contextShots[0].design, /Actual rightward movement/)
  assert.equal(request.contextShots.length, 2)
  workflow.shots[0].duration = 3
  assert.doesNotMatch(
    buildPlanRequest(workflow, 1, shot).contextShots[0].design,
    /Actual rightward movement/,
  )
})

test('composition dependencies use the actual retained predecessor, not a hidden middle shot', () => {
  const workflow = fixture()
  workflow.shots[2].videos[0].sourceConnectionKey = previousShotTailSource(
    workflow,
    workflow.shots[2],
  ).sourceKey
  workflow.shots[1].kept = false
  assert.throws(() => buildCompositionRequest(workflow), /衔接参考已过期/)
})

test('new order, selected version, cut, narrative and model invalidate the review', () => {
  for (const mutate of [
    (workflow) => workflow.shots.reverse(),
    (workflow) => {
      workflow.shots[0].start = 0.1
    },
    (workflow) => {
      workflow.shots[0].videoId = 'new'
      workflow.shots[0].videos.push({
        id: 'new',
        url: 'https://assets.example/new.mp4',
        duration: 6,
      })
    },
    (workflow) => {
      workflow.brief = 'New narrative'
    },
    (workflow) => {
      workflow.planningModel = 'new-model'
    },
  ]) {
    const workflow = fixture()
    report(workflow)
    assert.equal(currentContinuityReview(workflow), true)
    mutate(workflow)
    assert.equal(currentContinuityReview(workflow), false)
    assert.match(continuityReviewIssue(workflow), /请先检查/)
  }
})

test('audio and captions do not cause unnecessary repeat visual inspections', () => {
  const workflow = fixture()
  report(workflow)
  workflow.keepOriginalAudio = true
  workflow.smoothAudio = true
  workflow.musicVolume = 0.5
  workflow.shots[0].caption = 'New caption'
  assert.equal(currentContinuityReview(workflow), true)
})

test('explicit manual review is distinct from AI results and is invalidated by a new edit', () => {
  const workflow = fixture(),
    snapshot = buildContinuityReview(workflow, id)
  workflow.manualContinuityApproval = {
    id,
    fingerprint: snapshot.fingerprint,
    confirmedAt: Date.now(),
  }
  assert.equal(currentManualContinuityApproval(workflow), true)
  assert.equal(continuityReviewIssue(workflow), '')
  assert.equal(workflow.continuityReview, undefined)
  workflow.shots[1].duration = 3
  assert.equal(currentManualContinuityApproval(workflow), false)
  assert.match(continuityReviewIssue(workflow), /请先检查/)
})

test('attention, uncertainty and whole-story issues need explicit manual confirmation', () => {
  const workflow = fixture(),
    job = report(workflow)
  job.results[0].status = 'uncertain'
  assert.match(continuityReviewIssue(workflow), /1 处/)
  job.acknowledged = [0]
  assert.equal(continuityReviewIssue(workflow), '')
  job.issues = ['No closing action']
  assert.match(continuityReviewIssue(workflow), /整片结构/)
  job.wholeAcknowledged = true
  assert.equal(continuityReviewIssue(workflow), '')
  job.status = 'failed'
  assert.match(continuityReviewIssue(workflow), /未完成/)
})

test('legacy capability absence and one clip do not invent a multi-shot review requirement', () => {
  const workflow = fixture()
  assert.equal(continuityReviewIssue(workflow, false), '')
  workflow.shots = [workflow.shots[0]]
  assert.equal(continuityReviewIssue(workflow), '')
})

test('reference timing, speed and actual tail dependencies protect cut suggestions', () => {
  const workflow = fixture()
  workflow.shots[1].videos[0].sourceConnectionKey = previousShotTailSource(
    workflow,
    workflow.shots[1],
  ).sourceKey
  let clips = buildContinuityReview(workflow, id).request.clips
  assert.equal(clips[0].allowEndTrim, false)
  assert.equal(clips[1].allowStartTrim, false)
  workflow.shots[2].timingMode = 'speed'
  clips = buildContinuityReview(workflow, id).request.clips
  assert.equal(clips[2].allowStartTrim, false)
  assert.equal(clips[2].allowEndTrim, false)
  workflow.planningSource = 'reference'
  workflow.referenceVideo = { segments: [{ start: 0, end: 4 }] }
  assert.ok(
    buildContinuityReview(workflow, id).request.clips.every(
      (clip) => !clip.allowStartTrim && !clip.allowEndTrim,
    ),
  )
})

test('applying a cut only changes edit timing, preserves source and script, and invalidates the review', () => {
  const workflow = fixture(),
    job = report(workflow)
  job.results[0].suggestedPreviousEnd = 3.6
  job.results[0].suggestedCurrentStart = 0.4
  const source = JSON.stringify(
    workflow.shots.map((shot) => [shot.videos, shot.motion, shot.scriptDuration]),
  )
  assert.equal(applyContinuityCut(workflow, job.results[0]), 2)
  assert.equal(workflow.shots[0].duration, 3.6)
  assert.equal(workflow.shots[1].start, 0.4)
  assert.equal(workflow.shots[1].duration, 3.6)
  assert.equal(
    JSON.stringify(workflow.shots.map((shot) => [shot.videos, shot.motion, shot.scriptDuration])),
    source,
  )
  assert.equal(currentContinuityReview(workflow), false)
  assert.throws(() => applyContinuityCut(workflow, job.results[0]), /已过期/)
})

test('forged or out-of-range suggestions cannot partially modify timing', () => {
  const workflow = fixture(),
    job = report(workflow)
  job.results[0].suggestedPreviousEnd = 3.6
  job.results[0].suggestedCurrentStart = 5
  assert.throws(() => applyContinuityCut(workflow, job.results[0]), /超出建议范围/)
  assert.equal(workflow.shots[0].duration, 4)
  assert.throws(
    () => applyContinuityCut(workflow, { ...job.results[0], suggestedCurrentStart: 0.2 }),
    /不属于/,
  )
})

test('actual motion requires confirmation and binds both prompt and dependencies to the actual source', () => {
  const workflow = fixture(),
    shot = workflow.shots[1]
  const snapshot = buildContinuityReview(workflow, id, shot)
  shot.motionObservation = {
    id,
    status: 'completed',
    sourceKey: snapshot.sourceKey,
    targetMotion: shot.motion,
    results: [
      {
        previousState: 'Curtain is closed; hand is moving right',
        motion: 'Keep moving right at slow speed',
      },
    ],
  }
  assert.equal(usableMotionObservation(workflow, shot), null)
  shot.motionObservation.confirmed = true
  assert.ok(usableMotionObservation(workflow, shot))
  assert.match(shotConnectionPrompt(workflow, shot), /Keep moving right/)
  assert.equal(
    generationConnectionMetadata(workflow, shot, 'video').sourceConnectionKey,
    snapshot.sourceKey,
  )
  workflow.videoModel = 'doubao-seedance-2-5-260628'
  assert.match(buildVideoRequest(workflow, shot, 'request').prompt, /实际前镜/)
  workflow.shots[0].duration = 3
  assert.equal(usableMotionObservation(workflow, shot), null)
})

test('changing a next-shot script invalidates its previously confirmed motion reference', () => {
  const workflow = fixture(),
    shot = workflow.shots[1],
    snapshot = buildContinuityReview(workflow, id, shot)
  shot.motionObservation = {
    status: 'completed',
    confirmed: true,
    sourceKey: snapshot.sourceKey,
    targetMotion: shot.motion,
    results: [{ motion: 'Actual movement' }],
  }
  shot.motion = 'Different action'
  assert.equal(usableMotionObservation(workflow, shot), null)
})
