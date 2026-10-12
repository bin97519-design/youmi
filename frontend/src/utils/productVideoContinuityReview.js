import { selectedVideo, isWholeVideo } from './productVideo.js'
import { wholeTimeline, wholeSeconds, validateWholeTimeline, wholeTimelineIssue } from './productVideoWholeTimeline.js'
import {
  shotConnection,
  previousShotTailSource,
  adjacentProductVideoShots,
} from './productVideoShotConnections.js'

export const reviewRunning = (job) =>
  ['submitting', 'queued', 'processing', 'stopping'].includes(job?.status)
const clean = (text, max) => String(text || '').slice(0, max)
const retained = (workflow) => workflow.shots.filter((shot) => shot.kept)

export function buildWholeVideoReview(workflow, id, shot) {
  if (!isWholeVideo(shot?.productionMode)) throw new Error('请选择15或30秒整片')
  const video = selectedVideo(shot)
  if (!video?.url || ['failed', 'submitting', 'processing', 'unknown'].includes(video.status)) throw new Error('请先完成整片视频')
  if (Number.isFinite(Number(video.duration)) && Number(video.duration) > 0 && Number(video.duration) + .05 < wholeSeconds(shot))
    throw new Error('实际视频时长不足整片策划时长，请核对生成结果')
  const problem = wholeTimelineIssue(shot)
  if (problem) throw new Error(problem)
  const timeline = wholeTimeline(shot)
  validateWholeTimeline(timeline, wholeSeconds(shot))
  const request = { id, kind: 'timeline', model: workflow.planningModel || 'default',
    concept: clean(shot.concept || workflow.lastPlanSummary?.concept || workflow.brief, 1200),
    clips: [{ shotId: shot.id, title: clean(shot.title, 120), url: video.url, start: 0, duration: wholeSeconds(shot),
      timingMode: 'trim', transition: 'opening', motion: '', startState: '', endState: '', allowStartTrim: false, allowEndTrim: false }],
    timeline }
  return { request, sourceKey: '', fingerprint: JSON.stringify({ ...request, id: undefined, version: video.id }) }
}

export function currentWholeVideoReview(workflow, shot, job = shot?.wholeReview) {
  if (!job?.id || !job.fingerprint) return false
  try { return buildWholeVideoReview(workflow, job.id, shot).fingerprint === job.fingerprint }
  catch { return false }
}

export function wholeVideoReviewIssue(workflow, shot, required = true) {
  if (!required || !isWholeVideo(shot?.productionMode)) return ''
  if (shot.wholeManualApproval && currentWholeVideoReview(workflow, shot, shot.wholeManualApproval)) return ''
  const job = shot.wholeReview
  if (!currentWholeVideoReview(workflow, shot)) return `「${shot.title}」整片时段待检查`
  if (job.status !== 'completed') return `「${shot.title}」整片检查未完成`
  if (job.results?.length !== wholeTimeline(shot).length) return '整片时段检查结果不完整'
  if (job.issues?.length && !job.wholeAcknowledged) return '整片结构问题待确认'
  if (job.results.some(item => (item.status !== 'pass' || item.issues?.length) && !job.acknowledged?.includes(item.index))) return '整片时段问题待确认'
  return ''
}

function clip(workflow, shot, allowStartTrim, allowEndTrim) {
  const video = selectedVideo(shot)
  if (!video?.url) throw new Error(`${shot.title} 尚无可用视频`)
  const start = shot.timingMode === 'speed' ? 0 : Number(shot.start)
  const duration = Number(shot.duration)
  if (
    ![start, duration].every(Number.isFinite) ||
    start < 0 ||
    duration < 0.5 ||
    duration > 30 ||
    duration > Number(video.duration || 15) ||
    start + duration > Number(video.duration || 15) + 0.05
  )
    throw new Error(`${shot.title} 的裁剪范围无效`)
  const connection = shotConnection(workflow, shot)
  return {
    shotId: shot.id,
    title: clean(shot.title, 120),
    url: video.url,
    start,
    duration,
    timingMode: shot.timingMode === 'speed' ? 'speed' : 'trim',
    transition: connection.type,
    motion: clean(shot.motion, 600),
    startState: connection.startState,
    endState: connection.endState,
    allowStartTrim,
    allowEndTrim,
  }
}

export function buildContinuityReview(workflow, id, targetShot = null) {
  const shots = targetShot
    ? [adjacentProductVideoShots(workflow, targetShot).previous]
    : retained(workflow)
  if (shots.some((shot) => !shot) || shots.length < (targetShot ? 1 : 2))
    throw new Error('请先准备实际视频片段')
  const lockedEnds = new Set()
  let unparsedDependency = false
  for (const shot of shots) {
    const key = selectedVideo(shot)?.sourceConnectionKey
    if (!key) continue
    try {
      lockedEnds.add(JSON.parse(key).shotId)
    } catch {
      unparsedDependency = true
    }
  }
  const referenceLocked =
    workflow.planningSource === 'reference' &&
    workflow.referenceVideo?.segments?.length &&
    !shots.every((shot) => shot.referenceStrategy === 'highlights')
  const sequence = targetShot ? workflow : { ...workflow, shots }
  const clips = shots.map((shot) => {
    const connection = shotConnection(sequence, shot)
    const editable =
      !targetShot && !referenceLocked && !shot.referenceRange && shot.timingMode !== 'speed'
    return clip(
      sequence,
      shot,
      Boolean(
        editable && !selectedVideo(shot)?.sourceConnectionKey && connection.type !== 'continue',
      ),
      Boolean(editable && !lockedEnds.has(shot.id) && !unparsedDependency),
    )
  })
  const source = targetShot && previousShotTailSource(workflow, targetShot)
  if (targetShot && !source) throw new Error('请先完成上一镜视频并确定裁剪范围')
  const concept = targetShot
    ? `分析前镜实际动作，用于下一镜「${clean(targetShot.title, 120)}」。下一镜计划：${clean(targetShot.motion, 500)}。${clean(workflow.lastPlanSummary?.concept, 500)}`
    : clean(workflow.lastPlanSummary?.concept || workflow.brief, 1200)
  const request = {
    id,
    kind: targetShot ? 'handoff' : 'boundaries',
    model: workflow.planningModel || 'default',
    concept,
    clips,
  }
  return {
    request,
    sourceKey: source?.sourceKey || '',
    fingerprint: JSON.stringify({
      ...request,
      id: undefined,
      versions: shots.map((shot) => selectedVideo(shot)?.id),
      sourceKey: source?.sourceKey || '',
    }),
  }
}

export function currentContinuityReview(
  workflow,
  job = workflow.continuityReview,
  targetShot = null,
) {
  if (!job?.id || !job.fingerprint) return false
  try {
    return buildContinuityReview(workflow, job.id, targetShot).fingerprint === job.fingerprint
  } catch {
    return false
  }
}

export function continuityReviewIssue(workflow, required = true) {
  if (!required || retained(workflow).length < 2) return ''
  if (currentManualContinuityApproval(workflow)) return ''
  const job = workflow.continuityReview
  if (!job || !currentContinuityReview(workflow, job)) return '请先检查当前成片的实际衔接'
  if (reviewRunning(job)) return '实际视频衔接检查中'
  if (job.status !== 'completed') return '衔接检查未完成，请核对检查结果'
  if ((job.results?.length || 0) !== retained(workflow).length - 1) return '衔接检查结果不完整'
  if (job.issues?.length && !job.wholeAcknowledged) return '整片结构问题待确认'
  const pending = job.results.filter(
    (item) =>
      (item.status !== 'pass' || item.issues?.length) && !job.acknowledged?.includes(item.index),
  )
  return pending.length ? `${pending.length} 处镜间衔接待确认` : ''
}

export function currentManualContinuityApproval(workflow) {
  const approval = workflow.manualContinuityApproval
  if (!approval?.fingerprint) return false
  try {
    return buildContinuityReview(workflow, approval.id).fingerprint === approval.fingerprint
  } catch {
    return false
  }
}

export function applyContinuityCut(workflow, result) {
  const job = workflow.continuityReview
  if (job?.status !== 'completed' || !currentContinuityReview(workflow, job))
    throw new Error('剪辑建议已过期，请重新检查')
  const stored = job.results?.find((item) => item.index === result.index)
  if (!stored || JSON.stringify(stored) !== JSON.stringify(result))
    throw new Error('剪辑建议不属于当前检查')
  const shots = retained(workflow)
  const previous = shots[result.index],
    current = shots[result.index + 1]
  if (previous?.id !== result.previousId || current?.id !== result.currentId)
    throw new Error('成片顺序已改变')
  const snapshot = buildContinuityReview(workflow, job.id).request.clips
  const updates = []
  if (result.suggestedPreviousEnd != null) {
    const target = Number(result.suggestedPreviousEnd),
      original = snapshot[result.index]
    const end = original.start + original.duration
    if (
      !original.allowEndTrim ||
      !Number.isFinite(target) ||
      target < end - 0.85 ||
      target > end ||
      target - original.start < 0.5
    )
      throw new Error('前镜切点不可调整或超出建议范围')
    updates.push({ shot: previous, start: original.start, duration: target - original.start })
  }
  if (result.suggestedCurrentStart != null) {
    const target = Number(result.suggestedCurrentStart),
      original = snapshot[result.index + 1]
    const end = original.start + original.duration
    if (
      !original.allowStartTrim ||
      !Number.isFinite(target) ||
      target < original.start ||
      target > original.start + 0.85 ||
      end - target < 0.5
    )
      throw new Error('本镜切点不可调整或超出建议范围')
    updates.push({ shot: current, start: target, duration: end - target })
  }
  if (!updates.length) throw new Error('当前衔接没有可应用的剪辑建议')
  for (const update of updates) {
    update.shot.start = update.start
    update.shot.duration = update.duration
  }
  return updates.length
}

export function motionObservationRequired(workflow, shot) {
  return !isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue'
}
